import type { ToolCall, ToolDefinition } from '../../../types.js'

/**
 * Build tools prompt for prompt engineering mode
 */
export function buildToolsPrompt(_tools: ToolDefinition[]): string {
  return ''
}

/**
 * Parse tool calls from text response (prompt engineering mode)
 * 支持 function call JSON 格式: {"name": "click", "arguments": {"coordinate": [500, 300]}}
 */
export function parseToolCallsFromText(text: string): { thought: string; toolCalls: ToolCall[] } {
  let thought = ''
  const toolCalls: ToolCall[] = []

  // 提取 Thought 部分
  const thoughtMatch = text.match(/Thought:\s*([\s\S]*?)(?=Action:|```|\{|$)/)
  if (thoughtMatch) {
    thought = thoughtMatch[1].trim()
  }

  // 尝试提取 JSON 对象或数组
  // 匹配 {"name": ...} 或 [{"name": ...}]
  const jsonMatches = text.matchAll(/(\{[\s\S]*?"name"[\s\S]*?\}|\[[\s\S]*?\{[\s\S]*?"name"[\s\S]*?\}[\s\S]*?\])/g)

  for (const match of jsonMatches) {
    try {
      const jsonStr = match[1].trim()
      const parsed = JSON.parse(jsonStr)

      // 支持单个对象或数组
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

      if (toolCalls.length > 0) break
    } catch {
      // JSON 解析失败，继续尝试
    }
  }

  // 如果上面没解析到，尝试更宽松的匹配
  if (toolCalls.length === 0) {
    // 匹配单个 JSON 对象
    const singleMatch = text.match(/\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\}|\[\s*\d+\s*(?:,\s*\d+\s*)*\])\s*\}/)
    if (singleMatch) {
      try {
        const name = singleMatch[1]
        const args = JSON.parse(singleMatch[2])
        const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        toolCalls.push({ id, name, arguments: typeof args === 'object' && !Array.isArray(args) ? args : { coordinate: args } })
      } catch { /* ignore */ }
    }
  }

  return { thought, toolCalls }
}
