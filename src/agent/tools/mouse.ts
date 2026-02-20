import type { Tool, ToolResult } from '../../types.js'
import { logger } from '../../utils/logger.js'
import { config } from '../../utils/config.js'
import {
  queryNearbyElements,
  formatResultForAgent,
  searchUIElements,
  formatSearchResultForAgent,
  isAccessibilityAvailable,
  captureState,
  diffState,
  formatDiffForAgent,
  type StateSnapshot,
} from '../../accessibility/index.js'

const COORDINATE_FACTOR = 1000

// Platform detection
const isLinux = process.platform === 'linux'
const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

/**
 * Execute command via shell (for Linux xdotool fallback)
 */
async function execCommand(command: string): Promise<string> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)
  try {
    const { stdout, stderr } = await execAsync(command)
    if (stderr) {
      logger.debug(`xdotool stderr: ${stderr}`)
    }
    return stdout
  } catch (error) {
    const err = error as Error & { stderr?: string }
    logger.debug(`xdotool error: ${err.message}`)
    throw error
  }
}

/**
 * Linux xdotool-based mouse operations
 * Used when nut-js is not available (e.g., ARM64 Linux)
 */
const linuxMouse = {
  async move(x: number, y: number, speed: number): Promise<void> {
    if (speed === -1) {
      // Instant move
      await execCommand(`xdotool mousemove ${x} ${y}`)
    } else {
      // For now, just do instant move - smooth movement would need more complex implementation
      await execCommand(`xdotool mousemove ${x} ${y}`)
    }
  },

  async click(button: number): Promise<void> {
    // button: 1=left, 2=middle, 3=right
    await execCommand(`xdotool click ${button}`)
  },

  async doubleClick(button: number): Promise<void> {
    await execCommand(`xdotool click --repeat 2 ${button}`)
  },

  async drag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    await execCommand(`xdotool mousemove ${startX} ${startY}`)
    await execCommand(`xdotool mousedown 1`)
    await execCommand(`xdotool mousemove ${endX} ${endY}`)
    await execCommand(`xdotool mouseup 1`)
  },

  async scroll(direction: 'up' | 'down' | 'left' | 'right'): Promise<void> {
    const mapping: Record<string, string> = {
      up: '4',
      down: '5',
      left: '6',
      right: '7',
    }
    await execCommand(`xdotool click ${mapping[direction]}`)
  },
}

function normalizeCoord(value: number): number {
  return value / COORDINATE_FACTOR
}

/**
 * Auto-correct click coordinates via accessibility search.
 * When desc is provided and a high-confidence match is found (>= 80% similarity)
 * that is far enough from the LLM-provided coordinate (> 30 normalized units),
 * returns the corrected screen pixel coordinates.
 * Times out after 500ms to avoid blocking clicks.
 */
const CORRECT_TIMEOUT_MS = 500

async function correctCoordinate(
  coord: number[],
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  desc?: string,
): Promise<{ x: number; y: number; corrected: boolean }> {
  const fallback = { x, y, corrected: false }
  if (!desc || !desc.trim() || !(await isAccessibilityAvailable())) {
    return fallback
  }

  try {
    // Race: accessibility search vs timeout
    const searchPromise = searchUIElements(desc.trim(), { maxResults: 3 })
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), CORRECT_TIMEOUT_MS)
    )
    const searchResult = await Promise.race([searchPromise, timeoutPromise])

    if (!searchResult || !searchResult.success || searchResult.results.length === 0) {
      if (!searchResult) logger.debug(`correctCoordinate: search for "${desc}" timed out (${CORRECT_TIMEOUT_MS}ms)`)
      return fallback
    }

    const best = searchResult.results[0]
    if (best.similarity && best.similarity >= 0.9) {
      const [cx, cy] = best.center
      const normBestX = Math.round((cx / screenWidth) * COORDINATE_FACTOR)
      const normBestY = Math.round((cy / screenHeight) * COORDINATE_FACTOR)
      const dist = Math.sqrt((normBestX - coord[0]) ** 2 + (normBestY - coord[1]) ** 2)
      // Only correct when AX result is CLOSE to LLM coordinate (fine-tuning).
      // If dist is large, AX likely matched a wrong element -- trust LLM instead.
      if (dist <= 150) {
        logger.debug(`correctCoordinate: "${desc}" matched "${best.title}" (${Math.round(best.similarity * 100)}%), correcting screen(${x},${y}) -> screen(${cx},${cy}), dist=${Math.round(dist)}`)
        return { x: Math.round(cx), y: Math.round(cy), corrected: true }
      } else {
        logger.debug(`correctCoordinate: "${desc}" matched "${best.title}" (${Math.round(best.similarity * 100)}%) but dist=${Math.round(dist)} too far, keeping LLM coord`)
      }
    }
  } catch (error) {
    logger.debug(`correctCoordinate: search for "${desc}" failed: ${error}`)
  }

  return fallback
}

