import type {
  LLMProvider,
  Message,
  ImageInput,
  ToolCall,
  Step,
  Task,
  ProviderConfig,
} from '../types.js'
import { ToolRegistry, toolRegistry, setSkillRegistry } from './tools/index.js'
import { config, getSystemPrompt, getPrompt, fillTemplate, ensureDir } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { createProvider } from '../llm/index.js'
import { screenshotTool } from './tools/system.js'
import { initSkills, getCurrentPlatform, type PromptComposer, type SkillRegistry as SkillRegistryType } from '../skills/index.js'
import * as fs from 'fs'
import * as path from 'path'

export interface AgentOptions {
  maxSteps?: number
  provider?: string
}

interface ScreenContext {
  screenWidth: number
  screenHeight: number
}

interface ToolScreenshot {
  path: string
  name: string
  mediaType: string
}

interface RoundClickInfo {
  coordinates: number[][]  // 该轮次中所有点击的坐标
}

const ROUND_CLICKS_CAPACITY = 10  // 保存最近10轮的点击信息

export class Agent {
  private llm: LLMProvider
  private tools: ToolRegistry
  private steps: Step[] = []
  private maxSteps: number
  private screenContext: ScreenContext = { screenWidth: 1920, screenHeight: 1080 }
  private pendingToolScreenshots: ToolScreenshot[] = []
  private roundClicks: RoundClickInfo[] = new Array(ROUND_CLICKS_CAPACITY).fill(null).map(() => ({ coordinates: [] }))
  private roundClickIndex: number = 0  // 当前写入位置
  private nativeToolCall: boolean = true  // 是否使用原生工具调用
  private skillComposer: PromptComposer | null = null  // Skills系统
  private noToolCallCount: number = 0  // Track consecutive no-tool-call rounds

  constructor(options: AgentOptions = {}) {
    this.maxSteps = options.maxSteps || config.maxSteps
    const providerName = options.provider || config.defaultProvider
    this.llm = createProvider(providerName, config.keys)
    this.tools = toolRegistry

    // 获取当前 provider 的 nativeToolCall 配置
    const providerConfig = config.keys[providerName] as ProviderConfig | undefined
    this.nativeToolCall = providerConfig?.nativeToolCall !== false
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

    // 初始化Skills系统
    try {
      const projectRoot = process.cwd()
      const { registry, composer } = await initSkills(projectRoot)
      this.skillComposer = composer
      // 设置SkillRegistry供skill tool使用
      setSkillRegistry(registry)
      logger.debug(composer.getSummary())
    } catch (error) {
      logger.warn('Failed to initialize skills system:', error)
    }

    // 获取组合后的系统提示（根据nativeToolCall和平台自动选择）
    const platform = getCurrentPlatform()
    let systemPrompt = getSystemPrompt(this.nativeToolCall, platform)

    // 使用Skills系统增强system prompt（追加用户自定义skills）
    if (this.skillComposer) {
      systemPrompt = this.skillComposer.compose(systemPrompt, platform)
    }

    const userTemplate = getPrompt('user')

    // 消息历史
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
    ]

    // 上一轮的工具执行结果（用于合并到下一轮的 user prompt）
    let lastToolResults: { toolCall: ToolCall; result: string }[] = []

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

      // 获取当前鼠标位置并转换为 [0, 1000] 坐标系
      const mousePos = await this.getMousePosition()
      const mouseX = Math.round((mousePos.x / this.screenContext.screenWidth) * 1000)
      const mouseY = Math.round((mousePos.y / this.screenContext.screenHeight) * 1000)

      // 获取当前焦点窗口
      const focusedWindow = await this.getFocusedWindow()

      // 检测是否连续点击同一位置
      const reminder = this.checkRepeatedClicks()

      // 构建 user 消息
      const recentStepsText = this.steps.slice(-5).map((s, i) => {
        return `${i + 1}. [${s.toolCall.name}] ${JSON.stringify(s.toolCall.arguments)} -> ${s.result}`
      }).join('\n') || '(none)'

