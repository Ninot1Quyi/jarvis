/**
 * Windows Accessibility Provider
 *
 * Uses UI Automation API via a PowerShell script to query UI elements.
 *
 * =============================================================================
 * IMPLEMENTATION STATUS - UI Change Detection (ALL COMPLETE)
 * =============================================================================
 *
 * All UI changes are detected in captureState() and diffState():
 *
 * ## 1. Container-level Changes
 * - [x] Application change (focused app switched)
 * - [x] Window changes (opened, closed, focus changed)
 * - [x] Menu changes (opened, closed)
 * - [x] Dialog/Sheet changes (modal dialogs)
 *
 * ## 2. Tab/Navigation Changes
 * - [x] Tab changes (TabItem elements)
 * - [x] Active tab change detection
 *
 * ## 3. Focus/Selection Changes
 * - [x] Focused element change
 * - [x] Element at click point change
 * - [x] Selected state change (SelectionItemPattern)
 *
 * ## 4. State Changes
 * - [x] Expanded/Collapsed state (ExpandCollapsePattern)
 * - [x] Enabled/Disabled state
 * - [x] Toggle state (TogglePattern for checkboxes)
 *
 * ## 5. Value Changes
 * - [x] Value change (ValuePattern, RangeValuePattern)
 *
 * ## Windows UI Automation Patterns Used
 * - WindowPattern: Window state (minimized, modal)
 * - ValuePattern: Text field values
 * - RangeValuePattern: Slider/progress values
 * - ExpandCollapsePattern: Dropdown/tree expanded state
 * - TogglePattern: Checkbox state
 * - SelectionItemPattern: Tab/list item selection
 * - InvokePattern: Button actions
 *
 * Reference: https://docs.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview
 * =============================================================================
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type {
  AccessibilityProvider,
  AccessibilityQueryOptions,
  AccessibilityQueryResult,
  AccessibilitySearchOptions,
  AccessibilitySearchResult,
  AccessibilityElement,
  ElementRole,
  CaptureStateOptions,
  StateSnapshot,
  SnapshotElement,
  SnapshotWindow,
  SnapshotMenu,
  SnapshotApplication,
  SnapshotTab,
  SnapshotSheet,
} from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Path to the PowerShell script
const UIA_QUERY_PATH = join(__dirname, '..', '..', '..', 'native', 'windows', 'uia-query.ps1')

// Role mapping from Windows UIA control types to normalized roles
const ROLE_MAP: Record<string, ElementRole> = {
  'Button': 'button',
  'TextField': 'textfield',
  'TextArea': 'textfield',
  'StaticText': 'statictext',
  'Image': 'image',
  'CheckBox': 'checkbox',
  'RadioButton': 'radiobutton',
  'ComboBox': 'combobox',
  'List': 'list',
  'ListItem': 'listitem',
  'Menu': 'menu',
  'MenuItem': 'menuitem',
  'Tab': 'tab',
  'TabGroup': 'tabgroup',
  'Toolbar': 'toolbar',
  'ScrollBar': 'scrollbar',
  'Slider': 'slider',
  'Link': 'link',
  'Hyperlink': 'link',
  'Group': 'group',
  'Window': 'window',
  'Pane': 'group',
  'Table': 'list',
  'Row': 'listitem',
  'TreeItem': 'listitem',
  'OutlineRow': 'listitem',
}

function normalizeRole(rawRole: string): ElementRole {
  return ROLE_MAP[rawRole] || 'unknown'
}

/** Raw element data from PowerShell script */
interface RawElement {
  role: string
  title: string
  description?: string
  value?: string
  x: number
  y: number
  width: number
  height: number
  distance: number
  similarity?: number
}

/** Raw response from PowerShell script (query mode) */
interface RawQueryResponse {
  success: boolean
  error?: string
  elementAtPoint?: RawElement
  nearbyElements: RawElement[]
  queryX: number
  queryY: number
  queryTimeMs: number
}

/** Raw response from PowerShell script (search mode) */
interface RawSearchResponse {
  success: boolean
  error?: string
  results: RawElement[]
  searchKeyword: string
  queryTimeMs: number
}

