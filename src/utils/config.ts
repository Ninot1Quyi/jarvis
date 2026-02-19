import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { KeyConfig, JarvisConfig, ProviderConfig, ToolDefinition } from '../types.js'
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
  // Auto-fix hardcoded paths for cross-platform compatibility
  const hostWorkspace = keys.workspace
  const isRemotePath = hostWorkspace?.startsWith('/Users/') || hostWorkspace?.startsWith('C:\\')
  const currentPlatform = process.platform

  // If running on Linux and config has Mac/Windows path, auto-detect local path
  let workspace: string
  if (isRemotePath && currentPlatform === 'linux') {
    // Use ROOT_DIR-based path on Linux
    workspace = path.join(ROOT_DIR, 'workspace')
  } else {
    workspace = hostWorkspace || path.join(ROOT_DIR, 'workspace')
  }

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
 * @param toolDefinitions 工具定义列表（PE 模式下动态生成工具描述）
 * @returns 组合后的系统提示
 */
export function getSystemPrompt(nativeToolCall: boolean, platform?: Platform, toolDefinitions?: ToolDefinition[]): string {
  const currentPlatform = platform || process.platform as Platform

  // 加载基础模板
  let systemPrompt = getPrompt('system')

  // 加载工具说明
  let toolsPrompt: string
  if (nativeToolCall) {
    // Native mode: tools are sent via API, prompt only needs brief instructions
    toolsPrompt = getPrompt('tools/native')
  } else {
    // PE mode: load format template, then append dynamic tool descriptions
    toolsPrompt = getPrompt('tools/text')
    if (toolDefinitions && toolDefinitions.length > 0) {
      toolsPrompt = toolsPrompt + '\n\n' + generateToolDescriptions(toolDefinitions)
    }
  }

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

  // 加载工具使用指南
  let toolsGuide = ''
  try {
    toolsGuide = getPrompt('tools/guide')
  } catch {
    // guide.md 不存在时使用空字符串
  }
  systemPrompt = systemPrompt.replace('{{TOOLS_GUIDE}}', toolsGuide)

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

/**
 * Generate tool descriptions from ToolDefinition[] for PE mode prompts.
 * This is the single source of truth -- no more manually maintained tool lists.
 */
function generateToolDescriptions(tools: ToolDefinition[]): string {
  const lines: string[] = ['## Available Tools', '']

  for (const tool of tools) {
    lines.push(`- **${tool.name}**: ${tool.description}`)

    const props = tool.parameters?.properties
    if (props && Object.keys(props).length > 0) {
      const required = new Set(tool.parameters.required || [])
      const argParts: string[] = []
      for (const [key, schema] of Object.entries(props)) {
        const s = schema as Record<string, unknown>
        const opt = required.has(key) ? '' : '?'
        let desc = (s.description as string) || ''
        if (s.enum) {
          desc += ` (${(s.enum as string[]).map(v => `"${v}"`).join('|')})`
        }
        argParts.push(`\`${key}${opt}\`: ${desc}`)
      }
      lines.push(`  Args: ${argParts.join(', ')}`)
    }
  }

  return lines.join('\n')
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
const MODELS_CACHE_FILE = 'config/models-cache.json'

interface ModelsCache {
  providers: Record<string, Record<string, number>>  // provider -> { model -> contextWindow }
  openrouter: Record<string, number>  // model -> contextWindow
  updatedAt: number
}

// Load models cache from file
function loadModelsCache(): ModelsCache | null {
  const cachePath = path.join(ROOT_DIR, MODELS_CACHE_FILE)
  try {
    if (fs.existsSync(cachePath)) {
      const content = fs.readFileSync(cachePath, 'utf-8')
      return JSON.parse(content) as ModelsCache
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

// Save models cache to file
function saveModelsCache(cache: ModelsCache): void {
  const cachePath = path.join(ROOT_DIR, MODELS_CACHE_FILE)
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))
  } catch {
    // Ignore write errors
  }
}

// In-memory cache
let modelsCache: ModelsCache | null = null

// Initialize cache on module load
function initModelsCache(): void {
  modelsCache = loadModelsCache()
  if (!modelsCache) {
    modelsCache = { providers: {}, openrouter: {}, updatedAt: 0 }
  }
}
initModelsCache()

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

  // Check cache first
  const providerName = providerConfig.baseUrl
  if (modelsCache?.providers[providerName]?.[model]) {
    return modelsCache.providers[providerName][model]
  }

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

    // Build model map and cache it
    const modelMap: Record<string, number> = {}
    for (const entry of json.data) {
      let ctxLen: number | undefined
      if (entry.token_limits?.context_window) {
        ctxLen = entry.token_limits.context_window
      } else if (entry.context_length) {
        ctxLen = entry.context_length
      }
      if (ctxLen) {
        modelMap[entry.id] = ctxLen
      }
    }

    // Update cache
    if (modelsCache) {
      if (!modelsCache.providers[providerName]) {
        modelsCache.providers[providerName] = {}
      }
      Object.assign(modelsCache.providers[providerName], modelMap)
      saveModelsCache(modelsCache)
    }

    return modelMap[model]
  } catch {
    // Network error, timeout, parse error - all fine, just fall through
    return undefined
  }
}

