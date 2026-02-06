/**
 * Mail Service - IMAP IDLE (realtime) + POP3 (fallback) + SMTP (send)
 *
 * Two legs:
 * 1. IMAP IDLE -- main channel, server pushes new mail notifications in realtime
 * 2. POP3 poll -- fallback, every pollInterval ms, catches anything IMAP missed
 *
 * Outbound: nodemailer SMTP.
 */

import * as fs from 'fs'
import * as path from 'path'
import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js'
import { Pop3Client, type Pop3Options } from './pop3.js'
import { ImapClient } from './imap.js'
import { parseMail, type ParsedMail } from './mail-parser.js'
import { messageLayer } from './MessageLayer.js'

// ---------- Config ----------

export interface MailConfig {
  smtp: {
    host: string
    port: number
    secure: boolean
  }
  pop3: {
    host: string
    port: number
  }
  imap: {
    host: string
    port: number
  }
  user: string
  pass: string
  pollInterval: number  // POP3 fallback interval (ms)
  whitelist: string[]
}

// ---------- UID Store ----------

interface UidStore {
  uids: string[]
  lastCheck: string
}

const UID_MAX = 1000

function uidFilePath(): string {
  return path.join(process.cwd(), 'data', 'mail-uids.json')
}

function loadUids(): Set<string> {
  try {
    const raw = fs.readFileSync(uidFilePath(), 'utf-8')
    const store: UidStore = JSON.parse(raw)
    return new Set(store.uids)
  } catch {
    return new Set()
  }
}

function saveUids(uids: Set<string>): void {
  const dir = path.dirname(uidFilePath())
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const arr = [...uids]
  const trimmed = arr.length > UID_MAX ? arr.slice(arr.length - UID_MAX) : arr

  const store: UidStore = {
    uids: trimmed,
    lastCheck: new Date().toISOString(),
  }
  fs.writeFileSync(uidFilePath(), JSON.stringify(store, null, 2), 'utf-8')
}

// ---------- MailService ----------

export class MailService {
  private config: MailConfig
  private transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo>
  private processedUids: Set<string>
  private whitelistSet: Set<string>

  // POP3 fallback
  private pop3Timer: ReturnType<typeof setInterval> | null = null
  private pop3Checking = false

  // IMAP IDLE
  private imap: ImapClient | null = null
  private imapRunning = false
  private imapReconnectTimer: ReturnType<typeof setTimeout> | null = null

  private stopped = false

