import Anthropic from '@anthropic-ai/sdk'
import type {
  LLMProvider,
  Message,
  ImageInput,
  ToolDefinition,
  ChatOptions,
  ChatResponse,
  ToolCall,
} from '../types.js'
import { logger } from '../utils/logger.js'
import { parseToolCallsFromText } from '../agent/tools/utils/parseToolCalls.js'
import * as fs from 'fs'

type MediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  private client: Anthropic
  private model: string
  private nativeToolCall: boolean
  private lastMessageCount: number = 0  // Track message count for debug logging

  constructor(apiKey: string, baseUrl?: string, model?: string, nativeToolCall: boolean = true) {
    this.client = new Anthropic({
      apiKey,
      baseURL: baseUrl,
    })
    this.model = model || 'claude-sonnet-4-5-20250514'
    this.nativeToolCall = nativeToolCall
  }

  async chatWithVisionAndTools(
    messages: Message[],
    images: ImageInput[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    // Convert messages to Anthropic format
    const systemMessage = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    const anthropicMessages: Anthropic.MessageParam[] = []

    // Find the last user message index to add images only to it
    let lastUserIndex = -1
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      if (nonSystemMessages[i].role === 'user') {
        lastUserIndex = i
        break
      }
    }

    for (let i = 0; i < nonSystemMessages.length; i++) {
      const msg = nonSystemMessages[i]
      if (msg.role === 'user') {
        const content: Anthropic.MessageParam['content'] = []

        // Add text content
        if (msg.content) {
          (content as Anthropic.TextBlockParam[]).push({ type: 'text', text: msg.content })
        }

        // Add images only to the last user message
        if (i === lastUserIndex && images.length > 0) {
          for (const img of images) {
            // Add image name/label as text before the image
            if (img.name) {
              (content as Anthropic.TextBlockParam[]).push({ type: 'text', text: `[${img.name}]` })
            }

            let base64Data: string
            const mediaType: MediaType = (img.mediaType as MediaType) || 'image/png'

            if (img.type === 'path') {
              const buffer = fs.readFileSync(img.data)
              base64Data = buffer.toString('base64')
            } else if (img.type === 'base64') {
              base64Data = img.data
            } else {
              throw new Error(`Unsupported image type: ${img.type}`)
            }

            (content as Anthropic.ImageBlockParam[]).push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            })
          }
        }

        anthropicMessages.push({ role: 'user', content })
      } else if (msg.role === 'assistant') {
        const content: Anthropic.MessageParam['content'] = []

        if (msg.content) {
          (content as Anthropic.TextBlockParam[]).push({ type: 'text', text: msg.content })
        }

        // Only use native tool_use blocks if nativeToolCall is enabled
        if (this.nativeToolCall && msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            (content as Anthropic.ToolUseBlockParam[]).push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })
          }
        }

        anthropicMessages.push({ role: 'assistant', content })
      } else if (msg.role === 'tool') {
        // Only use native tool_result blocks if nativeToolCall is enabled
        if (this.nativeToolCall) {
          anthropicMessages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.toolCallId!,
                content: msg.content,
              },
            ],
          })
        } else {
          // In non-native mode, append tool result as text to the last user message
          // or create a new user message
          const toolResultText = `[Tool Result: ${msg.toolCallId}]\n${msg.content}`
          const lastMsg = anthropicMessages[anthropicMessages.length - 1]
          if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
            (lastMsg.content as Anthropic.TextBlockParam[]).push({ type: 'text', text: toolResultText })
          } else {
            anthropicMessages.push({
              role: 'user',
              content: [{ type: 'text', text: toolResultText }],
            })
          }
        }
      }
    }

    // Convert tools to Anthropic format (only for native tool call mode)
    const anthropicTools: Anthropic.Tool[] = this.nativeToolCall ? tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: t.parameters.properties,
        required: t.parameters.required,
      },
    })) : []

    logger.debug('Calling Anthropic API', {
      model: this.model,
      messageCount: anthropicMessages.length,
      toolCount: anthropicTools.length,
      nativeToolCall: this.nativeToolCall,
    })

    // Log only new messages since last call
    // ANSI colors: green for ASSISTANT, blue for USER, gray for others
    const roleColors: Record<string, string> = {
      assistant: '\x1b[32m',  // green
      user: '\x1b[34m',       // blue
      system: '\x1b[90m',     // gray
      tool: '\x1b[90m',       // gray
    }
    const RESET = '\x1b[0m'

    for (let i = this.lastMessageCount; i < anthropicMessages.length; i++) {
      const msg = anthropicMessages[i]
      const role = msg.role.toUpperCase()
      const color = roleColors[msg.role] || '\x1b[0m'

      // Helper to format content for display (handle escaped newlines)
      const formatContent = (content: string): string => {
        // Parse JSON strings to handle escaped characters
        try {
          // If it looks like JSON, try to parse and re-stringify with proper formatting
          if (content.startsWith('{') || content.startsWith('[')) {
            const parsed = JSON.parse(content)
            return JSON.stringify(parsed, null, 2)
          }
        } catch {
          // Not JSON, continue
        }
        // Replace literal \n with actual newlines for display
        return content.replace(/\\n/g, '\n')
      }

      if (typeof msg.content === 'string') {
        const content = formatContent(msg.content)
        logger.debug(`${color}[MSG ${i}] ${role}:${RESET}\n${content}`)
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((p): p is Anthropic.TextBlockParam => p.type === 'text')
          .map(p => p.text)
          .join('\n')
        const imageParts = msg.content.filter((p): p is Anthropic.ImageBlockParam => p.type === 'image')
        const toolUseCount = msg.content.filter(p => p.type === 'tool_use').length
        const toolResultCount = msg.content.filter(p => p.type === 'tool_result').length

        let suffix = ''
        if (toolUseCount > 0) suffix += ` [+${toolUseCount} tool_use]`
        if (toolResultCount > 0) suffix += ` [+${toolResultCount} tool_result]`

        const content = formatContent(textParts)
        logger.debug(`${color}[MSG ${i}] ${role}:${RESET}\n${content}${suffix}`)

        // Log each image attachment
        for (let j = 0; j < imageParts.length; j++) {
          const img = imageParts[j]
          if (img.source.type === 'base64') {
            const sizeKB = Math.round(img.source.data.length * 0.75 / 1024)
            logger.debug(`  [ATTACHMENT ${j}] ${img.source.media_type}, ~${sizeKB}KB`)
          } else if (img.source.type === 'url') {
            logger.debug(`  [ATTACHMENT ${j}] URL: ${(img.source as any).url}`)
          }
        }
      }
    }
    this.lastMessageCount = anthropicMessages.length

    const requestParams: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: options?.maxTokens || 4096,
      system: systemMessage?.content,
      messages: anthropicMessages,
    }

    // Only add tools if using native tool call
    if (this.nativeToolCall && anthropicTools.length > 0) {
      requestParams.tools = anthropicTools
      requestParams.tool_choice = { type: 'any' }
    }

    const response = await this.client.messages.create(requestParams)

    // Parse response
    let content = ''
    const toolCalls: ToolCall[] = []

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        })
      }
    }

    // If not using native tool call, parse tool calls from text
    if (!this.nativeToolCall && toolCalls.length === 0 && content) {
      const { thought, toolCalls: parsedCalls } = parseToolCallsFromText(content)
      if (parsedCalls.length > 0) {
        return {
          content: thought || content,
          toolCalls: parsedCalls,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        }
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    }
  }
}
