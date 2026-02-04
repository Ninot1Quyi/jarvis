/**
 * Linux Accessibility Provider (Placeholder)
 *
 * TODO: Implement using AT-SPI2
 */

import type {
  AccessibilityProvider,
  AccessibilityQueryOptions,
  AccessibilityQueryResult,
  AccessibilitySearchOptions,
  AccessibilitySearchResult,
} from '../types.js'

export class LinuxAccessibilityProvider implements AccessibilityProvider {
  platform = 'linux' as const

  async isAvailable(): Promise<boolean> {
    return false
  }

  async query(options: AccessibilityQueryOptions): Promise<AccessibilityQueryResult> {
    return {
      success: false,
      error: 'Linux accessibility provider not implemented yet',
      nearbyElements: [],
      queryPosition: [options.x, options.y],
      queryTimeMs: 0,
    }
  }

  async search(options: AccessibilitySearchOptions): Promise<AccessibilitySearchResult> {
    return {
      success: false,
      error: 'Linux accessibility provider not implemented yet',
      results: [],
      searchKeyword: options.keyword,
      queryTimeMs: 0,
    }
  }
}

export const provider = new LinuxAccessibilityProvider()
