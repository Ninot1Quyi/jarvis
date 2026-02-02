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
    // 使用 osascript 获取桌面边界，这是最可靠的方法
    const { stdout } = await execAsync(`osascript -e 'tell application "Finder" to get bounds of window of desktop'`)
    // 输出格式: "0, 0, 1728, 1117"
    const parts = stdout.trim().split(',').map(s => parseInt(s.trim()))
    if (parts.length === 4) {
      const width = parts[2]
      const height = parts[3]
      logger.debug(`Screen logical size from osascript: ${width}x${height}`)
      return { width, height }
    }
  } catch (e) {
    logger.debug(`osascript failed: ${e}`)
  }

  try {
    // 备用方法: 使用 system_profiler
    const { stdout } = await execAsync(`system_profiler SPDisplaysDataType 2>/dev/null`)

    // 查找 Retina 格式: "Resolution: 1728 x 1117 (3456 x 2234 Retina)"
    const retinaMatch = stdout.match(/Resolution:\s*(\d+)\s*x\s*(\d+)\s*\(.*Retina\)/i)
    if (retinaMatch) {
      const width = parseInt(retinaMatch[1])
      const height = parseInt(retinaMatch[2])
      logger.debug(`Screen logical size from system_profiler (Retina): ${width}x${height}`)
      return { width, height }
    }

    // 非 Retina: "Resolution: 1920 x 1080"
    const normalMatch = stdout.match(/Resolution:\s*(\d+)\s*x\s*(\d+)(?!\s*\()/)
    if (normalMatch) {
      const width = parseInt(normalMatch[1])
      const height = parseInt(normalMatch[2])
      logger.debug(`Screen logical size from system_profiler: ${width}x${height}`)
      return { width, height }
    }
  } catch (e) {
    logger.debug(`system_profiler failed: ${e}`)
  }

  // 默认值
  logger.debug('Using default screen size: 1920x1080')
  return { width: 1920, height: 1080 }
}

// 压缩图片到指定长边
async function resizeImage(inputPath: string, outputPath: string, maxLongEdge: number = 1080): Promise<{ width: number; height: number }> {
  const { stdout: sizeOutput } = await execAsync(`sips -g pixelWidth -g pixelHeight "${inputPath}"`)
  const widthMatch = sizeOutput.match(/pixelWidth:\s*(\d+)/)
  const heightMatch = sizeOutput.match(/pixelHeight:\s*(\d+)/)

  const originalWidth = parseInt(widthMatch?.[1] || '1920')
  const originalHeight = parseInt(heightMatch?.[1] || '1080')
  const longEdge = Math.max(originalWidth, originalHeight)

  let newWidth = originalWidth
  let newHeight = originalHeight

  if (longEdge > maxLongEdge) {
    const scale = maxLongEdge / longEdge
    newWidth = Math.floor(originalWidth * scale)
    newHeight = Math.floor(originalHeight * scale)
    await execAsync(`sips -z ${newHeight} ${newWidth} "${inputPath}" --out "${outputPath}"`)
  } else {
    fs.copyFileSync(inputPath, outputPath)
  }

  return { width: newWidth, height: newHeight }
}

export const screenshotTool: Tool = {
  definition: {
    name: 'screenshot',
    description: '截取当前屏幕',
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

    // 获取屏幕逻辑尺寸（鼠标坐标系使用的尺寸）
    const screenSize = await getScreenLogicalSize()

    // 截图
    const tempPath = path.join(dateDir, `${timestamp}_temp.png`)
    await execAsync(`screencapture -x -r "${tempPath}"`)

    // 缩放到逻辑分辨率，确保模型看到的图片和坐标系一致
    await execAsync(`sips -z ${screenSize.height} ${screenSize.width} "${tempPath}" --out "${filepath}"`)
    fs.unlinkSync(tempPath)

    return {
      success: true,
      data: {
        path: filepath,
        timestamp,
        screenWidth: screenSize.width,
        screenHeight: screenSize.height,
        imageWidth: screenSize.width,
        imageHeight: screenSize.height,
        mediaType: 'image/png',
      },
    }
  },
}

export const waitTool: Tool = {
  definition: {
    name: 'wait',
    description: '等待指定时间',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: '等待时间 (毫秒)' },
      },
      required: ['ms'],
    },
  },
  async execute(args) {
    const ms = args.ms as number
    await new Promise(resolve => setTimeout(resolve, ms))
    return { success: true, data: { ms } }
  },
}

export const finishedTool: Tool = {
  definition: {
    name: 'finished',
    description: '标记任务完成，系统会进行验证',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '任务完成摘要' },
      },
      required: ['summary'],
    },
  },
  async execute(args) {
    const summary = args.summary as string
    return {
      success: true,
      data: {
        finished: true,
        summary,
      },
    }
  },
}

export const callUserTool: Tool = {
  definition: {
    name: 'call_user',
    description: '请求用户介入，当任务不明确或需要确认时使用',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '向用户说明的内容' },
      },
      required: ['message'],
    },
  },
  async execute(args) {
    const message = args.message as string
    return {
      success: true,
      data: {
        needUserInput: true,
        message,
      },
    }
  },
}

// Export all system tools
export const systemTools: Tool[] = [
  screenshotTool,
  waitTool,
  finishedTool,
  callUserTool,
]
