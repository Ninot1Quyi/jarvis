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

function normalizeCoord(value: number): number {
  return value / COORDINATE_FACTOR
}

// 移动鼠标，支持瞬移（mouseSpeed=-1）
async function moveMouse(x: number, y: number) {
  const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
  const speed = config.mouseSpeed

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
    description: 'Click at the specified position. Coordinates are in range [0, 1000]. Supports modifier keys for special clicks (e.g., cmd+click for multi-select).',
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
    const { mouse, keyboard, Key } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const desc = args.desc as string | undefined
    const modifiers = args.modifiers as string[] | undefined
    const x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    const y = Math.round(normalizeCoord(coord[1]) * screenHeight)

    const modifierStr = modifiers?.length ? ` +[${modifiers.join('+')}]` : ''
    logger.debug(`click: [${coord[0]}, ${coord[1]}] -> screen(${x}, ${y})${modifierStr}${desc ? ` (target: ${desc})` : ''}`)

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

    // Execute click with state diff
    const stateDiffResult = await executeWithStateDiff(x, y, async () => {
      await moveMouse(x, y)

      // Press modifier keys
      if (modifierKeys.length > 0) {
        await keyboard.pressKey(...modifierKeys)
      }

      await mouse.leftClick()

      // Release modifier keys
      if (modifierKeys.length > 0) {
        await keyboard.releaseKey(...modifierKeys)
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
    const { mouse } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const desc = args.desc as string | undefined
    const x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    const y = Math.round(normalizeCoord(coord[1]) * screenHeight)

    logger.debug(`left_double: [${coord[0]}, ${coord[1]}] -> screen(${x}, ${y})${desc ? ` (target: ${desc})` : ''}`)

    // Execute double click with state diff
    const stateDiffResult = await executeWithStateDiff(x, y, async () => {
      await moveMouse(x, y)
      await mouse.doubleClick(0)
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
    const { mouse } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const desc = args.desc as string | undefined
    const x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    const y = Math.round(normalizeCoord(coord[1]) * screenHeight)

    logger.debug(`right_single: [${coord[0]}, ${coord[1]}] -> screen(${x}, ${y})${desc ? ` (target: ${desc})` : ''}`)

    // Execute right click with state diff
    const stateDiffResult = await executeWithStateDiff(x, y, async () => {
      await moveMouse(x, y)
      await mouse.rightClick()
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
    const { mouse, Button } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const desc = args.desc as string | undefined
    const x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    const y = Math.round(normalizeCoord(coord[1]) * screenHeight)

    logger.debug(`middle_click: [${coord[0]}, ${coord[1]}] -> screen(${x}, ${y})${desc ? ` (target: ${desc})` : ''}`)

    // Execute middle click with state diff
    const stateDiffResult = await executeWithStateDiff(x, y, async () => {
      await moveMouse(x, y)
      await mouse.click(Button.MIDDLE)
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
    const { mouse, Point, straightTo } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const startCoord = args.startCoordinate as number[]
    const endCoord = args.endCoordinate as number[]

    const startX = Math.round(normalizeCoord(startCoord[0]) * screenWidth)
    const startY = Math.round(normalizeCoord(startCoord[1]) * screenHeight)
    const endX = Math.round(normalizeCoord(endCoord[0]) * screenWidth)
    const endY = Math.round(normalizeCoord(endCoord[1]) * screenHeight)

    await moveMouse(startX, startY)
    await mouse.drag(straightTo(new Point(endX, endY)))

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
    const { mouse } = await import('@computer-use/nut-js')
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    const coord = args.coordinate as number[]
    const x = Math.round(normalizeCoord(coord[0]) * screenWidth)
    const y = Math.round(normalizeCoord(coord[1]) * screenHeight)
    const direction = args.direction as string

    await moveMouse(x, y)

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
