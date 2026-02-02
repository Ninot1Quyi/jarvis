import { OpenAIProvider } from './openai.js'

/**
 * Doubao provider - extends OpenAI provider with different defaults
 * Uses prompt engineering mode by default (nativeToolCall=false)
 */
export class DoubaoProvider extends OpenAIProvider {
  name = 'doubao'

  constructor(apiKey: string, baseUrl?: string, model?: string, nativeToolCall: boolean = false) {
    super(
      apiKey,
      baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
      model || 'doubao-1-5-ui-tars-250428',
      nativeToolCall
    )
  }
}
