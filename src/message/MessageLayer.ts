/**
 * Message Layer - 消息队列核心
 *
 * 负责：
 * 1. 接收来自多个来源的消息（tui/gui/mail）
 * 2. 持久化到 md 文件
 * 3. 提供给 Agent 消费
 */

import * as fs from 'fs'
import * as path from 'path'

export type MessageSource = 'tui' | 'gui' | 'mail' | 'notification'

export interface QueuedMessage {
  id: string
  timestamp: Date
  source: MessageSource
  content: string
  consumed: boolean
  status: 'pending' | 'processing'
}

/**
 * 解析 Assistant 回复中的 <chat> 标签
 */
export interface ChatReply {
  tui?: string
  gui?: string
  mail?: string
  attachments?: string[]
}

export interface OutboundMailTarget {
  to: string
  subject: string
  body: string
}

export interface OutboundMessage {
  id: string
  timestamp: Date
  tui?: string
  gui?: string
  mail?: OutboundMailTarget
  attachments?: string[]
  delivered: {
    tui?: boolean
    gui?: boolean
    mail?: boolean
  }
  attempts: {
    tui?: number
    gui?: number
    mail?: number
  }
}

type DeliveryChannel = 'tui' | 'gui' | 'mail'

/**
 * Delivery functions registered by Agent.
 * Each returns true on success, false on failure.
 */
export interface Deliverers {
  tui: (content: string, attachments?: string[]) => boolean
  gui: (content: string, attachments?: string[]) => boolean
  mail: (to: string, subject: string, body: string, attachments?: string[]) => Promise<boolean>
}

const MAX_DELIVERY_ATTEMPTS = 3
const DELIVERY_INTERVAL = 5000

