/**
 * Base LLM Provider - Unified interface with common logging and tracing
 */

import type {
  LLMProvider,
  Message,
  ImageInput,
  ToolDefinition,
  ChatOptions,
  ChatResponse,
} from '../types.js'
import { logger } from '../utils/logger.js'
import { traceLogger } from '../utils/trace.js'

/**
 * Abstract base class for LLM providers
 * Handles common functionality: logging, tracing, message formatting
 */
export abstract class BaseLLMProvider implements LLMProvider {
  abstract name: string
  protected lastMessageCount: number = 0
  protected abortController: AbortController | null = null

  /**
   * Subclasses implement this to make the actual API call
   */
  protected abstract doChat(
    messages: Message[],
    images: ImageInput[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatResponse>

  /**
   * Abort the current LLM request if one is in progress
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Get the current abort signal (for subclasses to pass to API calls)
   */
  protected getAbortSignal(): AbortSignal | undefined {
    return this.abortController?.signal
  }

  /**
   * Main entry point - handles logging and tracing, then delegates to doChat
   */
  async chatWithVisionAndTools(
    messages: Message[],
    images: ImageInput[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    // Create a new AbortController for this request
    this.abortController = new AbortController()

    try {
      // Log and trace input messages
      this.logInputMessages(messages, images)

      // Call the actual implementation
      const response = await this.doChat(messages, images, tools, options)

      // Log and trace assistant response
      this.logAssistantResponse(response)

      return response
    } finally {
      this.abortController = null
    }
  }

  /**
   * Log input messages (system, user) with images
   */
  private logInputMessages(messages: Message[], images: ImageInput[]): void {
    const systemMessage = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    // Find last user message index (for image attachment)
    let lastUserIndex = -1
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      if (nonSystemMessages[i].role === 'user') {
        lastUserIndex = i
        break
      }
    }

    // ANSI colors
    const COLORS = {
      assistant: '\x1b[38;5;208m',  // orange
      user: '\x1b[32m',             // green
      system: '\x1b[90m',           // gray
      tool: '\x1b[90m',             // gray
    }
    const RESET = '\x1b[0m'

    // Log and trace system message (only on first call)
    if (this.lastMessageCount === 0 && systemMessage?.content) {
      logger.debug(`${COLORS.system}[MSG 0] SYSTEM:\n${systemMessage.content}${RESET}`)
      if (traceLogger.isEnabled()) {
        traceLogger.addSystem(systemMessage.content)
      }
    }

    // Log new messages since last call
    const startIndex = Math.max(0, this.lastMessageCount - 1)  // Adjust for system message offset

    for (let i = startIndex; i < nonSystemMessages.length; i++) {
      const msg = nonSystemMessages[i]
      const msgIndex = i + 1  // +1 for system message

      if (msgIndex <= this.lastMessageCount) continue  // Skip already logged messages

      const color = COLORS[msg.role as keyof typeof COLORS] || RESET
      const role = msg.role.toUpperCase()

      // Format content
      const content = this.formatContent(msg.content)

      // Check if this message has images
      const hasImages = i === lastUserIndex && images.length > 0

      // Log to console
      logger.debug(`${color}[MSG ${msgIndex}] ${role}:\n${content}${RESET}`)

      if (hasImages) {
        for (let j = 0; j < images.length; j++) {
          const img = images[j]
          if (img.type === 'path') {
            logger.debug(`${color}  [ATTACHMENT ${j}] ${img.name || 'image'} (${img.mediaType || 'image/png'})${RESET}`)
          }
        }
      }

      // Trace logging
      if (traceLogger.isEnabled()) {
        if (msg.role === 'user') {
          if (hasImages) {
            const traceImages = images
              .filter(img => img.type === 'path')
              .map(img => ({ name: img.name, path: img.data }))
            traceLogger.addUser(content, traceImages.length > 0 ? traceImages : undefined)
          } else {
            traceLogger.addUser(content)
          }
        }
      }
    }

    this.lastMessageCount = nonSystemMessages.length + 1  // +1 for system message
  }

  /**
   * Log assistant response
   */
  private logAssistantResponse(response: ChatResponse): void {
    const ORANGE = '\x1b[38;5;208m'
    const RESET = '\x1b[0m'

    let logContent = `${ORANGE}[MSG ${this.lastMessageCount}] ASSISTANT:\n`
    if (response.content) {
      logContent += response.content
    }
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolsStr = response.toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.arguments)})`).join(', ')
      logContent += `${response.content ? '\n' : ''}[Tools: ${toolsStr}]`
    }
    logContent += RESET
    logger.debug(logContent)

    // Trace logging
    if (traceLogger.isEnabled()) {
      traceLogger.addAssistant(response.content, response.toolCalls)
    }
  }

  /**
   * Format content for display
   */
  private formatContent(content: string): string {
    try {
      if (content.startsWith('{') || content.startsWith('[')) {
        const parsed = JSON.parse(content)
        return JSON.stringify(parsed, null, 2)
      }
    } catch {
      // Not JSON
    }
    return content.replace(/\\n/g, '\n')
  }

  /**
   * Reset message counter (for new conversation)
   */
  resetMessageCount(): void {
    this.lastMessageCount = 0
  }
}
