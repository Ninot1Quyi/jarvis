/**
 * Trace Logger - Save conversation history as readable markdown files
 */

import * as fs from 'fs'
import * as path from 'path'

const TRACES_DIR = path.join(process.cwd(), 'data', 'traces')

interface TraceMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: TraceImage[]
  toolCalls?: string[]
}

interface TraceImage {
  name?: string
  path?: string  // Relative path to existing screenshot in data/memory/screenshots
}

class TraceLogger {
  private sessionId: string
  private traceFileName: string
  private messages: TraceMessage[] = []
  private enabled: boolean = false

  constructor() {
    // Generate session ID based on local timestamp
    this.sessionId = this.formatLocalTimestamp(new Date())
    this.traceFileName = `${this.sessionId}.md`
  }

  /**
   * Format date as local timestamp string: YYYY-MM-DDTHH-MM-SS
   */
  private formatLocalTimestamp(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0')
    const year = date.getFullYear()
    const month = pad(date.getMonth() + 1)
    const day = pad(date.getDate())
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())
    const seconds = pad(date.getSeconds())
    return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}`
  }

  /**
   * Enable trace logging and ensure directory exists
   */
  enable(): void {
    this.enabled = true
    if (!fs.existsSync(TRACES_DIR)) {
      fs.mkdirSync(TRACES_DIR, { recursive: true })
    }
  }

  /**
   * Check if trace logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Get the full path to the trace file
   */
  getTracePath(): string {
    return path.join(TRACES_DIR, this.traceFileName)
  }

  /**
   * Add system message
   */
  addSystem(content: string): void {
    if (!this.enabled) return
    this.messages.push({ role: 'system', content })
    this.save()
  }

  /**
   * Add user message with optional images
   * Images should reference existing files in data/memory/screenshots
   */
  addUser(content: string, images?: { name?: string; path?: string }[]): void {
    if (!this.enabled) return

    const traceImages: TraceImage[] = []

    if (images) {
      for (const img of images) {
        if (img.path) {
          // Convert absolute path to relative path from traces directory
          const absolutePath = img.path
          const tracesDir = TRACES_DIR
          const relativePath = path.relative(tracesDir, absolutePath)
          traceImages.push({ name: img.name, path: relativePath })
        }
      }
    }

    this.messages.push({ role: 'user', content, images: traceImages.length > 0 ? traceImages : undefined })
    this.save()
  }

  /**
   * Add assistant message with optional tool calls
   */
  addAssistant(content: string, toolCalls?: { name: string; arguments: Record<string, unknown> }[]): void {
    if (!this.enabled) return

    const toolCallStrs = toolCalls?.map(tc => `${tc.name}(${JSON.stringify(tc.arguments)})`)

    this.messages.push({ role: 'assistant', content, toolCalls: toolCallStrs })
    this.save()
  }

  /**
   * Save conversation to markdown file
   */
  private save(): void {
    if (!this.enabled) return

    const lines: string[] = []

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i]

      if (i > 0) {
        lines.push('')
        lines.push('---')
        lines.push('')
      }

      lines.push(`## ${msg.role.toUpperCase()}`)
      lines.push('')

      // Add content
      if (msg.content) {
        lines.push(msg.content)
      }

      // Add images for user messages (reference existing screenshots)
      if (msg.images && msg.images.length > 0) {
        lines.push('')
        for (const img of msg.images) {
          if (img.path) {
            lines.push(`![${img.name || 'screenshot'}](${img.path})`)
          }
        }
      }

      // Add tool calls for assistant messages
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push('')
        lines.push('**Tool Calls:**')
        for (const tc of msg.toolCalls) {
          lines.push(`- \`${tc}\``)
        }
      }
    }

    const mdPath = this.getTracePath()
    fs.writeFileSync(mdPath, lines.join('\n'))
  }

  /**
   * Reset for new session
   */
  reset(): void {
    this.sessionId = this.formatLocalTimestamp(new Date())
    this.traceFileName = `${this.sessionId}.md`
    this.messages = []
  }
}

// Singleton instance
export const traceLogger = new TraceLogger()
