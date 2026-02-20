import type { Tool } from '../../types.js'
import { spawn } from 'child_process'

// Platform detection
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const isWSL = isLinux && process.env.WSL_DISTRO_NAME

/**
 * Execute command via shell (for Linux xdotool fallback)
 */
async function execCommand(command: string): Promise<string> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  // For Linux, ensure DISPLAY is set
  const env = { ...process.env }
  if (isLinux && !env.DISPLAY) {
    env.DISPLAY = ':0'
  }

  try {
    const { stdout, stderr } = await execAsync(command, { env })
    if (stderr) {
      console.error(`xdotool stderr: ${stderr}`)
    }
    return stdout
  } catch (error) {
    const err = error as Error & { stderr?: string }
    console.error(`xdotool error: ${err.message}`)
    throw error
  }
}

// 将文本写入剪贴板（跨平台）
async function copyToClipboard(text: string): Promise<void> {
  // For Linux, merge current env with DISPLAY (spawn replaces env completely)
  const env = isLinux ? { ...process.env, DISPLAY: ':0' } : undefined

  return new Promise((resolve, reject) => {
    let proc: ReturnType<typeof spawn> | undefined
    if (isMac) {
      proc = spawn('pbcopy')
      proc.stdin?.write(text)
      proc.stdin?.end()
    } else if (isWin || isWSL) {
      // Windows: 使用 UTF-16LE 编码直接写入 clip.exe
      // clip.exe 原生支持 UTF-16LE（Windows Unicode 格式）
      proc = spawn(isWSL ? 'clip.exe' : 'clip')
      const utf16leBuffer = Buffer.from(text, 'utf16le')
      proc.stdin?.write(utf16leBuffer)
      proc.stdin?.end()
    } else {
      // Linux: 检测 Wayland 或 X11
      const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' ||
        process.env.WAYLAND_DISPLAY !== undefined

      if (isWayland) {
        // Wayland: 优先使用 wl-copy，失败则尝试 xclip (XWayland)
        proc = spawn('wl-copy', ['--foreground'], { env })
        proc.stdin?.write(text)
        proc.stdin?.end()
        proc.on('error', () => {
          // wl-copy 失败，尝试 XWayland xclip
          const fallback = spawn('xclip', ['-selection', 'clipboard'], { env })
          fallback.stdin?.write(text)
          fallback.stdin?.end()
          fallback.on('close', (code) => {
            if (code === 0) resolve()
            else reject(new Error(`clipboard fallback failed with code ${code}`))
          })
          fallback.on('error', reject)
        })
        proc.on('close', (code) => {
          if (code === 0) resolve()
          else if (code !== undefined) reject(new Error(`wl-copy failed with code ${code}`))
        })
        return
      } else {
        // X11: 尝试 xclip，失败则尝试 xsel
        // 添加超时避免卡住
        let resolved = false
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true
            proc?.kill()
            // 尝试 xsel 作为 fallback
            const fallback = spawn('xsel', ['--clipboard', '--input'], { env })
            fallback.stdin?.write(text)
            fallback.stdin?.end()
            fallback.on('close', (code) => {
              if (code === 0) resolve()
              else reject(new Error(`xsel fallback failed with code ${code}`))
            })
            fallback.on('error', reject)
          }
        }, 3000)

        proc = spawn('xclip', ['-selection', 'clipboard'], { env })
        proc.stdin?.write(text)
        proc.stdin?.end()
        proc.on('error', () => {
          if (!resolved) {
            clearTimeout(timeout)
            resolved = true
            const fallback = spawn('xsel', ['--clipboard', '--input'], { env })
            fallback.stdin?.write(text)
            fallback.stdin?.end()
            fallback.on('close', (code) => {
              if (code === 0) resolve()
              else reject(new Error(`xsel fallback failed with code ${code}`))
            })
            fallback.on('error', reject)
          }
        })
        proc.on('close', (code) => {
          if (!resolved) {
            clearTimeout(timeout)
            resolved = true
            if (code === 0) resolve()
            else if (code !== undefined) reject(new Error(`xclip failed with code ${code}`))
          }
        })
        return
      }
    }

    proc?.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`clipboard command failed with code ${code}`))
    })
    proc?.on('error', reject)
  })
}

export const typeTool: Tool = {
  definition: {
    name: 'type',
    description: 'Type text content. Supports escape sequences: \\n (newline), \\t (tab). For multi-line text, clipboard paste is used to preserve formatting.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type. Use \\n for newline, \\t for tab.' },
      },
      required: ['text'],
    },
  },
  async execute(args) {
    const text = args.text as string

    // 检测是否包含非ASCII字符（中文等）或换行符/制表符
    const hasNonAscii = /[^\x00-\x7F]/.test(text)
    const hasSpecialChars = text.includes('\n') || text.includes('\t')

    // 如果包含非ASCII字符或特殊字符，使用剪贴板粘贴以保持格式
    if (hasNonAscii || hasSpecialChars) {
      // 将文本写入剪贴板
      await copyToClipboard(text)

      // 执行粘贴
      if (isLinux) {
        // Linux: use xdotool Ctrl+V
        await execCommand('xdotool key ctrl+v')
      } else {
        const { keyboard, Key } = await import('@computer-use/nut-js')
        const modKey = isMac ? Key.LeftCmd : Key.LeftControl
        await keyboard.pressKey(modKey, Key.V)
        await keyboard.releaseKey(modKey, Key.V)
      }

      // Wait for paste to complete
      await new Promise(resolve => setTimeout(resolve, 150))

      return { success: true, data: { text, method: 'paste' } }
    }

    // 简单ASCII文本直接打字
    if (isLinux) {
      // Linux: use xdotool type
      // Escape special characters for xdotool
      const escapedText = text.replace(/'/g, "'\\''")
      await execCommand(`xdotool type -- '${escapedText}'`)
    } else {
      const { keyboard } = await import('@computer-use/nut-js')
      keyboard.config.autoDelayMs = 10
      await keyboard.type(text)
    }

    // Wait for typing to complete
    await new Promise(resolve => setTimeout(resolve, 150))

    return { success: true, data: { text, method: isLinux ? 'xdotool' : 'type' } }
  },
}

