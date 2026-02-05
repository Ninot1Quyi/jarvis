/**
 * UI Element Search Tool
 *
 * Allows the agent to search for UI elements by keyword when click positions are uncertain.
 */

import type { Tool } from '../../types.js'
import { logger } from '../../utils/logger.js'
import {
  searchUIElements,
  formatSearchResultForAgent,
  isAccessibilityAvailable,
} from '../../accessibility/index.js'

export const findElementTool: Tool = {
  definition: {
    name: 'find_element',
    description: 'Search for UI elements by keyword in the focused application. Use this when you are unsure about the exact position of a UI element. Returns matching elements with their coordinates.',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'The keyword to search for (e.g., "Insert", "Save", "File", "Submit")',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['keyword'],
    },
  },
  async execute(args, context) {
    const keyword = args.keyword as string
    const maxResults = (args.max_results as number) || 5
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    if (!keyword || keyword.trim() === '') {
      return {
        success: false,
        error: 'Keyword is required',
      }
    }

    if (!(await isAccessibilityAvailable())) {
      return {
        success: false,
        error: 'Accessibility features not available on this platform',
      }
    }

    logger.debug(`Searching UI elements for: "${keyword}"`)

    const result = await searchUIElements(keyword.trim(), { maxResults })

    logger.debug(`Search completed: ${result.results.length} results in ${result.queryTimeMs}ms`)

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Search failed',
      }
    }

    const formattedResult = formatSearchResultForAgent(result, screenWidth, screenHeight)

    return {
      success: true,
      message: formattedResult,
      data: {
        keyword: result.searchKeyword,
        resultCount: result.results.length,
        queryTimeMs: result.queryTimeMs,
      },
    }
  },
}

export const locateElementTool: Tool = {
  definition: {
    name: 'locate',
    description: 'Locate UI element for next action. Call this as the LAST action in each response to pre-search the element you plan to interact with next. Returns precise center coordinates from accessibility tree. Combine this with visual analysis for accurate clicking.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the UI element to locate for next action (e.g., "Insert", "Shape", "Save")',
        },
      },
      required: ['name'],
    },
  },
  async execute(args, context) {
    const name = args.name as string
    const screenWidth = (context?.screenWidth as number) || 1920
    const screenHeight = (context?.screenHeight as number) || 1080

    if (!name || name.trim() === '') {
      return {
        success: false,
        error: 'Element name is required',
      }
    }

    if (!(await isAccessibilityAvailable())) {
      return {
        success: false,
        error: 'Accessibility features not available on this platform',
      }
    }

    logger.debug(`Locating element for next action: "${name}"`)

    const result = await searchUIElements(name.trim(), { maxResults: 5 })

    logger.debug(`Locate completed: ${result.results.length} results in ${result.queryTimeMs}ms`)

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Locate failed',
      }
    }

    // Filter results: only keep high similarity matches (>= 0.7)
    const relevantResults = result.results.filter(el => el.similarity && el.similarity >= 0.7)

    if (relevantResults.length === 0) {
      return {
        success: true,
        message: `Element "${name}" not found. Use visual analysis from screenshot to determine position.`,
        data: {
          name,
          found: false,
        },
      }
    }

    // Take top 2 results
    const topResults = relevantResults.slice(0, 2)

    // Format results concisely for next action planning
    const toNormalized = (x: number, y: number): [number, number] => [
      Math.round((x / screenWidth) * 1000),
      Math.round((y / screenHeight) * 1000),
    ]

    const elements = topResults.map(el => {
      const [normX, normY] = toNormalized(el.center[0], el.center[1])
      const roleDisplay = el.role === 'unknown' ? el.rawRole : el.role
      return `[${roleDisplay}] "${el.title}" at [${normX}, ${normY}]`
    })

    const message = `Located "${name}":\n${elements.map(e => `  ${e}`).join('\n')}`

    return {
      success: true,
      message,
      data: {
        name,
        found: true,
        count: topResults.length,
        elements: topResults.map(el => ({
          role: el.role === 'unknown' ? el.rawRole : el.role,
          title: el.title,
          coordinate: toNormalized(el.center[0], el.center[1]),
        })),
      },
    }
  },
}

export const uiSearchTools: Tool[] = [findElementTool, locateElementTool]