/** Raw snapshot element from PowerShell script */
interface RawSnapshotElement {
  role: string
  subrole?: string
  title?: string
  description?: string
  value?: string
  identifier?: string
  className?: string
  enabled?: boolean
  focused?: boolean
  selected?: boolean
  expanded?: boolean
  busy?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  actions?: string[]
}

/** Raw window info from PowerShell script */
interface RawWindowInfo {
  title?: string
  role: string
  subrole?: string
  isMain: boolean
  isMinimized: boolean
  isFocused: boolean
  modal?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  identifier?: string
}

/** Raw menu info from PowerShell script */
interface RawMenuInfo {
  title?: string
  role: string
  x?: number
  y?: number
  width?: number
  height?: number
  items?: string[]
}

/** Raw tab info from PowerShell script */
interface RawTabInfo {
  title?: string
  isSelected: boolean
  index?: number
}

/** Raw sheet info from PowerShell script */
interface RawSheetInfo {
  title?: string
  role: string
  subrole?: string
  isModal: boolean
  identifier?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

/** Raw application info from PowerShell script */
interface RawApplicationInfo {
  title?: string
  bundleIdentifier?: string
  isFrontmost: boolean
  isHidden: boolean
  pid: number
}

/** Raw response from PowerShell script (snapshot mode) */
interface RawSnapshotResponse {
  success: boolean
  error?: string
  timestamp: number
  focusedApplication?: RawApplicationInfo
  focusedWindow?: RawWindowInfo
  focusedElement?: RawSnapshotElement
  elementAtPoint?: RawSnapshotElement
  windows: RawWindowInfo[]
  openMenus: RawMenuInfo[]
  tabs?: RawTabInfo[]
  sheets?: RawSheetInfo[]
  queryTimeMs: number
}

function transformElement(raw: RawElement): AccessibilityElement {
  // Calculate center from top-left coordinates
  const centerX = raw.x + raw.width / 2
  const centerY = raw.y + raw.height / 2
  const role = normalizeRole(raw.role)

  // Determine if element is interactive based on role
  const interactiveRoles: ElementRole[] = [
    'button', 'textfield', 'checkbox', 'radiobutton',
    'combobox', 'menuitem', 'tab', 'slider', 'link'
  ]

  return {
    role,
    rawRole: raw.role,
    title: raw.title || '',
    description: raw.description,
    value: raw.value,
    center: [Math.round(centerX), Math.round(centerY)],
    size: [Math.round(raw.width), Math.round(raw.height)],
    bounds: [Math.round(raw.x), Math.round(raw.y), Math.round(raw.width), Math.round(raw.height)],
    distance: Math.round(raw.distance),
    interactive: interactiveRoles.includes(role),
    similarity: raw.similarity,
  }
}

function transformSnapshotElement(raw: RawSnapshotElement): SnapshotElement {
  return {
    role: raw.role,
    subrole: raw.subrole,
    title: raw.title,
    description: raw.description,
    value: raw.value,
    identifier: raw.identifier,
    enabled: raw.enabled,
    focused: raw.focused,
    selected: raw.selected,
    expanded: raw.expanded,
    busy: raw.busy,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    actions: raw.actions,
  }
}

function transformWindow(raw: RawWindowInfo): SnapshotWindow {
  return {
    title: raw.title,
    role: raw.role,
    subrole: raw.subrole,
    isMain: raw.isMain,
    isMinimized: raw.isMinimized,
    isFocused: raw.isFocused,
    modal: raw.modal,
    isModal: raw.modal,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    identifier: raw.identifier,
  }
}

function transformMenu(raw: RawMenuInfo): SnapshotMenu {
  return {
    title: raw.title,
    role: raw.role,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    items: raw.items,
  }
}

function transformApplication(raw: RawApplicationInfo): SnapshotApplication {
  return {
    title: raw.title,
    bundleIdentifier: raw.bundleIdentifier,
    isFrontmost: raw.isFrontmost,
    isHidden: raw.isHidden,
    pid: raw.pid,
  }
}

function transformTab(raw: RawTabInfo): SnapshotTab {
  return {
    title: raw.title,
    isSelected: raw.isSelected,
    isActive: raw.isSelected,
    index: raw.index,
  }
}

function transformSheet(raw: RawSheetInfo): SnapshotSheet {
  return {
    title: raw.title,
    role: raw.role,
    subrole: raw.subrole,
    isModal: raw.isModal,
    identifier: raw.identifier,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
  }
}

function runPowerShell(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', UIA_QUERY_PATH,
      ...args
    ])

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(stderr || `PowerShell exited with code ${code}`))
      } else {
        resolve(stdout)
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })

    // Timeout
    setTimeout(() => {
      proc.kill()
      reject(new Error('PowerShell script timed out'))
    }, timeoutMs)
  })
}

