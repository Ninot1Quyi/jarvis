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

export type MessageSource = 'tui' | 'gui' | 'mail'

export interface QueuedMessage {
  id: string
  timestamp: Date
  source: MessageSource
  content: string
  consumed: boolean
}

/**
 * 解析 Assistant 回复中的 <chat> 标签
 */
export interface ChatReply {
  tui?: string
  gui?: string
  mail?: string
}

export class MessageLayer {
  private filePath: string
  private messages: QueuedMessage[] = []

  constructor(filePath?: string) {
    // 默认路径：data/messages.md
    this.filePath = filePath || path.join(process.cwd(), 'data', 'messages.md')
    this.load()
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
    }
    this.messages.push(message)
    this.save()
    return id
  }

  /**
   * 获取所有未消费的消息
   */
  getPending(): QueuedMessage[] {
    return this.messages.filter(m => !m.consumed)
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
   * 格式化待处理消息为 <chat> 格式
   */
  formatPendingAsChat(): string | null {
    const pending = this.getPending()
    if (pending.length === 0) return null

    const bySource: Record<MessageSource, string[]> = {
      tui: [],
      gui: [],
      mail: [],
    }

    for (const msg of pending) {
      bySource[msg.source].push(msg.content)
    }

    let chat = '<chat>\n'
    for (const source of ['tui', 'gui', 'mail'] as MessageSource[]) {
      if (bySource[source].length > 0) {
        const combined = bySource[source].join('\n---\n')
        chat += `<${source}>${combined}</${source}>\n`
      }
    }
    chat += '</chat>'

    return chat
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

    return reply
  }

  /**
   * 从 md 文件加载消息
   */
  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.messages = []
        return
      }

      const content = fs.readFileSync(this.filePath, 'utf-8')
      this.messages = this.parseMd(content)
    } catch (error) {
      console.error('[MessageLayer] Failed to load:', error)
      this.messages = []
    }
  }

  /**
   * 保存消息到 md 文件
   */
  private save(): void {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const content = this.toMd()
      fs.writeFileSync(this.filePath, content, 'utf-8')
    } catch (error) {
      console.error('[MessageLayer] Failed to save:', error)
    }
  }

  /**
   * 解析 md 文件内容
   *
   * 格式：
   * - [ ] `m001` [2024-02-07 10:30:15] [terminal] 消息内容
   * - [x] `m002` [2024-02-07 10:31:20] [gui] 已消费的消息
   */
  private parseMd(content: string): QueuedMessage[] {
    const messages: QueuedMessage[] = []
    const lines = content.split('\n')

    // 正则：- [ ] `id` [timestamp] [source] content
    // 或：  - [x] `id` [timestamp] [source] content
    const regex = /^- \[([ x])\] `([^`]+)` \[([^\]]+)\] \[([^\]]+)\] (.+)$/

    for (const line of lines) {
      const match = line.match(regex)
      if (match) {
        const [, consumed, id, timestamp, source, content] = match
        messages.push({
          id,
          timestamp: new Date(timestamp),
          source: source as MessageSource,
          content,
          consumed: consumed === 'x',
        })
      }
    }

    return messages
  }

  /**
   * 转换为 md 格式
   */
  private toMd(): string {
    let md = '# Agent Message Queue\n\n'

    // 按时间排序
    const sorted = [...this.messages].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    )

    for (const msg of sorted) {
      const checkbox = msg.consumed ? '[x]' : '[ ]'
      const timestamp = msg.timestamp.toISOString().replace('T', ' ').slice(0, 19)
      md += `- ${checkbox} \`${msg.id}\` [${timestamp}] [${msg.source}] ${msg.content}\n`
    }

    return md
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
