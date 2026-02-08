export type Platform = 'darwin' | 'win32' | 'linux'

export interface NotificationEvent {
  type: 'notification'
  id: string
  appName: string
  bundleId?: string
  title: string
  body: string
  timestamp: number
}

export interface NotificationConfig {
  enabled: boolean
  appWhitelist?: string[]
  appBlacklist?: string[]
  diffApps?: string[]
}

export interface NotificationProvider {
  platform: Platform
  isAvailable(): Promise<boolean>
  start(onNotification: (event: NotificationEvent) => void): Promise<void>
  stop(): void
}
