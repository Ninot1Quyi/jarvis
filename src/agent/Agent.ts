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
import { messageManager } from '../message/MessageManager.js'
import { type MailConfig } from '../message/mail.js'
import type { NotificationConfig } from '../notification/types.js'
import { captureAXSnapshot, computeAXDiff, type AXSnapshot } from '../notification/axSnapshot.js'
import * as fs from 'fs'
import * as path from 'path'

export interface AgentOptions {
  maxSteps?: number
  provider?: string
  overlay?: boolean
  interactive?: boolean  // 交互模式：无初始任务，等待消息
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
  private overlay: boolean = false  // 是否启用 overlay UI
  private interactive: boolean = false  // 交互模式
  private lastHadToolCall: boolean = false  // 上一轮是否有工具调用
  private screenEnabled: boolean = true  // 屏幕截图开关，默认开启
  private currentTask: string = ''  // 当前任务
  private todoSummary: string = '(none)'  // TODO 摘要
  private axDiffBaseline: AXSnapshot | null = null
  private axToolDiffAdded: Map<string, number> = new Map()  // tool-caused additions to subtract

  constructor(options: AgentOptions = {}) {
    this.maxSteps = options.maxSteps || config.maxSteps
    this.overlay = options.overlay || false
    this.interactive = options.interactive || false
    const providerName = options.provider || config.defaultProvider
    this.llm = createProvider(providerName, config.keys)
    this.tools = toolRegistry

    // 获取当前 provider 的 nativeToolCall 配置
    const providerConfig = config.keys[providerName] as ProviderConfig | undefined
    this.nativeToolCall = providerConfig?.nativeToolCall !== false
  }

