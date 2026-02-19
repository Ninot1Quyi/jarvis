/**
 * Linux Accessibility Provider (AT-SPI2)
 *
 * Uses AT-SPI2 via Python CLI tool to query UI elements.
 *
 * =============================================================================
 * IMPLEMENTATION STATUS - UI Change Detection
 * =============================================================================
 *
 * ## 1. Container-level Changes (PARTIAL)
 * - [ ] Application change (focused app switched) - via state command
 * - [x] Window changes (opened, closed, focus changed) - via state command
 * - [ ] Menu changes (opened, closed)
 * - [ ] Dialog/Sheet changes (modal dialogs, file pickers, alerts)
 * - [ ] Popover changes (popup windows)
 *
 * ## 2. Tab/Navigation Changes (NOT IMPLEMENTED)
 * - Tab changes in tab groups
 * - Browser column changes
 *
 * ## 3. Focus/Selection Changes (PARTIAL)
 * - Focused element change - via query command
 * - Element at click point change - via query command
 * - Selected children change
 * - Selected rows change
 * - Selected cells change
 *
 * ## 4. State Changes (PARTIAL)
 * - Expanded/Collapsed state
 * - Enabled/Disabled state
 * - Busy/Loading state
 * - Minimized state
 * - Modal state
 * - Checked state
 *
 * ## 5. Value Changes (PARTIAL)
 * - Value change (text fields)
 * - Selected text change
 *
 * AT-SPI2 Reference: https://docs.gtk.org/atspi2/
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
} from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Path to the Python AT-SPI2 query tool
const ATSPI_QUERY_PATH = join(__dirname, '..', '..', '..', 'native', 'linux', 'atspi-query.py')

// Role mapping from AT-SPI2 roles to normalized roles
const ROLE_MAP: Record<string, ElementRole> = {
  'button': 'button',
  'textfield': 'textfield',
  'text': 'textfield',
  'entry': 'textfield',
  'password': 'textfield',
  'checkbox': 'checkbox',
  'radiobutton': 'radiobutton',
  'combobox': 'combobox',
  'list': 'list',
  'listitem': 'listitem',
  'menu': 'menu',
  'menuitem': 'menuitem',
  'menubar': 'menu',
  'tab': 'tab',
  'tablist': 'tabgroup',
  'toolbar': 'toolbar',
  'scrollbar': 'scrollbar',
  'slider': 'slider',
  'link': 'link',
  'image': 'image',
  'label': 'statictext',
  'group': 'group',
  'panel': 'group',
  'window': 'window',
  'dialog': 'window',
  'document': 'group',
  'heading': 'statictext',
  'separator': 'group',
  'togglebutton': 'button',
  'spinbutton': 'textfield',
  'tree': 'list',
  'table': 'list',
  'cell': 'listitem',
}

function normalizeRole(rawRole: string): ElementRole {
  return ROLE_MAP[rawRole.toLowerCase()] || 'unknown'
}

/** Raw element data from Python AT-SPI2 tool */
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
  enabled?: boolean
}

/** Raw response from Python AT-SPI2 tool (query mode) */
interface RawQueryResponse {
  success: boolean
  error?: string
  elementAtPoint?: RawElement
  nearbyElements: RawElement[]
  queryX: number
  queryY: number
  queryTimeMs: number
}

/** Raw response from Python AT-SPI2 tool (search mode) */
interface RawSearchResponse {
  success: boolean
  error?: string
  results: RawElement[]
  searchKeyword: string
  queryTimeMs: number
}

/** Raw desktop state response */
interface RawStateResponse {
  success: boolean
  error?: string
  applications: Array<{
    name: string
    windows: Array<{
      title: string
      x: number
      y: number
      width: number
      height: number
    }>
  }>
  focusedApplication: string
  queryTimeMs: number
}

function convertElement(raw: RawElement): AccessibilityElement {
  const role = normalizeRole(raw.role)
  const centerX = raw.x + raw.width / 2
  const centerY = raw.y + raw.height / 2
  return {
    role,
    rawRole: raw.role,
    title: raw.title || '',
    description: raw.description || '',
    value: raw.value || '',
    center: [centerX, centerY],
    size: [raw.width, raw.height],
    bounds: [raw.x, raw.y, raw.width, raw.height],
    distance: raw.distance,
    interactive: role !== 'unknown' && role !== 'group',
    similarity: raw.similarity || 0,
  }
}

function execATSPI(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if Python3 and required modules are available
    const proc = spawn('python3', [ATSPI_QUERY_PATH, ...args])
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(stderr || `AT-SPI2 query failed with code ${code}`))
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })
  })
}

export class LinuxAccessibilityProvider implements AccessibilityProvider {
  platform = 'linux' as const

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Python3 is available
      const result = await execATSPI(['state'])
      const state = JSON.parse(result) as RawStateResponse
      return state.success
    } catch {
      return false
    }
  }

  async query(options: AccessibilityQueryOptions): Promise<AccessibilityQueryResult> {
    try {
      const stdout = await execATSPI(['query', String(options.x), String(options.y)])
      const raw = JSON.parse(stdout) as RawQueryResponse

      if (!raw.success) {
        return {
          success: false,
          error: raw.error || 'AT-SPI2 query failed',
          nearbyElements: [],
          queryPosition: [options.x, options.y],
          queryTimeMs: raw.queryTimeMs,
        }
      }

      return {
        success: true,
        elementAtPoint: raw.elementAtPoint ? convertElement(raw.elementAtPoint) : undefined,
        nearbyElements: raw.nearbyElements.map(convertElement),
        queryPosition: [raw.queryX, raw.queryY],
        queryTimeMs: raw.queryTimeMs,
      }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'AT-SPI2 query error',
        nearbyElements: [],
        queryPosition: [options.x, options.y],
        queryTimeMs: 0,
      }
    }
  }

  async search(options: AccessibilitySearchOptions): Promise<AccessibilitySearchResult> {
    try {
      const stdout = await execATSPI(['search', options.keyword])
      const raw = JSON.parse(stdout) as RawSearchResponse

      if (!raw.success) {
        return {
          success: false,
          error: raw.error || 'AT-SPI2 search failed',
          results: [],
          searchKeyword: options.keyword,
          queryTimeMs: raw.queryTimeMs,
        }
      }

      return {
        success: true,
        results: raw.results.map(convertElement),
        searchKeyword: raw.searchKeyword,
        queryTimeMs: raw.queryTimeMs,
      }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'AT-SPI2 search error',
        results: [],
        searchKeyword: options.keyword,
        queryTimeMs: 0,
      }
    }
  }
}

export const provider = new LinuxAccessibilityProvider()
