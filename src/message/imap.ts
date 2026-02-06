/**
 * Lightweight IMAP IDLE Client - Node.js native tls only, zero dependencies.
 *
 * Implements the minimal IMAP subset needed for real-time mail monitoring:
 * LOGIN, SELECT, SEARCH UNSEEN, FETCH BODY.PEEK[], STORE +FLAGS, IDLE, LOGOUT.
 *
 * IMAP is a tagged protocol: each command gets a unique tag (A0001, A0002...),
 * and the server's completion response carries the same tag. Untagged responses
 * start with '*'. IDLE is special: server sends '+ idling' as continuation,
 * then pushes '* N EXISTS' on new mail, client sends 'DONE' to exit.
 */

import * as tls from 'tls'
import { EventEmitter } from 'events'

export interface ImapOptions {
  host: string
  port: number
  user: string
  pass: string
  timeout?: number
}

const CRLF = '\r\n'
const TIMEOUT_CONNECT = 10_000
const TIMEOUT_COMMAND = 30_000
const IDLE_RENEW_MS = 25 * 60 * 1000 // 25 minutes

// ── State for the current in-flight tagged command ──────────────

interface PendingCommand {
  tag: string
  resolve: (lines: string[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  /** Accumulates untagged response lines */
  lines: string[]
  /** For FETCH: tracks literal byte collection */
  literal: LiteralState | null
}

interface LiteralState {
  /** Total bytes expected */
  size: number
  /** Bytes collected so far (binary string) */
  collected: string
}

// ── IDLE state ──────────────────────────────────────────────────

interface IdleState {
  tag: string
  resolve: (exists: number) => void
  reject: (err: Error) => void
  /** Latest EXISTS count seen during this IDLE session */
  exists: number
  /** Whether we already sent DONE (waiting for tagged OK) */
  doneSent: boolean
  /** 25-min renewal timer */
  renewTimer: ReturnType<typeof setTimeout>
}

export class ImapClient extends EventEmitter {
  private opts: Required<ImapOptions>
  private sock: tls.TLSSocket | null = null
  private buf = ''  // binary (latin1) buffer
  private tagCounter = 1
  private pending: PendingCommand | null = null
  private idleState: IdleState | null = null
  private alive = false
  private greeting = ''

  constructor(options: ImapOptions) {
    super()
    this.opts = {
      timeout: TIMEOUT_CONNECT,
      ...options,
    }
  }

  // ── Public API ────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.greeting = await this.open()

    // Coremail (163/126/yeah.net) requires RFC 2971 ID before LOGIN
    if (this.isCoremail()) {
      await this.exec('ID ("name" "jarvis" "version" "1.0" "vendor" "jarvis-agent")')
      console.log('[Imap] sent ID command (Coremail detected)')
    }

    await this.exec(`LOGIN ${this.opts.user} ${this.opts.pass}`)
    console.log(`[Imap] authenticated as ${this.opts.user}`)
  }

  private isCoremail(): boolean {
    return this.greeting.toLowerCase().includes('coremail')
  }

  async capability(): Promise<string[]> {
    const lines = await this.exec('CAPABILITY')
    // * CAPABILITY IMAP4rev1 IDLE NAMESPACE ...
    for (const line of lines) {
      if (line.startsWith('* CAPABILITY')) {
        return line.slice('* CAPABILITY'.length).trim().toUpperCase().split(/\s+/)
      }
    }
    return []
  }

  async noop(): Promise<void> {
    await this.exec('NOOP')
  }

  async selectInbox(): Promise<{ exists: number; recent: number }> {
    const lines = await this.exec('SELECT INBOX')
    let exists = 0
    let recent = 0
    for (const line of lines) {
      const em = line.match(/^\* (\d+) EXISTS$/i)
      if (em) exists = parseInt(em[1], 10)
      const rm = line.match(/^\* (\d+) RECENT$/i)
      if (rm) recent = parseInt(rm[1], 10)
    }
    console.log(`[Imap] INBOX selected: ${exists} exists, ${recent} recent`)
    return { exists, recent }
  }

  async searchUnseen(): Promise<number[]> {
    const lines = await this.exec('SEARCH UNSEEN')
    // * SEARCH 1 3 5 7
    for (const line of lines) {
      if (line.startsWith('* SEARCH')) {
        const nums = line.slice('* SEARCH'.length).trim()
        if (!nums) return []
        return nums.split(/\s+/).map(n => parseInt(n, 10))
      }
    }
    return []
  }

  async fetch(seqNum: number): Promise<string> {
    const lines = await this.exec(`FETCH ${seqNum} BODY.PEEK[]`)
    // Lines contain the literal content joined together.
    // The first line is '* N FETCH (BODY[] {size}' -- skip it.
    // The last line is ')' -- skip it.
    // Everything in between is the raw email, already extracted by literal parsing.
    // Find the literal content: it's stored as a single entry prefixed with \x00LITERAL\x00
    for (const line of lines) {
      if (line.startsWith('\x00LITERAL\x00')) {
        return line.slice('\x00LITERAL\x00'.length)
      }
    }
    // Fallback: join all untagged lines (shouldn't happen with proper literal parsing)
    return lines.filter(l => !l.startsWith('*')).join(CRLF)
  }

  async markSeen(seqNum: number): Promise<void> {
    await this.exec(`STORE ${seqNum} +FLAGS (\\Seen)`)
  }

  async idle(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (!this.sock) {
        return reject(new Error('[Imap] not connected'))
      }

      const tag = this.nextTag()

      const renewTimer = setTimeout(() => {
        // 25-min renewal: send DONE, then caller re-enters idle
        this.exitIdle()
      }, IDLE_RENEW_MS)

      this.idleState = {
        tag,
        resolve,
        reject,
        exists: 0,
        doneSent: false,
        renewTimer,
      }

      this.sock.write(`${tag} IDLE${CRLF}`, 'binary')
      console.log(`[Imap] >> ${tag} IDLE`)
    })
  }

  async logout(): Promise<void> {
    this.cancelIdle()
    try {
      await this.exec('LOGOUT')
    } catch {
      // don't care if logout fails
    }
    this.destroy()
  }

  isAlive(): boolean {
    return this.alive
  }

  // ── Connection ────────────────────────────────────────────────

  private open(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = this.opts.timeout

      const onError = (err: Error) => {
        this.destroy()
        reject(new Error(`[Imap] connect failed: ${err.message}`))
      }

      const sock = tls.connect(
        { host: this.opts.host, port: this.opts.port },
        () => {
          console.log(`[Imap] TLS connected to ${this.opts.host}:${this.opts.port}`)
        },
      )

      // Use binary (latin1) encoding so literal byte counts are accurate
      sock.setEncoding('binary')
      sock.setTimeout(timeout)

      sock.once('error', onError)
      sock.once('timeout', () => {
        this.destroy()
        reject(new Error(`[Imap] connect timeout (${timeout}ms)`))
      })

      this.sock = sock
      this.alive = true

      // After initial setup, wire persistent handlers
      sock.on('data', (chunk: string) => this.onData(chunk))
      sock.on('error', (err: Error) => {
        this.alive = false
        this.emit('error', err)
      })
      sock.on('close', () => {
        this.alive = false
        this.emit('close')
      })

      // Wait for server greeting: * OK ...
      this.waitGreeting(resolve as (greeting: string) => void, reject, timeout)
    })
  }

  private waitGreeting(
    resolve: (greeting: string) => void,
    reject: (err: Error) => void,
    timeout: number,
  ): void {
    const timer = setTimeout(() => {
      this.destroy()
      reject(new Error(`[Imap] greeting timeout (${timeout}ms)`))
    }, timeout)

    // Greeting is untagged: * OK ...
    // We use a pseudo-pending with tag '*' to catch it
    this.pending = {
      tag: '*',
      resolve: (lines) => {
        clearTimeout(timer)
        const first = lines[0] || ''
        if (first.toUpperCase().includes('OK')) {
          console.log(`[Imap] greeting: ${first}`)
          resolve(first)
        } else {
          reject(new Error(`[Imap] bad greeting: ${first}`))
        }
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      },
      lines: [],
      timer,
      literal: null,
    }
  }

  // ── Tag management ────────────────────────────────────────────

  private nextTag(): string {
    return `A${String(this.tagCounter++).padStart(4, '0')}`
  }

  // ── Command execution ─────────────────────────────────────────

  private exec(cmd: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.sock) {
        return reject(new Error('[Imap] not connected'))
      }

      const tag = this.nextTag()

      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error(`[Imap] command timeout: ${cmd.split(' ')[0]}`))
      }, TIMEOUT_COMMAND)

      this.pending = {
        tag,
        resolve: (lines) => {
          clearTimeout(timer)
          resolve(lines)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
        lines: [],
        timer,
        literal: null,
      }

      this.sock.write(`${tag} ${cmd}${CRLF}`, 'binary')
      // Don't log high-frequency polling commands or passwords
      if (!cmd.startsWith('NOOP') && !cmd.startsWith('SEARCH') && !cmd.startsWith('LOGIN')) {
        console.log(`[Imap] >> ${tag} ${cmd}`)
      }
    })
  }

  // ── Data parsing ──────────────────────────────────────────────

  /**
   * Core data handler. Accumulates into buf, then processes line by line.
   *
   * Three modes:
   * 1. Literal collection: we know exactly how many bytes to read
   * 2. IDLE mode: watch for '+ ', '* N EXISTS', tagged OK
   * 3. Normal command: collect untagged lines, resolve on tagged response
   *
   * Greeting is handled as a special case of normal command with tag='*'.
   */
  private onData(chunk: string): void {
    this.buf += chunk
    this.drain()
  }

  private drain(): void {
    while (this.buf.length > 0) {
      // Phase 1: If we're collecting a literal, consume bytes
      if (this.pending?.literal) {
        if (!this.consumeLiteral()) return // need more data
        continue
      }

      // Phase 2: Need a complete line
      const idx = this.buf.indexOf(CRLF)
      if (idx === -1) return // incomplete line, wait for more data

      const line = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 2)

      this.processLine(line)
    }
  }

  /**
   * Consume literal bytes from buf into pending.literal.
   * Returns true if literal is complete, false if need more data.
   */
  private consumeLiteral(): boolean {
    const lit = this.pending!.literal!
    const need = lit.size - lit.collected.length

    if (this.buf.length < need) {
      // Not enough data yet, take what we have
      lit.collected += this.buf
      this.buf = ''
      return false
    }

    // We have enough: take exactly what we need
    lit.collected += this.buf.slice(0, need)
    this.buf = this.buf.slice(need)

    // Convert binary string to proper UTF-8
    const content = Buffer.from(lit.collected, 'binary').toString('utf-8')
    this.pending!.lines.push('\x00LITERAL\x00' + content)
    this.pending!.literal = null
    return true
  }

  private processLine(line: string): void {
    // ── IDLE mode ───────────────────────────────────────────
    if (this.idleState) {
      this.processIdleLine(line)
      return
    }

    // ── Greeting (pseudo-tag '*') ───────────────────────────
    if (this.pending?.tag === '*') {
      // Server greeting: * OK ...
      if (line.startsWith('* ')) {
        const p = this.pending
        this.pending = null
        p.resolve([line])
      }
      return
    }

    // ── Normal tagged command ───────────────────────────────
    if (!this.pending) return

    const tag = this.pending.tag

    // Check for literal indicator: {NNN}
    const litMatch = line.match(/\{(\d+)\}$/)
    if (litMatch) {
      this.pending.lines.push(line)
      this.pending.literal = {
        size: parseInt(litMatch[1], 10),
        collected: '',
      }
      return
    }

    // Tagged response: AXXX OK/NO/BAD ...
    if (line.startsWith(`${tag} `)) {
      const status = line.slice(tag.length + 1)
      const p = this.pending
      this.pending = null

      if (status.startsWith('OK')) {
        p.resolve(p.lines)
      } else {
        p.reject(new Error(`[Imap] ${line}`))
      }
      return
    }

    // Untagged response: * ...
    if (line.startsWith('* ')) {
      this.pending.lines.push(line)
      return
    }

    // Continuation or other data -- accumulate
    this.pending.lines.push(line)
  }

  // ── IDLE handling ─────────────────────────────────────────────

  private processIdleLine(line: string): void {
    const idle = this.idleState!

    // Continuation response: server entered idle mode
    if (line.startsWith('+ ')) {
      console.log('[Imap] server entered IDLE mode')
      return
    }

    // Untagged EXISTS: new mail arrived
    const existsMatch = line.match(/^\* (\d+) EXISTS$/i)
    if (existsMatch) {
      idle.exists = parseInt(existsMatch[1], 10)
      console.log(`[Imap] IDLE: new mail, EXISTS=${idle.exists}`)
      if (!idle.doneSent) {
        this.exitIdle()
      }
      return
    }

    // Other untagged responses during IDLE (EXPUNGE, RECENT, etc.) -- ignore
    if (line.startsWith('* ')) {
      return
    }

    // Tagged response: our IDLE command completed
    if (line.startsWith(`${idle.tag} `)) {
      const status = line.slice(idle.tag.length + 1)
      const exists = idle.exists
      const resolve = idle.resolve
      const reject = idle.reject

      clearTimeout(idle.renewTimer)
      this.idleState = null

      if (status.startsWith('OK')) {
        resolve(exists)
      } else {
        reject(new Error(`[Imap] IDLE failed: ${line}`))
      }
      return
    }
  }

  private exitIdle(): void {
    if (!this.idleState || this.idleState.doneSent) return
    this.idleState.doneSent = true
    console.log('[Imap] >> DONE')
    this.sock?.write(`DONE${CRLF}`, 'binary')
  }

  private cancelIdle(): void {
    if (!this.idleState) return
    clearTimeout(this.idleState.renewTimer)
    if (!this.idleState.doneSent && this.sock) {
      this.idleState.doneSent = true
      this.sock.write(`DONE${CRLF}`, 'binary')
    }
    // Let the tagged response flow through and resolve/reject naturally
  }

  // ── Cleanup ───────────────────────────────────────────────────

  private destroy(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending = null
    }
    if (this.idleState) {
      clearTimeout(this.idleState.renewTimer)
      this.idleState = null
    }
    if (this.sock) {
      this.sock.removeAllListeners()
      this.sock.destroy()
      this.sock = null
    }
    this.buf = ''
    this.alive = false
    console.log('[Imap] connection closed')
  }
}
