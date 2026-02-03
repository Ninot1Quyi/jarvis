import type { Tool } from '../../types.js'
import { spawn } from 'child_process'

// 将文本写入剪贴板（macOS）
async function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('pbcopy')
    proc.stdin.write(text)
    proc.stdin.end()
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pbcopy failed with code ${code}`))
    })
    proc.on('error', reject)
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
    const { keyboard, Key } = await import('@computer-use/nut-js')
    const text = args.text as string

    // 检测是否包含非ASCII字符（中文等）或换行符/制表符
    const hasNonAscii = /[^\x00-\x7F]/.test(text)
    const hasSpecialChars = text.includes('\n') || text.includes('\t')

    // 如果包含非ASCII字符或特殊字符，使用剪贴板粘贴以保持格式
    if (hasNonAscii || hasSpecialChars) {
      // 将文本写入剪贴板
      await copyToClipboard(text)

      // 执行粘贴 (Cmd+V)
      await keyboard.pressKey(Key.LeftCmd, Key.V)
      await keyboard.releaseKey(Key.LeftCmd, Key.V)

      return { success: true, data: { text, method: 'paste' } }
    }

    // 简单ASCII文本直接打字
    keyboard.config.autoDelayMs = 10
    await keyboard.type(text)

    return { success: true, data: { text, method: 'type' } }
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
    const { keyboard, Key } = await import('@computer-use/nut-js')
    const keysStr = args.key as string

    // Parse keys like "ctrl c" or "cmd shift s" (space separated)
    const keyParts = keysStr.split(/[\s+]+/).map(k => k.trim().toLowerCase()).filter(k => k)

    const keyEnumMap: Record<string, number> = {
      command: Key.LeftCmd,
      cmd: Key.LeftCmd,
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
    await keyboard.releaseKey(...keys)

    return { success: true, data: { key: keysStr } }
  },
}

// Export all keyboard tools
export const keyboardTools: Tool[] = [
  typeTool,
  hotkeyTool,
]
