/**
 * Mail Service - imapflow (IMAP IDLE/NOOP) + mailparser + nodemailer (SMTP)
 *
 * Receive: imapflow handles IDLE (realtime) and auto-fallback to NOOP polling.
 * Parse:   mailparser.simpleParser for full RFC 2822 decoding.
 * Send:    nodemailer SMTP (unchanged).
 *
 * Zero custom protocol code. Let battle-tested libraries do the heavy lifting.
 */

import * as fs from 'fs'
import * as path from 'path'
import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js'
import { ImapFlow } from 'imapflow'
import type { MailboxLockObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { messageLayer } from './MessageLayer.js'

// ---------- Config ----------

export interface MailConfig {
  smtp: {
    host: string
    port: number
    secure: boolean
  }
  imap: {
    host: string
    port: number
  }
  /** @deprecated POP3 no longer used. Kept for backward compat. */
  pop3?: {
    host: string
    port: number
  }
  user: string
  pass: string
  pollInterval: number
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

  private client: ImapFlow | null = null
  private lock: MailboxLockObject | null = null
  private running = false
  private stopped = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

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

  /** Start IMAP connection and monitoring */
  start(): void {
    if (this.running) return
    this.stopped = false
    this.startImap().catch(err => {
      console.error('[Mail] IMAP startup failed:', err)
    })
  }

  /** Stop everything */
  stop(): void {
    this.stopped = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.releaseLock()

    if (this.client) {
      this.client.removeAllListeners()
      this.client.logout().catch(() => {})
      this.client = null
    }

    this.running = false
    console.log('[Mail] stopped')
  }

  /** Send mail via SMTP */
  async send(to: string, subject: string, body: string, attachments?: string[]): Promise<boolean> {
    try {
      const mailOpts: nodemailer.SendMailOptions = {
        from: this.config.user,
        to,
        subject,
        text: body,
      }
      if (attachments && attachments.length > 0) {
        mailOpts.attachments = attachments.map(p => ({
          filename: path.basename(p),
          path: p,
        }))
      }
      await this.transporter.sendMail(mailOpts)
      console.log(`[Mail] sent to ${to}, subject="${subject}"`)
      return true
    } catch (err) {
      console.error('[Mail] send failed:', err)
      return false
    }
  }

  // ========== IMAP ==========

  private async startImap(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true

    try {
      const client = new ImapFlow({
        host: this.config.imap.host,
        port: this.config.imap.port,
        secure: true,
        auth: {
          user: this.config.user,
          pass: this.config.pass,
        },
        logger: false,
        // If server doesn't support IDLE, fall back to NOOP polling
        missingIdleCommand: 'NOOP',
      })

      client.on('error', (err: Error) => {
        console.error('[Mail] IMAP error:', err.message)
      })

      client.on('close', () => {
        console.log('[Mail] IMAP connection closed')
        this.running = false
        this.releaseLock()
        this.client = null
        this.scheduleReconnect()
      })

      // New mail notification
      client.on('exists', (data: { path: string; count: number; prevCount: number }) => {
        if (data.count <= data.prevCount) return
        const newCount = data.count - data.prevCount
        console.log(`[Mail] IMAP: ${newCount} new message(s) in ${data.path}`)
        this.fetchUnseen().catch(err => {
          console.error('[Mail] IMAP fetch after EXISTS failed:', err)
        })
      })

      await client.connect()
      console.log(`[Mail] IMAP connected to ${this.config.imap.host}:${this.config.imap.port}`)

      this.client = client

      // Open INBOX and hold the lock -- IDLE starts automatically
      this.lock = await client.getMailboxLock('INBOX')
      console.log('[Mail] IMAP: INBOX opened, IDLE active')

      // Fetch any existing unseen mails on startup
      await this.fetchUnseen()
    } catch (err) {
      console.error('[Mail] IMAP startup failed:', err)
      this.running = false
      this.releaseLock()
      if (this.client) {
        this.client.removeAllListeners()
        this.client.logout().catch(() => {})
        this.client = null
      }
      this.scheduleReconnect()
    }
  }

  private async fetchUnseen(): Promise<void> {
    if (!this.client) return

    try {
      const uids = await this.client.search({ seen: false }, { uid: true })
      if (!uids || uids.length === 0) return

      console.log(`[Mail] IMAP: ${uids.length} unseen message(s)`)

      for (const uid of uids) {
        // Deduplicate by UID
        const uidKey = `imap:${uid}`
        if (this.processedUids.has(uidKey)) {
          await this.client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
          continue
        }

        try {
          const msg = await this.client.fetchOne(
            String(uid),
            { source: true, envelope: true },
            { uid: true },
          )

          if (!msg || !msg.source) {
            this.processedUids.add(uidKey)
            await this.client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
            continue
          }

          const parsed = await simpleParser(msg.source)

          const from = parsed.from?.value?.[0]?.address || ''
          const subject = parsed.subject || ''
          const body = parsed.text || ''

          // Whitelist check
          if (!this.isWhitelisted(from)) {
            console.log(`[Mail] skipped (not whitelisted): ${from}`)
            this.processedUids.add(uidKey)
            await this.client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
            continue
          }

          // Push to message layer
          const formatted = `[From: ${from}] [Subject: ${subject || '(no subject)'}]\n${body}`
          messageLayer.push('mail', formatted)
          console.log(`[Mail] IMAP received from ${from}, subject="${subject}"`)

          this.processedUids.add(uidKey)
          await this.client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        } catch (err) {
          console.error(`[Mail] IMAP failed to process uid=${uid}:`, err)
          this.processedUids.add(uidKey)
        }
      }

      saveUids(this.processedUids)
    } catch (err) {
      console.error('[Mail] IMAP fetch unseen failed:', err)
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return

    console.log('[Mail] IMAP reconnecting in 10s...')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.startImap().catch(err => {
        console.error('[Mail] IMAP reconnect failed:', err)
      })
    }, 10_000)
  }

  private releaseLock(): void {
    if (this.lock) {
      try { this.lock.release() } catch { /* already released */ }
      this.lock = null
    }
  }

  // ========== Shared ==========

  private isWhitelisted(from: string): boolean {
    if (this.whitelistSet.size === 0) return true
    return this.whitelistSet.has(from.toLowerCase())
  }
}

// ---------- Factory ----------

export function createMailService(config: MailConfig): MailService {
  return new MailService(config)
}
