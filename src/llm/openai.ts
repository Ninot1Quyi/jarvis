import OpenAI from 'openai'
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
import { buildToolsPrompt, parseToolCallsFromText } from '../agent/tools/utils/parseToolCalls.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

// 确保 logs 目录存在
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..', '..')
const LOGS_DIR = path.join(ROOT_DIR, 'logs')

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
  }
}

function saveRequestLog(provider: string, request: any, response: any) {
  try {
    ensureLogsDir()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${timestamp}_${provider}.json`
    const filepath = path.join(LOGS_DIR, filename)

    // 移除 base64 图片数据以减小日志大小
    const cleanRequest = JSON.parse(JSON.stringify(request))
    if (cleanRequest.messages) {
      for (const msg of cleanRequest.messages) {
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
              part.image_url.url = '[BASE64_IMAGE_REMOVED]'
            }
          }
        }
      }
    }

    fs.writeFileSync(filepath, JSON.stringify({ request: cleanRequest, response }, null, 2))
    logger.debug(`Request log saved: ${filepath}`)
  } catch (e) {
    logger.error(`Failed to save request log: ${e}`)
  }
}

export class OpenAIProvider implements LLMProvider {
  name = 'openai'
  protected client: OpenAI
  protected model: string
  protected nativeToolCall: boolean
  private lastMessageCount: number = 0  // Track message count for debug logging

  constructor(apiKey: string, baseUrl?: string, model?: string, nativeToolCall: boolean = true) {
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

    // Find the last user message (not tool result converted to user)
    let lastUserMsgIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMsgIndex = i
        break
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (msg.role === 'system') {
        const content = toolsPrompt ? msg.content + '\n' + toolsPrompt : msg.content
        openaiMessages.push({ role: 'system', content })
      } else if (msg.role === 'user') {
        const content: OpenAI.ChatCompletionContentPart[] = []

        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }

        // Add images to the last user message
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

  async chatWithVisionAndTools(
    messages: Message[],
    images: ImageInput[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const openaiMessages = this.buildMessages(messages, images, tools)

    logger.debug(`Calling ${this.name} API`, {
      model: this.model,
      messageCount: openaiMessages.length,
      nativeToolCall: this.nativeToolCall,
    })

    // Log only new messages since last call
    // ANSI colors: orange for ASSISTANT, green for USER, gray for others
    const roleColors: Record<string, string> = {
      assistant: '\x1b[38;5;208m',  // orange
      user: '\x1b[32m',             // green
      system: '\x1b[90m',           // gray
      tool: '\x1b[90m',             // gray
    }
    const RESET = '\x1b[0m'

    for (let i = this.lastMessageCount; i < openaiMessages.length; i++) {
      const msg = openaiMessages[i]
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
        logger.debug(`${color}[MSG ${i}] ${role}:\n${content}${RESET}`)
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((p): p is OpenAI.ChatCompletionContentPartText => p.type === 'text')
          .map(p => p.text)
          .join('\n')
        const imageParts = msg.content.filter((p): p is OpenAI.ChatCompletionContentPartImage => p.type === 'image_url')

        const content = formatContent(textParts)
        logger.debug(`${color}[MSG ${i}] ${role}:\n${content}${RESET}`)

        // Log each image attachment
        for (let j = 0; j < imageParts.length; j++) {
          const img = imageParts[j]
          const url = img.image_url.url
          if (url.startsWith('data:')) {
            const mediaType = url.split(';')[0].replace('data:', '')
            const base64Length = url.split(',')[1]?.length || 0
            const sizeKB = Math.round(base64Length * 0.75 / 1024)
            logger.debug(`${color}  [ATTACHMENT ${j}] ${mediaType}, ~${sizeKB}KB${RESET}`)
          } else {
            logger.debug(`${color}  [ATTACHMENT ${j}] URL: ${url}${RESET}`)
          }
        }
      }
    }
    this.lastMessageCount = openaiMessages.length

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

    const requestBody = {
      model: this.model,
      max_tokens: options?.maxTokens || 4096,
      messages,
      tools: openaiTools,
      tool_choice: 'required',
    }

    const response = await this.client.chat.completions.create(requestBody as any)

    // 保存请求日志
    saveRequestLog(this.name, requestBody, response)

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
        logger.debug('Parsed tool calls from text:', parsedCalls)
        toolCalls.push(...parsedCalls)
      }
    }

    // Log ASSISTANT response
    const ORANGE = '\x1b[38;5;208m'
    const RESET = '\x1b[0m'
    let assistantLog = `${ORANGE}[MSG ${this.lastMessageCount}] ASSISTANT:\n`
    if (message.content) {
      assistantLog += message.content
    }
    // Only show [Tools: ...] for native tool call mode (text mode already has <Action> in content)
    if (this.nativeToolCall && toolCalls.length > 0) {
      const toolsStr = toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.arguments)})`).join(', ')
      assistantLog += `${message.content ? '\n' : ''}[Tools: ${toolsStr}]`
    }
    assistantLog += RESET
    logger.debug(assistantLog)

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
    const requestBody = {
      model: this.model,
      max_tokens: options?.maxTokens || 4096,
      messages,
    }

    const startTime = Date.now()
    const response = await this.client.chat.completions.create(requestBody)
    logger.debug(`${this.name} API took ${Date.now() - startTime}ms`)

    // 保存请求日志
    saveRequestLog(this.name, requestBody, response)

    const choice = response.choices[0]
    const message = choice.message
    const content = message.content || ''

    // Parse tool calls from text
    const { thought, toolCalls } = parseToolCallsFromText(content)

    // Log ASSISTANT response
    const ORANGE = '\x1b[38;5;208m'
    const RESET = '\x1b[0m'
    let assistantLog = `${ORANGE}[MSG ${this.lastMessageCount}] ASSISTANT:\n`
    assistantLog += content
    if (toolCalls.length > 0) {
      const toolsStr = toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.arguments)})`).join(', ')
      assistantLog += `\n[Tools: ${toolsStr}]`
    }
    assistantLog += RESET
    logger.debug(assistantLog)

    return {
      // If we parsed tool calls, only return thought (may be empty)
      // If no tool calls parsed, return original content for debugging
      content: toolCalls.length > 0 ? thought : content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    }
  }
}
