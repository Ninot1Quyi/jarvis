import type { NotificationProvider, NotificationEvent, Platform } from '../types.js'

export class WindowsNotificationProvider implements NotificationProvider {
  platform: Platform = 'win32'

  async isAvailable(): Promise<boolean> {
    return false
  }

  async start(_onNotification: (event: NotificationEvent) => void): Promise<void> {
    console.log('[NotificationProvider:win32] not implemented')
  }

  stop(): void {}
}