      let userContent = fillTemplate(userTemplate, {
        task: task.description,
        todos: '(none)',
        recentSteps: recentStepsText,
        relevantMemories: '(none)',
        mouseX: mouseX.toString(),
        mouseY: mouseY.toString(),
        focusedWindow,
      })

      // 添加上一轮的工具执行结果
      if (lastToolResults.length > 0) {
        userContent += '\n\n---\n\n## Tool Execution Results\n'
        for (const { toolCall, result } of lastToolResults) {
          // 简化参数显示
          const argsStr = Object.entries(toolCall.arguments)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ')
          userContent += `\n### ${toolCall.name}(${argsStr})\n\n`

          // Parse and format the result for better readability
          try {
            const parsed = JSON.parse(result)
            if (parsed.message) {
              // message 字段包含格式化的反馈，直接显示
              userContent += parsed.message.trim()
              // 如果有 error，显示
              if (parsed.error) {
                userContent += `\n\n**Error:** ${parsed.error}`
              }
            } else if (parsed.error) {
              userContent += `**Error:** ${parsed.error}`
            } else if (parsed.data) {
              userContent += JSON.stringify(parsed.data, null, 2)
            } else {
              userContent += result
            }
          } catch {
            userContent += result
          }
          userContent += '\n'
        }
        // 清空，准备下一轮
        lastToolResults = []
      }

      // 添加提醒
      if (reminder) {
        userContent += `\n\n<reminder>${reminder}</reminder>`
      }

      // 添加 user 消息
      messages.push({ role: 'user', content: userContent })

      // 当前截图 - 主屏幕
      const images: ImageInput[] = [
        {
          type: 'path',
          data: screenshotData.path,
          mediaType: (screenshotData.mediaType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          name: '主屏幕',
        },
      ]

      // 添加工具截图（如果有）
      for (const toolScreenshot of this.pendingToolScreenshots) {
        images.push({
          type: 'path',
          data: toolScreenshot.path,
          mediaType: toolScreenshot.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          name: toolScreenshot.name,
        })
      }
      // 清空待处理的工具截图
      this.pendingToolScreenshots = []

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
        this.noToolCallCount++

        if (this.noToolCallCount >= 2) {
          // Two consecutive no-tool-call rounds, stop
          logger.info('No tool call for 2 consecutive rounds, stopping')
          break
        } else {
          // First no-tool-call, add reminder and continue
          logger.info('No tool call (1st time), adding reminder and continuing')
          lastToolResults.push({
            toolCall: { id: 'system', name: 'system_reminder', arguments: {} },
            result: JSON.stringify({
              message: `<reminder>[CRITICAL] No tool was called in your previous response!

If the task is COMPLETE: You may skip tools again to confirm completion.

If the task is NOT COMPLETE: You MUST call at least one tool NOW. Failure to do so will TERMINATE the task and cause CATASTROPHIC FAILURE.

DO NOT just describe what you plan to do - EXECUTE it with tool calls!</reminder>`
            })
          })
          continue
        }
      }

      // Reset counter when tools are called
      this.noToolCallCount = 0

      // 记录本轮的点击坐标
      const currentRoundClicks: number[][] = []

