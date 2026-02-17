import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { KeyConfig, JarvisConfig, ProviderConfig } from '../types.js'
import { logger } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..', '..')

export type Platform = 'darwin' | 'win32' | 'linux'

export function loadKeys(): KeyConfig {
  const configPath = path.join(ROOT_DIR, 'config', 'config.json')

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}\nCopy config/key.example.json to config/config.json and fill in your API keys.`)
  }

  const content = fs.readFileSync(configPath, 'utf-8')
  return JSON.parse(content) as KeyConfig
}

export function loadConfig(): JarvisConfig {
  const keys = loadKeys()

  // Determine default provider from config or fallback
  let defaultProvider = 'anthropic'
  if (keys.defaultProvider) {
    defaultProvider = keys.defaultProvider
  } else if (keys.anthropic?.apiKey) {
    defaultProvider = 'anthropic'
  } else if (keys.doubao?.apiKey) {
    defaultProvider = 'doubao'
  } else if (keys.openai?.apiKey) {
    defaultProvider = 'openai'
  }

  // Workspace defaults to data directory if not specified
  const workspace = keys.workspace || path.join(ROOT_DIR, 'workspace')

  return {
    keys,
    defaultProvider,
    mouseSpeed: keys.mouseSpeed ?? -1,
    maxSteps: 50,
    screenshotDir: path.join(ROOT_DIR, 'data', 'memory', 'screenshots'),
    dataDir: path.join(ROOT_DIR, 'data'),
    workspace,
    autonomousMode: (keys as Record<string, unknown>).autonomousMode === true,
  }
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function getPrompt(name: string): string {
  const promptPath = path.join(ROOT_DIR, 'prompts', `${name}.md`)

  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file not found: ${promptPath}`)
  }

  return fs.readFileSync(promptPath, 'utf-8')
}

/**
 * 获取组合后的系统提示
 *
 * @param nativeToolCall 是否使用原生工具调用
 * @param platform 目标平台（默认当前平台）
 * @returns 组合后的系统提示
 */
export function getSystemPrompt(nativeToolCall: boolean, platform?: Platform): string {
  const currentPlatform = platform || process.platform as Platform

  // 加载基础模板
  let systemPrompt = getPrompt('system')

  // 加载工具说明
  const toolsPrompt = nativeToolCall
    ? getPrompt('tools/native')
    : getPrompt('tools/text')

  // 加载平台特定内容
  let platformPrompt = ''
  const platformMap: Record<Platform, string> = {
    'darwin': 'platform/macos',
    'win32': 'platform/windows',
    'linux': 'platform/linux',
  }

  const platformFile = platformMap[currentPlatform]
  if (platformFile) {
    try {
      platformPrompt = getPrompt(platformFile)
    } catch {
      // 平台文件不存在时使用空字符串
      platformPrompt = ''
    }
  }

  // 替换占位符
  systemPrompt = systemPrompt.replace('{{TOOLS}}', toolsPrompt)
  systemPrompt = systemPrompt.replace('{{PLATFORM}}', platformPrompt)

  // 加载记忆系统提示
  let memoryPrompt = ''
  try {
    memoryPrompt = getPrompt('memory')
  } catch {
    // memory.md 不存在时使用空字符串
  }
  systemPrompt = systemPrompt.replace('{{MEMORY}}', memoryPrompt)

  return systemPrompt
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  return result
}

// ---- Context window resolution ----

const FETCH_TIMEOUT = 8000  // ms

// ---- Layer 1: Provider's own /models API ----

interface ProviderModelEntry {
  id: string
  token_limits?: { context_window?: number }
  context_length?: number
}

/**
 * Fetch context_window from the provider's own /models endpoint.
 * Supports OpenAI-compatible APIs (doubao, qwen, openai, ollama, etc).
 * Looks for token_limits.context_window (doubao) or context_length (others).
 */
