/**
 * Windows Accessibility Provider (Placeholder)
 *
 * TODO: Implement using UI Automation API
 */

import type {
  AccessibilityProvider,
  AccessibilityQueryOptions,
  AccessibilityQueryResult,
  AccessibilitySearchOptions,
  AccessibilitySearchResult,
} from '../types.js'

export class WindowsAccessibilityProvider implements AccessibilityProvider {
  platform = 'win32' as const

  async isAvailable(): Promise<boolean> {
    return false
  }

  async query(options: AccessibilityQueryOptions): Promise<AccessibilityQueryResult> {
    return {
      success: false,
      error: 'Windows accessibility provider not implemented yet',
      nearbyElements: [],
      queryPosition: [options.x, options.y],
      queryTimeMs: 0,
    }
  }

  async search(options: AccessibilitySearchOptions): Promise<AccessibilitySearchResult> {
    return {
      success: false,
      error: 'Windows accessibility provider not implemented yet',
      results: [],
      searchKeyword: options.keyword,
      queryTimeMs: 0,
    }
  }
}

export const provider = new WindowsAccessibilityProvider()