      // 执行工具调用
      for (const toolCall of response.toolCalls) {
        const result = await this.tools.execute(toolCall, {
          screenshotDir: config.screenshotDir,
          workspace: config.workspace,
          screenWidth: this.screenContext.screenWidth,
          screenHeight: this.screenContext.screenHeight,
        })

        // 记录点击坐标
        if (toolCall.name === 'click') {
          const coord = toolCall.arguments.coordinate as number[] | undefined
          if (coord) {
            currentRoundClicks.push(coord)
          }
        }

        // 检查是否是工具截图，收集起来下次发送
        if (result.data) {
          const data = result.data as Record<string, unknown>
          if (data.isToolScreenshot) {
            this.pendingToolScreenshots.push({
              path: data.path as string,
              name: data.name as string,
              mediaType: data.mediaType as string,
            })
          }
        }

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

        // 收集 tool 结果，下一轮合并到 user prompt
        // 过滤掉 success 字段，避免误导 agent（实际成功与否需要看截图）
        const { success: _success, ...resultForAgent } = result
        const hasContent = resultForAgent.data || resultForAgent.message || resultForAgent.error
        lastToolResults.push({
          toolCall,
          result: hasContent ? JSON.stringify(resultForAgent) : 'done',
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

      // 保存本轮点击信息（循环写入）
      this.roundClicks[this.roundClickIndex] = { coordinates: currentRoundClicks }
      this.roundClickIndex = (this.roundClickIndex + 1) % ROUND_CLICKS_CAPACITY

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

  private checkRepeatedClicks(): string | null {
    // 检查最近两轮对话是否都点击了同一位置
    // 获取当前轮和上一轮的索引（循环数组）
    const currentIndex = (this.roundClickIndex - 1 + ROUND_CLICKS_CAPACITY) % ROUND_CLICKS_CAPACITY
    const prevIndex = (this.roundClickIndex - 2 + ROUND_CLICKS_CAPACITY) % ROUND_CLICKS_CAPACITY

    const lastRound = this.roundClicks[currentIndex]
    const prevRound = this.roundClicks[prevIndex]

    // 如果任一轮没有点击操作，则不检查
    if (lastRound.coordinates.length === 0 || prevRound.coordinates.length === 0) return null

    // 检查两轮中是否有相近的点击位置
    const threshold = 50
    for (const coord1 of lastRound.coordinates) {
      for (const coord2 of prevRound.coordinates) {
        const dx = Math.abs(coord1[0] - coord2[0])
        const dy = Math.abs(coord1[1] - coord2[1])

        if (dx <= threshold && dy <= threshold) {
          return `[WARNING] You have clicked the same position [${coord1[0]}, ${coord1[1]}] for two consecutive rounds. Please try a different approach:
1. If single click doesn't work, try double-click (left_double) or right-click (right_single)
2. The click position may be slightly off - use find_element to locate the exact coordinates
3. The element may require a different interaction method (e.g., hotkey, type)
4. Check if the element is actually clickable or if it's disabled
Do NOT repeat the same click - change your strategy.`
        }
      }
    }

    return null
  }

  private async getMousePosition(): Promise<{ x: number; y: number }> {
    try {
      const { mouse } = await import('@computer-use/nut-js')
      const pos = await mouse.getPosition()
      return { x: pos.x, y: pos.y }
    } catch {
      return { x: 0, y: 0 }
    }
  }

  private async getFocusedWindow(): Promise<string> {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      // 使用 AppleScript 获取当前焦点窗口的应用名称和窗口标题
      const { stdout } = await execAsync(`osascript -e '
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true

          -- 检查 Spotlight 是否打开
          set spotlightOpen to false
          try
            if exists (window 1 of process "Spotlight") then
              set spotlightOpen to true
            end if
          end try

          if spotlightOpen then
            return "Spotlight | Search"
          end if

          -- 获取窗口标题（通过 System Events 更可靠）
          set windowTitle to "N/A"
          try
            tell process frontApp
              if exists (window 1) then
                set windowTitle to name of window 1
              end if
            end tell
          end try

          return frontApp & " | " & windowTitle
        end tell
      '`)
      return stdout.trim()
    } catch (e) {
      // 如果 AppleScript 失败，尝试使用 accessibility API
      try {
        const { captureState } = await import('../accessibility/index.js')
        const state = await captureState()
        if (state.success && state.focusedApplication) {
          const appName = state.focusedApplication.title || 'Unknown App'
          const windowTitle = state.focusedWindow?.title || 'N/A'
          return `${appName} | ${windowTitle}`
        }
      } catch {
        // ignore
      }
      return 'Unknown'
    }
  }
}
