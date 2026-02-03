import type { ToolCall, ToolDefinition } from '../../../types.js'

/**
 * Build tools prompt for prompt engineering mode
 */
export function buildToolsPrompt(_tools: ToolDefinition[]): string {
  return ''
}

/**
 * Remove comments from JSON string
 */
function stripJsonComments(json: string): string {
  // Remove single-line comments (// ... and # ...)
  return json
    .replace(/\/\/[^\n]*/g, '')  // Remove // comments
    .replace(/#[^\n]*/g, '')      // Remove # comments
}

/**
 * Parse tool calls from XML format response
 * Format: <Thought>...</Thought> <Action>[...]</Action>
 * Also handles raw JSON array without tags
 */
export function parseToolCallsFromText(text: string): { thought: string; toolCalls: ToolCall[] } {
  const thought = text.match(/<Thought>([\s\S]*?)<\/Thought>/i)?.[1]?.trim() || ''
  const toolCalls: ToolCall[] = []

  // Try to extract action content from <Action> tag
  let actionContent = text.match(/<Action>([\s\S]*?)<\/Action>/i)?.[1]?.trim()

  // If no <Action> tag, try to find raw JSON array in the text
  if (!actionContent) {
    const jsonArrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (jsonArrayMatch) {
      actionContent = jsonArrayMatch[0]
    }
  }

  if (!actionContent) return { thought, toolCalls }

  try {
    // Strip comments before parsing JSON
    const cleanJson = stripJsonComments(actionContent)
    const parsed = JSON.parse(cleanJson)
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
