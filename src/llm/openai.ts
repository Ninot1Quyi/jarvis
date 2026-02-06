import OpenAI from 'openai'
import type {
  Message,
  ImageInput,
  ToolDefinition,
  ChatOptions,
  ChatResponse,
  ToolCall,
} from '../types.js'
import { BaseLLMProvider } from './base.js'
import { buildToolsPrompt, parseToolCallsFromText } from '../agent/tools/utils/parseToolCalls.js'
import * as fs from 'fs'

export class OpenAIProvider extends BaseLLMProvider {
  name = 'openai'
  protected client: OpenAI
  protected model: string
  protected nativeToolCall: boolean

  constructor(apiKey: string, baseUrl?: string, model?: string, nativeToolCall: boolean = true) {
    super()
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    })
    this.model = model || 'gpt-4o'
    this.nativeToolCall = nativeToolCall
  }

  /**
   * Build OpenAI messages from internal message format
   */
  protected buildMessages(
    messages: Message[],
    images: ImageInput[],
    tools?: ToolDefinition[]
  ): OpenAI.ChatCompletionMessageParam[] {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = []
    const toolsPrompt = !this.nativeToolCall && tools ? buildToolsPrompt(tools) : ''

    // Find the last user/computer message (not tool result converted to user)
    let lastUserMsgIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' || messages[i].role === 'computer') {
        lastUserMsgIndex = i
        break
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (msg.role === 'system') {
        const content = toolsPrompt ? msg.content + '\n' + toolsPrompt : msg.content
        openaiMessages.push({ role: 'system', content })
      } else if (msg.role === 'user' || msg.role === 'computer') {
        // 'computer' role is treated as 'user' for API, but semantically different
        const content: OpenAI.ChatCompletionContentPart[] = []

        // Add role indicator for computer messages
        if (msg.role === 'computer') {
          content.push({ type: 'text', text: '[COMPUTER FEEDBACK]' })
        }

        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }

        // Add images to the last user/computer message
        if (i === lastUserMsgIndex && images.length > 0) {
          for (const img of images) {
            // Add image name/label as text before the image
            if (img.name) {
              content.push({ type: 'text', text: `[${img.name}]` })
            }

            let imageUrl: string

            if (img.type === 'path') {
              const buffer = fs.readFileSync(img.data)
              const base64 = buffer.toString('base64')
              const mediaType = img.mediaType || 'image/png'
              imageUrl = `data:${mediaType};base64,${base64}`
            } else if (img.type === 'base64') {
              const mediaType = img.mediaType || 'image/png'
              imageUrl = `data:${mediaType};base64,${img.data}`
            } else if (img.type === 'url') {
              imageUrl = img.data
            } else {
              throw new Error(`Unsupported image type: ${img.type}`)
            }

            content.push({
              type: 'image_url',
              image_url: { url: imageUrl },
            })
          }
        }

        openaiMessages.push({ role: 'user', content })
      } else if (msg.role === 'assistant') {
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: msg.content || null,
        }

        if (this.nativeToolCall && msg.toolCalls) {
          assistantMsg.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }))
        }

        openaiMessages.push(assistantMsg)
      } else if (msg.role === 'tool') {
        if (this.nativeToolCall) {
          openaiMessages.push({
            role: 'tool',
            tool_call_id: msg.toolCallId!,
            content: msg.content,
          })
        } else {
          // In prompt engineering mode, convert tool result to user message
          openaiMessages.push({
            role: 'user',
            content: `Tool execution result: ${msg.content}`,
          })
        }
      }
    }

    return openaiMessages
  }

  protected async doChat(
    messages: Message[],
    images: ImageInput[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const openaiMessages = this.buildMessages(messages, images, tools)

    if (this.nativeToolCall) {
      return this.chatWithNativeTools(openaiMessages, tools, options)
    } else {
      return this.chatWithPromptEngineering(openaiMessages, options)
    }
  }

  /**
   * Chat using native OpenAI function calling
   */
  private async chatWithNativeTools(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens || 4096,
      messages,
      tools: openaiTools,
      tool_choice: 'required',
    } as any)

    const choice = response.choices[0]
    const message = choice.message

    const toolCalls: ToolCall[] = []
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })
      }
    }

    // Fallback: try parsing from text if no native tool calls
    if (toolCalls.length === 0 && message.content) {
      const { toolCalls: parsedCalls } = parseToolCallsFromText(message.content)
      if (parsedCalls.length > 0) {
        toolCalls.push(...parsedCalls)
      }
    }

    return {
      content: message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    }
  }

  /**
   * Chat using prompt engineering for tool calls
   */
  private async chatWithPromptEngineering(
    messages: OpenAI.ChatCompletionMessageParam[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens || 4096,
      messages,
    })

    const choice = response.choices[0]
    const message = choice.message
    const content = message.content || ''

    // Parse tool calls from text
    const { thought, toolCalls } = parseToolCallsFromText(content)

    return {
      content: toolCalls.length > 0 ? thought : content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    }
  }
}