// 移动鼠标，支持瞬移（mouseSpeed=-1）
async function moveMouse(x: number, y: number) {
  const speed = config.mouseSpeed

  if (isLinux) {
    // Use xdotool on Linux
    await linuxMouse.move(x, y, speed)
    return
  }

  // Use nut-js on macOS/Windows
  const { mouse, Point, straightTo } = await import('@computer-use/nut-js')

  if (speed === -1) {
    await mouse.setPosition(new Point(x, y))
  } else {
    mouse.config.mouseSpeed = speed > 0 ? speed : 1000
    await mouse.move(straightTo(new Point(x, y)))
  }
}

/**
 * Capture state before click, execute click, capture state after, return diff
 */
async function executeWithStateDiff(
  screenX: number,
  screenY: number,
  clickFn: () => Promise<void>
): Promise<{ before: StateSnapshot; after: StateSnapshot } | null> {
  if (!(await isAccessibilityAvailable())) {
    return null
  }

  try {
    // Capture state before click
    const before = await captureState({ x: screenX, y: screenY })

    // Execute the click
    await clickFn()

    // Initial wait for UI to start updating
    await new Promise(resolve => setTimeout(resolve, 150))

    // Capture state after click
    let after = await captureState({ x: screenX, y: screenY })

    // If significant change detected (app switch, window open/close), wait longer for UI to stabilize
    const appChanged = before.focusedApplication?.bundleIdentifier !== after.focusedApplication?.bundleIdentifier
    const windowCountChanged = before.windows.length !== after.windows.length
    // Detect Spotlight closed (macOS Spotlight bundle ID: com.apple.Spotlight)
    const spotlightClosed = before.focusedApplication?.bundleIdentifier === 'com.apple.Spotlight' &&
                            after.focusedApplication?.bundleIdentifier !== 'com.apple.Spotlight'

    if (appChanged || windowCountChanged || spotlightClosed) {
      // Wait longer for app launch / window animation
      await new Promise(resolve => setTimeout(resolve, 300))
      // Re-capture to get stable state
      after = await captureState({ x: screenX, y: screenY })
    }

    return { before, after }
  } catch (error) {
    logger.debug(`State diff capture failed: ${error}`)
    return null
  }
}

/**
 * Query nearby UI elements and optionally search by desc keyword
 * Append results to the tool result message
 */