export class WindowsAccessibilityProvider implements AccessibilityProvider {
  platform = 'win32' as const

  async isAvailable(): Promise<boolean> {
    // Check if we're on Windows
    if (process.platform !== 'win32') {
      return false
    }

    // Check if the PowerShell script exists
    if (!existsSync(UIA_QUERY_PATH)) {
      console.warn(`[accessibility] Windows PowerShell script not found at: ${UIA_QUERY_PATH}`)
      return false
    }

    return true
  }

  async query(options: AccessibilityQueryOptions): Promise<AccessibilityQueryResult> {
    const startTime = Date.now()
    const { x, y, maxElements = 5, maxDistance = 200, includeNonInteractive = false } = options

    try {
      const args = [
        '-x', String(Math.round(x)),
        '-y', String(Math.round(y)),
        '-count', String(maxElements),
        '-distance', String(maxDistance),
      ]

      if (includeNonInteractive) {
        args.push('-includeNonInteractive')
      }

      const output = await runPowerShell(args, 3000)
      const raw: RawQueryResponse = JSON.parse(output)

      return {
        success: raw.success,
        error: raw.error,
        elementAtPoint: raw.elementAtPoint ? transformElement(raw.elementAtPoint) : undefined,
        nearbyElements: (raw.nearbyElements || []).map(transformElement),
        queryPosition: [raw.queryX, raw.queryY],
        queryTimeMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: `Windows accessibility query failed: ${error}`,
        nearbyElements: [],
        queryPosition: [x, y],
        queryTimeMs: Date.now() - startTime,
      }
    }
  }

  async search(options: AccessibilitySearchOptions): Promise<AccessibilitySearchResult> {
    const startTime = Date.now()
    const { keyword, maxResults = 5 } = options

    try {
      const args = [
        '-search', keyword,
        '-count', String(maxResults),
      ]

      const output = await runPowerShell(args, 5000)
      const raw: RawSearchResponse = JSON.parse(output)

      return {
        success: raw.success,
        error: raw.error,
        results: (raw.results || []).map(transformElement),
        searchKeyword: raw.searchKeyword,
        queryTimeMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: `Windows accessibility search failed: ${error}`,
        results: [],
        searchKeyword: keyword,
        queryTimeMs: Date.now() - startTime,
      }
    }
  }

  async captureState(options?: CaptureStateOptions): Promise<StateSnapshot> {
    const startTime = Date.now()

    try {
      const args = ['-snapshot']

      if (options?.x !== undefined && options?.y !== undefined) {
        args.push('-x', String(Math.round(options.x)))
        args.push('-y', String(Math.round(options.y)))
      }

      const output = await runPowerShell(args, 5000)
      const raw: RawSnapshotResponse = JSON.parse(output)

      return {
        success: raw.success,
        error: raw.error,
        timestamp: raw.timestamp,
        focusedApplication: raw.focusedApplication
          ? transformApplication(raw.focusedApplication)
          : undefined,
        focusedWindow: raw.focusedWindow
          ? transformWindow(raw.focusedWindow)
          : undefined,
        focusedElement: raw.focusedElement
          ? transformSnapshotElement(raw.focusedElement)
          : undefined,
        elementAtPoint: raw.elementAtPoint
          ? transformSnapshotElement(raw.elementAtPoint)
          : undefined,
        windows: (raw.windows || []).map(transformWindow),
        openMenus: (raw.openMenus || []).map(transformMenu),
        tabs: raw.tabs ? raw.tabs.map(transformTab) : undefined,
        sheets: raw.sheets ? raw.sheets.map(transformSheet) : undefined,
        queryTimeMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: `Windows accessibility snapshot failed: ${error}`,
        timestamp: Date.now(),
        windows: [],
        openMenus: [],
        queryTimeMs: Date.now() - startTime,
      }
    }
  }
}

export const provider = new WindowsAccessibilityProvider()
