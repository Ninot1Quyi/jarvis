#!/usr/bin/env node

import { Agent } from '../agent/Agent.js'
import { logger } from '../utils/logger.js'
import { traceLogger } from '../utils/trace.js'

async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  let verbose = false
  let provider: 'anthropic' | 'openai' | 'doubao' | undefined
  let task = ''

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--verbose' || arg === '-v') {
      verbose = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if (arg === '--provider' || arg === '-p') {
      const value = args[++i]
      if (value === 'anthropic' || value === 'openai' || value === 'doubao') {
        provider = value
      } else {
        console.error(`Invalid provider: ${value}. Use 'anthropic', 'openai', or 'doubao'.`)
        process.exit(1)
      }
    } else if (arg === '--anthropic') {
      provider = 'anthropic'
    } else if (arg === '--openai') {
      provider = 'openai'
    } else if (arg === '--doubao') {
      provider = 'doubao'
    } else if (!arg.startsWith('-')) {
      task = arg
    }
  }

  if (verbose) {
    logger.setLevel('debug')
  }

  if (!task) {
    console.log('Jarvis - Digital Employee Agent\n')
    console.log('Usage: jarvis "<task description>"\n')
    console.log('Example: jarvis "打开 Chrome 搜索今天的天气"\n')
    console.log('Options:')
    console.log('  -p, --provider <name>  Use specific provider (anthropic/openai/doubao)')
    console.log('  --anthropic            Use Anthropic Claude')
    console.log('  --openai               Use OpenAI')
    console.log('  --doubao               Use Doubao')
    console.log('  -v, --verbose          Show debug output')
    console.log('  -h, --help             Show this help')
    process.exit(0)
  }

  // Always enable trace logging
  traceLogger.enable()

  console.log('[JARVIS] Starting...\n')
  console.log(`[TRACE] ${traceLogger.getTracePath()}\n`)
  if (provider) {
    console.log(`[CONFIG] Provider: ${provider}\n`)
  }

  try {
    const agent = new Agent({ provider })
    await agent.run(task)
  } catch (error) {
    logger.error('Agent error:', error)
    process.exit(1)
  }
}

function printHelp() {
  console.log(`
Jarvis - Digital Employee Agent

Usage:
  jarvis "<task description>"
  jarvis --anthropic "<task description>"
  jarvis --openai "<task description>"
  jarvis --doubao "<task description>"

Examples:
  jarvis "打开 Chrome 搜索今天的天气"
  jarvis --anthropic "打开微信发送消息给张三"
  jarvis --doubao "用 Chrome 搜索我的世界"
  jarvis -p openai "整理桌面上的文件"

Options:
  -p, --provider <name>  Use specific provider (anthropic/openai/doubao)
  --anthropic            Use Anthropic Claude
  --openai               Use OpenAI
  --doubao               Use Doubao
  -v, --verbose          Show debug output
  -h, --help             Show this help

Trace:
  Conversation traces are automatically saved to data/traces/

Configuration:
  Edit config/key.json to set API keys and model names.

For more information, see REQUIREMENTS.md
`)
}

main()
