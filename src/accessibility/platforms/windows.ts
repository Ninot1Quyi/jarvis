/**
 * Windows Accessibility Provider (Placeholder)
 *
 * TODO: Implement using UI Automation API
 *
 * =============================================================================
 * IMPLEMENTATION REQUIREMENTS - UI Change Detection
 * =============================================================================
 *
 * When implementing captureState() and state diff, the following changes MUST
 * be detected to provide complete UI change feedback to the agent:
 *
 * ## 1. Container-level Changes
 * - Application change (focused app switched)
 * - Window changes (opened, closed, focus changed)
 * - Menu changes (opened, closed)
 * - Dialog/Sheet changes (modal dialogs, file pickers, alerts)
 * - Popover changes (popup windows)
 *
 * ## 2. Tab/Navigation Changes (CRITICAL for browsers)
 * - Tab changes in tab groups (new tab opened, tab closed, active tab changed)
 * - Browser column changes (for column-view file browsers)
 *
 * ## 3. Focus/Selection Changes
 * - Focused element change
 * - Element at click point change
 * - Selected children change (list items, tree items)
 * - Selected rows change (tables, outlines)
 * - Selected cells change (spreadsheets, grids)
 *
 * ## 4. State Changes
 * - Expanded/Collapsed state (dropdowns, disclosure triangles, tree nodes)
 * - Enabled/Disabled state (buttons, menu items)
 * - Busy/Loading state (progress indicators, loading spinners)
 * - Minimized state (windows)
 * - Modal state (dialogs)
 * - Checked state (checkboxes, radio buttons)
 *
 * ## 5. Value Changes
 * - Value change (text fields, sliders, progress bars)
 * - Selected text change (text editors)
 *
 * ## Windows UI Automation Equivalents
 * - UIA_AutomationFocusChangedEventId
 * - UIA_StructureChangedEventId
 * - UIA_Window_WindowOpenedEventId / WindowClosedEventId
 * - UIA_SelectionItem_ElementSelectedEventId
 * - UIA_ExpandCollapseExpandCollapseStatePropertyId
 * - UIA_ToggleToggleStatePropertyId
 * - UIA_ValueValuePropertyId
 * - UIA_RangeValueValuePropertyId
 *
 * Reference: https://docs.microsoft.com/en-us/windows/win32/winauto/uiauto-eventsoverview
 * =============================================================================
 */

import type {
  AccessibilityProvider,
  AccessibilityQueryOptions,
  AccessibilityQueryResult,
  AccessibilitySearchOptions,
  AccessibilitySearchResult,
} from '../types.js'

export class WindowsAccessibilityProvider implements AccessibilityProvider {
  platform = 'win32' as const

  async isAvailable(): Promise<boolean> {
    return false
  }

  async query(options: AccessibilityQueryOptions): Promise<AccessibilityQueryResult> {
    return {
      success: false,
      error: 'Windows accessibility provider not implemented yet',
      nearbyElements: [],
      queryPosition: [options.x, options.y],
      queryTimeMs: 0,
    }
  }

  async search(options: AccessibilitySearchOptions): Promise<AccessibilitySearchResult> {
    return {
      success: false,
      error: 'Windows accessibility provider not implemented yet',
      results: [],
      searchKeyword: options.keyword,
      queryTimeMs: 0,
    }
  }
}

export const provider = new WindowsAccessibilityProvider()
