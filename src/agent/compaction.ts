/**
 * Message Compaction - Three-layer context window management
 *
 * Layer 1: Tool Result Soft Trim (zero LLM cost, every round)
 * Layer 2: LLM Compaction (when inputTokens > contextWindow * 0.75)
 * Layer 3: Emergency Hard Truncation (when Layer 2 fails or context overflow)
 */

import type { Message, LLMProvider } from '../types.js'
import { logger } from '../utils/logger.js'

// ---- Constants ----
const COMPACTION_THRESHOLD = 0.75
const KEEP_RECENT_MESSAGES = 6
const TOOL_RESULT_TRIM_THRESHOLD = 2000
const TOOL_RESULT_KEEP_HEAD = 800
const TOOL_RESULT_KEEP_TAIL = 800
const KEEP_RECENT_FOR_TRIM = 3  // protect last N rounds (~6-9 messages)
const EMERGENCY_KEEP_MESSAGES = 10
const MAX_OVERFLOW_RETRIES = 2

// Track overflow retry count (reset on successful LLM call)
let overflowRetryCount = 0

export function getOverflowRetryCount(): number {
  return overflowRetryCount
}

export function incrementOverflowRetry(): number {
  return ++overflowRetryCount
}

export function resetOverflowRetry(): void {
  overflowRetryCount = 0
}

export { MAX_OVERFLOW_RETRIES }

// ---- Layer 1: Tool Result Soft Trim ----

/**
 * Trim old tool results in-place. Protects the most recent N rounds of
 * computer/assistant messages. For older computer messages, truncates
 * tool output sections that exceed the threshold.
 */
export function trimOldToolResults(messages: Message[]): void {
  // Find the protection boundary: last KEEP_RECENT_FOR_TRIM pairs of
  // computer+assistant messages (counting from the end)
  let pairsFound = 0
  let protectFromIndex = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'computer' || messages[i].role === 'assistant') {
      if (messages[i].role === 'computer') {
        pairsFound++
      }
      if (pairsFound >= KEEP_RECENT_FOR_TRIM) {
        protectFromIndex = i
        break
      }
    }
  }

  // Trim tool results in unprotected computer messages
  for (let i = 0; i < protectFromIndex; i++) {
    const msg = messages[i]
    if (msg.role !== 'computer') continue

    const marker = '## Tool Execution Results'
    const markerIdx = msg.content.indexOf(marker)
    if (markerIdx === -1) continue

    // Process each tool result block (### tool_name(...))
    const prefix = msg.content.slice(0, markerIdx + marker.length)
    let resultSection = msg.content.slice(markerIdx + marker.length)

    // Split by ### headers, trim each block
    const blocks = splitToolBlocks(resultSection)
    let trimmed = false

    for (const block of blocks) {
      if (block.body.length > TOOL_RESULT_TRIM_THRESHOLD) {
        const charsRemoved = block.body.length - TOOL_RESULT_KEEP_HEAD - TOOL_RESULT_KEEP_TAIL
        block.body =
          block.body.slice(0, TOOL_RESULT_KEEP_HEAD) +
          `\n...[trimmed ${charsRemoved} chars]...\n` +
          block.body.slice(-TOOL_RESULT_KEEP_TAIL)
        trimmed = true
      }
    }

    if (trimmed) {
      resultSection = blocks.map(b => b.header + b.body).join('')
      messages[i] = { ...msg, content: prefix + resultSection }
    }
  }
}

interface ToolBlock {
  header: string  // includes the ### line
  body: string
}

function splitToolBlocks(text: string): ToolBlock[] {
  const blocks: ToolBlock[] = []
  const headerRegex = /\n### /g
  let match: RegExpExecArray | null
  const indices: number[] = []

  while ((match = headerRegex.exec(text)) !== null) {
    indices.push(match.index)
  }

  if (indices.length === 0) {
    // No ### headers, treat entire text as one block
    return [{ header: '', body: text }]
  }

  // Content before first ### (usually just whitespace)
  if (indices[0] > 0) {
    blocks.push({ header: '', body: text.slice(0, indices[0]) })
  }

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i]
    const end = i + 1 < indices.length ? indices[i + 1] : text.length
    const chunk = text.slice(start, end)

    // Split header line from body
    const newlineIdx = chunk.indexOf('\n', 1)  // skip leading \n
    if (newlineIdx === -1) {
      blocks.push({ header: chunk, body: '' })
    } else {
      blocks.push({
        header: chunk.slice(0, newlineIdx),
        body: chunk.slice(newlineIdx),
      })
    }
  }

  return blocks
}

