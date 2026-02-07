import type { NotificationProvider } from './types.js'

let currentProvider: NotificationProvider | null = null

export async function getProvider(): Promise<NotificationProvider> {
  if (currentProvider) return currentProvider

  switch (process.platform) {
    case 'darwin': {
      const { MacOSNotificationProvider } = await import('./platforms/macos.js')
      currentProvider = new MacOSNotificationProvider()
      break
    }
    case 'win32': {
      const { WindowsNotificationProvider } = await import('./platforms/windows.js')
      currentProvider = new WindowsNotificationProvider()
      break
    }
    case 'linux': {
      const { LinuxNotificationProvider } = await import('./platforms/linux.js')
      currentProvider = new LinuxNotificationProvider()
      break
    }
    default:
      throw new Error(`Unsupported platform: ${process.platform}`)
  }

  return currentProvider
}

export type { NotificationEvent, NotificationConfig, NotificationProvider, Platform } from './types.js'
