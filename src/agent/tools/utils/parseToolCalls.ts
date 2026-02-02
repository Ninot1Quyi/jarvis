import type { ToolCall, ToolDefinition } from '../../../types.js'

// 坐标归一化因子（模型输出范围 0-1000）
const COORDINATE_FACTOR = 1000

/**
 * Build tools prompt for prompt engineering mode (Doubao UI-TARS format)
 */
export function buildToolsPrompt(_tools: ToolDefinition[]): string {
  // 使用 Doubao UI-TARS 原生格式，不需要动态生成工具描述
  return ''
}

/**
 * Parse point from <point>x y</point> format
 * Returns normalized coordinates (0-1)
 */
function parsePoint(text: string): { x: number; y: number } | null {
  const match = text.match(/<point>\s*(\d+)\s+(\d+)\s*<\/point>/)
  if (match) {
    const x = parseInt(match[1]) / COORDINATE_FACTOR
    const y = parseInt(match[2]) / COORDINATE_FACTOR
    return { x, y }
  }
  return null
}

/**
 * Parse tool calls from Doubao UI-TARS format
 * Format: Thought: ... \n Action: action_name(params)
 */
export function parseToolCallsFromText(text: string): { thought: string; toolCalls: ToolCall[] } {
  let thought = ''
  const toolCalls: ToolCall[] = []

  // 提取 Thought 部分
  const thoughtMatch = text.match(/Thought:\s*([\s\S]*?)(?=Action:|$)/)
  if (thoughtMatch) {
    thought = thoughtMatch[1].trim()
  }

  // 提取所有 Action 行
  const actionMatches = text.matchAll(/Action:\s*(.+?)(?=\n|$)/g)

  for (const actionMatch of actionMatches) {
    const actionStr = actionMatch[1].trim()
    const toolCall = parseAction(actionStr)
    if (toolCall) {
      toolCalls.push(toolCall)
    }
  }

  // 如果没有找到 Action: 格式，尝试直接解析函数调用
  if (toolCalls.length === 0) {
    const directActions = text.matchAll(/(\w+)\s*\(([^)]*)\)/g)
    for (const match of directActions) {
      const toolCall = parseAction(match[0])
      if (toolCall) {
        toolCalls.push(toolCall)
      }
    }
  }

  return { thought, toolCalls }
}

/**
 * Parse a single action string
 */
function parseAction(actionStr: string): ToolCall | null {
  const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // click(point='<point>x y</point>')
  const clickMatch = actionStr.match(/^click\s*\(\s*point\s*=\s*'([^']+)'\s*\)/)
  if (clickMatch) {
    const point = parsePoint(clickMatch[1])
    if (point) {
      return { id, name: 'click', arguments: point }
    }
  }

  // left_double(point='<point>x y</point>')
  const doubleClickMatch = actionStr.match(/^left_double\s*\(\s*point\s*=\s*'([^']+)'\s*\)/)
  if (doubleClickMatch) {
    const point = parsePoint(doubleClickMatch[1])
    if (point) {
      return { id, name: 'double_click', arguments: point }
    }
  }

  // right_single(point='<point>x y</point>')
  const rightClickMatch = actionStr.match(/^right_single\s*\(\s*point\s*=\s*'([^']+)'\s*\)/)
  if (rightClickMatch) {
    const point = parsePoint(rightClickMatch[1])
    if (point) {
      return { id, name: 'right_click', arguments: point }
    }
  }

  // drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')
  const dragMatch = actionStr.match(/^drag\s*\(\s*start_point\s*=\s*'([^']+)'\s*,\s*end_point\s*=\s*'([^']+)'\s*\)/)
  if (dragMatch) {
    const startPoint = parsePoint(dragMatch[1])
    const endPoint = parsePoint(dragMatch[2])
    if (startPoint && endPoint) {
      return {
        id,
        name: 'drag',
        arguments: {
          startX: startPoint.x,
          startY: startPoint.y,
          endX: endPoint.x,
          endY: endPoint.y,
        },
      }
    }
  }

  // scroll(point='<point>x y</point>', direction='down')
  const scrollMatch = actionStr.match(/^scroll\s*\(\s*point\s*=\s*'([^']+)'\s*,\s*direction\s*=\s*'(\w+)'\s*\)/)
  if (scrollMatch) {
    const point = parsePoint(scrollMatch[1])
    if (point) {
      return {
        id,
        name: 'scroll',
        arguments: { ...point, direction: scrollMatch[2] },
      }
    }
  }

  // hotkey(key='ctrl c')
  const hotkeyMatch = actionStr.match(/^hotkey\s*\(\s*key\s*=\s*'([^']+)'\s*\)/)
  if (hotkeyMatch) {
    // 将空格分隔转换为 + 分隔
    const keys = hotkeyMatch[1].trim().replace(/\s+/g, '+')
    return { id, name: 'hotkey', arguments: { keys } }
  }

  // type(content='xxx')
  const typeMatch = actionStr.match(/^type\s*\(\s*content\s*=\s*'([^']*)'\s*\)/)
  if (typeMatch) {
    return { id, name: 'type', arguments: { text: typeMatch[1] } }
  }

  // wait()
  if (actionStr.match(/^wait\s*\(\s*\)/)) {
    return { id, name: 'wait', arguments: { ms: 1000 } }
  }

  // finished(content='xxx')
  const finishedMatch = actionStr.match(/^finished\s*\(\s*content\s*=\s*'([^']*)'\s*\)/)
  if (finishedMatch) {
    return { id, name: 'finished', arguments: { summary: finishedMatch[1] } }
  }

  // call_user()
  if (actionStr.match(/^call_user\s*\(\s*\)/)) {
    return { id, name: 'call_user', arguments: { message: 'User assistance needed' } }
  }

  return null
}
