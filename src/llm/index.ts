import type { LLMProvider, KeyConfig, ProviderConfig } from '../types.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'

export function createProvider(
  type: string,
  keys: KeyConfig
): LLMProvider {
  // 获取 provider 配置
  const config = keys[type] as ProviderConfig | undefined

  if (!config?.apiKey) {
    throw new Error(`${type} API key not configured`)
  }

  // 根据 apiType 决定使用哪个 Provider 类，默认 openai
  const apiType = config.apiType || 'openai'
  const nativeToolCall = config.nativeToolCall === true

  if (apiType === 'anthropic') {
    return new AnthropicProvider(config.apiKey, config.baseUrl, config.model)
  }

  // 默认使用 OpenAI 兼容 API
  return new OpenAIProvider(config.apiKey, config.baseUrl, config.model, nativeToolCall)
}

export { AnthropicProvider } from './anthropic.js'
export { OpenAIProvider } from './openai.js'
