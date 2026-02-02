import type {
  LLMProvider,
  Message,
  ImageInput,
  ToolCall,
  Step,
  Task,
} from '../types.js'
import { ToolRegistry, toolRegistry } from './tools/index.js'
import { config, getPrompt, fillTemplate, ensureDir } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { createProvider } from '../llm/index.js'
import { screenshotTool } from './tools/system.js'
import * as fs from 'fs'
import * as path from 'path'

export interface AgentOptions {
  maxSteps?: number
  provider?: 'anthropic' | 'openai' | 'doubao'
}

interface ScreenContext {
  screenWidth: number
  screenHeight: number
}

export class Agent {
  private llm: LLMProvider
  private tools: ToolRegistry
  private steps: Step[] = []
  private maxSteps: number
  private screenContext: ScreenContext = { screenWidth: 1920, screenHeight: 1080 }

  constructor(options: AgentOptions = {}) {
    this.maxSteps = options.maxSteps || config.maxSteps
    this.llm = createProvider(
      options.provider || config.defaultProvider,
      config.keys
    )
    this.tools = toolRegistry
  }

  async run(taskDescription: string): Promise<void> {
    logger.info(`Starting task: ${taskDescription}`)

    const task: Task = {
      id: Date.now().toString(),
      description: taskDescription,
      status: 'in_progress',
      priority: 'medium',
      createdAt: new Date(),
      source: 'tui',
    }

    ensureDir(config.screenshotDir)

    const systemPrompt = getPrompt('system')
    const userTemplate = getPrompt('user')

    // 消息历史
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
    ]

    let stepCount = 0
    let finished = false

    while (stepCount < this.maxSteps && !finished) {
      stepCount++
      logger.info(`Step ${stepCount}/${this.maxSteps}`)

      // 截图
      const screenshotResult = await screenshotTool.execute(
        {},
        { screenshotDir: config.screenshotDir }
      )

      if (!screenshotResult.success) {
        logger.error('Failed to take screenshot')
        break
      }

      const screenshotData = screenshotResult.data as {
        path: string
        screenWidth: number
        screenHeight: number
        mediaType: string
      }

      this.screenContext = {
        screenWidth: screenshotData.screenWidth,
        screenHeight: screenshotData.screenHeight,
      }

      logger.debug(`Screenshot: ${screenshotData.path}`)
      logger.debug(`Screen: ${this.screenContext.screenWidth}x${this.screenContext.screenHeight}`)

      // 构建 user 消息
      const recentStepsText = this.steps.slice(-5).map((s, i) => {
        return `${i + 1}. [${s.toolCall.name}] ${JSON.stringify(s.toolCall.arguments)} -> ${s.result}`
      }).join('\n') || '(none)'

      const userContent = fillTemplate(userTemplate, {
        task: task.description,
        todos: '(none)',
        recentSteps: recentStepsText,
        relevantMemories: '(none)',
      })

      // 添加 user 消息
      messages.push({ role: 'user', content: userContent })

      // 当前截图
      const images: ImageInput[] = [
        {
          type: 'path',
          data: screenshotData.path,
          mediaType: (screenshotData.mediaType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
        },
      ]

      // 调用 LLM
      const response = await this.llm.chatWithVisionAndTools(
        messages,
        images,
        this.tools.getDefinitions(),
        { maxTokens: 4096 }
      )

      logger.debug(`Tokens: ${response.usage.inputTokens} in, ${response.usage.outputTokens} out`)

      if (response.content) {
        logger.thought(response.content)
      }

      // 添加 assistant 消息
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      })

      // 判断是否有工具调用
      if (!response.toolCalls || response.toolCalls.length === 0) {
        logger.info('No tool call, stopping')
        break
      }

      // 执行工具调用
      for (const toolCall of response.toolCalls) {
        const result = await this.tools.execute(toolCall, {
          screenshotDir: config.screenshotDir,
          screenWidth: this.screenContext.screenWidth,
          screenHeight: this.screenContext.screenHeight,
        })

        // 记录步骤
        const step: Step = {
          timestamp: Date.now(),
          screenshotPath: screenshotData.path,
          thought: response.content,
          toolCall,
          result: result.success ? 'success' : 'failed',
        }
        this.steps.push(step)
        await this.saveStep(step)

        // 添加 tool 结果消息
        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: toolCall.id,
        })

        // 检查是否完成
        if (result.data) {
          const data = result.data as Record<string, unknown>

          if (data.finished) {
            logger.info(`Task finished: ${data.summary}`)
            finished = true
            break
          }

          if (data.needUserInput) {
            logger.info(`User input needed: ${data.message}`)
            finished = true
            break
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (stepCount >= this.maxSteps) {
      logger.warn(`Reached max steps (${this.maxSteps})`)
    }

    logger.info(`Task completed in ${stepCount} steps`)
  }

  private async saveStep(step: Step): Promise<void> {
    const date = new Date().toISOString().slice(0, 10)
    const stepsDir = path.join(config.dataDir, 'memory', 'steps', date)
    ensureDir(stepsDir)

    const filename = `${step.timestamp}.json`
    const filepath = path.join(stepsDir, filename)

    fs.writeFileSync(filepath, JSON.stringify(step, null, 2))
    logger.debug(`Step saved: ${filepath}`)
  }
}
