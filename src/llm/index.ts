import type { LLMProvider, KeyConfig } from '../types.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'
import { DoubaoProvider } from './doubao.js'

export function createProvider(
  type: 'anthropic' | 'openai' | 'doubao',
  keys: KeyConfig
): LLMProvider {
  if (type === 'anthropic') {
    const config = keys.anthropic
    if (!config?.apiKey) {
      throw new Error('Anthropic API key not configured')
    }
    return new AnthropicProvider(config.apiKey, config.baseUrl, config.model)
  }

  if (type === 'openai') {
    const config = keys.openai
    if (!config?.apiKey) {
      throw new Error('OpenAI API key not configured')
    }
    const nativeToolCall = config.nativeToolCall !== false // default true
    return new OpenAIProvider(config.apiKey, config.baseUrl, config.model, nativeToolCall)
  }

  if (type === 'doubao') {
    const config = keys.doubao
    if (!config?.apiKey) {
      throw new Error('Doubao API key not configured')
    }
    const nativeToolCall = config.nativeToolCall === true // default false
    return new DoubaoProvider(config.apiKey, config.baseUrl, config.model, nativeToolCall)
  }

  throw new Error(`Unknown provider type: ${type}`)
}

export { AnthropicProvider } from './anthropic.js'
export { OpenAIProvider } from './openai.js'
export { DoubaoProvider } from './doubao.js'
