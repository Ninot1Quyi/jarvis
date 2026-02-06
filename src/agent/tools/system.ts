import * as path from 'path'
import type { Tool } from '../../types.js'
import { ensureDir } from '../../utils/config.js'
import { logger } from '../../utils/logger.js'

// 使用 nut-js 获取屏幕尺寸（跨平台）
async function getScreenLogicalSize(): Promise<{ width: number; height: number }> {
  try {
    const { screen } = await import('@computer-use/nut-js')
    const width = await screen.width()
    const height = await screen.height()
    logger.debug(`Screen logical size: ${width}x${height}`)
    return { width, height }
  } catch (e) {
    logger.debug(`Failed to get screen size: ${e}`)
    return { width: 1920, height: 1080 }
  }
}

// 使用 macOS screencapture 截图（包含鼠标光标）
// IMPORTANT: Screenshots MUST include the mouse cursor for LLM to calibrate click positions
async function captureScreen(filepath: string): Promise<void> {
  const os = await import('os')
  if (os.platform() === 'darwin') {
    // macOS: use screencapture with -C (include cursor) and -x (no sound)
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    await execAsync(`screencapture -C -x "${filepath}"`)
  } else {
    // TODO: Other platforms - MUST include mouse cursor in screenshot
    // Windows: consider using PowerShell or native API that captures cursor
    // Linux: consider using scrot with cursor option or similar
    const { screen, saveImage } = await import('@computer-use/nut-js')
    const image = await screen.grab()
    await saveImage({ image, path: filepath })
  }
}

export const screenshotTool: Tool = {
  definition: {
    name: 'screenshot',
    description: 'Take a screenshot of the current screen',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  async execute(_args, context?: { screenshotDir?: string }) {
    const screenshotDir = context?.screenshotDir || '/tmp'
    ensureDir(screenshotDir)

    const timestamp = Date.now()
    const date = new Date().toISOString().slice(0, 10)
    const dateDir = path.join(screenshotDir, date)
    ensureDir(dateDir)

    const filename = `${timestamp}.png`
    const filepath = path.join(dateDir, filename)

    const screenSize = await getScreenLogicalSize()

    await captureScreen(filepath)

    return {
      success: true,
      data: {
        path: filepath,
        timestamp,
        screenWidth: screenSize.width,
        screenHeight: screenSize.height,
        mediaType: 'image/png',
      },
    }
  },
}

export const waitTool: Tool = {
  definition: {
    name: 'wait',
    description: 'Wait for screen update',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Wait time in milliseconds, default 500' },
      },
    },
  },
  async execute(args) {
    const ms = (args.ms as number) || 500
    await new Promise(resolve => setTimeout(resolve, ms))
    return { success: true, data: { ms } }
  },
}

export const finishedTool: Tool = {
  definition: {
    name: 'finished',
    description: 'Mark the task as completed',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Task completion summary' },
      },
      required: ['content'],
    },
  },
  async execute(args) {
    const content = args.content as string
    return {
      success: true,
      data: {
        finished: true,
        summary: content,
      },
    }
  },
}

export const callUserTool: Tool = {
  definition: {
    name: 'call_user',
    description: 'Request user assistance when the task is unclear or needs confirmation',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  async execute() {
    return {
      success: true,
      data: {
        needUserInput: true,
        message: 'User assistance needed',
      },
    }
  },
}

// Tool screenshot - agent can use this to capture screen content during operations
export const takeScreenshotTool: Tool = {
  definition: {
    name: 'take_screenshot',
    description: 'Take a screenshot to capture current screen content. Use this between operations to save what you see for later reference. The screenshot will be included in the next message.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name/label for this screenshot (e.g., "search_results", "article_content")',
        },
      },
      required: ['name'],
    },
  },
  async execute(args, context?: { screenshotDir?: string; workspace?: string }) {
    const name = args.name as string
    const workspace = context?.workspace || '/tmp'
    const screenshotDir = path.join(workspace, 'screenshots')
    ensureDir(screenshotDir)

    const timestamp = Date.now()
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
    const filename = `${timestamp}_${safeName}.png`
    const filepath = path.join(screenshotDir, filename)

    const screenSize = await getScreenLogicalSize()

    await captureScreen(filepath)

    return {
      success: true,
      data: {
        path: filepath,
        name: `工具截图: ${name}`,
        timestamp,
        screenWidth: screenSize.width,
        screenHeight: screenSize.height,
        mediaType: 'image/png',
        isToolScreenshot: true,
      },
    }
  },
}

// Screen control tool - toggle screen capture on/off
export const screenTool: Tool = {
  definition: {
    name: 'screen',
    description: 'Control screen capture. Screen is ON by default. Use "close" to stop receiving screenshots (for pure conversation), "open" to resume (for GUI tasks). Turning off screen when not needed saves resources.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'close'],
          description: 'Action to perform: "open" to start screen capture, "close" to stop',
        },
      },
      required: ['action'],
    },
  },
  async execute(args) {
    const action = args.action as 'open' | 'close'
    return {
      success: true,
      data: {
        screenEnabled: action === 'open',
        action,
      },
      message: action === 'open'
        ? 'Screen capture enabled. You will now receive screenshots each turn.'
        : 'Screen capture disabled. You will no longer receive screenshots.',
    }
  },
}

// Export all system tools
export const systemTools: Tool[] = [
  waitTool,
  finishedTool,
  callUserTool,
  takeScreenshotTool,
  screenTool,
]
