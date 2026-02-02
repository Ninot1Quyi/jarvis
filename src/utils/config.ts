import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { KeyConfig, JarvisConfig } from '../types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..', '..')

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
  let defaultProvider: 'anthropic' | 'openai' | 'doubao' = 'anthropic'
  if (keys.defaultProvider) {
    defaultProvider = keys.defaultProvider
  } else if (keys.anthropic?.apiKey) {
    defaultProvider = 'anthropic'
  } else if (keys.doubao?.apiKey) {
    defaultProvider = 'doubao'
  } else if (keys.openai?.apiKey) {
    defaultProvider = 'openai'
  }

  return {
    keys,
    defaultProvider,
    maxSteps: 50,
    screenshotDir: path.join(ROOT_DIR, 'data', 'memory', 'screenshots'),
    dataDir: path.join(ROOT_DIR, 'data'),
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

export function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  return result
}

export const config = loadConfig()
