import type { ToolCall, ToolDefinition } from '../../../types.js'

/**
 * Build tools prompt for prompt engineering mode
 */
export function buildToolsPrompt(_tools: ToolDefinition[]): string {
  return ''
}

/**
 * Remove comments from JSON string, preserving content inside quoted strings.
 */
function stripJsonComments(json: string): string {
  let result = ''
  let i = 0
  while (i < json.length) {
    // String literal: copy verbatim until closing quote
    if (json[i] === '"') {
      result += '"'
      i++
      while (i < json.length && json[i] !== '"') {
        if (json[i] === '\\' && i + 1 < json.length) {
          result += json[i] + json[i + 1]
          i += 2
        } else {
          result += json[i]
          i++
        }
      }
      if (i < json.length) {
        result += '"'
        i++
      }
    }
    // Single-line comment: skip until newline
    else if (json[i] === '/' && i + 1 < json.length && json[i + 1] === '/') {
      while (i < json.length && json[i] !== '\n') i++
    }
    // Hash comment: skip until newline
    else if (json[i] === '#') {
      while (i < json.length && json[i] !== '\n') i++
    }
    // Normal character
    else {
      result += json[i]
      i++
    }
  }
  return result
}

/**
 * Parse tool calls from XML format response
 * Format: <Thought>...</Thought> <Action>[...]</Action>
 * Also handles raw JSON array without tags
 */
export function parseToolCallsFromText(text: string): { thought: string; toolCalls: ToolCall[]; parseError?: string } {
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
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    return {
      thought,
      toolCalls,
      parseError: `JSON parse failed: ${errMsg}\nRaw content: ${actionContent}`,
    }
  }

  return { thought, toolCalls }
}