async function appendNearbyElements(
  result: ToolResult,
  screenX: number,
  screenY: number,
  screenWidth: number,
  screenHeight: number,
  desc?: string,
  stateDiffResult?: { before: StateSnapshot; after: StateSnapshot } | null,
  options?: { skipNoChangeWarning?: boolean }
): Promise<ToolResult> {
  // Check if accessibility is available
  if (!(await isAccessibilityAvailable())) {
    logger.debug('Accessibility not available, skipping nearby elements query')
    return result
  }

  let message = result.message || ''

  // Helper to convert screen pixels to normalized [0, 1000] coordinates
  const toNormalized = (x: number, y: number): [number, number] => [
    Math.round((x / screenWidth) * 1000),
    Math.round((y / screenHeight) * 1000),
  ]

  try {
    // Show element at click position from state snapshot
    if (stateDiffResult?.before?.elementAtPoint) {
      const el = stateDiffResult.before.elementAtPoint
      const elTitle = el.title || el.description || el.value || '(no title)'
      const elRole = el.role?.replace('AX', '') || 'Unknown'

      // Snapshot returns top-left coordinates, calculate center for display
      let coordStr = ''
      if (el.x !== undefined && el.y !== undefined && el.width !== undefined && el.height !== undefined) {
        const centerX = el.x + el.width / 2
        const centerY = el.y + el.height / 2
        const [normX, normY] = toNormalized(centerX, centerY)
        coordStr = ` [${normX}, ${normY}]`
      }

      message += `\nClicked: [${elRole}] "${elTitle}"${coordStr}`

      // If no desc provided but we have element title, use it for global search
      if (!desc && elTitle !== '(no title)') {
        desc = elTitle
      }
    }

    // If we have state diff, use it to show UI changes
    if (stateDiffResult) {
      const diff = diffState(stateDiffResult.before, stateDiffResult.after)
      // Skip "no changes" warning for middle_click (opens tab in background, no focus change expected)
      const isNoChange = diff.summary.length === 1 && diff.summary[0] === 'No significant UI changes detected'
      if (!isNoChange || !options?.skipNoChangeWarning) {
        const diffInfo = formatDiffForAgent(diff)
        if (diffInfo) {
          message += '\n' + diffInfo
        }
      }
      logger.debug(`State diff: ${diff.summary.join(', ')}`)
    }

    // Query nearby elements based on click position
    const queryResult = await queryNearbyElements(screenX, screenY, {
      maxElements: 5,
      maxDistance: 200,
      includeNonInteractive: true,
    })

    logger.debug(`Accessibility query: success=${queryResult.success}, elements=${queryResult.nearbyElements.length}, time=${queryResult.queryTimeMs}ms`)

    if (queryResult.error) {
      logger.debug(`Accessibility query error: ${queryResult.error}`)
    }

    if (queryResult.success && queryResult.nearbyElements.length > 0) {
      const nearbyInfo = formatResultForAgent(queryResult, screenWidth, screenHeight)
      if (nearbyInfo) {
        message += nearbyInfo
      }
    }

    // If desc is provided (or derived from clicked element), search globally
    if (desc && desc.trim()) {
      const searchResult = await searchUIElements(desc.trim(), { maxResults: 2 })

      logger.debug(`Accessibility search for "${desc}": success=${searchResult.success}, results=${searchResult.results.length}, time=${searchResult.queryTimeMs}ms`)

      if (searchResult.success && searchResult.results.length > 0) {
        const searchInfo = formatSearchResultForAgent(searchResult, screenWidth, screenHeight)
        if (searchInfo) {
          message += '\n' + searchInfo
        }
      } else if (searchResult.success && searchResult.results.length === 0) {
        message += `\n[WARNING] No UI element found matching "${desc}". The target may not exist or have a different name.`
      }
    }
  } catch (error) {
    logger.debug(`Accessibility query failed: ${error}`)
  }

  if (message) {
    return {
      ...result,
      message,
    }
  }

  return result
}

export const clickTool: Tool = {
  definition: {
    name: 'click',
    description: 'Click at the specified position. Coordinates are in range [0, 1000]. The desc should be the exact UI text/label (e.g., "Save", "Insert"), searched in accessibility tree for auto-correction. Use modifiers for special clicks: ["cmd"] for cmd+click (multi-select), ["shift"] for shift+click.',
    parameters: {
      type: 'object',
      properties: {
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate, range [0, 1000]. (0,0)=top-left, (1000,1000)=bottom-right',
        },
        desc: {
          type: 'string',
          description: 'The exact name/label of the target element (e.g., "Save", "Insert", "Microsoft PowerPoint"). This will be searched in the accessibility tree. Keep it short and match the actual UI text.',
        },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modifier keys to hold during click: "cmd", "ctrl", "shift", "alt/option". Example: ["cmd"] for cmd+click, ["cmd", "shift"] for cmd+shift+click.',
        },
      },
      required: ['coordinate'],
    },
  },
  async execute(args, context) {
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const desc = args.desc as string | undefined
    const modifiers = args.modifiers as string[] | undefined
    let x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    let y = Math.round(normalizeCoord(coord[1]) * screenHeight)

    // Auto-correct coordinates via accessibility search when desc is provided
    const correction = await correctCoordinate(coord, x, y, screenWidth, screenHeight, desc)
    x = correction.x
    y = correction.y

    const modifierStr = modifiers?.length ? ` +[${modifiers.join('+')}]` : ''
    const correctedStr = correction.corrected ? ' (corrected)' : ''
    logger.debug(`click: [${coord[0]}, ${coord[1]}] -> screen(${x}, ${y})${modifierStr}${correctedStr}${desc ? ` (target: ${desc})` : ''}`)

    // Execute click with state diff
    const stateDiffResult = await executeWithStateDiff(x, y, async () => {
      await moveMouse(x, y)

      if (isLinux) {
        // Linux: use xdotool with modifier support
        if (modifiers && modifiers.length > 0) {
          // Build xdotool command with modifiers
          const modMap: Record<string, string> = {
            cmd: 'super',
            command: 'super',
            ctrl: 'ctrl',
            control: 'ctrl',
            shift: 'shift',
            alt: 'alt',
            option: 'alt',
          }
          const modKeys = modifiers.map(m => modMap[m.toLowerCase()]).filter(Boolean)
          if (modKeys.length > 0) {
            // xdotool keydown + click + keyup
            for (const mod of modKeys) {
              await execCommand(`xdotool keydown ${mod}`)
            }
            await execCommand('xdotool click 1')
            for (const mod of modKeys.reverse()) {
              await execCommand(`xdotool keyup ${mod}`)
            }
            return
          }
        }
        await linuxMouse.click(1) // Left click
      } else {
        // macOS/Windows: use nut-js
        const { mouse, keyboard, Key } = await import('@computer-use/nut-js')

        // Map modifier names to Key enum
        const modifierKeyMap: Record<string, number> = {
          cmd: Key.LeftCmd,
          command: Key.LeftCmd,
          ctrl: Key.LeftControl,
          control: Key.LeftControl,
          shift: Key.LeftShift,
          alt: Key.LeftAlt,
          option: Key.LeftAlt,
        }

        // Get modifier keys to press
        const modifierKeys: number[] = []
        if (modifiers) {
          for (const mod of modifiers) {
            const key = modifierKeyMap[mod.toLowerCase()]
            if (key) modifierKeys.push(key)
          }
        }

        // Press modifier keys
        if (modifierKeys.length > 0) {
          await keyboard.pressKey(...modifierKeys)
        }

        await mouse.leftClick()

        // Release modifier keys
        if (modifierKeys.length > 0) {
          await keyboard.releaseKey(...modifierKeys)
        }
      }
    })

    const result: ToolResult = {
      success: true,
      data: { coordinate: coord, modifiers },
    }

    return appendNearbyElements(result, x, y, screenWidth, screenHeight, desc, stateDiffResult)
  },
}

