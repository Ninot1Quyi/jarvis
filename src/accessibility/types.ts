/**
 * Accessibility Query Module - Type Definitions
 *
 * Cross-platform interface for querying UI elements via accessibility APIs.
 * Used to improve click accuracy by providing nearby element information.
 */

/** Supported platforms */
export type Platform = 'darwin' | 'win32' | 'linux'

/** UI element role (normalized across platforms) */
export type ElementRole =
  | 'button'
  | 'textfield'
  | 'statictext'
  | 'image'
  | 'checkbox'
  | 'radiobutton'
  | 'combobox'
  | 'list'
  | 'listitem'
  | 'menu'
  | 'menuitem'
  | 'tab'
  | 'tabgroup'
  | 'toolbar'
  | 'scrollbar'
  | 'slider'
  | 'link'
  | 'group'
  | 'window'
  | 'unknown'

/** A UI element with its accessibility information */
export interface AccessibilityElement {
  /** Normalized role (cross-platform) */
  role: ElementRole
  /** Raw role from platform API */
  rawRole: string
  /** Element title/label */
  title: string
  /** Element description (for accessibility) */
  description?: string
  /** Element value (for inputs, sliders, etc.) */
  value?: string
  /** Center position in screen pixels */
  center: [number, number]
  /** Size in pixels [width, height] */
  size: [number, number]
  /** Bounding box [x, y, width, height] */
  bounds: [number, number, number, number]
  /** Distance from query point (in pixels) */
  distance: number
  /** Whether the element is interactive */
  interactive: boolean
  /** Similarity score (for search results) */
  similarity?: number
}

/** Result of an accessibility query */
export interface AccessibilityQueryResult {
  /** Whether the query succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** The element directly at the query position (if any) */
  elementAtPoint?: AccessibilityElement
  /** Nearby elements sorted by distance */
  nearbyElements: AccessibilityElement[]
  /** Query position in screen pixels */
  queryPosition: [number, number]
  /** Time taken for the query in milliseconds */
  queryTimeMs: number
}

/** Result of a UI search */
export interface AccessibilitySearchResult {
  /** Whether the search succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Search results sorted by similarity */
  results: AccessibilityElement[]
  /** The search keyword used */
  searchKeyword: string
  /** Time taken for the search in milliseconds */
  queryTimeMs: number
}

/** Options for accessibility query */
export interface AccessibilityQueryOptions {
  /** Screen X coordinate (pixels) */
  x: number
  /** Screen Y coordinate (pixels) */
  y: number
  /** Maximum number of nearby elements to return */
  maxElements?: number
  /** Maximum distance (pixels) to search for nearby elements */
  maxDistance?: number
  /** Whether to include non-interactive elements */
  includeNonInteractive?: boolean
}

/** Options for UI search */
export interface AccessibilitySearchOptions {
  /** Search keyword */
  keyword: string
  /** Maximum number of results to return */
  maxResults?: number
}

/** Platform-specific accessibility provider interface */
export interface AccessibilityProvider {
  /** Platform identifier */
  platform: Platform
  /** Whether this provider is available on the current system */
  isAvailable(): Promise<boolean>
  /** Query elements at/near a position */
  query(options: AccessibilityQueryOptions): Promise<AccessibilityQueryResult>
  /** Search UI elements by keyword */
  search(options: AccessibilitySearchOptions): Promise<AccessibilitySearchResult>
}