  async run(taskDescription?: string): Promise<void> {
    // Reset any messages stuck in 'processing' from a previous crashed run
    messageManager.resetProcessing()

    // 如果有初始任务，写入消息队列
    if (taskDescription) {
      messageManager.pushInbound('tui', taskDescription)
      logger.info(`Starting with task: ${taskDescription}`)
    } else {
      logger.info('Starting in interactive mode, waiting for messages...')
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

    // Initialize message manager (channels + deliverers)
    messageManager.init({
      overlay: this.overlay,
      mailConfig: config.keys.mail as MailConfig | undefined,
      notificationConfig: config.keys.notification as NotificationConfig | undefined,
    })

    // 获取组合后的系统提示（根据nativeToolCall和平台自动选择）
    const platform = getCurrentPlatform()
    let systemPrompt = getSystemPrompt(this.nativeToolCall, platform)

    // 使用Skills系统增强system prompt（追加用户自定义skills）
    if (this.skillComposer) {
      systemPrompt = this.skillComposer.compose(systemPrompt, platform)
    }

    const computerTemplate = getPrompt('user')  // 复用 user template 作为 computer template

    // 消息历史
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
    ]

    // 上一轮的工具执行结果（用于合并到下一轮的 computer prompt）
    let lastToolResults: { toolCall: ToolCall; result: string }[] = []

    let stepCount = 0
    let finished = false

    while (stepCount < this.maxSteps && !(finished && !this.interactive)) {
      // AX diff: detect external changes before checking messages (so diff gets consumed this round)
      const diffApps = (config.keys.notification as NotificationConfig)?.diffApps || []
      if (this.axDiffBaseline && diffApps.length > 0) {
        const snap = await captureAXSnapshot()
        if (snap && snap.bundleId === this.axDiffBaseline.bundleId) {
          const totalDiff = computeAXDiff(this.axDiffBaseline.lines, snap.lines)
          // Subtract tool-caused additions
          const externalAdded: string[] = []
          const toolRemain = new Map(this.axToolDiffAdded)
          for (const line of totalDiff.added) {
            const cnt = toolRemain.get(line) || 0
            if (cnt > 0) {
              toolRemain.set(line, cnt - 1)
            } else {
              externalAdded.push(line)
            }
          }
          if (externalAdded.length > 0) {
            const diffLines = externalAdded.map(l => `+ ${l}`)
            const formatted = `[App: ${snap.appName}] [AX Change: +${externalAdded.length}]\n${diffLines.join('\n')}`
            messageManager.pushInbound('notification', formatted)
            logger.info(`[AX-diff] external: ${snap.appName} +${externalAdded.length}`)
          }
        }
        this.axToolDiffAdded.clear()
      }

      // 1. 检查消息队列，获取新的用户消息
      const pendingMessages = messageManager.getInbound()
      let hasUserMessage = false

      if (pendingMessages.length > 0) {
        // 有新消息，立刻标记为 processing（从 UI pending queue 移除）
        const ids = pendingMessages.map(m => m.id)
        messageManager.markProcessing(ids)

        // 注入到对话中
        const chatContent = messageManager.formatInboundAsChat()
        if (chatContent) {
          messages.push({ role: 'user', content: chatContent })

          // 标记消息为已消费
          messageManager.consumeInbound(ids)

          // Forward to overlay UI
          messageManager.notifyGuiInbound(pendingMessages)

          logger.info(`Received ${pendingMessages.length} new message(s)`)
          hasUserMessage = true
        }

        // 重置无工具调用计数
        this.noToolCallCount = 0
        this.lastHadToolCall = true  // 有新消息时视为需要继续
      } else if (stepCount === 0 || (!this.lastHadToolCall && this.noToolCallCount >= 2)) {
        // Idle wait: poll every 1s for new messages AND AX diff on whitelisted focused apps
        const diffApps = (config.keys.notification as NotificationConfig)?.diffApps || []
        let idleBaseline: AXSnapshot | null = null
        if (diffApps.length > 0) {
          const snap = await captureAXSnapshot()
          if (snap && diffApps.some(app => snap.appName.toLowerCase().includes(app.toLowerCase()))) {
            idleBaseline = snap
          }
        }

        // Poll loop: check messages + AX diff every 1s
        while (true) {
          const hasMsg = await this.waitForMessages(1000)
          if (hasMsg) break

          // AX diff check on whitelisted focused app
          if (diffApps.length > 0) {
            const snap = await captureAXSnapshot()
            if (snap && diffApps.some(app => snap.appName.toLowerCase().includes(app.toLowerCase()))) {
              if (idleBaseline && snap.bundleId === idleBaseline.bundleId) {
                const diff = computeAXDiff(idleBaseline.lines, snap.lines)
                if (diff.added.length > 0) {
                  const diffLines = diff.added.map(l => `+ ${l}`)
                  const formatted = `[App: ${snap.appName}] [AX Change: +${diff.added.length}]\n${diffLines.join('\n')}`
                  messageManager.pushInbound('notification', formatted)
                  logger.info(`[AX-diff] idle: ${snap.appName} +${diff.added.length}`)
                  // Clear the main-loop baseline so the external diff check
                  // at the top of the loop doesn't duplicate this detection
                  this.axDiffBaseline = null
                  break
                }
              }
              // Update baseline to current focused app (may have switched)
              idleBaseline = snap
            }
          }
        }

        continue
      }

      stepCount++
      logger.info(`Step ${stepCount}/${this.maxSteps}`)

      // 2. 截图（仅当屏幕开启时）
      let screenshotData: {
        path: string
        screenWidth: number
        screenHeight: number
        mediaType: string
      } | null = null

      if (this.screenEnabled) {
        const screenshotResult = await screenshotTool.execute(
          {},
          { screenshotDir: config.screenshotDir }
        )

        if (!screenshotResult.success) {
          logger.error('Failed to take screenshot')
          break
        }

        screenshotData = screenshotResult.data as {
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
      }

      // 获取当前鼠标位置并转换为 [0, 1000] 坐标系
      const mousePos = await this.getMousePosition()
      const mouseX = Math.round((mousePos.x / this.screenContext.screenWidth) * 1000)
      const mouseY = Math.round((mousePos.y / this.screenContext.screenHeight) * 1000)

      // 获取当前焦点窗口
      const focusedWindow = await this.getFocusedWindow()

      // 检测是否连续点击同一位置
      const reminder = this.checkRepeatedClicks()

      // 3. 构建 computer 消息（系统反馈）
      const recentStepsText = this.steps.slice(-5).map((s, i) => {
        return `${i + 1}. [${s.toolCall.name}] ${JSON.stringify(s.toolCall.arguments)} -> ${s.result}`
      }).join('\n') || '(none)'

      // 构建屏幕状态信息（仅当屏幕开启时显示）
      let screenStatus = ''
      if (this.screenEnabled) {
        screenStatus = `## Screen Status

Mouse: [${mouseX}, ${mouseY}]
Focused Window: ${focusedWindow}

Note: Screenshot is attached. If target window != focused window, first click activates window.`
      }

      let computerContent = fillTemplate(computerTemplate, {
        task: this.currentTask || '(none)',
        todoSummary: this.todoSummary,
        recentSteps: recentStepsText,
        screenStatus,
      })

      // 如果本轮有 user 消息，在 computer 开头提示 LLM 同时关注
      if (hasUserMessage) {
        computerContent = `<quote>The previous message has role=user. It was sent together with this computer feedback. Pay attention to both messages and decide whether to update tasks, update the TODO list, or respond to the user's new message.</quote>\n\n` + computerContent
      }

      // 添加上一轮的工具执行结果
      if (lastToolResults.length > 0) {
        computerContent += '\n\n---\n\n## Tool Execution Results\n'
        for (const { toolCall, result } of lastToolResults) {
          // 简化参数显示
          const argsStr = Object.entries(toolCall.arguments)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ')
          computerContent += `\n### ${toolCall.name}(${argsStr})\n\n`

          // Parse and format the result for better readability
          try {
            const parsed = JSON.parse(result)
            if (parsed.message) {
              // message 字段包含格式化的反馈，直接显示
              computerContent += parsed.message.trim()
              // 如果有 error，显示
              if (parsed.error) {
                computerContent += `\n\n**Error:** ${parsed.error}`
              }
            } else if (parsed.error) {
              computerContent += `**Error:** ${parsed.error}`
            } else if (parsed.data) {
              computerContent += JSON.stringify(parsed.data, null, 2)
            } else {
              computerContent += result
            }
          } catch {
            computerContent += result
          }
          computerContent += '\n'
        }
        // 清空，准备下一轮
        lastToolResults = []
      }

      // 添加提醒
      if (reminder) {
        computerContent += `\n\n<reminder>${reminder}</reminder>`
      }

      // 添加 computer 消息（系统反馈）
      messages.push({ role: 'computer', content: computerContent })

      // 构建图片数组
      const images: ImageInput[] = []
      const guiAttachments: string[] = []

      // 主屏幕截图（仅当屏幕开启时）
      if (this.screenEnabled && screenshotData) {
        images.push({
          type: 'path',
          data: screenshotData.path,
          mediaType: (screenshotData.mediaType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          name: 'screen',
        })
        guiAttachments.push(screenshotData.path)
      }

      // 添加工具截图（如果有）
      for (const toolScreenshot of this.pendingToolScreenshots) {
        images.push({
          type: 'path',
          data: toolScreenshot.path,
          mediaType: toolScreenshot.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          name: toolScreenshot.name,
        })
        guiAttachments.push(toolScreenshot.path)
      }
      // 清空待处理的工具截图
      this.pendingToolScreenshots = []

      // 发送 computer 消息到 overlay UI（含截图附件）
      messageManager.notifyGuiComputer(computerContent, guiAttachments.length > 0 ? guiAttachments : undefined)

      // AX diff: capture baseline right before LLM call
      // Next round will diff against this to detect changes during LLM thinking + tool execution
      if (diffApps.length > 0) {
        const snap = await captureAXSnapshot()
        if (snap && diffApps.some(app => snap.appName.toLowerCase().includes(app.toLowerCase()))) {
          this.axDiffBaseline = snap
          logger.info(`[AX-diff] baseline: ${snap.appName} (${snap.lines.length} lines)`)
        }
      }

      // 4. 调用 LLM
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

      // 5. 提交到 MessageManager（解析 <chat> 标签，路由到各通道，持久化+重试）
      messageManager.dispatchReply(response.content || '')

      // Forward assistant reply to overlay UI
      messageManager.notifyGuiAssistant(
        response.content || '',
        response.toolCalls?.map(tc => ({ name: tc.name, arguments: tc.arguments })),
      )

      // 添加 assistant 消息
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      })

      // 6. 如果有 parseError，注入错误反馈并跳过本轮工具调用判断
      if (response.parseError) {
        logger.warn(`Tool call parse error: ${response.parseError}`)
        lastToolResults.push({
          toolCall: { id: 'system', name: 'system_error', arguments: {} },
          result: JSON.stringify({
            message: `<error>Your <Action> JSON is malformed and could not be parsed.

${response.parseError}

Correct format:
<Action>
[
  {"name": "tool_name", "arguments": {"key": "value"}},
  {"name": "wait", "arguments": {"ms": 500}}
]
</Action>

Fix the JSON and retry.</error>`
          })
        })
        continue
      }

      // 7. 判断是否有工具调用
      if (!response.toolCalls || response.toolCalls.length === 0) {
        this.noToolCallCount++
        this.lastHadToolCall = false

        if (this.noToolCallCount >= 2) {
          // 连续两轮没有工具调用 — 任务确认完成，停止自循环，等待新消息
          logger.info('No tool call for 2 consecutive rounds, task confirmed complete.')

          if (this.interactive) {
            // Interactive mode: reset task state but keep noToolCallCount/lastHadToolCall
            // so the loop falls into the idle-wait branch on continue
            this.currentTask = ''
            lastToolResults = []
            logger.info('Task done, waiting for new messages...')
          } else {
            finished = true
          }
          continue
        } else {
          // 第一次没有工具调用 — 注入完成 checklist
          logger.info('No tool call (1st time), injecting completion checklist')
          lastToolResults.push({
            toolCall: { id: 'system', name: 'system_reminder', arguments: {} },
            result: JSON.stringify({
              message: `<reminder>COMPLETION CHECKLIST -- You called no tools. If the task is complete, review before confirming:

1. Did you call recordTask(content="...", source="...") at the START of this task?
2. Did you REPLY to the message source?
   - If the task came from <notification> (WeChat, QQ, Slack, etc.): You MUST open the originating app via GUI automation and send a reply to the sender. <chat> tags CANNOT reach these apps.
   - If the task came from <chat> (tui/gui/mail): Reply via <chat> tags.
3. Did you update TODO to "completed"?
4. Did you call recordTask(content="") to clear the task?

If ANY step is missing (especially replying to the sender), do it NOW with tool calls.
If the task is NOT complete, call tools to make progress.
If ALL steps are done, skip tools again in the next round to confirm completion.</reminder>`
            })
          })
          continue
        }
      }

      // Reset counter when tools are called
      this.noToolCallCount = 0
      this.lastHadToolCall = true

      // 记录本轮的点击坐标
      const currentRoundClicks: number[][] = []

      // AX diff: snapshot before tool execution
      let preToolSnap: AXSnapshot | null = null
      if (diffApps.length > 0) {
        const snap = await captureAXSnapshot()
        if (snap && diffApps.some(app => snap.appName.toLowerCase().includes(app.toLowerCase()))) {
          preToolSnap = snap
        }
      }

      // 7. 执行工具调用
      for (const toolCall of response.toolCalls) {
        const result = await this.tools.execute(toolCall, {
          screenshotDir: config.screenshotDir,
          workspace: config.workspace,
          screenWidth: this.screenContext.screenWidth,
          screenHeight: this.screenContext.screenHeight,
          stepCount,
        })

        // Send tool result to overlay
        const resultStr = result.success
          ? (result.message || 'done')
          : (result.error || 'failed')
        messageManager.notifyGuiToolResult(toolCall.name, resultStr)

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

          // 处理 screen 工具的开关状态
          if (typeof data.screenEnabled === 'boolean') {
            this.screenEnabled = data.screenEnabled
            logger.info(`Screen capture ${this.screenEnabled ? 'enabled' : 'disabled'}`)
          }

          // 处理 task 工具的任务设置
          if (data.taskSet) {
            this.currentTask = (data.taskContent as string) || ''
            logger.info(`Task ${this.currentTask ? 'set: ' + this.currentTask : 'cleared'}`)
          }

          // 处理 todo_write 工具的摘要更新
          if (data.summary && toolCall.name === 'todo_write') {
            this.todoSummary = data.summary as string
            logger.info(`TODO updated: ${this.todoSummary}`)
          }
        }

        // 记录步骤
        const step: Step = {
          timestamp: Date.now(),
          screenshotPath: screenshotData?.path || '',
          thought: response.content,
          toolCall,
          result: result.success ? 'success' : 'failed',
        }
        this.steps.push(step)
        await this.saveStep(step)

        // 收集 tool 结果，下一轮合并到 computer prompt
        // 过滤掉 success 字段，避免误导 agent（实际成功与否需要看截图）
        const { success: _success, ...resultForAgent } = result
        const hasContent = resultForAgent.data || resultForAgent.message || resultForAgent.error
        lastToolResults.push({
          toolCall,
          result: hasContent ? JSON.stringify(resultForAgent) : 'done',
        })

        // 检查是否需要用户输入
        if (result.data) {
          const data = result.data as Record<string, unknown>

          if (data.needUserInput) {
            logger.info(`User input needed: ${data.message}`)
            // 不退出，等待用户输入
          }
        }
      }

      // 保存本轮点击信息（循环写入）
      this.roundClicks[this.roundClickIndex] = { coordinates: currentRoundClicks }
      this.roundClickIndex = (this.roundClickIndex + 1) % ROUND_CLICKS_CAPACITY

      // AX diff: snapshot after tool execution, compute tool-caused diff
      if (diffApps.length > 0 && preToolSnap) {
        const postToolSnap = await captureAXSnapshot()
        if (postToolSnap && postToolSnap.bundleId === preToolSnap.bundleId) {
          const toolDiff = computeAXDiff(preToolSnap.lines, postToolSnap.lines)
          for (const line of toolDiff.added) {
            this.axToolDiffAdded.set(line, (this.axToolDiffAdded.get(line) || 0) + 1)
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

  /**
   * 等待新消息到达
   */
  private async waitForMessages(timeoutMs: number): Promise<boolean> {
    return messageManager.waitForInbound(timeoutMs)
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
