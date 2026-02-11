import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const NOTIF_WATCH_PATH = join(__dirname, '..', '..', 'native', 'macos', 'notif-watch', '.build', 'release', 'notif-watch')
const UIA_QUERY_PATH = join(__dirname, '..', '..', 'native', 'windows', 'uia-query.ps1')

export interface AXSnapshot {
  appName: string
  bundleId: string
  lines: string[]
}

export async function captureAXSnapshot(): Promise<AXSnapshot | null> {
  if (process.platform === 'darwin') {
    if (!existsSync(NOTIF_WATCH_PATH)) return null
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
  } else if (process.platform === 'win32') {
    if (!existsSync(UIA_QUERY_PATH)) return null
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', UIA_QUERY_PATH, '-axlines'], { timeout: 15000 }, (error, stdout) => {
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
  } else {
    return null
  }
}

export function computeAXDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
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

/**
 * Extract the "skeleton" of a line: role + automationId (d= field).
 * Two lines with the same skeleton represent the same UI element
 * whose name/value changed (UI refresh noise), not new content.
 */
function lineSkeleton(line: string): string {
  const parts = line.split('|')
  const role = parts[0] || ''
  let did = ''
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith('d=')) { did = parts[i]; break }
  }
  return did ? `${role}|${did}` : ''
}

/**
 * Filter out UI refresh noise from an AX diff.
 *
 * Noise pattern: an element's name/value changes between snapshots,
 * producing a matched pair in added+removed with the same role+automationId.
 * Real new content (e.g. IM messages) appears as added lines with no
 * corresponding removed skeleton.
 *
 * Returns only the genuinely new added lines.
 */
export function filterDiffNoise(diff: { added: string[]; removed: string[] }): string[] {
  // Build a bag of removed skeletons
  const removedSkeletons = new Map<string, number>()
  for (const line of diff.removed) {
    const sk = lineSkeleton(line)
    if (sk) removedSkeletons.set(sk, (removedSkeletons.get(sk) || 0) + 1)
  }

  const genuine: string[] = []
  for (const line of diff.added) {
    const sk = lineSkeleton(line)
    if (sk) {
      // Has automationId -- check if a removed line has the same skeleton
      const cnt = removedSkeletons.get(sk) || 0
      if (cnt > 0) {
        // This is a UI refresh (same element, different text), cancel it out
        removedSkeletons.set(sk, cnt - 1)
        continue
      }
    }
    // No automationId or no matching removed skeleton -> genuinely new
    genuine.push(line)
  }
  return genuine
}