  constructor(config: MailConfig) {
    this.config = config
    this.processedUids = loadUids()
    this.whitelistSet = new Set(config.whitelist.map(e => e.toLowerCase()))

    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    })
  }

  /** Start both IMAP IDLE and POP3 fallback */
  start(): void {
    if (this.pop3Timer) return
    this.stopped = false

    console.log(`[Mail] starting: IMAP IDLE (realtime) + POP3 fallback (${this.config.pollInterval}ms)`)

    // Start IMAP IDLE loop
    this.startImap()

    // Start POP3 fallback polling
    this.pop3Check().catch(err => {
      console.error('[Mail] initial POP3 check failed:', err)
    })

    this.pop3Timer = setInterval(() => {
      this.pop3Check().catch(err => {
        console.error('[Mail] POP3 poll failed:', err)
      })
    }, this.config.pollInterval)
  }

  /** Stop everything */
  stop(): void {
    this.stopped = true

    if (this.pop3Timer) {
      clearInterval(this.pop3Timer)
      this.pop3Timer = null
    }

    if (this.imapReconnectTimer) {
      clearTimeout(this.imapReconnectTimer)
      this.imapReconnectTimer = null
    }

    this.imapRunning = false
    if (this.imap) {
      this.imap.logout().catch(() => {})
      this.imap = null
    }

    console.log('[Mail] stopped')
  }

  /** Send mail via SMTP */
  async send(to: string, subject: string, body: string): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: this.config.user,
        to,
        subject,
        text: body,
      })
      console.log(`[Mail] sent to ${to}, subject="${subject}"`)
      return true
    } catch (err) {
      console.error('[Mail] send failed:', err)
      return false
    }
  }

  // ========== IMAP ==========

  private async startImap(): Promise<void> {
    if (this.imapRunning || this.stopped) return
    this.imapRunning = true

    try {
      const client = new ImapClient({
        host: this.config.imap.host,
        port: this.config.imap.port,
        user: this.config.user,
        pass: this.config.pass,
      })

      client.on('error', (err: Error) => {
        console.error('[Mail] IMAP error:', err.message)
        this.scheduleImapReconnect()
      })

      client.on('close', () => {
        console.log('[Mail] IMAP connection closed')
        this.scheduleImapReconnect()
      })

      await client.connect()
      await client.selectInbox()
      this.imap = client

      // Fetch any existing unseen mails first
      await this.imapFetchUnseen()

      // Check IDLE support
      const caps = await client.capability()
      if (caps.includes('IDLE')) {
        console.log('[Mail] IMAP: IDLE supported, entering realtime mode')
        this.imapIdleLoop()
      } else {
        console.log('[Mail] IMAP: IDLE not supported, falling back to NOOP polling (1s)')
        this.imapPollLoop()
      }
    } catch (err) {
      console.error('[Mail] IMAP startup failed:', err)
      this.imapRunning = false
      this.scheduleImapReconnect()
    }
  }

  private async imapIdleLoop(): Promise<void> {
    while (this.imap?.isAlive() && !this.stopped) {
      try {
        const exists = await this.imap.idle()
        if (exists > 0) {
          console.log(`[Mail] IMAP IDLE: new mail detected (EXISTS=${exists})`)
          await this.imapFetchUnseen()
        }
        // exists === 0 means 25-min renewal, just re-enter IDLE
      } catch (err) {
        console.error('[Mail] IMAP IDLE error:', err)
        break
      }
    }

    this.imapRunning = false
    if (!this.stopped) {
      this.scheduleImapReconnect()
    }
  }

  /** Fallback: NOOP polling every 30s for servers without IDLE */
  private async imapPollLoop(): Promise<void> {
    const POLL_MS = 1_000
    while (this.imap?.isAlive() && !this.stopped) {
      try {
        await new Promise(r => setTimeout(r, POLL_MS))
        if (!this.imap?.isAlive() || this.stopped) break
        await this.imap.noop()
        await this.imapFetchUnseen()
      } catch (err) {
        console.error('[Mail] IMAP poll error:', err)
        break
      }
    }

    this.imapRunning = false
    if (!this.stopped) {
      this.scheduleImapReconnect()
    }
  }

  private async imapFetchUnseen(): Promise<void> {
    if (!this.imap) return

    try {
      const unseenNums = await this.imap.searchUnseen()
      if (unseenNums.length === 0) return

      console.log(`[Mail] IMAP: ${unseenNums.length} unseen mail(s)`)

      for (const seqNum of unseenNums) {
        try {
          const raw = await this.imap.fetch(seqNum)
          const parsed = parseMail(raw)

          // Whitelist check
          if (!this.isWhitelisted(parsed.from)) {
            console.log(`[Mail] skipped (not whitelisted): ${parsed.from}`)
            await this.imap.markSeen(seqNum)
            continue
          }

          // Deduplicate: use subject+date+from as pseudo-UID for IMAP
          const pseudoUid = `imap:${parsed.from}:${parsed.date}:${parsed.subject}`
          if (this.processedUids.has(pseudoUid)) {
            await this.imap.markSeen(seqNum)
            continue
          }

          // Push to message layer
          const formatted = `[From: ${parsed.from}] [Subject: ${parsed.subject || '(no subject)'}]\n${parsed.body || ''}`
          messageLayer.push('mail', formatted)
          console.log(`[Mail] IMAP received from ${parsed.from}, subject="${parsed.subject}"`)

          this.processedUids.add(pseudoUid)
          await this.imap.markSeen(seqNum)
        } catch (err) {
          console.error(`[Mail] IMAP failed to process seqNum=${seqNum}:`, err)
        }
      }

      saveUids(this.processedUids)
    } catch (err) {
      console.error('[Mail] IMAP fetch unseen failed:', err)
    }
  }

  private scheduleImapReconnect(): void {
    if (this.stopped || this.imapReconnectTimer) return

    this.imapRunning = false
    if (this.imap) {
      this.imap.removeAllListeners()
      this.imap.logout().catch(() => {})
      this.imap = null
    }

    console.log('[Mail] IMAP reconnecting in 10s...')
    this.imapReconnectTimer = setTimeout(() => {
      this.imapReconnectTimer = null
      this.startImap()
    }, 10_000)
  }

  // ========== POP3 Fallback ==========

  private async pop3Check(): Promise<void> {
    if (this.pop3Checking) return
    this.pop3Checking = true

    try {
      await this.pop3FetchNewMails()
    } finally {
      this.pop3Checking = false
    }
  }

  private async pop3FetchNewMails(): Promise<void> {
    const pop3Opts: Pop3Options = {
      host: this.config.pop3.host,
      port: this.config.pop3.port,
      user: this.config.user,
      pass: this.config.pass,
    }

    const client = new Pop3Client(pop3Opts)

    try {
      await client.connect()
      const list = await client.uidl()

      const newMails = list.filter(m => !this.processedUids.has(m.uid))

      if (newMails.length === 0) {
        await client.quit()
        return
      }

      console.log(`[Mail] POP3: ${newMails.length} new mail(s) found`)

      for (const mail of newMails) {
        try {
          const raw = await client.retr(mail.num)
          const parsed = parseMail(raw)

          if (!this.isWhitelisted(parsed.from)) {
            this.processedUids.add(mail.uid)
            continue
          }

          // Check if IMAP already processed this (pseudo-UID match)
          const pseudoUid = `imap:${parsed.from}:${parsed.date}:${parsed.subject}`
          if (this.processedUids.has(pseudoUid)) {
            this.processedUids.add(mail.uid)
            continue
          }

          const formatted = `[From: ${parsed.from}] [Subject: ${parsed.subject || '(no subject)'}]\n${parsed.body || ''}`
          messageLayer.push('mail', formatted)
          console.log(`[Mail] POP3 received from ${parsed.from}, subject="${parsed.subject}"`)

          this.processedUids.add(mail.uid)
          this.processedUids.add(pseudoUid)  // Also mark pseudo-UID to prevent IMAP duplicate
        } catch (err) {
          console.error(`[Mail] POP3 failed to process uid=${mail.uid}:`, err)
          this.processedUids.add(mail.uid)
        }
      }

      await client.quit()
    } catch (err) {
      console.error('[Mail] POP3 fetch failed:', err)
      try { await client.quit() } catch { /* noop */ }
    }

    saveUids(this.processedUids)
  }

  // ========== Shared ==========

  private isWhitelisted(from: string): boolean {
    if (this.whitelistSet.size === 0) return true  // Empty whitelist = accept all
    const match = from.match(/<([^>]+)>/)
    const email = (match ? match[1] : from).toLowerCase()
    return this.whitelistSet.has(email)
  }
}

// ---------- Factory ----------

export function createMailService(config: MailConfig): MailService {
  return new MailService(config)
}
