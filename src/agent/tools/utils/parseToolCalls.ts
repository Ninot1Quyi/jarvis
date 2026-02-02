import type { ToolCall, ToolDefinition } from '../../../types.js'

/**
 * Build tools prompt for prompt engineering mode
 */
export function buildToolsPrompt(_tools: ToolDefinition[]): string {
  return ''
}

/**
 * Parse tool calls from text response (prompt engineering mode)
 * 支持 XML 格式: <Thought>...</Thought> <Action>[...]</Action>
 */
export function parseToolCallsFromText(text: string): { thought: string; toolCalls: ToolCall[] } {
  let thought = ''
  const toolCalls: ToolCall[] = []

  // 提取 <Thought>...</Thought> 内容
  const thoughtMatch = text.match(/<Thought>([\s\S]*?)<\/Thought>/i)
  if (thoughtMatch) {
    thought = thoughtMatch[1].trim()
  }

  // 提取 <Action>...</Action> 内容
  const actionMatch = text.match(/<Action>([\s\S]*?)<\/Action>/i)
  if (actionMatch) {
    const actionContent = actionMatch[1].trim()

    // 解析 JSON 数组
    try {
      const parsed = JSON.parse(actionContent)
      const items = Array.isArray(parsed) ? parsed : [parsed]

      for (const item of items) {
        if (item.name) {
          const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          toolCalls.push({
            id,
            name: item.name,
            arguments: item.arguments || {},
          })
        }
      }
    } catch {
      // JSON 解析失败，尝试逐个匹配
      const objectMatches = actionContent.matchAll(/\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}/g)
      for (const match of objectMatches) {
        try {
          const name = match[1]
          const args = JSON.parse(match[2])
          const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          toolCalls.push({ id, name, arguments: args })
        } catch {
          // 继续
        }
      }
    }
  }

  return { thought, toolCalls }
}
