#!/usr/bin/env node

import { Agent } from '../agent/Agent.js'
import { logger } from '../utils/logger.js'
import { traceLogger } from '../utils/trace.js'
import { overlayClient } from '../utils/overlay.js'
import { messageLayer } from '../message/index.js'
import * as readline from 'readline'

async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  let verbose = false
  let overlay = false
  let interactive = false
  let provider: 'anthropic' | 'openai' | 'doubao' | undefined
  let task = ''

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--verbose' || arg === '-v') {
      verbose = true
    } else if (arg === '--overlay' || arg === '-o') {
      overlay = true
    } else if (arg === '--interactive' || arg === '-i') {
      interactive = true
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

  // 如果没有任务且没有 -i 标志，显示帮助
  if (!task && !interactive) {
    console.log('Jarvis - Digital Employee Agent\n')
    console.log('Usage: jarvis "<task description>"\n')
    console.log('Example: jarvis "open Chrome and search for weather"\n')
    console.log('Options:')
    console.log('  -i, --interactive      Interactive mode (wait for messages)')
    console.log('  -p, --provider <name>  Use specific provider (anthropic/openai/doubao)')
    console.log('  --anthropic            Use Anthropic Claude')
    console.log('  --openai               Use OpenAI')
    console.log('  --doubao               Use Doubao')
    console.log('  -o, --overlay          Enable overlay UI (connect to ws://127.0.0.1:19823)')
    console.log('  -v, --verbose          Show debug output')
    console.log('  -h, --help             Show this help')
    process.exit(0)
  }

  // Always enable trace logging
  traceLogger.enable()

  // Enable overlay if requested
  if (overlay) {
    overlayClient.enable()
    console.log('[OVERLAY] Connecting to overlay UI...\n')
  }

  console.log('[JARVIS] Starting...\n')
  console.log(`[TRACE] ${traceLogger.getTracePath()}\n`)
  if (provider) {
    console.log(`[CONFIG] Provider: ${provider}\n`)
  }
  if (interactive) {
    console.log('[MODE] Interactive mode - type messages to send to agent\n')
  }

  // 启动终端输入监听（交互模式或有 overlay 时）
  if (interactive || overlay) {
    startTerminalInput()
  }

  try {
    const agent = new Agent({ provider, overlay, interactive })
    await agent.run(task || undefined)
  } catch (error) {
    logger.error('Agent error:', error)
    if (overlay) {
      overlayClient.sendError(`Agent error: ${error}`)
    }
    process.exit(1)
  } finally {
    if (overlay) {
      overlayClient.disable()
    }
  }
}

/**
 * 启动终端输入监听
 * 用户输入的内容会被推送到消息队列
 */
function startTerminalInput() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (trimmed) {
      messageLayer.push('terminal', trimmed)
      console.log(`[QUEUED] Message added to queue: ${trimmed}\n`)
    }
  })

  rl.on('close', () => {
    console.log('\n[JARVIS] Terminal input closed\n')
  })
}

function printHelp() {
  console.log(`
Jarvis - Digital Employee Agent

Usage:
  jarvis "<task description>"
  jarvis -i                          # Interactive mode
  jarvis --anthropic "<task description>"
  jarvis --openai "<task description>"
  jarvis --doubao "<task description>"

Examples:
  jarvis "open Chrome and search for weather"
  jarvis --anthropic "open WeChat and send a message"
  jarvis --doubao -o "search Minecraft in Chrome"
  jarvis -p openai "organize files on desktop"
  jarvis -i -o -v                    # Interactive mode with overlay and verbose

Options:
  -i, --interactive      Interactive mode (no initial task, wait for messages)
  -p, --provider <name>  Use specific provider (anthropic/openai/doubao)
  --anthropic            Use Anthropic Claude
  --openai               Use OpenAI
  --doubao               Use Doubao
  -o, --overlay          Enable overlay UI (connect to ws://127.0.0.1:19823)
  -v, --verbose          Show debug output
  -h, --help             Show this help

Message Sources:
  In interactive mode, you can send messages from:
  - Terminal: Type directly in the console
  - Overlay UI: Send via the GUI (requires -o flag)
  - Email: (coming soon)

  Messages are queued in data/messages.md and processed by the agent.

Overlay UI:
  Start the overlay app first, then use -o flag to send messages to it.
  The overlay listens on ws://127.0.0.1:19823

Trace:
  Conversation traces are automatically saved to data/traces/

Configuration:
  Edit config/key.json to set API keys and model names.

For more information, see REQUIREMENTS.md
`)
}

main()