// ---- Layer 2: LLM Compaction ----

/**
 * Check if compaction should be triggered based on token usage.
 */
export function shouldCompact(inputTokens: number, contextWindow: number): boolean {
  return inputTokens > contextWindow * COMPACTION_THRESHOLD
}

/**
 * Compress old messages into a summary using the LLM.
 * Modifies the messages array in-place.
 * Returns true on success, false on failure.
 */
export async function compactMessages(
  messages: Message[],
  llm: LLMProvider,
  contextWindow: number
): Promise<boolean> {
  // Find system message (always index 0)
  if (messages.length === 0 || messages[0].role !== 'system') {
    return false
  }

  // Not enough messages to compact
  if (messages.length <= KEEP_RECENT_MESSAGES + 2) {
    return false
  }

  // Messages to compress: everything between system and the protected tail
  const compressEnd = messages.length - KEEP_RECENT_MESSAGES
  if (compressEnd <= 1) {
    return false
  }

  const toCompress = messages.slice(1, compressEnd)
  if (toCompress.length === 0) {
    return false
  }

  // Serialize messages for the compaction prompt
  const serialized = toCompress.map(m => {
    const content = m.content.length > 500
      ? m.content.slice(0, 400) + '...[truncated]...' + m.content.slice(-100)
      : m.content
    return `[${m.role}]: ${content}`
  }).join('\n\n')

  const compactionPrompt = `You are a conversation compactor. Summarize the following conversation history into a concise summary that preserves:
1. Key decisions and actions taken
2. Important tool results and their outcomes
3. Current task progress and state
4. Any errors encountered and how they were resolved
5. User preferences or instructions mentioned

Be concise but preserve all information needed to continue the task. Output only the summary, no preamble.

Conversation to summarize (${toCompress.length} messages):

${serialized}`

  try {
    const response = await llm.chatWithVisionAndTools(
      [
        { role: 'system', content: 'You are a precise conversation summarizer. Output only the summary.' },
        { role: 'user', content: compactionPrompt },
      ],
      [],  // no images
      [],  // no tools
      { maxTokens: 1024 }
    )

    const summary = response.content?.trim()
    if (!summary) {
      logger.warn('Compaction returned empty summary')
      return false
    }

    // Replace compressed messages with a single summary message
    const compactedMessage: Message = {
      role: 'computer',
      content: `[Compacted: ${toCompress.length} messages summarized]\n\n${summary}`,
    }

    // Splice: remove compressed messages, insert summary
    messages.splice(1, compressEnd - 1, compactedMessage)

    logger.info(`Compacted ${toCompress.length} messages into summary (${summary.length} chars)`)
    return true
  } catch (err) {
    logger.warn('Compaction LLM call failed:', err)
    return false
  }
}

// ---- Layer 3: Emergency Hard Truncation ----

/**
 * Brute-force truncation: keep system + notification + recent N messages.
 * Modifies the messages array in-place.
 */
export function emergencyTruncate(messages: Message[]): void {
  if (messages.length === 0) return

  // Keep system message (index 0)
  const systemMsg = messages[0].role === 'system' ? messages[0] : null
  const keepCount = Math.min(EMERGENCY_KEEP_MESSAGES, messages.length - 1)
  const recentMessages = messages.slice(-keepCount)
  const removedCount = messages.length - (systemMsg ? 1 : 0) - keepCount

  // Clear and rebuild
  messages.length = 0

  if (systemMsg) {
    messages.push(systemMsg)
  }

  // Insert truncation notice
  messages.push({
    role: 'computer',
    content: `[Context truncated: ${removedCount} older messages were removed to fit context window]`,
  })

  messages.push(...recentMessages)

  logger.warn(`Emergency truncation: removed ${removedCount} messages, kept ${keepCount} recent`)
}

// ---- Helpers ----

/**
 * Detect if an error is a context window overflow error.
 */
export function isContextOverflowError(err: unknown): boolean {
  if (!err) return false

  const message = err instanceof Error
    ? err.message
    : typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)

  const keywords = [
    'too_large',
    'context_length',
    'token limit',
    'maximum context',
    'max_tokens',
    'context window',
    'too many tokens',
    'exceeds the model',
    'request too large',
  ]

  const lower = message.toLowerCase()
  return keywords.some(kw => lower.includes(kw))
}

/**
 * Rough token estimate: ~4 chars per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
