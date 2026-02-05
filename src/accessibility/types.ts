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

/**
 * macOS Accessibility Roles (from AXRoleConstants.h)
 * Complete list of standard roles defined in macOS SDK
 */
export type AXRole =
  | 'AXApplication'
  | 'AXSystemWide'
  | 'AXWindow'
  | 'AXSheet'
  | 'AXDrawer'
  | 'AXGrowArea'
  | 'AXImage'
  | 'AXUnknown'
  | 'AXButton'
  | 'AXRadioButton'
  | 'AXCheckBox'
  | 'AXPopUpButton'
  | 'AXMenuButton'
  | 'AXTabGroup'
  | 'AXTable'
  | 'AXColumn'
  | 'AXRow'
  | 'AXOutline'
  | 'AXBrowser'
  | 'AXScrollArea'
  | 'AXScrollBar'
  | 'AXRadioGroup'
  | 'AXList'
  | 'AXGroup'
  | 'AXValueIndicator'
  | 'AXComboBox'
  | 'AXSlider'
  | 'AXIncrementor'
  | 'AXBusyIndicator'
  | 'AXProgressIndicator'
  | 'AXRelevanceIndicator'
  | 'AXToolbar'
  | 'AXDisclosureTriangle'
  | 'AXTextField'
  | 'AXTextArea'
  | 'AXStaticText'
  | 'AXHeading'
  | 'AXMenuBar'
  | 'AXMenuBarItem'
  | 'AXMenu'
  | 'AXMenuItem'
  | 'AXSplitGroup'
  | 'AXSplitter'
  | 'AXColorWell'
  | 'AXTimeField'
  | 'AXDateField'
  | 'AXHelpTag'
  | 'AXMatte'
  | 'AXDockItem'
  | 'AXRuler'
  | 'AXRulerMarker'
  | 'AXGrid'
  | 'AXLevelIndicator'
  | 'AXCell'
  | 'AXLayoutArea'
  | 'AXLayoutItem'
  | 'AXHandle'
  | 'AXPopover'

/**
 * macOS Accessibility Subroles (from AXRoleConstants.h)
 */
export type AXSubrole =
  // Standard subroles
  | 'AXCloseButton'
  | 'AXMinimizeButton'
  | 'AXZoomButton'
  | 'AXToolbarButton'
  | 'AXFullScreenButton'
  | 'AXSecureTextField'
  | 'AXTableRow'
  | 'AXOutlineRow'
  | 'AXUnknown'
  // Window subroles
  | 'AXStandardWindow'
  | 'AXDialog'
  | 'AXSystemDialog'
  | 'AXFloatingWindow'
  | 'AXSystemFloatingWindow'
  | 'AXDecorative'
  // Scroll subroles
  | 'AXIncrementArrow'
  | 'AXDecrementArrow'
  | 'AXIncrementPage'
  | 'AXDecrementPage'
  // Other subroles
  | 'AXSortButton'
  | 'AXSearchField'
  | 'AXTimeline'
  | 'AXRatingIndicator'
  | 'AXContentList'
  | 'AXDefinitionList'
  | 'AXDescriptionList'
  | 'AXToggle'
  | 'AXSwitch'
  // Dock subroles
  | 'AXApplicationDockItem'
  | 'AXDocumentDockItem'
  | 'AXFolderDockItem'
  | 'AXMinimizedWindowDockItem'
  | 'AXURLDockItem'
  | 'AXDockExtraDockItem'
  | 'AXTrashDockItem'
  | 'AXSeparatorDockItem'
  | 'AXProcessSwitcherList'

/**
 * macOS Accessibility Actions (from AXActionConstants.h)
 */
export type AXAction =
  | 'AXPress'
  | 'AXIncrement'
  | 'AXDecrement'
  | 'AXConfirm'
  | 'AXCancel'
  | 'AXShowAlternateUI'
  | 'AXShowDefaultUI'
  | 'AXRaise'
  | 'AXShowMenu'
  | 'AXPick'

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

// ============================================================================
// Snapshot Types - For capturing and comparing UI state
// ============================================================================

/** Tab information for snapshots */
export interface SnapshotTab {
  /** Tab title */
  title?: string
  /** Whether this tab is currently selected/active */
  isSelected: boolean
  /** Whether this tab is currently active (alias for isSelected) */
  isActive?: boolean
  /** Tab index (0-based) */
  index?: number
  /** Tab URL (if available, e.g., browser tabs) */
  url?: string
}

