import { createProvider } from '../llm/index.js'
import type { LLMProvider, KeyConfig } from '../types.js'
import type { ToolCallEntry } from './task-files.js'
import { traceLogger } from '../utils/trace.js'

export interface MemoryAgentConfig {
  provider: string
  model?: string
}

export class MemoryAgent {
  private llm: LLMProvider

  constructor(config: MemoryAgentConfig, keys: KeyConfig) {
    const effectiveKeys = config.model
      ? { ...keys, [config.provider]: { ...(keys[config.provider] as any), model: config.model } }
      : keys
    this.llm = createProvider(config.provider, effectiveKeys)
  }

  async compressToolCalls(toolCalls: ToolCallEntry[]): Promise<string> {
    if (toolCalls.length === 0) return ''

    const toolCallsText = toolCalls.map(tc =>
      `${tc.name}(${JSON.stringify(tc.arguments)})`
    ).join('\n')

    const wasTracing = traceLogger.isEnabled()
    if (wasTracing) traceLogger.disable()

    try {
      const response = await this.llm.chatWithVisionAndTools(
        [
          {
            role: 'system',
            content: 'You are a memory compression agent. Summarize this sequence of tool calls into a concise natural language description. Preserve semantic intent (not raw coordinates), outcomes, and key identifiers (file paths, URLs, app names). One paragraph, no bullets. Reply with ONLY the summary, nothing else.',
          },
          {
            role: 'user',
            content: toolCallsText,
          },
        ],
        [],
        [],
        { maxTokens: 256 }
      )

      return response.content.trim()
    } finally {
      if (wasTracing) traceLogger.enable()
    }
  }
}
