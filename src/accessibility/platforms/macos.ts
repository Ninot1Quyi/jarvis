/**
 * macOS Accessibility Provider
 *
 * Uses AXUIElement API via a Swift CLI tool to query UI elements.
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

function transformElement(raw: RawElement): AccessibilityElement {
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
}

export const provider = new MacOSAccessibilityProvider()
