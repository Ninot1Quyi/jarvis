import type { ToolCall, ToolDefinition } from '../../../types.js'

// 坐标归一化因子（模型输出范围 0-1000）
const COORDINATE_FACTOR = 1000

/**
 * Build tools prompt for prompt engineering mode (JSON format)
 */
export function buildToolsPrompt(_tools: ToolDefinition[]): string {
  return ''
}

/**
 * Parse coordinate array [x, y] and normalize to 0-1
 */
function parseCoordinate(coord: number[]): { x: number; y: number } | null {
  if (Array.isArray(coord) && coord.length >= 2) {
    const x = coord[0] / COORDINATE_FACTOR
    const y = coord[1] / COORDINATE_FACTOR
    return { x, y }
  }
  return null
}

/**
 * Parse tool calls from JSON format
 */
export function parseToolCallsFromText(text: string): { thought: string; toolCalls: ToolCall[] } {
  let thought = ''
  const toolCalls: ToolCall[] = []

  // 提取 Thought 部分
  const thoughtMatch = text.match(/Thought:\s*([\s\S]*?)(?=Action:|```|$)/)
  if (thoughtMatch) {
    thought = thoughtMatch[1].trim()
  }

  // 提取 JSON 代码块
  const jsonMatches = text.matchAll(/```json\s*([\s\S]*?)\s*```/g)

  for (const match of jsonMatches) {
    try {
      const jsonStr = match[1].trim()
      const parsed = JSON.parse(jsonStr)
      const actions = Array.isArray(parsed) ? parsed : [parsed]

      for (const action of actions) {
        const toolCall = parseJsonAction(action)
        if (toolCall) {
          toolCalls.push(toolCall)
        }
      }
    } catch {
      // JSON 解析失败，继续
    }
  }

  // fallback: 直接解析 JSON 对象
  if (toolCalls.length === 0) {
    const directJsonMatch = text.match(/\{[\s\S]*"action"[\s\S]*\}/)
    if (directJsonMatch) {
      try {
        const parsed = JSON.parse(directJsonMatch[0])
        const toolCall = parseJsonAction(parsed)
        if (toolCall) {
          toolCalls.push(toolCall)
        }
      } catch { /* ignore */ }
    }
  }

  return { thought, toolCalls }
}

/**
 * Parse a single JSON action object
 */
function parseJsonAction(action: Record<string, unknown>): ToolCall | null {
  if (!action || typeof action !== 'object' || !action.action) {
    return null
  }

  const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const actionType = action.action as string

  switch (actionType) {
    case 'click': {
      const coord = parseCoordinate(action.coordinate as number[])
      if (coord) return { id, name: 'click', arguments: coord }
      break
    }

    case 'left_double': {
      const coord = parseCoordinate(action.coordinate as number[])
      if (coord) return { id, name: 'double_click', arguments: coord }
      break
    }

    case 'right_single': {
      const coord = parseCoordinate(action.coordinate as number[])
      if (coord) return { id, name: 'right_click', arguments: coord }
      break
    }

    case 'drag': {
      const startCoord = parseCoordinate(action.startCoordinate as number[])
      const endCoord = parseCoordinate(action.endCoordinate as number[])
      if (startCoord && endCoord) {
        return {
          id,
          name: 'drag',
          arguments: {
            startX: startCoord.x,
            startY: startCoord.y,
            endX: endCoord.x,
            endY: endCoord.y,
          },
        }
      }
      break
    }

    case 'scroll': {
      const coord = parseCoordinate(action.coordinate as number[])
      if (coord && action.direction) {
        return {
          id,
          name: 'scroll',
          arguments: { ...coord, direction: action.direction as string },
        }
      }
      break
    }

    case 'type': {
      if (action.text !== undefined) {
        return { id, name: 'type', arguments: { text: action.text as string } }
      }
      break
    }

    case 'hotkey': {
      if (action.key) {
        const keys = (action.key as string).trim().replace(/\s+/g, '+')
        return { id, name: 'hotkey', arguments: { keys } }
      }
      break
    }

    case 'wait':
      return { id, name: 'wait', arguments: { ms: 1000 } }

    case 'finished':
      return {
        id,
        name: 'finished',
        arguments: { summary: (action.content as string) || 'Task completed' },
      }

    case 'call_user':
      return {
        id,
        name: 'call_user',
        arguments: { message: 'User assistance needed' },
      }
  }

  return null
}
