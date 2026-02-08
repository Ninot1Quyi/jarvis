import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const NOTIF_WATCH_PATH = join(__dirname, '..', '..', 'native', 'macos', 'notif-watch', '.build', 'release', 'notif-watch')

export interface AXSnapshot {
  appName: string
  bundleId: string
  lines: string[]
}

export async function captureAXSnapshot(): Promise<AXSnapshot | null> {
  if (process.platform !== 'darwin') return null
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
}

export function computeAXDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const setA = new Set(a)
  const setB = new Set(b)
  const added = b.filter(l => !setA.has(l))
  const removed = a.filter(l => !setB.has(l))
  return { added, removed }
}