export class MessageLayer {
  private filePath: string
  private messages: QueuedMessage[] = []
  private outboundPath: string
  private outbound: OutboundMessage[] = []
  private deliverers: Deliverers | null = null
  private deliveryTimer: ReturnType<typeof setInterval> | null = null

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'inbound.json')
    this.outboundPath = path.join(path.dirname(this.filePath), 'outbound.json')
    this.load()
    this.loadOutbound()
  }

  /**
   * 添加新消息到队列
   */
  push(source: MessageSource, content: string): string {
    const id = `m${Date.now()}`
    const message: QueuedMessage = {
      id,
      timestamp: new Date(),
      source,
      content: content.trim(),
      consumed: false,
      status: 'pending',
    }
    this.messages.push(message)
    this.save()
    return id
  }

  /**
   * 获取所有未消费的消息（包括 pending 和 processing）
   */
  getPending(): QueuedMessage[] {
    return this.messages.filter(m => !m.consumed)
  }

  /**
   * 获取仅 pending 状态的消息（用于 UI 显示）
   */
  getPendingOnly(): QueuedMessage[] {
    return this.messages.filter(m => !m.consumed && m.status === 'pending')
  }

  /**
   * 标记消息为已消费
   */
  consume(id: string): void {
    const msg = this.messages.find(m => m.id === id)
    if (msg) {
      msg.consumed = true
      this.save()
    }
  }

  /**
   * 批量消费消息
   */
  consumeAll(ids: string[]): void {
    for (const id of ids) {
      const msg = this.messages.find(m => m.id === id)
      if (msg) {
        msg.consumed = true
      }
    }
    this.save()
  }

  /**
   * Mark messages as processing (agent has picked them up, UI should hide them)
   */
  markProcessing(ids: string[]): void {
    for (const id of ids) {
      const msg = this.messages.find(m => m.id === id)
      if (msg) {
        msg.status = 'processing'
      }
    }
    this.save()
  }

  /**
   * Reset all processing messages back to pending (on agent restart)
   */
  resetProcessing(): void {
    let changed = false
    for (const msg of this.messages) {
      if (!msg.consumed && msg.status === 'processing') {
        msg.status = 'pending'
        changed = true
      }
    }
    if (changed) this.save()
  }

  /**
   * 格式化待处理消息为 <chat> 格式
   */
  formatPendingAsChat(): string | null {
    const pending = this.getPending()
    if (pending.length === 0) return null

    const bySource: Record<MessageSource, string[]> = {
      tui: [],
      gui: [],
      mail: [],
      notification: [],
    }

    for (const msg of pending) {
      bySource[msg.source].push(msg.content)
    }

    let result = ''

    // Chat sources (tui, gui, mail) go inside <chat>
    const chatSources = ['tui', 'gui', 'mail'] as MessageSource[]
    const hasChatContent = chatSources.some(s => bySource[s].length > 0)
    if (hasChatContent) {
      result += '<chat>\n'
      for (const source of chatSources) {
        if (bySource[source].length > 0) {
          const combined = bySource[source].join('\n---\n')
          result += `<${source}>${combined}</${source}>\n`
        }
      }
      result += '</chat>\n'
    }

    // Notification goes outside <chat> in its own tag
    if (bySource.notification.length > 0) {
      const combined = bySource.notification.join('\n---\n')
      result += `<notification>\n${combined}\n</notification>`
    }

    return result.trim() || null
  }

  /**
   * 解析 Assistant 回复中的 <chat> 标签
   */
  static parseReply(content: string): ChatReply {
    const reply: ChatReply = {}

    const chatMatch = content.match(/<chat>([\s\S]*?)<\/chat>/)
    if (!chatMatch) return reply

    const chatContent = chatMatch[1]

    const tuiMatch = chatContent.match(/<tui>([\s\S]*?)<\/tui>/)
    if (tuiMatch) reply.tui = tuiMatch[1].trim()

    const guiMatch = chatContent.match(/<gui>([\s\S]*?)<\/gui>/)
    if (guiMatch) reply.gui = guiMatch[1].trim()

    const mailMatch = chatContent.match(/<mail>([\s\S]*?)<\/mail>/)
    if (mailMatch) reply.mail = mailMatch[1].trim()

    const attachmentMatches = chatContent.matchAll(/<attachment>([\s\S]*?)<\/attachment>/g)
    const attachments: string[] = []
    for (const m of attachmentMatches) {
      const p = m[1].trim()
      if (p) attachments.push(p)
    }
    if (attachments.length > 0) reply.attachments = attachments

    return reply
  }

  /**
   * Load inbound queue from JSON file.
   */
  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.messages = []
        return
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
      this.messages = parsed.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp as string),
      })) as QueuedMessage[]
    } catch (error) {
      console.error('[MessageLayer] Failed to load inbound:', error)
      this.messages = []
    }
  }

  /**
   * Save inbound queue to JSON file.
   */
  private save(): void {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.messages, null, 2), 'utf-8')
    } catch (error) {
      console.error('[MessageLayer] Failed to save inbound:', error)
    }
  }

  // ========== Outbound Queue ==========

  /**
   * Register delivery functions and start the delivery loop.
   * Called by Agent after all services are initialized.
   */
  registerDeliverers(deliverers: Deliverers): void {
    this.deliverers = deliverers
    this.startDeliveryLoop()
  }

  /**
   * Stop the delivery loop.
   */
  stopDeliveryLoop(): void {
    if (this.deliveryTimer) {
      clearInterval(this.deliveryTimer)
      this.deliveryTimer = null
    }
  }

  /**
   * Push an outbound message. Immediately attempts delivery, then
   * the background loop retries any failures.
   */
  pushOutbound(msg: {
    tui?: string
    gui?: string
    mail?: OutboundMailTarget
    attachments?: string[]
  }): string {
    const id = `o${Date.now()}`
    const delivered: Record<string, boolean> = {}
    const attempts: Record<string, number> = {}
    if (msg.tui !== undefined) { delivered.tui = false; attempts.tui = 0 }
    if (msg.gui !== undefined) { delivered.gui = false; attempts.gui = 0 }
    if (msg.mail !== undefined) { delivered.mail = false; attempts.mail = 0 }

    const outMsg: OutboundMessage = {
      id,
      timestamp: new Date(),
      ...msg,
      delivered,
      attempts,
    }
    this.outbound.push(outMsg)
    this.saveOutbound()

    // Attempt immediate delivery
    this.deliverOne(outMsg)

    return id
  }

  /**
   * Get outbound messages with at least one undelivered channel.
   */
  getPendingOutbound(): OutboundMessage[] {
    return this.outbound.filter(m =>
      Object.entries(m.delivered).some(
        ([ch, v]) => v === false && (m.attempts[ch as DeliveryChannel] ?? 0) < MAX_DELIVERY_ATTEMPTS
      )
    )
  }

  // ---------- Delivery Loop ----------

  private startDeliveryLoop(): void {
    if (this.deliveryTimer) return
    this.deliveryTimer = setInterval(() => {
      this.deliverAll()
    }, DELIVERY_INTERVAL)
  }

  private deliverAll(): void {
    const pending = this.getPendingOutbound()
    for (const msg of pending) {
      this.deliverOne(msg)
    }
  }

  private deliverOne(msg: OutboundMessage): void {
    if (!this.deliverers) return

    const channels: DeliveryChannel[] = ['tui', 'gui', 'mail']
    let changed = false

    for (const ch of channels) {
      if (msg.delivered[ch] !== false) continue
      if ((msg.attempts[ch] ?? 0) >= MAX_DELIVERY_ATTEMPTS) continue

      let success = false

      if (ch === 'tui' && msg.tui) {
        success = this.deliverers.tui(msg.tui, msg.attachments)
      } else if (ch === 'gui' && msg.gui) {
        success = this.deliverers.gui(msg.gui, msg.attachments)
      } else if (ch === 'mail' && msg.mail) {
        // Mail is async -- fire and handle result
        const mailTarget = msg.mail
        const attachments = msg.attachments
        this.deliverers.mail(mailTarget.to, mailTarget.subject, mailTarget.body, attachments)
          .then(ok => {
            if (ok) {
              msg.delivered.mail = true
              console.log(`[Outbound] mail delivered: ${msg.id} -> ${mailTarget.to}`)
            } else {
              msg.attempts.mail = (msg.attempts.mail ?? 0) + 1
              console.log(`[Outbound] mail failed (${msg.attempts.mail}/${MAX_DELIVERY_ATTEMPTS}): ${msg.id}`)
              this.checkMaxAttempts(msg, 'mail')
            }
            this.saveOutbound()
          })
          .catch(() => {
            msg.attempts.mail = (msg.attempts.mail ?? 0) + 1
            this.checkMaxAttempts(msg, 'mail')
            this.saveOutbound()
          })
        continue  // mail handled async, skip sync logic below
      }

      if (ch !== 'mail') {
        msg.attempts[ch] = (msg.attempts[ch] ?? 0) + 1
        if (success) {
          msg.delivered[ch] = true
          changed = true
        } else {
          this.checkMaxAttempts(msg, ch)
          changed = true
        }
      }
    }

    if (changed) {
      this.saveOutbound()
    }
  }

  /**
   * After MAX_DELIVERY_ATTEMPTS failures, inject a system notification
   * into the inbound queue at the FIRST position (highest priority).
   */
  private checkMaxAttempts(msg: OutboundMessage, channel: DeliveryChannel): void {
    if ((msg.attempts[channel] ?? 0) < MAX_DELIVERY_ATTEMPTS) return

    const preview = channel === 'mail' && msg.mail
      ? `to=${msg.mail.to} subject="${msg.mail.subject}"`
      : (msg[channel as 'tui' | 'gui'] || '').slice(0, 80)

    const notification = `[SYSTEM] Outbound delivery failed after ${MAX_DELIVERY_ATTEMPTS} attempts. channel=${channel}, id=${msg.id}, content="${preview}". Please check the ${channel} channel and retry or inform the user.`

    // Insert at position 0 (highest priority) in inbound queue
    const sysMsg: QueuedMessage = {
      id: `sys${Date.now()}`,
      timestamp: new Date(),
      source: 'tui',
      content: notification,
      consumed: false,
      status: 'pending',
    }
    this.messages.unshift(sysMsg)
    this.save()
    console.log(`[Outbound] delivery failed permanently: ${channel} ${msg.id}`)
  }

  // ---------- Outbound Persistence ----------

  private loadOutbound(): void {
    try {
      if (!fs.existsSync(this.outboundPath)) {
        this.outbound = []
        return
      }
      const raw = fs.readFileSync(this.outboundPath, 'utf-8')
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
      this.outbound = parsed.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp as string),
      })) as OutboundMessage[]
    } catch {
      this.outbound = []
    }
  }

  private saveOutbound(): void {
    try {
      const dir = path.dirname(this.outboundPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.outboundPath, JSON.stringify(this.outbound, null, 2), 'utf-8')
    } catch (error) {
      console.error('[MessageLayer] Failed to save outbound:', error)
    }
  }

  /**
   * Clear all pending (unconsumed) inbound messages and all pending outbound messages.
   */
  clearPending(): void {
    const before = this.messages.length
    this.messages = this.messages.filter(m => m.consumed)
    this.save()

    const outBefore = this.outbound.length
    this.outbound = this.outbound.filter(m =>
      Object.values(m.delivered).every(v => v === true)
    )
    this.saveOutbound()

    const inCleared = before - this.messages.length
    const outCleared = outBefore - this.outbound.length
    console.log(`[MessageLayer] cleared ${inCleared} inbound, ${outCleared} outbound pending messages`)
  }

  cleanupOutbound(keepRecent: number = 100): void {
    const fullyDelivered = this.outbound.filter(m =>
      Object.values(m.delivered).every(v => v === true)
    )
    const rest = this.outbound.filter(m =>
      !Object.values(m.delivered).every(v => v === true)
    )
    const recentDelivered = fullyDelivered.slice(-keepRecent)
    this.outbound = [...recentDelivered, ...rest]
    this.saveOutbound()
  }

  /**
   * 清理已消费的消息（可选，保持文件整洁）
   */
  cleanup(keepRecent: number = 50): void {
    const consumed = this.messages.filter(m => m.consumed)
    const pending = this.messages.filter(m => !m.consumed)

    // 保留最近 N 条已消费消息
    const recentConsumed = consumed.slice(-keepRecent)

    this.messages = [...recentConsumed, ...pending]
    this.save()
  }
}

// 单例导出
export const messageLayer = new MessageLayer()
