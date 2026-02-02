import type { Tool } from '../../types.js'

export const typeTool: Tool = {
  definition: {
    name: 'type',
    description: 'Type text content. Use \\n for newline/enter.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
    },
  },
  async execute(args) {
    const { keyboard } = await import('@computer-use/nut-js')
    const text = args.text as string

    // 处理换行符，转换为回车键
    if (text.includes('\n')) {
      const parts = text.split('\n')
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          await keyboard.type(parts[i])
        }
        if (i < parts.length - 1) {
          const { Key } = await import('@computer-use/nut-js')
          await keyboard.pressKey(Key.Enter)
          await keyboard.releaseKey(Key.Enter)
        }
      }
    } else {
      await keyboard.type(text)
    }

    return { success: true, data: { text } }
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
