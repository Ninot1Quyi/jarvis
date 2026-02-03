import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { KeyConfig, JarvisConfig } from '../types.js'

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

  return systemPrompt
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  return result
}

export const config = loadConfig()
