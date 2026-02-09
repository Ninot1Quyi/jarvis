/**
 * Live AX diff test: captures a snapshot every second and prints diff.
 *
 * Usage:
 *   npx tsx test/ax-diff-live.ts
 *
 * Switch to any window, do something (click, type, open menu, etc.),
 * and watch the terminal for detected changes.
 *
 * Press Ctrl+C to stop.
 */

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const NOTIF_WATCH_PATH = join(__dirname, '..', 'native', 'macos', 'notif-watch', '.build', 'release', 'notif-watch')

interface AXSnapshot {
  appName: string
  bundleId: string
  lines: string[]
}

function captureAXSnapshot(): Promise<AXSnapshot | null> {
  if (!existsSync(NOTIF_WATCH_PATH)) {
    console.error(`notif-watch binary not found: ${NOTIF_WATCH_PATH}`)
    process.exit(1)
  }

  return new Promise((resolve) => {
    execFile(NOTIF_WATCH_PATH, ['--snapshot'], { timeout: 5000 }, (error, stdout) => {
      if (error) { resolve(null); return }
      try {
        const data = JSON.parse(stdout.trim())
        if (data.error) { resolve(null); return }
        resolve({ appName: data.appName, bundleId: data.bundleId, lines: data.lines })
      } catch {
        resolve(null)
      }
    })
  })
}

function computeAXDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  // Count occurrences instead of using Set, so duplicate lines are handled correctly
  const countA = new Map<string, number>()
  const countB = new Map<string, number>()
  for (const l of a) countA.set(l, (countA.get(l) || 0) + 1)
  for (const l of b) countB.set(l, (countB.get(l) || 0) + 1)

  const added: string[] = []
  const removed: string[] = []

  for (const [line, cnt] of countB) {
    const diff = cnt - (countA.get(line) || 0)
    for (let i = 0; i < diff; i++) added.push(line)
  }
  for (const [line, cnt] of countA) {
    const diff = cnt - (countB.get(line) || 0)
    for (let i = 0; i < diff; i++) removed.push(line)
  }

  return { added, removed }
}

async function main() {
  console.log('=== AX Diff Live Test ===')
  console.log(`Binary: ${NOTIF_WATCH_PATH}`)
  console.log('Capturing initial snapshot...\n')

  let prev = await captureAXSnapshot()
  if (!prev) {
    console.error('Failed to capture initial snapshot. Check accessibility permissions.')
    process.exit(1)
  }

  console.log(`Focused app: ${prev.appName} (${prev.bundleId})`)
  console.log(`Tree nodes: ${prev.lines.length}`)
  console.log('\nPolling every 1s. Switch to a window and interact with it.\nPress Ctrl+C to stop.\n')
  console.log('---')

  let tick = 0

  const interval = setInterval(async () => {
    tick++
    const curr = await captureAXSnapshot()
    if (!curr) {
      console.log(`[${tick}s] snapshot failed (null)`)
      return
    }

    // App switched
    if (curr.bundleId !== prev!.bundleId) {
      console.log(`[${tick}s] APP SWITCHED: ${prev!.appName} -> ${curr.appName} (${curr.bundleId}), ${curr.lines.length} nodes`)
      prev = curr
      return
    }

    const diff = computeAXDiff(prev!.lines, curr.lines)

    if (diff.added.length === 0 && diff.removed.length === 0) {
      // No change, print a dot to show it's alive
      process.stdout.write('.')
      return
    }

    // Has changes
    console.log(`\n[${tick}s] CHANGE in ${curr.appName}: +${diff.added.length} -${diff.removed.length} (total: ${prev!.lines.length} -> ${curr.lines.length})`)

    if (diff.added.length > 0) {
      console.log('  ADDED:')
      for (const line of diff.added.slice(0, 30)) {
        console.log(`    + ${line}`)
      }
      if (diff.added.length > 30) {
        console.log(`    ... and ${diff.added.length - 30} more`)
      }
    }

    if (diff.removed.length > 0) {
      console.log('  REMOVED:')
      for (const line of diff.removed.slice(0, 30)) {
        console.log(`    - ${line}`)
      }
      if (diff.removed.length > 30) {
        console.log(`    ... and ${diff.removed.length - 30} more`)
      }
    }

    console.log('---')
    prev = curr
  }, 1000)

  process.on('SIGINT', () => {
    clearInterval(interval)
    console.log('\n\nStopped.')
    process.exit(0)
  })
}

main()
