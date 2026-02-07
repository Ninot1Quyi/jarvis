/**
 * MessageManager - Unified message facade
 *
 * Agent sees ONE interface. Internally routes to TUI/GUI/Mail channels.
 *
 * Inbound:  external sources -> queue -> Agent consumes
 * Outbound: Agent submits LLM reply -> parse <chat> -> route to channels
 *           MessageLayer handles persistence, retry, failure notifications.
 */

import { overlayClient } from '../utils/overlay.js'
import { messageLayer, MessageLayer, type MessageSource, type QueuedMessage, type OutboundMailTarget } from './MessageLayer.js'
import { MailService, type MailConfig } from './mail.js'
import { NotificationService } from '../notification/NotificationService.js'
import type { NotificationConfig } from '../notification/types.js'

export interface MessageManagerOptions {
  overlay?: boolean
  mailConfig?: MailConfig
  notificationConfig?: NotificationConfig
}

export class MessageManager {
  private overlay = false
  private mailService: MailService | null = null
  private notificationService: NotificationService | null = null

  /**
   * Initialize channels and register deliverers.
   * Call once before the main loop.
   */
  init(options: MessageManagerOptions): void {
    this.overlay = options.overlay || false

    // -- GUI channel --
    if (this.overlay) {
      overlayClient.enable()
    }

    // -- Mail channel --
    if (options.mailConfig?.user && options.mailConfig?.pass) {
      this.mailService = new MailService(options.mailConfig)
      this.mailService.start()
      console.log('[MessageManager] mail channel started')
    }

    // -- Notification channel --
    if (options.notificationConfig?.enabled) {
      this.notificationService = new NotificationService(options.notificationConfig)
      this.notificationService.start()
      console.log('[MessageManager] notification channel started')
    }

    // -- Register deliverers with MessageLayer (handles persistence + retry) --
    const mailSvc = this.mailService
    const overlayEnabled = this.overlay
    messageLayer.registerDeliverers({
      tui: (content: string, attachments?: string[]) => {
        console.log(`\n[ASSISTANT -> tui] ${content}\n`)
        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            console.log(`[ATTACHMENT] ${att}`)
          }
        }
        return true
      },
      gui: (content: string, attachments?: string[]) => {
        if (!overlayEnabled) return true
        if (!overlayClient.isConnected()) return false
        overlayClient.sendAssistant(content, undefined, attachments)
        return true
      },
      mail: async (to: string, subject: string, body: string, attachments?: string[]) => {
        if (!mailSvc) return true
        const ok = await mailSvc.send(to, subject, body, attachments)
        if (ok) {
          console.log(`\n[ASSISTANT -> mail] To: ${to}, Subject: ${subject}\n`)
        }
        return ok
      },
    })
  }

  /**
   * Stop all channels and delivery loop.
   */
  stop(): void {
    messageLayer.stopDeliveryLoop()
    if (this.mailService) {
      this.mailService.stop()
      this.mailService = null
    }
    if (this.notificationService) {
      this.notificationService.stop()
      this.notificationService = null
    }
    if (this.overlay) {
      overlayClient.disable()
    }
  }

  // ========== Inbound (External -> Agent) ==========

  /**
   * Push a message into the inbound queue.
   */
  pushInbound(source: MessageSource, content: string): string {
    return messageLayer.push(source, content)
  }

  /**
   * Get all pending inbound messages.
   */
  getInbound(): QueuedMessage[] {
    return messageLayer.getPending()
  }

  /**
   * Format pending inbound messages as <chat> XML for LLM.
   */
  formatInboundAsChat(): string | null {
    return messageLayer.formatPendingAsChat()
  }

  /**
   * Mark inbound messages as consumed.
   */
  consumeInbound(ids: string[]): void {
    messageLayer.consumeAll(ids)
  }

  /**
   * Wait for new inbound messages (polling with sleep).
   */
  async waitForInbound(timeoutMs: number): Promise<boolean> {
    const checkInterval = 500
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (messageLayer.getPending().length > 0) return true
      await new Promise(r => setTimeout(r, checkInterval))
    }
    return false
  }

  // ========== Outbound (Agent -> External) ==========

  /**
   * Dispatch an LLM reply to target channels.
   * Parses <chat> tags, builds outbound message, submits to
   * MessageLayer for persistent delivery with retry.
   */
  dispatchReply(rawContent: string): void {
    const chatReply = MessageLayer.parseReply(rawContent)

    const hasReply = chatReply.tui || chatReply.gui || chatReply.mail
    if (!hasReply) return

    const outbound: {
      tui?: string
      gui?: string
      mail?: OutboundMailTarget
      attachments?: string[]
    } = {}

    if (chatReply.tui) outbound.tui = chatReply.tui

    if (this.overlay) {
      outbound.gui = chatReply.gui || chatReply.tui || rawContent || ''
    }

    if (chatReply.mail) {
      const recipientMatch = chatReply.mail.match(/<recipient>([\s\S]*?)<\/recipient>/)
      if (recipientMatch) {
        const titleMatch = chatReply.mail.match(/<title>([\s\S]*?)<\/title>/)
        const contentMatch = chatReply.mail.match(/<content>([\s\S]*?)<\/content>/)
        outbound.mail = {
          to: recipientMatch[1].trim(),
          subject: titleMatch ? titleMatch[1].trim() : 'Reply from Jarvis',
          body: contentMatch ? contentMatch[1].trim() : '',
        }
      }
    }

    if (chatReply.attachments) outbound.attachments = chatReply.attachments

    messageLayer.pushOutbound(outbound)
  }

  // ========== GUI Helpers (for overlay-specific operations) ==========

  /**
   * Forward inbound messages to overlay UI for display.
   */
  notifyGuiInbound(messages: QueuedMessage[]): void {
    if (!this.overlay) return
    for (const msg of messages) {
      overlayClient.sendUser(`[${msg.source}] ${msg.content}`)
    }
  }

  /**
   * Send a tool execution result to overlay UI.
   */
  notifyGuiToolResult(toolName: string, result: string): void {
    if (!this.overlay) return
    overlayClient.sendTool(toolName, result)
  }

  /**
   * Send a computer message (system feedback) to overlay UI.
   */
  notifyGuiComputer(content: string): void {
    if (!this.overlay) return
    overlayClient.sendComputer(content)
  }

  /**
   * Forward assistant reply to overlay UI.
   */
  notifyGuiAssistant(content: string, toolCalls?: { name: string; arguments: Record<string, unknown> }[], attachments?: string[]): void {
    if (!this.overlay) return
    overlayClient.sendAssistant(content, toolCalls, attachments)
  }
}

export const messageManager = new MessageManager()
