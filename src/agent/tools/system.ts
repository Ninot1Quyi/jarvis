import * as path from 'path'
import type { Tool } from '../../types.js'
import { ensureDir } from '../../utils/config.js'
import { logger } from '../../utils/logger.js'

// 使用 nut-js 获取屏幕尺寸（跨平台）
async function getScreenLogicalSize(): Promise<{ width: number; height: number }> {
  // Linux: use xrandr as fallback (nut-js doesn't work on ARM64)
  if (process.platform === 'linux') {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)
      const { stdout } = await execAsync('xrandr | grep "current" | head -1')
      // Parse "current 1191 x 712" or "current 1920 x 1080, ..."
      const match = stdout.match(/current\s+(\d+)\s+x\s+(\d+)/)
      if (match) {
        const width = parseInt(match[1], 10)
        const height = parseInt(match[2], 10)
        logger.info(`Screen resolution: ${width}x${height}`)
        return { width, height }
      }
    } catch (e) {
      logger.debug(`xrandr failed: ${e}`)
    }
    // Fallback to common values
    return { width: 1920, height: 1080 }
  }

  // macOS/Windows: use nut-js
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
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  if (os.platform() === 'darwin') {
    // macOS: use screencapture with -C (include cursor) and -x (no sound)
    await execAsync(`screencapture -C -x "${filepath}"`)
  } else if (os.platform() === 'win32') {
    // Windows: use PowerShell with cursor capture
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
      $cursor = [System.Windows.Forms.Cursor]::Current
      $cursorPos = [System.Windows.Forms.Cursor]::Position
      $graphics.FillRectangle([System.Drawing.Brushes]::Red, $cursorPos.X, $cursorPos.Y, 20, 20)
      $graphics.Dispose()
      $bitmap.Save("${filepath.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
      $bitmap.Dispose()
    `
    await execAsync(`powershell -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)
  } else {
    // Linux: 尝试多种截图工具，包含光标
    const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' ||
      process.env.WAYLAND_DISPLAY !== undefined

    try {
      if (isWayland) {
        // Wayland: 优先使用 gnome-screenshot (需要 gnome-screenshot > 3.38)
        // 或使用 wl-shot
        try {
          await execAsync('gnome-screenshot -f "' + filepath + '"')
          logger.debug('[Linux] gnome-screenshot succeeded')
        } catch {
          // 尝试 wl-shot
          try {
            await execAsync('wl-copy < /dev/null') // 确保 wl-copy 可用
            await execAsync('grim -g "$(slurp)" "' + filepath + '"')
          } catch {
            // 最后尝试 scrot
            await execAsync('scrot "' + filepath + '"')
          }
        }
      } else {
        // X11: 优先使用 scrot (支持 -m 包含光标)
        try {
          await execAsync('scrot -m "' + filepath + '"')
          logger.debug('[Linux] scrot -m succeeded')
        } catch {
          // 尝试 gnome-screenshot
          try {
            await execAsync('gnome-screenshot -f "' + filepath + '"')
          } catch {
            // 最后回退到 nut-js
            const { screen, saveImage } = await import('@computer-use/nut-js')
            const image = await screen.grab()
            await saveImage({ image, path: filepath })
          }
        }
      }
    } catch (e) {
      logger.warn('[Linux] All screenshot methods failed, falling back to nut-js')
      const { screen, saveImage } = await import('@computer-use/nut-js')
      const image = await screen.grab()
      await saveImage({ image, path: filepath })
    }
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

// Task control tool - set current task
export const taskTool: Tool = {
  definition: {
    name: 'recordTask',
    description: 'Record/set your current task so the system can track and display what you are working on. Must include task source. Set content to empty string to clear the task when completed.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The task description. Use empty string "" to clear the task.',
        },
        source: {
          type: 'string',
          description: 'Where the task came from. e.g. "tui", "gui", "mail:boss@company.com", "notification:WeChat", "notification:QQ"',
        },
      },
      required: ['content'],
    },
  },
  async execute(args) {
    const content = (args.content as string).trim()
    const source = (args.source as string | undefined)?.trim() || ''
    const display = content
      ? (source ? `[${source}] ${content}` : content)
      : ''
    return {
      success: true,
      data: {
        taskContent: display,
        taskSet: true,
      },
      message: display
        ? `Task set: ${display}`
        : 'Task cleared.',
    }
  },
}

// Screen control tool - toggle screen capture on/off
export const screenTool: Tool = {
  definition: {
    name: 'screen',
    description: 'Control screen capture. Screen is ON by default. Use "close" to stop receiving screenshots (for pure conversation), "open" to resume (for GUI tasks). Always combine with other actions - never waste a turn just to toggle screen.',
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
  callUserTool,
  takeScreenshotTool,
  screenTool,
  taskTool,
]
