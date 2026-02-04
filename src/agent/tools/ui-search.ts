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

export const uiSearchTools: Tool[] = [findElementTool]