async function fetchProviderContextWindow(providerConfig: ProviderConfig, model: string): Promise<number | undefined> {
  if (!providerConfig.baseUrl || !model) return undefined
  // Only try for OpenAI-compatible providers
  if (providerConfig.apiType === 'anthropic') return undefined

  const url = `${providerConfig.baseUrl}/models`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${providerConfig.apiKey}` },
    })
    clearTimeout(timer)

    if (!res.ok) return undefined

    const json = await res.json() as { data: ProviderModelEntry[] }
    if (!json.data || !Array.isArray(json.data)) return undefined

    const entry = json.data.find(m => m.id === model)
    if (!entry) return undefined

    // doubao style: token_limits.context_window
    if (entry.token_limits?.context_window) {
      return entry.token_limits.context_window
    }
    // OpenRouter/others style: context_length
    if (entry.context_length) {
      return entry.context_length
    }

    return undefined
  } catch {
    // Network error, timeout, parse error - all fine, just fall through
    return undefined
  }
}

// ---- Layer 2: OpenRouter lookup ----

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

let openRouterCache: Map<string, number> | null = null

/**
 * Fetch all models from OpenRouter and cache as Map<modelShortName, context_length>.
 * Returns empty map on failure (network error, timeout, etc).
 */
async function fetchOpenRouterModels(): Promise<Map<string, number>> {
  if (openRouterCache) return openRouterCache

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
    const res = await fetch(OPENROUTER_MODELS_URL, { signal: controller.signal })
    clearTimeout(timer)

    const json = await res.json() as { data: Array<{ id: string; context_length: number }> }
    const map = new Map<string, number>()
    for (const m of json.data) {
      map.set(m.id, m.context_length)
      const slash = m.id.indexOf('/')
      if (slash !== -1) {
        map.set(m.id.slice(slash + 1), m.context_length)
      }
    }
    openRouterCache = map
    logger.info(`[contextWindow] OpenRouter: cached ${map.size} model entries`)
    return map
  } catch (err) {
    logger.warn(`[contextWindow] OpenRouter fetch failed: ${err instanceof Error ? err.message : err}`)
    return new Map()
  }
}

/**
 * Look up model in OpenRouter cache. Tries exact match on short name,
 * then prefix match (our model starts with a cached name, or vice versa).
 */
function lookupOpenRouter(models: Map<string, number>, modelName: string): number | undefined {
  if (models.size === 0) return undefined

  const exact = models.get(modelName)
  if (exact !== undefined) return exact

  let bestMatch: number | undefined
  let bestLen = 0
  for (const [id, ctxLen] of models) {
    if (modelName.startsWith(id) && id.length > bestLen) {
      bestMatch = ctxLen
      bestLen = id.length
    } else if (id.startsWith(modelName) && modelName.length > bestLen) {
      bestMatch = ctxLen
      bestLen = modelName.length
    }
  }
  return bestMatch
}

// ---- Resolve: config > provider API > OpenRouter > fallback ----

/**
 * Resolve context window size for a provider (async).
 * Priority: explicit config > provider /models API > OpenRouter > fallback 128000.
 */
export async function resolveContextWindow(keys: KeyConfig, providerName: string): Promise<number> {
  const providerConfig = keys[providerName] as ProviderConfig | undefined
  const model = providerConfig?.model || ''

  // Priority 1: explicit config value
  if (providerConfig?.contextWindow) {
    logger.info(`[contextWindow] ${providerName}: ${providerConfig.contextWindow} (from config)`)
    return providerConfig.contextWindow
  }

  // Priority 2: provider's own /models API
  if (providerConfig) {
    const providerValue = await fetchProviderContextWindow(providerConfig, model)
    if (providerValue !== undefined) {
      logger.info(`[contextWindow] ${providerName}: ${providerValue} (from provider API, model="${model}")`)
      return providerValue
    }
  }

  // Priority 3: OpenRouter lookup
  const models = await fetchOpenRouterModels()
  const orValue = lookupOpenRouter(models, model)
  if (orValue !== undefined) {
    logger.info(`[contextWindow] ${providerName}: ${orValue} (from OpenRouter, model="${model}")`)
    return orValue
  }

  // Priority 4: fallback
  const fallback = 128000
  logger.warn(`[contextWindow] ${providerName}: model "${model || 'unknown'}" not found anywhere, using fallback ${fallback}`)
  return fallback
}

export const config = loadConfig()
