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

  // 提取 Thought 部分 - 匹配到 Action: 或 JSON 开始之前的内容
  const thoughtMatch = text.match(/Thought:\s*([\s\S]*?)(?=\nAction:|\n\[|\n\{|$)/i)
  if (thoughtMatch) {
    thought = thoughtMatch[1].trim()
  }

  // 如果没有 Thought: 标记，尝试提取 JSON 之前的所有文本作为 thought
  if (!thought) {
    const beforeJson = text.match(/^([\s\S]*?)(?=\[[\s\S]*"name"|{[\s\S]*"name")/i)
    if (beforeJson) {
      thought = beforeJson[1].replace(/Action:\s*/gi, '').trim()
    }
  }

  // 尝试提取 JSON 数组 [{"name": ...}]
  const arrayMatch = text.match(/\[\s*\{[\s\S]*?"name"[\s\S]*?\}\s*\]/g)
  if (arrayMatch) {
    for (const jsonStr of arrayMatch) {
      try {
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.name) {
              const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
              toolCalls.push({
                id,
                name: item.name,
                arguments: item.arguments || {},
              })
            }
          }
        }
        if (toolCalls.length > 0) break
      } catch {
        // 继续尝试
      }
    }
  }

  // 尝试提取单个 JSON 对象 {"name": ...}
  if (toolCalls.length === 0) {
    const objectMatch = text.match(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/g)
    if (objectMatch) {
      for (const jsonStr of objectMatch) {
        try {
          const parsed = JSON.parse(jsonStr)
          if (parsed.name) {
            const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            toolCalls.push({
              id,
              name: parsed.name,
              arguments: parsed.arguments || {},
            })
          }
        } catch {
          // 继续
        }
      }
    }
  }

  return { thought, toolCalls }
}