export const doubleClickTool: Tool = {
  definition: {
    name: 'left_double',
    description: 'Double click at the specified position. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate, range [0, 1000]',
        },
        desc: {
          type: 'string',
          description: 'The exact name/label of the target element. Searched in accessibility tree. Keep short.',
        },
      },
      required: ['coordinate'],
    },
  },
  async execute(args, context) {
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const desc = args.desc as string | undefined
    let x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    let y = Math.round(normalizeCoord(coord[1]) * screenHeight)

    const correction = await correctCoordinate(coord, x, y, screenWidth, screenHeight, desc)
    x = correction.x
    y = correction.y

    const correctedStr = correction.corrected ? ' (corrected)' : ''
    logger.debug(`left_double: [${coord[0]}, ${coord[1]}] -> screen(${x}, ${y})${correctedStr}${desc ? ` (target: ${desc})` : ''}`)

    // Execute double click with state diff
    const stateDiffResult = await executeWithStateDiff(x, y, async () => {
      await moveMouse(x, y)

      if (isLinux) {
        await linuxMouse.doubleClick(1) // Left button
      } else {
        const { mouse } = await import('@computer-use/nut-js')
        await mouse.doubleClick(0)
      }
    })

    const result: ToolResult = {
      success: true,
      data: { coordinate: coord },
    }

    return appendNearbyElements(result, x, y, screenWidth, screenHeight, desc, stateDiffResult)
  },
}

export const rightClickTool: Tool = {
  definition: {
    name: 'right_single',
    description: 'Right click at the specified position. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate, range [0, 1000]',
        },
        desc: {
          type: 'string',
          description: 'The exact name/label of the target element. Searched in accessibility tree. Keep short.',
        },
      },
      required: ['coordinate'],
    },
  },
  async execute(args, context) {
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const desc = args.desc as string | undefined
    let x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    let y = Math.round(normalizeCoord(coord[1]) * screenHeight)

    const correction = await correctCoordinate(coord, x, y, screenWidth, screenHeight, desc)
    x = correction.x
    y = correction.y

    const correctedStr = correction.corrected ? ' (corrected)' : ''
    logger.debug(`right_single: [${coord[0]}, ${coord[1]}] -> screen(${x}, ${y})${correctedStr}${desc ? ` (target: ${desc})` : ''}`)

    // Execute right click with state diff
    const stateDiffResult = await executeWithStateDiff(x, y, async () => {
      await moveMouse(x, y)

      if (isLinux) {
        await linuxMouse.click(3) // Right click
      } else {
        const { mouse } = await import('@computer-use/nut-js')
        await mouse.rightClick()
      }
    })

    const result: ToolResult = {
      success: true,
      data: { coordinate: coord },
    }

    return appendNearbyElements(result, x, y, screenWidth, screenHeight, desc, stateDiffResult)
  },
}

