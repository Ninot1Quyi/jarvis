// ---- Interfaces ----

import type { MultimodalInput } from './types.js'

export interface EmbeddingProvider {
  readonly id: string
  readonly model: string
  readonly dimensions: number
  readonly maxInputTokens: number
  readonly multimodal?: boolean
  embedQuery(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  embedMultimodal?(inputs: MultimodalInput[]): Promise<number[][]>
}

// ---- Constants ----

const EMBEDDING_BATCH_MAX_TOKENS = 8000
const RETRY_MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 500
const RETRY_MAX_DELAY_MS = 8000
const EMBEDDING_QUERY_TIMEOUT_MS = 60_000
const EMBEDDING_BATCH_TIMEOUT_MS = 120_000

// ---- Helpers ----

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

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
    return withTimeout(
      this.embedBatch([text]).then(r => r[0]),
      EMBEDDING_QUERY_TIMEOUT_MS,
      `embedding query timed out after ${Math.round(EMBEDDING_QUERY_TIMEOUT_MS / 1000)}s`
    )
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const truncated = texts.map(t => truncateToMaxTokens(t, this.maxInputTokens))
    const batches = groupIntoBatches(truncated)
    const allEmbeddings: number[][] = []

    const work = async () => {
      for (const batch of batches) {
        const embeddings = await this.callAPI(batch)
        allEmbeddings.push(...embeddings)
      }
      return allEmbeddings
    }

    return withTimeout(
      work(),
      EMBEDDING_BATCH_TIMEOUT_MS,
      `embedding batch timed out after ${Math.round(EMBEDDING_BATCH_TIMEOUT_MS / 1000)}s`
    )
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

// ---- Dashscope Multimodal Provider ----

interface DashscopeEmbeddingResponse {
  output: {
    embeddings: Array<{ index: number; embedding: number[]; type: string }>
  }
}

export class DashscopeEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'dashscope'
  readonly model: string
  readonly dimensions: number
  readonly maxInputTokens = 8192
  readonly multimodal = true

  private readonly apiKey: string
  private readonly apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding'

  constructor(options: { apiKey: string; model?: string; dimensions?: number }) {
    this.apiKey = options.apiKey
    this.model = options.model ?? 'qwen3-vl-embedding'
    this.dimensions = options.dimensions ?? 1024
  }

  async embedQuery(text: string): Promise<number[]> {
    return withTimeout(
      this.callAPI([{ text }]).then(r => r[0]),
      EMBEDDING_QUERY_TIMEOUT_MS,
      `dashscope embedding query timed out after ${Math.round(EMBEDDING_QUERY_TIMEOUT_MS / 1000)}s`
    )
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const contents = texts.map(t => ({ text: truncateToMaxTokens(t, this.maxInputTokens) }))
    return withTimeout(
      this.callAPI(contents),
      EMBEDDING_BATCH_TIMEOUT_MS,
      `dashscope embedding batch timed out after ${Math.round(EMBEDDING_BATCH_TIMEOUT_MS / 1000)}s`
    )
  }

  async embedMultimodal(inputs: MultimodalInput[]): Promise<number[][]> {
    if (inputs.length === 0) return []

    const work = async (): Promise<number[][]> => {
      const contents: Array<Record<string, string>> = []
      // Track which original input index each content entry maps to
      const indexMap: number[] = []

      for (let i = 0; i < inputs.length; i++) {
        const inp = inputs[i]
        const text = truncateToMaxTokens(inp.text, this.maxInputTokens)

        if (!inp.images || inp.images.length === 0) {
          contents.push({ text })
          indexMap.push(i)
        } else {
          // First image fused with text
          contents.push({ text, image: inp.images[0] })
          indexMap.push(i)
          // Additional images as standalone entries (rare, but handle it)
          for (let j = 1; j < inp.images.length; j++) {
            contents.push({ image: inp.images[j] })
            indexMap.push(i)
          }
        }
      }

      const rawEmbeddings = await this.callAPI(contents)

      // Merge: if multiple entries map to the same input, average them
      const result: number[][] = new Array(inputs.length)
      const counts: number[] = new Array(inputs.length).fill(0)

      for (let k = 0; k < rawEmbeddings.length; k++) {
        const idx = indexMap[k]
        if (counts[idx] === 0) {
          result[idx] = rawEmbeddings[k]
        } else {
          for (let d = 0; d < rawEmbeddings[k].length; d++) {
            result[idx][d] += rawEmbeddings[k][d]
          }
        }
        counts[idx]++
      }

      // Normalize averaged vectors
      for (let i = 0; i < result.length; i++) {
        if (counts[i] > 1) {
          result[i] = result[i].map(v => v / counts[i])
        }
        result[i] = l2Normalize(result[i])
      }

      return result
    }

    return withTimeout(
      work(),
      EMBEDDING_BATCH_TIMEOUT_MS,
      `dashscope multimodal embedding timed out after ${Math.round(EMBEDDING_BATCH_TIMEOUT_MS / 1000)}s`
    )
  }

  private async callAPI(contents: Array<Record<string, string>>): Promise<number[][]> {
    // Dashscope batches up to 20 contents per request
    const BATCH_SIZE = 20
    const allEmbeddings: number[][] = []

    for (let i = 0; i < contents.length; i += BATCH_SIZE) {
      const batch = contents.slice(i, i + BATCH_SIZE)
      const embeddings = await this.callAPISingle(batch)
      allEmbeddings.push(...embeddings)
    }

    return allEmbeddings
  }

  private async callAPISingle(contents: Array<Record<string, string>>): Promise<number[][]> {
    const body = JSON.stringify({
      model: this.model,
      input: { contents },
      parameters: { dimension: this.dimensions },
    })

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
          const err = new Error(`Dashscope embedding API error ${res.status}: ${text}`)
          if (isRetryable(res.status) && attempt < RETRY_MAX_ATTEMPTS - 1) {
            lastError = err
            await sleep(retryDelay(attempt))
            continue
          }
          throw err
        }

        const json = (await res.json()) as DashscopeEmbeddingResponse
        // Sort by index to ensure correct order
        const sorted = json.output.embeddings.sort((a, b) => a.index - b.index)
        return sorted.map(d => l2Normalize(d.embedding))
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

    throw lastError ?? new Error('dashscope embedding request failed after retries')
  }
}

// ---- Factory ----

import type { KeyConfig, ProviderConfig } from '../types.js'

export function createEmbeddingProvider(providerName: string, keys: KeyConfig): EmbeddingProvider | null {
  if (!providerName || providerName === 'none') return null
  const provider = keys[providerName] as ProviderConfig | undefined
  if (!provider?.apiKey || !provider?.embedding?.model) return null

  const embCfg = provider.embedding
  if (embCfg.apiType === 'dashscope') {
    return new DashscopeEmbeddingProvider({
      apiKey: provider.apiKey,
      model: embCfg.model,
      dimensions: embCfg.dimensions,
    })
  }

  // Default: OpenAI-compatible
  return new OpenAIEmbeddingProvider({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: embCfg.model,
    apiUrl: embCfg.baseUrl,
  })
}
