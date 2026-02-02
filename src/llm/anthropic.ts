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
import * as fs from 'fs'

type MediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  private client: Anthropic
  private model: string

  constructor(apiKey: string, baseUrl?: string, model?: string) {
    this.client = new Anthropic({
      apiKey,
      baseURL: baseUrl,
    })
    this.model = model || 'claude-sonnet-4-5-20250514'
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

        if (msg.toolCalls) {
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
      }
    }

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: t.parameters.properties,
        required: t.parameters.required,
      },
    }))

    logger.debug('Calling Anthropic API', {
      model: this.model,
      messageCount: anthropicMessages.length,
      toolCount: anthropicTools.length,
    })

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens || 4096,
      system: systemMessage?.content,
      messages: anthropicMessages,
      tools: anthropicTools,
      tool_choice: { type: 'any' },
    })

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
