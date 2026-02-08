import { getProvider } from './index.js'
import { messageLayer } from '../message/MessageLayer.js'
import type { NotificationConfig, NotificationEvent, NotificationProvider } from './types.js'

export class NotificationService {
  private config: NotificationConfig
  private provider: NotificationProvider | null = null

  constructor(config: NotificationConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    try {
      this.provider = await getProvider()
      const available = await this.provider.isAvailable()
      if (!available) {
        console.log('[NotificationService] provider not available on this platform')
        return
      }

      await this.provider.start(
        (event: NotificationEvent) => this.handleNotification(event),
      )
      console.log('[NotificationService] started')
    } catch (error) {
      console.error('[NotificationService] failed to start:', error)
    }
  }

  stop(): void {
    if (this.provider) {
      this.provider.stop()
      this.provider = null
    }
    console.log('[NotificationService] stopped')
  }

  private handleNotification(event: NotificationEvent): void {
    if (!this.passesFilter(event)) return

    const time = new Date(event.timestamp * 1000).toLocaleString()
    const formatted = `[App: ${event.appName}] [Time: ${time}] [Title: ${event.title}]\n${event.body}`

    messageLayer.push('notification', formatted)
  }

  private passesFilter(event: NotificationEvent): boolean {
    const { appWhitelist, appBlacklist } = this.config

    if (appBlacklist && appBlacklist.length > 0) {
      const blocked = appBlacklist.some(
        name => event.appName.toLowerCase() === name.toLowerCase()
          || (event.bundleId && event.bundleId.toLowerCase() === name.toLowerCase())
      )
      if (blocked) return false
    }

    if (appWhitelist && appWhitelist.length > 0) {
      const allowed = appWhitelist.some(
        name => event.appName.toLowerCase() === name.toLowerCase()
          || (event.bundleId && event.bundleId.toLowerCase() === name.toLowerCase())
      )
      if (!allowed) return false
    }

    return true
  }
}
