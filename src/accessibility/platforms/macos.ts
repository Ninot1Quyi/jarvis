/**
 * macOS Accessibility Provider
 *
 * Uses AXUIElement API via a Swift CLI tool to query UI elements.
 *
 * =============================================================================
 * IMPLEMENTATION STATUS - UI Change Detection
 * =============================================================================
 *
 * The following changes should be detected in captureState() and diffState():
 *
 * ## 1. Container-level Changes
 * - [x] Application change (focused app switched)
 * - [x] Window changes (opened, closed, focus changed)
 * - [x] Menu changes (opened, closed)
 * - [ ] Dialog/Sheet changes (AXSheet, AXDialog subrole) - TODO
 * - [ ] Popover changes (AXPopover) - TODO
 * - [ ] Drawer changes (AXDrawer) - TODO
 *
 * ## 2. Tab/Navigation Changes (CRITICAL for browsers)
 * - [ ] Tab changes (AXTabGroup, AXTabs attribute) - TODO: PRIORITY HIGH
 *       This is needed to detect browser tab open/close/switch
 * - [ ] Browser column changes (AXBrowser, AXColumns) - TODO
 *
 * ## 3. Focus/Selection Changes
 * - [x] Focused element change (AXFocusedUIElement)
 * - [x] Element at click point change
 * - [ ] Selected children change (AXSelectedChildren) - TODO
 * - [ ] Selected rows change (AXSelectedRows) - TODO
 * - [ ] Selected cells change (AXSelectedCells) - TODO
 *
 * ## 4. State Changes
 * - [ ] Expanded/Collapsed state (AXExpanded) - TODO
 * - [ ] Disclosing state (AXDisclosing) - TODO
 * - [ ] Enabled/Disabled state (AXEnabled) - TODO
 * - [ ] Busy/Loading state (AXElementBusy) - TODO
 * - [ ] Minimized state (AXMinimized) - TODO
 * - [ ] Modal state (AXModal) - TODO
 *
 * ## 5. Value Changes
 * - [ ] Value change (AXValue) - TODO
 * - [ ] Selected text change (AXSelectedText) - TODO
 *
 * ## macOS AX Attributes Reference
 * - AXTabs: Array of tab elements in AXTabGroup
 * - AXSelectedChildren: Currently selected child elements
 * - AXExpanded: Boolean for disclosure state
 * - AXElementBusy: Boolean for loading state
 * - AXModal: Boolean for modal dialogs
 * - AXSheet: Role for sheet dialogs
 * - AXPopover: Role for popover windows
 *
 * Reference: /Library/Developer/CommandLineTools/SDKs/MacOSX*.sdk/
 *            System/Library/Frameworks/ApplicationServices.framework/
 *            Frameworks/HIServices.framework/Headers/AXAttributeConstants.h
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
} from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Path to the compiled Swift CLI tool
const AX_QUERY_PATH = join(__dirname, '..', '..', '..', 'native', 'macos', 'ax-query', '.build', 'release', 'ax-query')

// Role mapping from macOS AX roles to normalized roles
const ROLE_MAP: Record<string, ElementRole> = {
  'AXButton': 'button',
  'AXTextField': 'textfield',
  'AXTextArea': 'textfield',
  'AXStaticText': 'statictext',
  'AXImage': 'image',
  'AXCheckBox': 'checkbox',
  'AXRadioButton': 'radiobutton',
  'AXComboBox': 'combobox',
  'AXList': 'list',
  'AXCell': 'listitem',
  'AXRow': 'listitem',
  'AXMenu': 'menu',
  'AXMenuItem': 'menuitem',
  'AXTab': 'tab',
  'AXTabGroup': 'tabgroup',
  'AXToolbar': 'toolbar',
  'AXScrollBar': 'scrollbar',
  'AXSlider': 'slider',
  'AXLink': 'link',
  'AXGroup': 'group',
  'AXWindow': 'window',
  'AXDockItem': 'button',  // Dock items are clickable
  'AXMenuBarItem': 'menuitem',
}

function normalizeRole(rawRole: string): ElementRole {
  return ROLE_MAP[rawRole] || 'unknown'
}

/** Raw element data from Swift CLI */
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

