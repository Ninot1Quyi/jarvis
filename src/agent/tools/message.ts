// message tool - Unified message sending tool

import type { Tool } from '../../types.js'
import { messageLayer } from '../../message/MessageLayer.js'

export const messageTool: Tool = {
  definition: {
    name: 'message',
    description: 'Send messages to users via different channels',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['send', 'reply'],
          description: 'Message action: send or reply'
        },
        channel: {
          type: 'string',
          enum: ['tui', 'gui', 'mail'],
          description: 'Target channel: tui, gui, or mail'
        },
        to: {
          type: 'string',
          description: 'Recipient (for mail: email address)'
        },
        title: {
          type: 'string',
          description: 'Email subject (for mail channel)'
        },
        message: {
          type: 'string',
          description: 'Message content'
        },
        guiContent: {
          type: 'string',
          description: 'GUI-specific content (Markdown supported)'
        },
        tuiContent: {
          type: 'string',
          description: 'TUI-specific content'
        },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to attach'
        }
      },
      required: ['action', 'message']
    }
  },
  async execute(args: Record<string, unknown>) {
    const channelParam = args.channel as string | undefined
    const to = args.to as string | undefined
    const title = args.title as string | undefined
    const message = args.message as string
    const guiContent = args.guiContent as string | undefined
    const tuiContent = args.tuiContent as string | undefined
    const attachments = args.attachments as string[] | undefined

    // Determine target channel
    let targetChannel: 'tui' | 'gui' | 'mail' = 'tui'
    if (channelParam === 'tui' || channelParam === 'gui' || channelParam === 'mail') {
      targetChannel = channelParam
    }

    // Send message via MessageLayer
    const success = messageLayer.send({
      channel: targetChannel,
      message: message || '',
      guiContent,
      tuiContent,
      to,
      title,
      attachments
    })

    if (success) {
      return {
        success: true,
        message: `Message sent via ${targetChannel}`
      }
    } else {
      return {
        success: false,
        error: `Failed to send message via ${targetChannel}`
      }
    }
  }
}
