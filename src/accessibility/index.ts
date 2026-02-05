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
  CaptureStateOptions,
  StateSnapshot,
  StateDiff,
  SnapshotElement,
  SnapshotWindow,
  SnapshotMenu,
  SnapshotApplication,
  WindowChange,
  MenuChange,
  TabChange,
  SnapshotTab,
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
  CaptureStateOptions,
  StateSnapshot,
  StateDiff,
  SnapshotElement,
  SnapshotWindow,
  SnapshotMenu,
  SnapshotApplication,
  WindowChange,
  MenuChange,
  TabChange,
  SnapshotTab,
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
    lines.push('  [WARNING] You clicked the macOS system menu bar. Use the app\'s internal toolbar instead.')
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

// ============================================================================
// State Snapshot Functions
// ============================================================================

/**
 * Capture a complete UI state snapshot
 *
 * @param options - Optional click position for elementAtPoint
 * @returns State snapshot
 */
export async function captureState(
  options?: CaptureStateOptions
): Promise<StateSnapshot> {
  const provider = await getProvider()

  if (!provider || !provider.captureState) {
    return {
      success: false,
      error: `State capture not available on ${process.platform}`,
      timestamp: Date.now(),
      windows: [],
      openMenus: [],
      queryTimeMs: 0,
    }
  }

  return provider.captureState(options)
}

/**
 * Compare two state snapshots and return the differences
 *
 * @param before - State snapshot before an action
 * @param after - State snapshot after an action
 * @returns Diff describing what changed
 */