export const hotkeyTool: Tool = {
  definition: {
    name: 'hotkey',
    description: 'Press hotkey combination. Use space to separate keys, e.g. "ctrl c", "cmd shift s"',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Hotkey combination, space separated, e.g. "ctrl c", "cmd shift s"',
        },
      },
      required: ['key'],
    },
  },
  async execute(args) {
    const keysStr = args.key as string

    // Parse keys like "ctrl c" or "cmd shift s" (space separated)
    const keyParts = keysStr.split(/[\s+]+/).map(k => k.trim().toLowerCase()).filter(k => k)

    if (isLinux) {
      // Linux: use xdotool
      // Map keys to xdotool format
      const xdotoolKeyMap: Record<string, string> = {
        command: 'super',
        cmd: 'super',
        win: 'super',
        windows: 'super',
        super: 'super',
        meta: 'super',
        control: 'ctrl',
        ctrl: 'ctrl',
        option: 'alt',
        alt: 'alt',
        shift: 'shift',
        return: 'Return',
        enter: 'Return',
        escape: 'Escape',
        esc: 'Escape',
        tab: 'Tab',
        space: 'space',
        backspace: 'BackSpace',
        delete: 'Delete',
        up: 'Up',
        down: 'Down',
        left: 'Left',
        right: 'Right',
        home: 'Home',
        end: 'End',
        pageup: 'Page_Up',
        pagedown: 'Page_Down',
      }

      // Build xdotool command
      const xdotoolKeys = keyParts.map(k => xdotoolKeyMap[k] || k).join('+')
      await execCommand(`xdotool key ${xdotoolKeys}`)

      // Wait for key action to be processed
      await new Promise(resolve => setTimeout(resolve, 100))

      return { success: true, data: { key: keysStr, method: 'xdotool' } }
    }

    // macOS/Windows: use nut-js
    const { keyboard, Key } = await import('@computer-use/nut-js')

    const keyEnumMap: Record<string, number> = {
      command: Key.LeftCmd,
      cmd: Key.LeftCmd,
      win: Key.LeftWin,
      windows: Key.LeftWin,
      super: Key.LeftSuper,
      meta: Key.LeftSuper,
      control: Key.LeftControl,
      ctrl: Key.LeftControl,
      option: Key.LeftAlt,
      alt: Key.LeftAlt,
      shift: Key.LeftShift,
      return: Key.Enter,
      enter: Key.Enter,
      escape: Key.Escape,
      esc: Key.Escape,
      tab: Key.Tab,
      space: Key.Space,
      backspace: Key.Backspace,
      delete: Key.Delete,
      up: Key.Up,
      down: Key.Down,
      left: Key.Left,
      right: Key.Right,
      home: Key.Home,
      end: Key.End,
      pageup: Key.PageUp,
      pagedown: Key.PageDown,
      a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E,
      f: Key.F, g: Key.G, h: Key.H, i: Key.I, j: Key.J,
      k: Key.K, l: Key.L, m: Key.M, n: Key.N, o: Key.O,
      p: Key.P, q: Key.Q, r: Key.R, s: Key.S, t: Key.T,
      u: Key.U, v: Key.V, w: Key.W, x: Key.X, y: Key.Y,
      z: Key.Z,
      '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3,
      '4': Key.Num4, '5': Key.Num5, '6': Key.Num6, '7': Key.Num7,
      '8': Key.Num8, '9': Key.Num9,
      f1: Key.F1, f2: Key.F2, f3: Key.F3, f4: Key.F4,
      f5: Key.F5, f6: Key.F6, f7: Key.F7, f8: Key.F8,
      f9: Key.F9, f10: Key.F10, f11: Key.F11, f12: Key.F12,
    }

    const keys: number[] = []
    for (const part of keyParts) {
      const key = keyEnumMap[part]
      if (key === undefined) {
        return { success: false, error: `Unknown key: ${part}` }
      }
      keys.push(key)
    }

    await keyboard.pressKey(...keys)
    // Small delay between press and release for reliability
    await new Promise(resolve => setTimeout(resolve, 50))
    await keyboard.releaseKey(...keys)
    // Wait for key action to be processed
    await new Promise(resolve => setTimeout(resolve, 100))

    return { success: true, data: { key: keysStr } }
  },
}

// Export all keyboard tools
export const keyboardTools: Tool[] = [
  typeTool,
  hotkeyTool,
]
