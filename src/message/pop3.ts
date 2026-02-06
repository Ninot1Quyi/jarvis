/**
 * Lightweight POP3 Client - 只用 Node.js 原生 tls/net 模块
 *
 * POP3 是个简单的行协议：发命令 -> 读响应 -> 完事。
 * 代码应该反映这种简单性。
 */

import * as net from 'net'
import * as tls from 'tls'

export interface Pop3Options {
  host: string
  port: number
  user: string
  pass: string
  tls?: boolean
  timeout?: number
}

export interface MailInfo {
  num: number
  size: number
  uid: string
}

const CRLF = '\r\n'
const TIMEOUT_CONNECT = 10_000
const TIMEOUT_COMMAND = 30_000

export class Pop3Client {
  private opts: Required<Pop3Options>
  private sock: net.Socket | tls.TLSSocket | null = null
  private buf = ''

  /** resolve/reject for the current in-flight command */
  private pending: {
    resolve: (lines: string[]) => void
    reject: (err: Error) => void
    multiline: boolean
    timer: ReturnType<typeof setTimeout>
  } | null = null

  constructor(options: Pop3Options) {
    this.opts = {
      tls: true,
      timeout: TIMEOUT_CONNECT,
      ...options,
    }
  }

  // ── public API ──────────────────────────────────────────

  async connect(): Promise<void> {
    await this.open()
    await this.command(`USER ${this.opts.user}`)
    await this.command(`PASS ${this.opts.pass}`)
    console.log(`[Pop3] authenticated as ${this.opts.user}`)
  }

  async stat(): Promise<{ count: number; size: number }> {
    const lines = await this.command('STAT')
    // +OK 5 12345
    const parts = lines[0].split(' ')
    return { count: parseInt(parts[1], 10), size: parseInt(parts[2], 10) }
  }

  async list(): Promise<MailInfo[]> {
    const lines = await this.command('LIST', true)
    // skip first line (+OK ...), parse "num size" lines
    return lines.slice(1).map(line => {
      const [n, s] = line.split(' ')
      return { num: parseInt(n, 10), size: parseInt(s, 10), uid: '' }
    })
  }

  async uidl(msgNum?: number): Promise<{ num: number; uid: string }[]> {
    const multi = msgNum === undefined
    const cmd = multi ? 'UIDL' : `UIDL ${msgNum}`
    const lines = await this.command(cmd, multi)

    if (!multi) {
      // +OK 1 abc123
      const parts = lines[0].split(' ')
      return [{ num: parseInt(parts[1], 10), uid: parts[2] }]
    }

    return lines.slice(1).map(line => {
      const [n, uid] = line.split(' ')
      return { num: parseInt(n, 10), uid }
    })
  }

  async retr(msgNum: number): Promise<string> {
    const lines = await this.command(`RETR ${msgNum}`, true)
    // skip +OK line, join the rest as raw email content
    // undo byte-stuffing: lines starting with ".." become "."
    return lines.slice(1).map(l => (l.startsWith('..') ? l.slice(1) : l)).join(CRLF)
  }

  async dele(msgNum: number): Promise<void> {
    await this.command(`DELE ${msgNum}`)
  }

  async quit(): Promise<void> {
    try {
      await this.command('QUIT')
    } catch {
      // don't care if quit fails
    }
    this.destroy()
  }

  // ── internals ───────────────────────────────────────────

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = this.opts.timeout || TIMEOUT_CONNECT

      const onError = (err: Error) => {
        this.destroy()
        reject(new Error(`[Pop3] connect failed: ${err.message}`))
      }

      const connectOpts = { host: this.opts.host, port: this.opts.port }

      const sock = this.opts.tls
        ? tls.connect(connectOpts, () => {
            console.log(`[Pop3] TLS connected to ${this.opts.host}:${this.opts.port}`)
          })
        : net.connect(connectOpts, () => {
            console.log(`[Pop3] connected to ${this.opts.host}:${this.opts.port}`)
          })

      sock.setEncoding('utf-8')
      sock.setTimeout(timeout)

      sock.once('error', onError)
      sock.once('timeout', () => {
        this.destroy()
        reject(new Error(`[Pop3] connect timeout (${timeout}ms)`))
      })

      this.sock = sock

      // wait for server greeting (+OK ...)
      this.waitGreeting(resolve, reject, timeout)

      sock.on('data', (chunk: string) => this.onData(chunk))
    })
  }

  private waitGreeting(
    resolve: () => void,
    reject: (err: Error) => void,
    timeout: number,
  ): void {
    const timer = setTimeout(() => {
      this.destroy()
      reject(new Error(`[Pop3] greeting timeout (${timeout}ms)`))
    }, timeout)

    this.pending = {
      resolve: (lines) => {
        clearTimeout(timer)
        if (lines[0].startsWith('+OK')) {
          console.log(`[Pop3] greeting: ${lines[0]}`)
          resolve()
        } else {
          reject(new Error(`[Pop3] bad greeting: ${lines[0]}`))
        }
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      },
      multiline: false,
      timer,
    }
  }

  /**
   * Send a command and wait for the response.
   * multiline=true for commands that return dot-terminated responses (LIST, UIDL, RETR, TOP).
   */
  private command(cmd: string, multiline = false): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.sock) {
        return reject(new Error('[Pop3] not connected'))
      }

      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error(`[Pop3] command timeout: ${cmd.split(' ')[0]}`))
      }, TIMEOUT_COMMAND)

      this.pending = {
        resolve: (lines) => {
          clearTimeout(timer)
          if (lines[0].startsWith('+OK')) {
            resolve(lines)
          } else {
            reject(new Error(`[Pop3] ${lines[0]}`))
          }
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
        multiline,
        timer,
      }

      this.sock.write(cmd + CRLF)
    })
  }

  /**
   * Buffer incoming data, extract complete responses, dispatch to pending handler.
   *
   * Single-line response: one line ending with CRLF, starts with +OK or -ERR.
   * Multi-line response: first line +OK/-ERR, then data lines, terminated by ".\r\n".
   */
  private onData(chunk: string): void {
    this.buf += chunk

    if (!this.pending) return

    if (this.pending.multiline) {
      this.tryResolveMultiline()
    } else {
      this.tryResolveSingleline()
    }
  }

  private tryResolveSingleline(): void {
    const idx = this.buf.indexOf(CRLF)
    if (idx === -1) return

    const line = this.buf.slice(0, idx)
    this.buf = this.buf.slice(idx + 2)

    const p = this.pending!
    this.pending = null
    p.resolve([line])
  }

  private tryResolveMultiline(): void {
    // multi-line ends with \r\n.\r\n
    const terminator = CRLF + '.' + CRLF
    const idx = this.buf.indexOf(terminator)
    if (idx === -1) return

    const raw = this.buf.slice(0, idx)
    this.buf = this.buf.slice(idx + terminator.length)

    // split into lines, filter out the terminator dot
    const lines = raw.split(CRLF)

    const p = this.pending!
    this.pending = null
    p.resolve(lines)
  }

  private destroy(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending = null
    }
    if (this.sock) {
      this.sock.removeAllListeners()
      this.sock.destroy()
      this.sock = null
    }
    this.buf = ''
    console.log('[Pop3] connection closed')
  }
}