/** Raw response from Swift CLI (query mode) */
interface RawQueryResponse {
  success: boolean
  error?: string
  elementAtPoint?: RawElement
  nearbyElements: RawElement[]
  queryX: number
  queryY: number
  queryTimeMs: number
}

/** Raw response from Swift CLI (search mode) */
interface RawSearchResponse {
  success: boolean
  error?: string
  results: RawElement[]
  searchKeyword: string
  queryTimeMs: number
}

/** Raw snapshot element from Swift CLI */
interface RawSnapshotElement {
  role: string
  subrole?: string
  title?: string
  description?: string
  value?: string
  identifier?: string
  enabled?: boolean
  focused?: boolean
  selected?: boolean
  expanded?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  actions?: string[]
}

/** Raw window info from Swift CLI */
interface RawWindowInfo {
  title?: string
  role: string
  subrole?: string
  isMain: boolean
  isMinimized: boolean
  isFocused: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  identifier?: string
}

/** Raw menu info from Swift CLI */
interface RawMenuInfo {
  title?: string
  role: string
  x?: number
  y?: number
  width?: number
  height?: number
  items?: string[]
}

/** Raw application info from Swift CLI */
interface RawApplicationInfo {
  title?: string
  bundleIdentifier?: string
  isFrontmost: boolean
  isHidden: boolean
  pid: number
}

/** Raw response from Swift CLI (snapshot mode) */
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
  queryTimeMs: number
}