/** Sheet (modal dialog) information for snapshots */
export interface SnapshotSheet {
  /** Sheet title */
  title?: string
  /** Sheet role (e.g., AXSheet) */
  role: string
  /** Sheet subrole */
  subrole?: string
  /** Whether the sheet is modal */
  isModal: boolean
  /** Sheet identifier */
  identifier?: string
  /** Position X */
  x?: number
  /** Position Y */
  y?: number
  /** Width */
  width?: number
  /** Height */
  height?: number
}

/** Selection state information for snapshots */
export interface SnapshotSelection {
  /** Role of the element containing the selection */
  elementRole: string
  /** Title of the element containing the selection */
  elementTitle?: string
  /** Number of selected items */
  selectedCount: number
  /** Titles of selected items */
  selectedTitles: string[]
}

/** Detailed element state for snapshots */
export interface SnapshotElement {
  /** Element role (e.g., AXButton, AXTextField) */
  role: string
  /** Element subrole (e.g., AXCloseButton) */
  subrole?: string
  /** Element title/label */
  title?: string
  /** Element description */
  description?: string
  /** Element value */
  value?: string
  /** Element identifier (for programmatic access) */
  identifier?: string
  /** Whether the element is enabled */
  enabled?: boolean
  /** Whether the element has keyboard focus */
  focused?: boolean
  /** Whether the element is selected */
  selected?: boolean
  /** Whether the element is expanded (for disclosure triangles, outlines, etc.) */
  expanded?: boolean
  /** Whether the element is disclosing content */
  disclosing?: boolean
  /** Whether the element is busy (loading, processing) */
  busy?: boolean
  /** Position X in screen pixels */
  x?: number
  /** Position Y in screen pixels */
  y?: number
  /** Width in pixels */
  width?: number
  /** Height in pixels */
  height?: number
  /** Available actions */
  actions?: string[]
}

/** Window information for snapshots */
export interface SnapshotWindow {
  /** Window title */
  title?: string
  /** Window role */
  role: string
  /** Window subrole */
  subrole?: string
  /** Whether this is the main window */
  isMain: boolean
  /** Whether the window is minimized */
  isMinimized: boolean
  /** Whether the window has focus */
  isFocused: boolean
  /** Whether the window is modal */
  modal?: boolean
  /** Whether the window is a modal dialog */
  isModal?: boolean
  /** Position X */
  x?: number
  /** Position Y */
  y?: number
  /** Width */
  width?: number
  /** Height */
  height?: number
  /** Window identifier */
  identifier?: string
}

/** Menu information for snapshots */
export interface SnapshotMenu {
  /** Menu title */
  title?: string
  /** Menu role */
  role: string
  /** Position X */
  x?: number
  /** Position Y */
  y?: number
  /** Width */
  width?: number
  /** Height */
  height?: number
  /** Menu item titles */
  items?: string[]
}

/** Application information for snapshots */
export interface SnapshotApplication {
  /** Application title */
  title?: string
  /** Bundle identifier (e.g., com.apple.Safari) */
  bundleIdentifier?: string
  /** Whether the app is frontmost */
  isFrontmost: boolean
  /** Whether the app is hidden */
  isHidden: boolean
  /** Process ID */
  pid: number
}

/** Complete UI state snapshot */
export interface StateSnapshot {
  /** Whether the snapshot was captured successfully */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Unix timestamp when snapshot was taken */
  timestamp: number
  /** The focused (frontmost) application */
  focusedApplication?: SnapshotApplication
  /** The focused window */
  focusedWindow?: SnapshotWindow
  /** The element with keyboard focus */
  focusedElement?: SnapshotElement
  /** Element at the specified click position (if coordinates provided) */
  elementAtPoint?: SnapshotElement
  /** All windows of the focused application */
  windows: SnapshotWindow[]
  /** Currently open menus (context menus, dropdowns, etc.) */
  openMenus: SnapshotMenu[]
  /** Tabs in the focused window (if applicable) */
  tabs?: SnapshotTab[]
  /** Sheets (modal dialogs) attached to windows */
  sheets?: SnapshotSheet[]
  /** Current selections in the UI */
  selections?: SnapshotSelection[]
  /** Time taken to capture the snapshot in milliseconds */
  queryTimeMs: number
}

