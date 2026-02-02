import type { ToolCall, ToolDefinition } from '../../../types.js'

/**
 * Build tools prompt for prompt engineering mode
 * 当 nativeToolCall=false 时，将工具定义添加到 system prompt
 */
export function buildToolsPrompt(tools: ToolDefinition[]): string {
  // system.md 已经包含了工具说明，这里不需要额外添加
  return ''
}

/**
 * Parse tool calls from text response (prompt engineering mode)
 * 支持格式: Action: click(coordinate=[500, 300])
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
  const actionMatches = text.matchAll(/Action:\s*(.+?)(?=\n|Action:|$)/g)

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
 * 格式: click(coordinate=[500, 300]) 或 type(text="hello")
 */
function parseAction(actionStr: string): ToolCall | null {
  const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // click(coordinate=[x, y])
  const clickMatch = actionStr.match(/^click\s*\(\s*coordinate\s*=\s*\[(\d+)\s*,\s*(\d+)\]\s*\)/)
  if (clickMatch) {
    return {
      id,
      name: 'click',
      arguments: { coordinate: [parseInt(clickMatch[1]), parseInt(clickMatch[2])] },
    }
  }

  // left_double(coordinate=[x, y])
  const doubleMatch = actionStr.match(/^left_double\s*\(\s*coordinate\s*=\s*\[(\d+)\s*,\s*(\d+)\]\s*\)/)
  if (doubleMatch) {
    return {
      id,
      name: 'left_double',
      arguments: { coordinate: [parseInt(doubleMatch[1]), parseInt(doubleMatch[2])] },
    }
  }

  // right_single(coordinate=[x, y])
  const rightMatch = actionStr.match(/^right_single\s*\(\s*coordinate\s*=\s*\[(\d+)\s*,\s*(\d+)\]\s*\)/)
  if (rightMatch) {
    return {
      id,
      name: 'right_single',
      arguments: { coordinate: [parseInt(rightMatch[1]), parseInt(rightMatch[2])] },
    }
  }

  // drag(startCoordinate=[x1, y1], endCoordinate=[x2, y2])
  const dragMatch = actionStr.match(/^drag\s*\(\s*startCoordinate\s*=\s*\[(\d+)\s*,\s*(\d+)\]\s*,\s*endCoordinate\s*=\s*\[(\d+)\s*,\s*(\d+)\]\s*\)/)
  if (dragMatch) {
    return {
      id,
      name: 'drag',
      arguments: {
        startCoordinate: [parseInt(dragMatch[1]), parseInt(dragMatch[2])],
        endCoordinate: [parseInt(dragMatch[3]), parseInt(dragMatch[4])],
      },
    }
  }

  // scroll(coordinate=[x, y], direction="down")
  const scrollMatch = actionStr.match(/^scroll\s*\(\s*coordinate\s*=\s*\[(\d+)\s*,\s*(\d+)\]\s*,\s*direction\s*=\s*["'](\w+)["']\s*\)/)
  if (scrollMatch) {
    return {
      id,
      name: 'scroll',
      arguments: {
        coordinate: [parseInt(scrollMatch[1]), parseInt(scrollMatch[2])],
        direction: scrollMatch[3],
      },
    }
  }

  // type(text="xxx")
  const typeMatch = actionStr.match(/^type\s*\(\s*text\s*=\s*["'](.*)["']\s*\)/)
  if (typeMatch) {
    return { id, name: 'type', arguments: { text: typeMatch[1] } }
  }

  // hotkey(key="ctrl c")
  const hotkeyMatch = actionStr.match(/^hotkey\s*\(\s*key\s*=\s*["'](.+?)["']\s*\)/)
  if (hotkeyMatch) {
    return { id, name: 'hotkey', arguments: { key: hotkeyMatch[1] } }
  }

  // wait()
  if (actionStr.match(/^wait\s*\(\s*\)/)) {
    return { id, name: 'wait', arguments: {} }
  }

  // finished(content="xxx")
  const finishedMatch = actionStr.match(/^finished\s*\(\s*content\s*=\s*["'](.*)["']\s*\)/)
  if (finishedMatch) {
    return { id, name: 'finished', arguments: { content: finishedMatch[1] } }
  }

  // call_user()
  if (actionStr.match(/^call_user\s*\(\s*\)/)) {
    return { id, name: 'call_user', arguments: {} }
  }

  return null
}
