import type { NotificationProvider, NotificationEvent, Platform } from '../types.js'

export class LinuxNotificationProvider implements NotificationProvider {
  platform: Platform = 'linux'

  async isAvailable(): Promise<boolean> {
    return false
  }

  async start(_onNotification: (event: NotificationEvent) => void): Promise<void> {
    console.log('[NotificationProvider:linux] not implemented')
  }

  stop(): void {}
}
