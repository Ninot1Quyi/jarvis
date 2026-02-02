import type { ToolCall, ToolDefinition } from '../../../types.js'

/**
 * Build tools prompt for prompt engineering mode
 */
export function buildToolsPrompt(_tools: ToolDefinition[]): string {
  return ''
}

/**
 * Parse tool calls from XML format response
 * Format: <Thought>...</Thought> <Action>[...]</Action>
 */
export function parseToolCallsFromText(text: string): { thought: string; toolCalls: ToolCall[] } {
  const thought = text.match(/<Thought>([\s\S]*?)<\/Thought>/i)?.[1]?.trim() || ''
  const toolCalls: ToolCall[] = []

  const actionContent = text.match(/<Action>([\s\S]*?)<\/Action>/i)?.[1]?.trim()
  if (!actionContent) return { thought, toolCalls }

  try {
    const parsed = JSON.parse(actionContent)
    const items = Array.isArray(parsed) ? parsed : [parsed]

    for (const item of items) {
      if (item.name) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: item.name,
          arguments: item.arguments || {},
        })
      }
    }
  } catch {
    // JSON parse failed
  }

  return { thought, toolCalls }
}
