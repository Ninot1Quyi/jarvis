#!/usr/bin/env node

import { Agent } from '../agent/Agent.js'
import { logger } from '../utils/logger.js'
import { traceLogger } from '../utils/trace.js'
import { overlayClient } from '../utils/overlay.js'
import { messageLayer } from '../message/index.js'
import * as readline from 'readline'
import { spawn, execSync, ChildProcess } from 'child_process'
import * as path from 'path'
import * as net from 'net'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OVERLAY_UI_DIR = path.resolve(__dirname, '../../overlay-ui')
const WS_PORT = 19823
const VITE_PORT = 1420

// ── UI process management ────────────────────────────────────────

let uiProcess: ChildProcess | null = null

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1')
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error', () => resolve(false))
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false) })
  })
}

/** Kill stale processes left over from a previous run. */
async function cleanStalePorts(): Promise<void> {
  // WS port open means UI is fully alive -- nothing to clean
  if (await probePort(WS_PORT)) return

  // Vite port occupied without WS = orphaned Vite from last run
  if (await probePort(VITE_PORT)) {
    console.log('[JARVIS] Killing stale Vite process on port 1420...')
    try { execSync(`lsof -ti:${VITE_PORT} | xargs kill -9`, { stdio: 'ignore' }) } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
}

async function waitForUi(timeoutMs = 120_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await probePort(WS_PORT)) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`Overlay UI did not start within ${timeoutMs / 1000}s`)
}

function spawnUi(): ChildProcess {
  const child = spawn('npm', ['run', 'tauri', 'dev'], {
    cwd: OVERLAY_UI_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    detached: true,  // own process group so we can kill the whole tree
  })

  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString().trim()
    if (text) console.log(`[UI] ${text}`)
  })
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim()
    if (text && !text.includes('warning:')) console.error(`[UI] ${text}`)
  })

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[UI] Process exited with code ${code}`)
    }
    uiProcess = null
  })

  // detached + unref so the child doesn't keep the parent alive on its own
  child.unref()

  return child
}

function killUi(): void {
  if (!uiProcess || uiProcess.killed) { uiProcess = null; return }

  const pid = uiProcess.pid
  uiProcess = null

  if (!pid) return

  // Kill the entire process group (shell + npm + vite + cargo + tauri)
  try { process.kill(-pid, 'SIGTERM') } catch {}
  // Belt-and-suspenders: also nuke the ports directly
  try { execSync(`lsof -ti:${VITE_PORT},${WS_PORT} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' }) } catch {}
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)

  let verbose = false
  let noUi = false
  let interactive = false
  let clear = false
  let provider: 'anthropic' | 'openai' | 'doubao' | undefined
  let task = ''

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--verbose' || arg === '-v') {
      verbose = true
    } else if (arg === '--no-ui') {
      noUi = true
    } else if (arg === '--interactive' || arg === '-i') {
      interactive = true
    } else if (arg === '--clear') {
      clear = true
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

  // No task and no interactive flag -> default to interactive
  if (!task && !interactive) {
    interactive = true
  }

  // ── Clear pending message queues ────────────────────────────────

  if (clear) {
    messageLayer.clearPending()
    console.log('[JARVIS] Pending message queues cleared\n')
  }

  // ── Start overlay UI ───────────────────────────────────────────

  let overlay = false

  if (!noUi) {
    const alreadyRunning = await probePort(WS_PORT)

    if (alreadyRunning) {
      console.log('[JARVIS] Overlay UI already running\n')
    } else {
      await cleanStalePorts()
      console.log('[JARVIS] Starting overlay UI...\n')
      uiProcess = spawnUi()
      await waitForUi()
      console.log('[JARVIS] Overlay UI ready\n')
    }

    overlay = true
    overlayClient.enable()
  }

  // ── Cleanup handlers ───────────────────────────────────────────

  const cleanup = () => {
    killUi()
    if (overlay) overlayClient.disable()
  }
  process.on('exit', cleanup)
  process.on('SIGINT', () => { cleanup(); process.exit(0) })
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })

  // ── Start agent ────────────────────────────────────────────────

  traceLogger.enable()

  console.log('[JARVIS] Starting...\n')
  console.log(`[TRACE] ${traceLogger.getTracePath()}\n`)
  if (provider) {
    console.log(`[CONFIG] Provider: ${provider}\n`)
  }
  if (interactive) {
    console.log('[MODE] Interactive - type messages or use overlay UI\n')
  }

  // Terminal input for interactive / overlay mode
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
  }
}

// ── Terminal input ───────────────────────────────────────────────

function startTerminalInput() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (trimmed) {
      messageLayer.push('tui', trimmed)
      console.log(`[QUEUED] ${trimmed}\n`)
    }
  })

  rl.on('close', () => {
    console.log('\n[JARVIS] Terminal input closed\n')
  })
}

// ── Help ─────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Jarvis - Digital Employee Agent

Usage:
  jarvis                               # Start UI + interactive mode
  jarvis "<task>"                      # Start UI + run task
  jarvis --no-ui "<task>"              # CLI only, no overlay UI

Examples:
  jarvis                               # Interactive with overlay UI
  jarvis "open Chrome and search for weather"
  jarvis --anthropic "send an email"
  jarvis --no-ui -v "organize files"   # CLI only, verbose

Options:
  -i, --interactive      Interactive mode (default when no task given)
  --no-ui                Skip overlay UI, CLI only
  -p, --provider <name>  Use specific provider (anthropic/openai/doubao)
  --anthropic            Use Anthropic Claude
  --openai               Use OpenAI
  --doubao               Use Doubao
  -v, --verbose          Show debug output
  --clear                Clear pending inbound/outbound message queues
  -h, --help             Show this help

The overlay UI starts automatically. Use --no-ui to disable.
Traces are saved to data/traces/
Configuration: config/key.json
`)
}

main()