export const middleClickTool: Tool = {
  definition: {
    name: 'middle_click',
    description: 'Middle click at the specified position. Use this to open links in a new tab without leaving the current page. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate, range [0, 1000]',
        },
        desc: {
          type: 'string',
          description: 'The exact name/label of the target element. Searched in accessibility tree. Keep short.',
        },
      },
      required: ['coordinate'],
    },
  },
  async execute(args, context) {
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const desc = args.desc as string | undefined
    let x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    let y = Math.round(normalizeCoord(coord[1]) * screenHeight)

    const correction = await correctCoordinate(coord, x, y, screenWidth, screenHeight, desc)
    x = correction.x
    y = correction.y

    const correctedStr = correction.corrected ? ' (corrected)' : ''
    logger.debug(`middle_click: [${coord[0]}, ${coord[1]}] -> screen(${x}, ${y})${correctedStr}${desc ? ` (target: ${desc})` : ''}`)

    // Execute middle click with state diff
    const stateDiffResult = await executeWithStateDiff(x, y, async () => {
      await moveMouse(x, y)

      if (isLinux) {
        await linuxMouse.click(2) // Middle click
      } else {
        const { mouse, Button } = await import('@computer-use/nut-js')
        await mouse.click(Button.MIDDLE)
      }
    })

    const result: ToolResult = {
      success: true,
      data: { coordinate: coord },
    }

    // Skip "no changes" warning for middle_click - it opens tabs in background without focus change
    return appendNearbyElements(result, x, y, screenWidth, screenHeight, desc, stateDiffResult, { skipNoChangeWarning: true })
  },
}

export const dragTool: Tool = {
  definition: {
    name: 'drag',
    description: 'Drag from start to end position. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        startCoordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] start coordinate, range [0, 1000]',
        },
        endCoordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] end coordinate, range [0, 1000]',
        },
      },
      required: ['startCoordinate', 'endCoordinate'],
    },
  },
  async execute(args, context) {
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const startCoord = args.startCoordinate as number[]
    const endCoord = args.endCoordinate as number[]

    const startX = Math.round(normalizeCoord(startCoord[0]) * screenWidth)
    const startY = Math.round(normalizeCoord(startCoord[1]) * screenHeight)
    const endX = Math.round(normalizeCoord(endCoord[0]) * screenWidth)
    const endY = Math.round(normalizeCoord(endCoord[1]) * screenHeight)

    if (isLinux) {
      await linuxMouse.drag(startX, startY, endX, endY)
    } else {
      const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
      await moveMouse(startX, startY)
      await mouse.drag(straightTo(new Point(endX, endY)))
    }

    return { success: true, data: { startCoordinate: startCoord, endCoordinate: endCoord } }
  },
}

export const scrollTool: Tool = {
  definition: {
    name: 'scroll',
    description: 'Scroll at the specified position. Coordinates are in range [0, 1000].',
    parameters: {
      type: 'object',
      properties: {
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate, range [0, 1000]',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction',
        },
      },
      required: ['coordinate', 'direction'],
    },
  },
  async execute(args, context) {
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    const y = Math.round(normalizeCoord(coord[1]) * screenHeight)
    const direction = args.direction as string

    await moveMouse(x, y)

    if (isLinux) {
      await linuxMouse.scroll(direction as 'up' | 'down' | 'left' | 'right')
    } else {
      const { mouse } = await import('@computer-use/nut-js')
      const amount = 300
      if (direction === 'up') {
        await mouse.scrollUp(amount)
      } else if (direction === 'down') {
        await mouse.scrollDown(amount)
      } else if (direction === 'left') {
        await mouse.scrollLeft(amount)
      } else if (direction === 'right') {
        await mouse.scrollRight(amount)
      }
    }

    return { success: true, data: { coordinate: coord, direction } }
  },
}

export const mouseTools: Tool[] = [
  clickTool,
  doubleClickTool,
  rightClickTool,
  middleClickTool,
  dragTool,
  scrollTool,
]