/** Options for capturing a state snapshot */
export interface CaptureStateOptions {
  /** Optional click position X (screen pixels) */
  x?: number
  /** Optional click position Y (screen pixels) */
  y?: number
}

// ============================================================================
// Diff Types - For comparing two snapshots
// ============================================================================

/** Represents a change in an element's state */
export interface ElementChange {
  /** Type of change */
  type: 'added' | 'removed' | 'modified'
  /** Element role */
  role: string
  /** Element title (for identification) */
  title?: string
  /** What changed (for 'modified' type) */
  changes?: {
    property: string
    before: unknown
    after: unknown
  }[]
}

/** Represents a window change */
export interface WindowChange {
  /** Type of change */
  type: 'opened' | 'closed' | 'focused' | 'unfocused' | 'moved' | 'resized'
  /** Window title */
  title?: string
  /** Window position (for opened/moved) */
  position?: [number, number]
  /** Window size (for opened/resized) */
  size?: [number, number]
}

/** Represents a menu change */
export interface MenuChange {
  /** Type of change */
  type: 'opened' | 'closed'
  /** Menu title */
  title?: string
  /** Menu items (for opened) */
  items?: string[]
  /** Menu position (for opened) */
  position?: [number, number]
}
/** Represents a tab change */
export interface TabChange {
  /** Type of change */
  type: 'opened' | 'closed' | 'activated'
  /** Tab title */
  title?: string
  /** Tab URL (if available) */
  url?: string
}


/** Difference between two state snapshots */
export interface StateDiff {
  /** Time between snapshots in milliseconds */
  timeDeltaMs: number

  /** Whether the focused application changed */
  applicationChanged: boolean
  /** Application before (if changed) */
  applicationBefore?: SnapshotApplication
  /** Application after (if changed) */
  applicationAfter?: SnapshotApplication

  /** Whether the focused window changed */
  windowFocusChanged: boolean
  /** Focused window before */
  focusedWindowBefore?: SnapshotWindow
  /** Focused window after */
  focusedWindowAfter?: SnapshotWindow

  /** Whether the focused element changed */
  focusChanged: boolean
  /** Focused element before */
  focusedElementBefore?: SnapshotElement
  /** Focused element after */
  focusedElementAfter?: SnapshotElement

  /** Whether the element at click position changed */
  clickedElementChanged: boolean
  /** Element at click position before */
  clickedElementBefore?: SnapshotElement
  /** Element at click position after */
  clickedElementAfter?: SnapshotElement

  /** Windows that were opened */
  windowsOpened: WindowChange[]
  /** Windows that were closed */
  windowsClosed: WindowChange[]
  /** Other window changes */
  windowChanges: WindowChange[]

  /** Menus that were opened */
  menusOpened: MenuChange[]
  /** Menus that were closed */
  menusClosed: MenuChange[]

  /** Tabs that were opened */
  tabsOpened: TabChange[]
  /** Tabs that were closed */
  tabsClosed: TabChange[]
  /** Whether the active tab changed */
  activeTabChanged: boolean
  /** Active tab title before (if changed) */
  activeTabBefore?: string
  /** Active tab title after (if changed) */
  activeTabAfter?: string

  /** Sheets/dialogs that were opened */
  sheetsOpened: WindowChange[]
  /** Sheets/dialogs that were closed */
  sheetsClosed: WindowChange[]

  /** Whether focused element expanded state changed */
  expandedChanged: boolean
  /** Expanded state before (if changed) */
  expandedBefore?: boolean
  /** Expanded state after (if changed) */
  expandedAfter?: boolean
  /** Element whose expanded state changed */
  expandedElement?: SnapshotElement

  /** Whether the busy state changed */
  busyStateChanged: boolean
  /** Whether the window state changed (minimized/modal) */
  windowStateChanged: boolean

  /** Whether focused element value changed */
  valueChanged: boolean
  /** Value before (if changed) */
  valueBefore?: string
  /** Value after (if changed) */
  valueAfter?: string

  /** Whether focused element enabled state changed */
  enabledChanged: boolean
  /** Enabled state before (if changed) */
  enabledBefore?: boolean
  /** Enabled state after (if changed) */
  enabledAfter?: boolean

  /** Summary of what changed (human-readable) */
  summary: string[]
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
  /** Capture a complete UI state snapshot */
  captureState?(options?: CaptureStateOptions): Promise<StateSnapshot>
}
