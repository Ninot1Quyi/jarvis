import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { Tool } from '../../types.js'
import { ensureDir } from '../../utils/config.js'
import { logger } from '../../utils/logger.js'

const execAsync = promisify(exec)

// 获取主显示器的逻辑尺寸（鼠标坐标系）
async function getScreenLogicalSize(): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execAsync(`osascript -e 'tell application "Finder" to get bounds of window of desktop'`)
    const parts = stdout.trim().split(',').map(s => parseInt(s.trim()))
    if (parts.length === 4) {
      const width = parts[2]
      const height = parts[3]
      logger.debug(`Screen logical size: ${width}x${height}`)
      return { width, height }
    }
  } catch (e) {
    logger.debug(`osascript failed: ${e}`)
  }

  try {
    const { stdout } = await execAsync(`system_profiler SPDisplaysDataType 2>/dev/null`)
    const retinaMatch = stdout.match(/Resolution:\s*(\d+)\s*x\s*(\d+)\s*\(.*Retina\)/i)
    if (retinaMatch) {
      return { width: parseInt(retinaMatch[1]), height: parseInt(retinaMatch[2]) }
    }
    const normalMatch = stdout.match(/Resolution:\s*(\d+)\s*x\s*(\d+)(?!\s*\()/)
    if (normalMatch) {
      return { width: parseInt(normalMatch[1]), height: parseInt(normalMatch[2]) }
    }
  } catch (e) {
    logger.debug(`system_profiler failed: ${e}`)
  }

  return { width: 1920, height: 1080 }
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

    const tempPath = path.join(dateDir, `${timestamp}_temp.png`)
    await execAsync(`screencapture -x -r "${tempPath}"`)

    // 缩放到逻辑分辨率
    await execAsync(`sips -z ${screenSize.height} ${screenSize.width} "${tempPath}" --out "${filepath}"`)
    fs.unlinkSync(tempPath)

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

    const tempPath = path.join(screenshotDir, `${timestamp}_temp.png`)
    await execAsync(`screencapture -x -r "${tempPath}"`)

    // 缩放到逻辑分辨率
    await execAsync(`sips -z ${screenSize.height} ${screenSize.width} "${tempPath}" --out "${filepath}"`)
    fs.unlinkSync(tempPath)

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

// Export all system tools
export const systemTools: Tool[] = [
  waitTool,
  finishedTool,
  callUserTool,
  takeScreenshotTool,
]
