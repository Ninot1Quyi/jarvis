import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'
import type { NotificationProvider, NotificationEvent, Platform } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const NOTIF_WATCH_PATH = join(__dirname, '..', '..', '..', 'native', 'macos', 'notif-watch', '.build', 'release', 'notif-watch')

const RESTART_DELAY = 5000

export class MacOSNotificationProvider implements NotificationProvider {
  platform: Platform = 'darwin'
  private process: ChildProcess | null = null
  private onNotification: ((event: NotificationEvent) => void) | null = null
  private stopped = false

  async isAvailable(): Promise<boolean> {
    return existsSync(NOTIF_WATCH_PATH)
  }

  async start(onNotification: (event: NotificationEvent) => void): Promise<void> {
    this.onNotification = onNotification
    this.stopped = false
    this.spawn()
  }

  stop(): void {
    this.stopped = true
    this.onNotification = null
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }

  private spawn(): void {
    if (this.stopped) return

    if (!existsSync(NOTIF_WATCH_PATH)) {
      console.error(`[NotificationProvider:darwin] binary not found: ${NOTIF_WATCH_PATH}`)
      return
    }

    this.process = spawn(NOTIF_WATCH_PATH, [], { stdio: ['ignore', 'pipe', 'pipe'] })

    const rl = createInterface({ input: this.process.stdout! })
    rl.on('line', (line: string) => {
      if (!line.trim()) return
      try {
        const data = JSON.parse(line)
        if (data.error) {
          console.error(`[NotificationProvider:darwin] error: ${data.error}`)
          return
        }
        // Skip status messages
        if (data.status) {
          console.log(`[NotificationProvider:darwin] ${data.status} (NC pid: ${data.pid})`)
          return
        }
        const event: NotificationEvent = {
          id: data.id,
          appName: data.appName,
          bundleId: data.bundleId,
          title: data.title,
          body: data.body,
          timestamp: data.timestamp,
        }
        this.onNotification?.(event)
      } catch {
        console.error(`[NotificationProvider:darwin] failed to parse: ${line}`)
      }
    })

    this.process.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[NotificationProvider:darwin] stderr: ${chunk.toString().trim()}`)
    })

    this.process.on('exit', (code: number | null) => {
      console.log(`[NotificationProvider:darwin] process exited with code ${code}`)
      this.process = null
      if (!this.stopped) {
        console.log(`[NotificationProvider:darwin] restarting in ${RESTART_DELAY}ms...`)
        setTimeout(() => this.spawn(), RESTART_DELAY)
      }
    })

    console.log('[NotificationProvider:darwin] started')
  }
}