function transformElement(raw: RawElement): AccessibilityElement {
  // Swift returns top-left coordinates, calculate center here
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

export class MacOSAccessibilityProvider implements AccessibilityProvider {
  platform = 'darwin' as const

  async isAvailable(): Promise<boolean> {
    // Check if we're on macOS
    if (process.platform !== 'darwin') {
      return false
    }

    // Check if the CLI tool exists
    if (!existsSync(AX_QUERY_PATH)) {
      console.warn(`[accessibility] macOS CLI tool not found at: ${AX_QUERY_PATH}`)
      console.warn('[accessibility] Run: cd native/macos/ax-query && swift build -c release')
      return false
    }

    return true
  }

  async query(options: AccessibilityQueryOptions): Promise<AccessibilityQueryResult> {
    const startTime = Date.now()
    const { x, y, maxElements = 5, maxDistance = 200, includeNonInteractive = false } = options

    return new Promise((resolve) => {
      const args = [
        '--x', String(Math.round(x)),
        '--y', String(Math.round(y)),
        '--count', String(maxElements),
        '--distance', String(maxDistance),
      ]

      if (includeNonInteractive) {
        args.push('--include-non-interactive')
      }

      const proc = spawn(AX_QUERY_PATH, args)
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        const queryTimeMs = Date.now() - startTime

        if (code !== 0) {
          resolve({
            success: false,
            error: stderr || `ax-query exited with code ${code}`,
            nearbyElements: [],
            queryPosition: [x, y],
            queryTimeMs,
          })
          return
        }

        try {
          const raw: RawQueryResponse = JSON.parse(stdout)

          const result: AccessibilityQueryResult = {
            success: raw.success,
            error: raw.error,
            elementAtPoint: raw.elementAtPoint ? transformElement(raw.elementAtPoint) : undefined,
            nearbyElements: (raw.nearbyElements || []).map(transformElement),
            queryPosition: [raw.queryX, raw.queryY],
            queryTimeMs,
          }

          resolve(result)
        } catch (parseError) {
          resolve({
            success: false,
            error: `Failed to parse ax-query output: ${parseError}`,
            nearbyElements: [],
            queryPosition: [x, y],
            queryTimeMs,
          })
        }
      })

      proc.on('error', (err) => {
        resolve({
          success: false,
          error: `Failed to spawn ax-query: ${err.message}`,
          nearbyElements: [],
          queryPosition: [x, y],
          queryTimeMs: Date.now() - startTime,
        })
      })

      // Timeout after 2 seconds
      setTimeout(() => {
        proc.kill()
        resolve({
          success: false,
          error: 'ax-query timed out',
          nearbyElements: [],
          queryPosition: [x, y],
          queryTimeMs: Date.now() - startTime,
        })
      }, 2000)
    })
  }

  async search(options: AccessibilitySearchOptions): Promise<AccessibilitySearchResult> {
    const startTime = Date.now()
    const { keyword, maxResults = 5 } = options

    return new Promise((resolve) => {
      const args = [
        '--search', keyword,
        '--count', String(maxResults),
      ]

      const proc = spawn(AX_QUERY_PATH, args)
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        const queryTimeMs = Date.now() - startTime

        if (code !== 0) {
          resolve({
            success: false,
            error: stderr || `ax-query exited with code ${code}`,
            results: [],
            searchKeyword: keyword,
            queryTimeMs,
          })
          return
        }

        try {
          const raw: RawSearchResponse = JSON.parse(stdout)

          const result: AccessibilitySearchResult = {
            success: raw.success,
            error: raw.error,
            results: (raw.results || []).map(transformElement),
            searchKeyword: raw.searchKeyword,
            queryTimeMs,
          }

          resolve(result)
        } catch (parseError) {
          resolve({
            success: false,
            error: `Failed to parse ax-query output: ${parseError}`,
            results: [],
            searchKeyword: keyword,
            queryTimeMs,
          })
        }
      })

      proc.on('error', (err) => {
        resolve({
          success: false,
          error: `Failed to spawn ax-query: ${err.message}`,
          results: [],
          searchKeyword: keyword,
          queryTimeMs: Date.now() - startTime,
        })
      })

      // Timeout after 3 seconds for search (may take longer)
      setTimeout(() => {
        proc.kill()
        resolve({
          success: false,
          error: 'ax-query search timed out',
          results: [],
          searchKeyword: keyword,
          queryTimeMs: Date.now() - startTime,
        })
      }, 3000)
    })
  }

  async captureState(options?: CaptureStateOptions): Promise<StateSnapshot> {
    const startTime = Date.now()

    return new Promise((resolve) => {
      const args = ['--snapshot']

      if (options?.x !== undefined && options?.y !== undefined) {
        args.push('--x', String(Math.round(options.x)))
        args.push('--y', String(Math.round(options.y)))
      }

      const proc = spawn(AX_QUERY_PATH, args)
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        const queryTimeMs = Date.now() - startTime

        if (code !== 0) {
          resolve({
            success: false,
            error: stderr || `ax-query exited with code ${code}`,
            timestamp: Date.now(),
            windows: [],
            openMenus: [],
            queryTimeMs,
          })
          return
        }

        try {
          const raw: RawSnapshotResponse = JSON.parse(stdout)

          const result: StateSnapshot = {
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
            queryTimeMs,
          }

          resolve(result)
        } catch (parseError) {
          resolve({
            success: false,
            error: `Failed to parse ax-query output: ${parseError}`,
            timestamp: Date.now(),
            windows: [],
            openMenus: [],
            queryTimeMs,
          })
        }
      })

      proc.on('error', (err) => {
        resolve({
          success: false,
          error: `Failed to spawn ax-query: ${err.message}`,
          timestamp: Date.now(),
          windows: [],
          openMenus: [],
          queryTimeMs: Date.now() - startTime,
        })
      })

      // Timeout after 3 seconds for snapshot
      setTimeout(() => {
        proc.kill()
        resolve({
          success: false,
          error: 'ax-query snapshot timed out',
          timestamp: Date.now(),
          windows: [],
          openMenus: [],
          queryTimeMs: Date.now() - startTime,
        })
      }, 3000)
    })
  }
}

export const provider = new MacOSAccessibilityProvider()