export function diffState(before: StateSnapshot, after: StateSnapshot): StateDiff {
  const summary: string[] = []

  // Time delta
  const timeDeltaMs = (after.timestamp - before.timestamp) * 1000

  // Application change
  const applicationChanged =
    before.focusedApplication?.bundleIdentifier !== after.focusedApplication?.bundleIdentifier

  if (applicationChanged) {
    summary.push(
      `App changed: ${before.focusedApplication?.title || 'none'} → ${after.focusedApplication?.title || 'none'}`
    )
  }

  // Window focus change
  const windowFocusChanged =
    before.focusedWindow?.title !== after.focusedWindow?.title ||
    before.focusedWindow?.identifier !== after.focusedWindow?.identifier

  if (windowFocusChanged && !applicationChanged) {
    summary.push(
      `Window focus: ${before.focusedWindow?.title || 'none'} → ${after.focusedWindow?.title || 'none'}`
    )
  }

  // Focus element change
  const focusChanged = !elementsEqual(before.focusedElement, after.focusedElement)

  if (focusChanged) {
    const beforeDesc = describeElement(before.focusedElement)
    const afterDesc = describeElement(after.focusedElement)
    if (beforeDesc !== afterDesc) {
      summary.push(`Focus: ${beforeDesc} → ${afterDesc}`)
    }
  }

  // Clicked element change
  const clickedElementChanged = !elementsEqual(before.elementAtPoint, after.elementAtPoint)

  if (clickedElementChanged) {
    const beforeDesc = describeElement(before.elementAtPoint)
    const afterDesc = describeElement(after.elementAtPoint)
    if (beforeDesc !== afterDesc) {
      summary.push(`Element at click: ${beforeDesc} → ${afterDesc}`)
    }
  }

  // Busy state change detection
  const beforeBusy = before.focusedElement?.busy ?? false
  const afterBusy = after.focusedElement?.busy ?? false
  const busyStateChanged = beforeBusy !== afterBusy

  if (busyStateChanged) {
    if (afterBusy) {
      summary.push('Loading started')
    } else {
      summary.push('Loading finished')
    }
  }

  // Window state change detection (minimized/modal)
  let windowStateChanged = false

  // Check minimized state change on focused window
  const beforeMinimized = before.focusedWindow?.isMinimized ?? false
  const afterMinimized = after.focusedWindow?.isMinimized ?? false
  if (beforeMinimized !== afterMinimized) {
    windowStateChanged = true
    if (afterMinimized) {
      summary.push('Window minimized')
    } else {
      summary.push('Window restored')
    }
  }

  // Check modal state on focused window
  const beforeModal = before.focusedWindow?.isModal ?? false
  const afterModal = after.focusedWindow?.isModal ?? false
  if (beforeModal !== afterModal) {
    windowStateChanged = true
    if (afterModal) {
      summary.push('Modal dialog active')
    }
  }

  // Also check if any window in the list became modal
  for (const w of after.windows) {
    if (w.isModal) {
      const beforeWindow = before.windows.find(bw => bw.identifier === w.identifier || bw.title === w.title)
      if (!beforeWindow?.isModal) {
        windowStateChanged = true
        if (!afterModal) { // Avoid duplicate message
          summary.push(`Modal dialog active: ${w.title || 'untitled'}`)
        }
        break
      }
    }
  }

  // Window changes
  const beforeWindowTitles = new Set(before.windows.map(w => w.title || w.identifier || ''))
  const afterWindowTitles = new Set(after.windows.map(w => w.title || w.identifier || ''))

  const windowsOpened: WindowChange[] = []
  const windowsClosed: WindowChange[] = []
  const windowChanges: WindowChange[] = []

  for (const w of after.windows) {
    const key = w.title || w.identifier || ''
    if (!beforeWindowTitles.has(key)) {
      windowsOpened.push({
        type: 'opened',
        title: w.title,
        position: w.x !== undefined && w.y !== undefined ? [w.x, w.y] : undefined,
        size: w.width !== undefined && w.height !== undefined ? [w.width, w.height] : undefined,
      })
      summary.push(`Window opened: ${w.title || 'untitled'}`)
    }
  }

  for (const w of before.windows) {
    const key = w.title || w.identifier || ''
    if (!afterWindowTitles.has(key)) {
      windowsClosed.push({
        type: 'closed',
        title: w.title,
      })
      summary.push(`Window closed: ${w.title || 'untitled'}`)
    }
  }

  // Menu changes
  const beforeMenuTitles = new Set(before.openMenus.map(m => m.title || ''))
  const afterMenuTitles = new Set(after.openMenus.map(m => m.title || ''))

  const menusOpened: MenuChange[] = []
  const menusClosed: MenuChange[] = []

  for (const m of after.openMenus) {
    const key = m.title || ''
    if (!beforeMenuTitles.has(key) || before.openMenus.length === 0) {
      menusOpened.push({
        type: 'opened',
        title: m.title,
        items: m.items,
        position: m.x !== undefined && m.y !== undefined ? [m.x, m.y] : undefined,
      })
      summary.push(`Menu opened: ${m.title || 'popup'}${m.items ? ` (${m.items.length} items)` : ''}`)
    }
  }

  for (const m of before.openMenus) {
    const key = m.title || ''
    if (!afterMenuTitles.has(key) || after.openMenus.length === 0) {
      menusClosed.push({
        type: 'closed',
        title: m.title,
      })
      summary.push(`Menu closed: ${m.title || 'popup'}`)
    }
  }

  // Tab changes
  const beforeTabs = before.tabs || []
  const afterTabs = after.tabs || []

  const beforeTabTitles = new Set(beforeTabs.map(t => t.title || ''))
  const afterTabTitles = new Set(afterTabs.map(t => t.title || ''))

  const tabsOpened: TabChange[] = []
  const tabsClosed: TabChange[] = []

  for (const t of afterTabs) {
    const key = t.title || ''
    if (key && !beforeTabTitles.has(key)) {
      tabsOpened.push({
        type: 'opened',
        title: t.title,
        url: t.url,
      })
      summary.push(`Tab opened: ${t.title || 'untitled'}`)
    }
  }

  for (const t of beforeTabs) {
    const key = t.title || ''
    if (key && !afterTabTitles.has(key)) {
      tabsClosed.push({
        type: 'closed',
        title: t.title,
        url: t.url,
      })
      summary.push(`Tab closed: ${t.title || 'untitled'}`)
    }
  }

  // Active tab change
  const beforeActiveTab = beforeTabs.find(t => t.isSelected || t.isActive)
  const afterActiveTab = afterTabs.find(t => t.isSelected || t.isActive)
  const activeTabChanged = beforeActiveTab?.title !== afterActiveTab?.title

  if (activeTabChanged && beforeActiveTab && afterActiveTab) {
    summary.push(`Active tab: ${beforeActiveTab.title || 'none'} -> ${afterActiveTab.title || 'none'}`)
  }

  // Sheet/dialog changes (handle undefined for backwards compatibility)
  const beforeSheets = before.sheets || []
  const afterSheets = after.sheets || []
  const beforeSheetTitles = new Set(beforeSheets.map(s => s.title || s.identifier || ''))
  const afterSheetTitles = new Set(afterSheets.map(s => s.title || s.identifier || ''))

  const sheetsOpened: WindowChange[] = []
  const sheetsClosed: WindowChange[] = []

  for (const s of afterSheets) {
    const key = s.title || s.identifier || ''
    if (!beforeSheetTitles.has(key)) {
      sheetsOpened.push({
        type: 'opened',
        title: s.title,
        position: s.x !== undefined && s.y !== undefined ? [s.x, s.y] : undefined,
        size: s.width !== undefined && s.height !== undefined ? [s.width, s.height] : undefined,
      })
      summary.push(`Dialog opened: ${s.title || 'untitled'}`)
    }
  }

  for (const s of beforeSheets) {
    const key = s.title || s.identifier || ''
    if (!afterSheetTitles.has(key)) {
      sheetsClosed.push({
        type: 'closed',
        title: s.title,
      })
      summary.push(`Dialog closed: ${s.title || 'untitled'}`)
    }
  }

  // Expanded state change detection
  let expandedChanged = false
  let expandedBefore: boolean | undefined
  let expandedAfter: boolean | undefined
  let expandedElement: SnapshotElement | undefined

  if (before.focusedElement && after.focusedElement) {
    const beforeExpanded = before.focusedElement.expanded
    const afterExpanded = after.focusedElement.expanded

    if (beforeExpanded !== afterExpanded && (beforeExpanded !== undefined || afterExpanded !== undefined)) {
      expandedChanged = true
      expandedBefore = beforeExpanded
      expandedAfter = afterExpanded
      expandedElement = after.focusedElement

      const elementDesc = describeElement(after.focusedElement)
      summary.push(`Expanded: ${elementDesc} ${beforeExpanded ?? 'undefined'}->${afterExpanded ?? 'undefined'}`)
    }
  }

  // Value change detection (for text fields, etc.)
  let valueChanged = false
  let valueBefore: string | undefined
  let valueAfter: string | undefined

  if (before.focusedElement && after.focusedElement) {
    const beforeValue = before.focusedElement.value
    const afterValue = after.focusedElement.value

    if (beforeValue !== afterValue) {
      valueChanged = true
      valueBefore = beforeValue
      valueAfter = afterValue

      const elementDesc = describeElement(after.focusedElement)
      // Truncate long values for summary
      const beforeShort = beforeValue ? (beforeValue.length > 20 ? beforeValue.slice(0, 20) + '...' : beforeValue) : 'empty'
      const afterShort = afterValue ? (afterValue.length > 20 ? afterValue.slice(0, 20) + '...' : afterValue) : 'empty'
      summary.push(`Value changed: ${elementDesc} "${beforeShort}"->"${afterShort}"`)
    }
  }

  // Enabled state change detection
  let enabledChanged = false
  let enabledBefore: boolean | undefined
  let enabledAfter: boolean | undefined

  if (before.focusedElement && after.focusedElement) {
    const beforeEnabled = before.focusedElement.enabled
    const afterEnabled = after.focusedElement.enabled

    if (beforeEnabled !== afterEnabled && (beforeEnabled !== undefined || afterEnabled !== undefined)) {
      enabledChanged = true
      enabledBefore = beforeEnabled
      enabledAfter = afterEnabled

      const elementDesc = describeElement(after.focusedElement)
      summary.push(`Enabled: ${elementDesc} ${beforeEnabled ?? 'undefined'}->${afterEnabled ?? 'undefined'}`)
    }
  }

  // Selection change detection
  let selectionChanged = false
  let selectionCountBefore: number | undefined
  let selectionCountAfter: number | undefined
  let selectionTitlesBefore: string[] | undefined
  let selectionTitlesAfter: string[] | undefined

  const beforeSelections = before.selections || []
  const afterSelections = after.selections || []

  // Compare first selection (most common case)
  const beforeSel = beforeSelections[0]
  const afterSel = afterSelections[0]

  if (beforeSel || afterSel) {
    const beforeCount = beforeSel?.selectedCount ?? 0
    const afterCount = afterSel?.selectedCount ?? 0
    const beforeTitles = beforeSel?.selectedTitles ?? []
    const afterTitles = afterSel?.selectedTitles ?? []

    // Check if selection changed
    if (beforeCount !== afterCount ||
        JSON.stringify(beforeTitles) !== JSON.stringify(afterTitles)) {
      selectionChanged = true
      selectionCountBefore = beforeCount
      selectionCountAfter = afterCount
      selectionTitlesBefore = beforeTitles
      selectionTitlesAfter = afterTitles

      if (beforeCount !== afterCount) {
        summary.push(`Selection: ${beforeCount} -> ${afterCount} items`)
      } else {
        summary.push(`Selection changed: ${afterTitles.slice(0, 3).join(', ')}${afterTitles.length > 3 ? '...' : ''}`)
      }
    }
  }

  // Selected text change detection
  let selectedTextChanged = false
  let selectedTextBefore: string | undefined
  let selectedTextAfter: string | undefined

  if (before.focusedElement && after.focusedElement) {
    const beforeText = before.focusedElement.selectedText
    const afterText = after.focusedElement.selectedText

    if (beforeText !== afterText) {
      selectedTextChanged = true
      selectedTextBefore = beforeText
      selectedTextAfter = afterText

      const beforeShort = beforeText ? (beforeText.length > 20 ? beforeText.slice(0, 20) + '...' : beforeText) : 'none'
      const afterShort = afterText ? (afterText.length > 20 ? afterText.slice(0, 20) + '...' : afterText) : 'none'
      summary.push(`Selected text: "${beforeShort}" -> "${afterShort}"`)
    }
  }

  // Browser columns change detection (Finder column view)
  let browserColumnsChanged = false
  let browserColumnCountBefore: number | undefined
  let browserColumnCountAfter: number | undefined

  const beforeColumns = before.browserColumns || []
  const afterColumns = after.browserColumns || []

  if (beforeColumns.length !== afterColumns.length) {
    browserColumnsChanged = true
    browserColumnCountBefore = beforeColumns.length
    browserColumnCountAfter = afterColumns.length
    summary.push(`Browser columns: ${beforeColumns.length} -> ${afterColumns.length}`)
  } else if (beforeColumns.length > 0) {
    // Check if selected items changed
    const beforeSelected = beforeColumns.map(c => c.selectedItem).join('/')
    const afterSelected = afterColumns.map(c => c.selectedItem).join('/')
    if (beforeSelected !== afterSelected) {
      browserColumnsChanged = true
      browserColumnCountBefore = beforeColumns.length
      browserColumnCountAfter = afterColumns.length
      const lastAfter = afterColumns[afterColumns.length - 1]
      summary.push(`Browser navigation: ${lastAfter?.selectedItem || 'none'}`)
    }
  }

  // If nothing changed, note that
  if (summary.length === 0) {
    summary.push('No significant UI changes detected')
  }

  return {
    timeDeltaMs,
    applicationChanged,
    applicationBefore: applicationChanged ? before.focusedApplication : undefined,
    applicationAfter: applicationChanged ? after.focusedApplication : undefined,
    windowFocusChanged,
    focusedWindowBefore: windowFocusChanged ? before.focusedWindow : undefined,
    focusedWindowAfter: windowFocusChanged ? after.focusedWindow : undefined,
    focusChanged,
    focusedElementBefore: focusChanged ? before.focusedElement : undefined,
    focusedElementAfter: focusChanged ? after.focusedElement : undefined,
    clickedElementChanged,
    clickedElementBefore: clickedElementChanged ? before.elementAtPoint : undefined,
    clickedElementAfter: clickedElementChanged ? after.elementAtPoint : undefined,
    busyStateChanged,
    windowStateChanged,
    windowsOpened,
    windowsClosed,
    windowChanges,
    menusOpened,
    menusClosed,
    tabsOpened,
    tabsClosed,
    activeTabChanged,
    activeTabBefore: activeTabChanged ? beforeActiveTab?.title : undefined,
    activeTabAfter: activeTabChanged ? afterActiveTab?.title : undefined,
    sheetsOpened,
    sheetsClosed,
    expandedChanged,
    expandedBefore: expandedChanged ? expandedBefore : undefined,
    expandedAfter: expandedChanged ? expandedAfter : undefined,
    expandedElement: expandedChanged ? expandedElement : undefined,
    valueChanged,
    valueBefore: valueChanged ? valueBefore : undefined,
    valueAfter: valueChanged ? valueAfter : undefined,
    enabledChanged,
    enabledBefore: enabledChanged ? enabledBefore : undefined,
    enabledAfter: enabledChanged ? enabledAfter : undefined,
    selectionChanged,
    selectionCountBefore: selectionChanged ? selectionCountBefore : undefined,
    selectionCountAfter: selectionChanged ? selectionCountAfter : undefined,
    selectionTitlesBefore: selectionChanged ? selectionTitlesBefore : undefined,
    selectionTitlesAfter: selectionChanged ? selectionTitlesAfter : undefined,
    selectedTextChanged,
    selectedTextBefore: selectedTextChanged ? selectedTextBefore : undefined,
    selectedTextAfter: selectedTextChanged ? selectedTextAfter : undefined,
    browserColumnsChanged,
    browserColumnCountBefore: browserColumnsChanged ? browserColumnCountBefore : undefined,
    browserColumnCountAfter: browserColumnsChanged ? browserColumnCountAfter : undefined,
    summary,
  }
}

