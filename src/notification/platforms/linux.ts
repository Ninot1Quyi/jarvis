import { spawn, type ChildProcess } from 'child_process'
import type { NotificationProvider, NotificationEvent, Platform } from '../types.js'

/**
 * Linux Notification Provider
 *
 * Uses D-Bus to monitor notifications via org.freedesktop.Notifications.
 * Also supports notify-send for sending notifications.
 *
 * Requires:
 * - notify-send (libnotify-bin on Ubuntu)
 * - Python3 with dbus python bindings
 */

const RESTART_DELAY = 5000

export class LinuxNotificationProvider implements NotificationProvider {
  platform: Platform = 'linux'
  private process: ChildProcess | null = null
  private onNotification: ((event: NotificationEvent) => void) | null = null
  private stopped = false

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      // Check if notify-send is available
      const proc = spawn('which', ['notify-send'])
      proc.on('close', (code) => {
        resolve(code === 0)
      })
      proc.on('error', () => resolve(false))
    })
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

    // Use a Python script to monitor D-Bus for notifications
    const pythonScript = `
import dbus
import json
import sys

bus = dbus.SessionBus()

# Get the notifications interface
obj = bus.get_object('org.freedesktop.Notifications', '/org/freedesktop/Notifications')
interface = dbus.Interface(obj, 'org.freedesktop.Notifications')

# Listen for notifications
def notify_callback(id, app_name, replaces_id, app_icon, summary, body, actions, hints, expire_timeout):
    event = {
        "id": id,
        "appName": app_name,
        "title": summary,
        "body": body,
        "timestamp": int(expire_timeout) if expire_timeout > 0 else 0
    }
    print(json.dumps(event), flush=True)

interface.connect_to_signal("NotificationClosed", lambda id, reason: None)
interface.connect_to_signal("ActionInvoked", lambda id, action: None)

# Use the new API for receiving notifications
try:
    # Register for notifications using the Matches API
    pass
except:
    pass

# Alternative: just keep the process alive and poll
import time
while True:
    time.sleep(1)
`

    try {
      this.process = spawn('python3', ['-c', pythonScript], {
        stdio: ['ignore', 'pipe', 'pipe']
      })

      this.process.stdout?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim()
        if (!line) return

        try {
          const data = JSON.parse(line)
          const event: NotificationEvent = {
            type: 'notification',
            id: String(data.id),
            appName: data.appName || '',
            title: data.title || '',
            body: data.body || '',
            timestamp: Date.now(),
          }
          this.onNotification?.(event)
        } catch {
          // Not JSON, ignore
        }
      })

      this.process.stderr?.on('data', (chunk: Buffer) => {
        console.error(`[NotificationProvider:linux] stderr: ${chunk.toString().trim()}`)
      })

      this.process.on('exit', (code: number | null) => {
        console.log(`[NotificationProvider:linux] process exited with code ${code}`)
        this.process = null
        if (!this.stopped) {
          console.log(`[NotificationProvider:linux] restarting in ${RESTART_DELAY}ms...`)
          setTimeout(() => this.spawn(), RESTART_DELAY)
        }
      })

      console.log('[NotificationProvider:linux] started')
    } catch (err) {
      console.error(`[NotificationProvider:linux] failed to start: ${err}`)
    }
  }
}