// ---- Layer 2: OpenRouter lookup ----

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/**
 * Fetch all models from OpenRouter and cache as Map<modelShortName, context_length>.
 * Returns empty map on failure (network error, timeout, etc).
 */
async function fetchOpenRouterModels(): Promise<Map<string, number>> {
  // If we have cached data, return it first
  if (modelsCache?.openrouter && Object.keys(modelsCache.openrouter).length > 0) {
    const map = new Map(Object.entries(modelsCache.openrouter))

    // Async update in background (won't block startup)
    // This will update the cache for future use
    fetchOpenRouterModelsAsync().catch(() => {})  // Fire and forget

    return map
  }

  // No cache - fetch synchronously
  try {
    const map = await fetchOpenRouterModelsSync()
    if (map.size > 0 && modelsCache) {
      modelsCache.openrouter = Object.fromEntries(map)
      modelsCache.updatedAt = Date.now()
      saveModelsCache(modelsCache)
    }
    return map
  } catch {
    return new Map()
  }
}

// Sync fetch from OpenRouter
async function fetchOpenRouterModelsSync(): Promise<Map<string, number>> {
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
    logger.info(`[contextWindow] OpenRouter: cached ${map.size} model entries`)
    return map
  } catch (err) {
    logger.warn(`[contextWindow] OpenRouter fetch failed: ${err instanceof Error ? err.message : err}`)
    return new Map()
  }
}

// Async fetch from OpenRouter (for background updates)
async function fetchOpenRouterModelsAsync(): Promise<void> {
  try {
    const map = await fetchOpenRouterModelsSync()
    if (map.size > 0) {
      modelsCache!.openrouter = Object.fromEntries(map)
      modelsCache!.updatedAt = Date.now()
      saveModelsCache(modelsCache!)
      logger.info(`[contextWindow] OpenRouter: async updated ${map.size} model entries`)
    }
  } catch {
    // Ignore async errors
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

  // Priority 1: explicit config value - use directly, skip all API requests
  if (providerConfig?.contextWindow) {
    logger.info(`[contextWindow] ${providerName}: ${providerConfig.contextWindow} (from config, skip API lookup)`)
    return providerConfig.contextWindow
  }

  // Priority 2: provider's own /models API (with cache)
  if (providerConfig) {
    const providerValue = await fetchProviderContextWindow(providerConfig, model)
    if (providerValue !== undefined) {
      logger.info(`[contextWindow] ${providerName}: ${providerValue} (from provider API, model="${model}")`)
      return providerValue
    }
  }

  // Priority 3: OpenRouter lookup (with cache)
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