/**
 * Format a state diff for display to the agent
 *
 * @param diff - The state diff to format
 * @returns Human-readable string describing the changes
 */
export function formatDiffForAgent(diff: StateDiff): string {
  if (diff.summary.length === 1 && diff.summary[0] === 'No significant UI changes detected') {
    return `<reminder>
[WARNING] The previous action did NOT produce any GUI changes. Please analyze:
1. Did you click the correct position? Check if the target element exists at that coordinate.
2. Was the click type correct? (single click vs double click vs right click)
3. Is the element clickable? Some elements may be disabled or non-interactive.
4. Should you try a different approach? (e.g., use hotkey instead of click, or find_element to locate the correct position)
Avoid repeating the same action - try a different method to prevent getting stuck in a loop.
</reminder>`
  }

  const lines: string[] = ['UI Changes:']

  for (const item of diff.summary) {
    lines.push(`  • ${item}`)
  }

  // Add details for menu items if a menu was opened
  if (diff.menusOpened.length > 0) {
    for (const menu of diff.menusOpened) {
      if (menu.items && menu.items.length > 0) {
        lines.push(`  Menu items: ${menu.items.slice(0, 5).join(', ')}${menu.items.length > 5 ? '...' : ''}`)
      }
    }
  }

  return lines.join('\n')
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if two snapshot elements are equal
 */
function elementsEqual(a?: SnapshotElement, b?: SnapshotElement): boolean {
  if (!a && !b) return true
  if (!a || !b) return false

  return (
    a.role === b.role &&
    a.title === b.title &&
    a.value === b.value &&
    a.focused === b.focused &&
    a.selected === b.selected &&
    a.expanded === b.expanded
  )
}

/**
 * Create a short description of an element
 */
function describeElement(el?: SnapshotElement): string {
  if (!el) return 'none'

  const parts: string[] = []

  // Role (simplified)
  const role = el.role.replace('AX', '')
  parts.push(role)

  // Title or value
  if (el.title) {
    parts.push(`"${el.title.slice(0, 30)}${el.title.length > 30 ? '...' : ''}"`)
  } else if (el.value) {
    const val = el.value.slice(0, 20)
    parts.push(`[${val}${el.value.length > 20 ? '...' : ''}]`)
  }

  // State indicators
  const states: string[] = []
  if (el.focused) states.push('focused')
  if (el.selected) states.push('selected')
  if (el.expanded) states.push('expanded')
  if (states.length > 0) {
    parts.push(`(${states.join(', ')})`)
  }

  return parts.join(' ')
}
