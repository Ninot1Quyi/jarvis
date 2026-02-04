/**
 * Accessibility Query Module
 *
 * Cross-platform interface for querying UI elements via accessibility APIs.
 * Provides nearby element information to improve click accuracy.
 */

import type {
  Platform,
  AccessibilityProvider,
  AccessibilityQueryOptions,
  AccessibilityQueryResult,
  AccessibilitySearchOptions,
  AccessibilitySearchResult,
  AccessibilityElement,
  ElementRole,
} from './types.js'

// Re-export types
export type {
  Platform,
  AccessibilityProvider,
  AccessibilityQueryOptions,
  AccessibilityQueryResult,
  AccessibilitySearchOptions,
  AccessibilitySearchResult,
  AccessibilityElement,
  ElementRole,
}

// Platform providers (lazy loaded)
let currentProvider: AccessibilityProvider | null = null
let providerChecked = false

/**
 * Get the accessibility provider for the current platform
 */
async function getProvider(): Promise<AccessibilityProvider | null> {
  if (providerChecked) {
    return currentProvider
  }

  providerChecked = true
  const platform = process.platform as Platform

  try {
    switch (platform) {
      case 'darwin': {
        const { provider } = await import('./platforms/macos.js')
        if (await provider.isAvailable()) {
          currentProvider = provider
        }
        break
      }
      case 'win32': {
        const { provider } = await import('./platforms/windows.js')
        if (await provider.isAvailable()) {
          currentProvider = provider
        }
        break
      }
      case 'linux': {
        const { provider } = await import('./platforms/linux.js')
        if (await provider.isAvailable()) {
          currentProvider = provider
        }
        break
      }
    }
  } catch (error) {
    console.warn(`[accessibility] Failed to load provider for ${platform}:`, error)
  }

  return currentProvider
}

/**
 * Check if accessibility features are available on the current platform
 */
export async function isAccessibilityAvailable(): Promise<boolean> {
  const provider = await getProvider()
  return provider !== null
}

/**
 * Query UI elements near a screen position
 *
 * @param x - Screen X coordinate in pixels
 * @param y - Screen Y coordinate in pixels
 * @param options - Query options
 * @returns Query result with nearby elements
 */
export async function queryNearbyElements(
  x: number,
  y: number,
  options: Partial<Omit<AccessibilityQueryOptions, 'x' | 'y'>> = {}
): Promise<AccessibilityQueryResult> {
  const provider = await getProvider()

  if (!provider) {
    return {
      success: false,
      error: `Accessibility not available on ${process.platform}`,
      nearbyElements: [],
      queryPosition: [x, y],
      queryTimeMs: 0,
    }
  }

  return provider.query({
    x,
    y,
    maxElements: options.maxElements ?? 5,
    maxDistance: options.maxDistance ?? 200,
    includeNonInteractive: options.includeNonInteractive ?? false,
  })
}

/**
 * Format accessibility query result for display to the agent
 *
 * @param result - Query result
 * @param screenWidth - Screen width for coordinate normalization
 * @param screenHeight - Screen height for coordinate normalization
 * @returns Formatted string for agent consumption
 */
export function formatResultForAgent(
  result: AccessibilityQueryResult,
  screenWidth: number,
  screenHeight: number
): string {
  if (!result.success || result.nearbyElements.length === 0) {
    return ''
  }

  const lines: string[] = ['', 'Nearby UI elements:']

  // Helper to convert screen pixels to normalized [0, 1000] coordinates
  const toNormalized = (x: number, y: number): [number, number] => [
    Math.round((x / screenWidth) * 1000),
    Math.round((y / screenHeight) * 1000),
  ]

  // Check if click was in macOS menu bar area (top ~30 pixels)
  const [, clickY] = result.queryPosition
  const menuBarThreshold = 30
  if (clickY < menuBarThreshold && process.platform === 'darwin') {
    lines.push('  ⚠ WARNING: You clicked the macOS system menu bar. Use the app\'s internal toolbar instead.')
  }

  for (const el of result.nearbyElements) {
    const [normX, normY] = toNormalized(el.center[0], el.center[1])
    const roleDisplay = el.role === 'unknown' ? el.rawRole : el.role
    const titleDisplay = el.title ? `"${el.title}"` : '(no title)'
    const interactiveMarker = el.interactive ? '*' : '-'

    lines.push(
      `  ${interactiveMarker} [${roleDisplay}] ${titleDisplay} [${normX}, ${normY}]`
    )
  }

  return lines.join('\n')
}

/**
 * Simplify nearby elements for JSON output (remove unnecessary fields)
 *
 * @param elements - Raw elements from query
 * @param screenWidth - Screen width for coordinate normalization
 * @param screenHeight - Screen height for coordinate normalization
 * @returns Simplified elements array
 */
export function simplifyElementsForData(
  elements: AccessibilityElement[],
  screenWidth: number,
  screenHeight: number
): Array<{ role: string; title: string; coordinate: [number, number] }> {
  const toNormalized = (x: number, y: number): [number, number] => [
    Math.round((x / screenWidth) * 1000),
    Math.round((y / screenHeight) * 1000),
  ]

  return elements.map(el => ({
    role: el.role === 'unknown' ? el.rawRole : el.role,
    title: el.title || '',
    coordinate: toNormalized(el.center[0], el.center[1]),
  }))
}

/**
 * Search UI elements by keyword in the focused application
 *
 * @param keyword - Search keyword
 * @param options - Search options
 * @returns Search result with matching elements
 */
export async function searchUIElements(
  keyword: string,
  options: Partial<Omit<AccessibilitySearchOptions, 'keyword'>> = {}
): Promise<AccessibilitySearchResult> {
  const provider = await getProvider()

  if (!provider) {
    return {
      success: false,
      error: `Accessibility not available on ${process.platform}`,
      results: [],
      searchKeyword: keyword,
      queryTimeMs: 0,
    }
  }

  return provider.search({
    keyword,
    maxResults: options.maxResults ?? 5,
  })
}

/**
 * Format search result for display to the agent
 *
 * @param result - Search result
 * @param screenWidth - Screen width for coordinate normalization
 * @param screenHeight - Screen height for coordinate normalization
 * @returns Formatted string for agent consumption
 */
export function formatSearchResultForAgent(
  result: AccessibilitySearchResult,
  screenWidth: number,
  screenHeight: number
): string {
  if (!result.success) {
    return `Search failed: ${result.error}`
  }

  if (result.results.length === 0) {
    return `No UI elements found matching "${result.searchKeyword}"`
  }

  const lines: string[] = [`Found ${result.results.length} UI elements matching "${result.searchKeyword}":`]

  // Helper to convert screen pixels to normalized [0, 1000] coordinates
  const toNormalized = (x: number, y: number): [number, number] => [
    Math.round((x / screenWidth) * 1000),
    Math.round((y / screenHeight) * 1000),
  ]

  for (const el of result.results) {
    const [normX, normY] = toNormalized(el.center[0], el.center[1])
    const roleDisplay = el.role === 'unknown' ? el.rawRole : el.role
    const titleDisplay = el.title ? `"${el.title}"` : '(no title)'
    const similarityDisplay = el.similarity ? ` (${Math.round(el.similarity * 100)}% match)` : ''

    lines.push(
      `  * [${roleDisplay}] ${titleDisplay} [${normX}, ${normY}]${similarityDisplay}`
    )
  }

  return lines.join('\n')
}
