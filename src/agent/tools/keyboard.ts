import type { Tool } from '../../types.js'

// Key mapping for macOS
const KEY_MAP: Record<string, string> = {
  // Modifiers
  cmd: 'command',
  ctrl: 'control',
  alt: 'option',
  shift: 'shift',
  // Special keys
  enter: 'return',
  return: 'return',
  esc: 'escape',
  escape: 'escape',
  tab: 'tab',
  space: 'space',
  backspace: 'delete',
  delete: 'forwarddelete',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
}

export const typeTool: Tool = {
  definition: {
    name: 'type',
    description: '输入文本内容',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要输入的文本' },
      },
      required: ['text'],
    },
  },
  async execute(args) {
    const { keyboard } = await import('@computer-use/nut-js')
    const text = args.text as string

    await keyboard.type(text)

    return { success: true, data: { text } }
  },
}

export const hotkeyTool: Tool = {
  definition: {
    name: 'hotkey',
    description: '按下快捷键组合，如 cmd+c, ctrl+shift+s',
    parameters: {
      type: 'object',
      properties: {
        keys: {
          type: 'string',
          description: '快捷键组合，用 + 连接，如 "cmd+c", "ctrl+shift+s"',
        },
      },
      required: ['keys'],
    },
  },
  async execute(args) {
    const { keyboard, Key } = await import('@computer-use/nut-js')
    const keysStr = args.keys as string

    // Parse keys like "cmd+c" or "ctrl+shift+s"
    const keyParts = keysStr.split('+').map(k => k.trim().toLowerCase())

    // Map to nut.js Key enum
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
      // Letters
      a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E,
      f: Key.F, g: Key.G, h: Key.H, i: Key.I, j: Key.J,
      k: Key.K, l: Key.L, m: Key.M, n: Key.N, o: Key.O,
      p: Key.P, q: Key.Q, r: Key.R, s: Key.S, t: Key.T,
      u: Key.U, v: Key.V, w: Key.W, x: Key.X, y: Key.Y,
      z: Key.Z,
      // Numbers
      '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3,
      '4': Key.Num4, '5': Key.Num5, '6': Key.Num6, '7': Key.Num7,
      '8': Key.Num8, '9': Key.Num9,
      // Function keys
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

    // Press all keys
    await keyboard.pressKey(...keys)
    await keyboard.releaseKey(...keys)

    return { success: true, data: { keys: keysStr } }
  },
}

export const pressKeyTool: Tool = {
  definition: {
    name: 'press_key',
    description: '按下单个按键，如 enter, escape, tab',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: '按键名称，如 "enter", "escape", "tab", "backspace"',
        },
      },
      required: ['key'],
    },
  },
  async execute(args) {
    const { keyboard, Key } = await import('@computer-use/nut-js')
    const keyStr = (args.key as string).toLowerCase()

    const keyEnumMap: Record<string, number> = {
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
    }

    const key = keyEnumMap[keyStr]
    if (key === undefined) {
      return { success: false, error: `Unknown key: ${keyStr}` }
    }

    await keyboard.pressKey(key)
    await keyboard.releaseKey(key)

    return { success: true, data: { key: keyStr } }
  },
}

// Export all keyboard tools
export const keyboardTools: Tool[] = [
  typeTool,
  hotkeyTool,
  pressKeyTool,
]
