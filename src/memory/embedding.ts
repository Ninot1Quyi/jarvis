// ---- Interfaces ----

export interface EmbeddingProvider {
  readonly id: string
  readonly model: string
  readonly dimensions: number
  readonly maxInputTokens: number
  embedQuery(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

// ---- Constants ----

const EMBEDDING_BATCH_MAX_TOKENS = 8000
const RETRY_MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 500
const RETRY_MAX_DELAY_MS = 8000

// ---- Helpers ----

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function truncateToMaxTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  let end = maxChars
  // Don't split surrogate pairs
  if (end > 0 && text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF) {
    end--
  }
  return text.slice(0, end)
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  if (norm === 0) return vec
  return vec.map(v => v / norm)
}

function groupIntoBatches(texts: string[]): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let currentTokens = 0

  for (const text of texts) {
    const tokens = estimateTokens(text)
    if (current.length > 0 && currentTokens + tokens > EMBEDDING_BATCH_MAX_TOKENS) {
      batches.push(current)
      current = []
      currentTokens = 0
    }
    current.push(text)
    currentTokens += tokens
  }

  if (current.length > 0) batches.push(current)
  return batches
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

// ---- OpenAI Provider ----

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai'
  readonly model: string
  readonly dimensions: number
  readonly maxInputTokens: number

  private readonly apiKey: string
  private readonly apiUrl: string

  constructor(options: {
    apiKey: string
    baseUrl?: string
    model?: string
    apiUrl?: string
  }) {
    this.apiKey = options.apiKey
    const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
    this.model = options.model ?? 'text-embedding-3-small'
    // apiUrl = full endpoint URL; if not given, default to baseUrl + /embeddings
    this.apiUrl = options.apiUrl ?? `${baseUrl}/embeddings`
    this.dimensions = 1536
    this.maxInputTokens = 8192
  }

  async embedQuery(text: string): Promise<number[]> {
    const results = await this.embedBatch([text])
    return results[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const truncated = texts.map(t => truncateToMaxTokens(t, this.maxInputTokens))
    const batches = groupIntoBatches(truncated)
    const allEmbeddings: number[][] = []

    for (const batch of batches) {
      const embeddings = await this.callAPI(batch)
      allEmbeddings.push(...embeddings)
    }

    return allEmbeddings
  }

  private get isMultimodal(): boolean {
    return this.apiUrl.includes('multimodal')
  }

  private async callAPI(input: string[]): Promise<number[][]> {
    // Multimodal API: one embedding per call, input is [{type:"text", text:"..."}]
    if (this.isMultimodal) {
      const results: number[][] = []
      for (const text of input) {
        const emb = await this.callAPISingle(
          [{ type: 'text' as const, text }]
        )
        results.push(emb)
      }
      return results
    }

    const body = JSON.stringify({ model: this.model, input })

    let lastError: Error | null = null

    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body,
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          const err = new Error(`OpenAI embedding API error ${res.status}: ${text}`)
          if (isRetryable(res.status) && attempt < RETRY_MAX_ATTEMPTS - 1) {
            lastError = err
            await sleep(retryDelay(attempt))
            continue
          }
          throw err
        }

        const json = (await res.json()) as OpenAIEmbeddingResponse
        return json.data.map(d => l2Normalize(d.embedding))
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        // Network errors are retryable
        if (attempt < RETRY_MAX_ATTEMPTS - 1 && isNetworkError(lastError)) {
          await sleep(retryDelay(attempt))
          continue
        }
        // Non-retryable or last attempt
        if (attempt === RETRY_MAX_ATTEMPTS - 1) break
        throw lastError
      }
    }

    throw lastError ?? new Error('embedding request failed after retries')
  }

  // Single-item call for multimodal API
  private async callAPISingle(input: Array<{ type: 'text'; text: string }>): Promise<number[]> {
    const body = JSON.stringify({ model: this.model, input })

    let lastError: Error | null = null

    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body,
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          const err = new Error(`Embedding API error ${res.status}: ${text}`)
          if (isRetryable(res.status) && attempt < RETRY_MAX_ATTEMPTS - 1) {
            lastError = err
            await sleep(retryDelay(attempt))
            continue
          }
          throw err
        }

        const json = (await res.json()) as OpenAIEmbeddingResponse
        return l2Normalize(json.data[0].embedding)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < RETRY_MAX_ATTEMPTS - 1 && isNetworkError(lastError)) {
          await sleep(retryDelay(attempt))
          continue
        }
        if (attempt === RETRY_MAX_ATTEMPTS - 1) break
        throw lastError
      }
    }

    throw lastError ?? new Error('embedding request failed after retries')
  }
}

function isNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase()
  return msg.includes('fetch') || msg.includes('network') || msg.includes('econnreset')
    || msg.includes('etimedout') || msg.includes('socket') || msg.includes('abort')
}

function retryDelay(attempt: number): number {
  const exponential = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
  const capped = Math.min(exponential, RETRY_MAX_DELAY_MS)
  // 20% jitter: multiply by random in [0.8, 1.2)
  const jitter = 0.8 + Math.random() * 0.4
  return Math.round(capped * jitter)
}

// ---- Factory ----

import type { KeyConfig, ProviderConfig } from '../types.js'

export function createEmbeddingProvider(providerName: string, keys: KeyConfig): EmbeddingProvider | null {
  if (!providerName || providerName === 'none') return null
  const provider = keys[providerName] as ProviderConfig | undefined
  if (!provider?.apiKey || !provider?.embedding?.model) return null
  // All OpenAI-compatible APIs (including doubao, openai, etc.) use OpenAIEmbeddingProvider
  return new OpenAIEmbeddingProvider({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: provider.embedding.model,
    apiUrl: provider.embedding.baseUrl,
  })
}
