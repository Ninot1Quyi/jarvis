/**
 * State Diff Unit Tests
 *
 * Tests for the UI state snapshot and diff functionality.
 * Run with: npx tsx test/state-diff.test.ts
 */

import {
  captureState,
  diffState,
  formatDiffForAgent,
  type StateSnapshot,
  type StateDiff,
} from '../src/accessibility/index.js'

// ANSI colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
}

function log(message: string) {
  console.log(message)
}

function logSuccess(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

function logError(message: string) {
  console.log(`${colors.red}✗${colors.reset} ${message}`)
}

function logInfo(message: string) {
  console.log(`${colors.cyan}ℹ${colors.reset} ${message}`)
}

function logSection(title: string) {
  console.log(`\n${colors.bold}${colors.yellow}=== ${title} ===${colors.reset}\n`)
}

// ============================================================================
// Test: diffState with mock data
// ============================================================================

function testDiffStateWithMockData() {
  logSection('Test: diffState with mock data')

  // Mock snapshot before
  const before: StateSnapshot = {
    success: true,
    timestamp: Date.now() / 1000,
    focusedApplication: {
      title: 'Finder',
      bundleIdentifier: 'com.apple.finder',
      isFrontmost: true,
      isHidden: false,
      pid: 1234,
    },
    focusedWindow: {
      title: 'Documents',
      role: 'AXWindow',
      isMain: true,
      isMinimized: false,
      isFocused: true,
    },
    focusedElement: {
      role: 'AXButton',
      title: 'Open',
      focused: true,
    },
    windows: [
      { title: 'Documents', role: 'AXWindow', isMain: true, isMinimized: false, isFocused: true },
    ],
    openMenus: [],
    queryTimeMs: 50,
  }

  // Mock snapshot after - menu opened
  const afterMenuOpened: StateSnapshot = {
    success: true,
    timestamp: (Date.now() + 100) / 1000,
    focusedApplication: {
      title: 'Finder',
      bundleIdentifier: 'com.apple.finder',
      isFrontmost: true,
      isHidden: false,
      pid: 1234,
    },
    focusedWindow: {
      title: 'Documents',
      role: 'AXWindow',
      isMain: true,
      isMinimized: false,
      isFocused: true,
    },
    focusedElement: {
      role: 'AXMenuItem',
      title: 'New Folder',
      focused: true,
    },
    windows: [
      { title: 'Documents', role: 'AXWindow', isMain: true, isMinimized: false, isFocused: true },
    ],
    openMenus: [
      {
        title: 'File',
        role: 'AXMenu',
        items: ['New Folder', 'New File', 'Open', 'Close'],
      },
    ],
    queryTimeMs: 50,
  }

  // Test 1: Menu opened
  log('Test 1: Detect menu opened')
  const diff1 = diffState(before, afterMenuOpened)

  if (diff1.menusOpened.length > 0) {
    logSuccess(`Menu opened detected: ${diff1.menusOpened[0].title}`)
  } else {
    logError('Failed to detect menu opened')
  }

  if (diff1.focusChanged) {
    logSuccess(`Focus changed: ${diff1.focusedElementBefore?.title} → ${diff1.focusedElementAfter?.title}`)
  } else {
    logError('Failed to detect focus change')
  }

  log(`Summary: ${diff1.summary.join(', ')}`)

  // Test 2: Window opened
  log('\nTest 2: Detect window opened')
  const afterWindowOpened: StateSnapshot = {
    ...before,
    timestamp: (Date.now() + 100) / 1000,
    windows: [
      { title: 'Documents', role: 'AXWindow', isMain: true, isMinimized: false, isFocused: false },
      { title: 'New Window', role: 'AXWindow', isMain: false, isMinimized: false, isFocused: true },
    ],
    focusedWindow: {
      title: 'New Window',
      role: 'AXWindow',
      isMain: false,
      isMinimized: false,
      isFocused: true,
    },
  }

  const diff2 = diffState(before, afterWindowOpened)

  if (diff2.windowsOpened.length > 0) {
    logSuccess(`Window opened detected: ${diff2.windowsOpened[0].title}`)
  } else {
    logError('Failed to detect window opened')
  }

  if (diff2.windowFocusChanged) {
    logSuccess(`Window focus changed`)
  } else {
    logError('Failed to detect window focus change')
  }

  log(`Summary: ${diff2.summary.join(', ')}`)

  // Test 3: No change
  log('\nTest 3: Detect no change')
  const diff3 = diffState(before, before)

  if (diff3.summary.includes('No significant UI changes detected')) {
    logSuccess('Correctly detected no change')
  } else {
    logError('Failed to detect no change')
  }

  // Test 4: Application switched
  log('\nTest 4: Detect application switch')
  const afterAppSwitch: StateSnapshot = {
    ...before,
    timestamp: (Date.now() + 100) / 1000,
    focusedApplication: {
      title: 'Safari',
      bundleIdentifier: 'com.apple.Safari',
      isFrontmost: true,
      isHidden: false,
      pid: 5678,
    },
  }

  const diff4 = diffState(before, afterAppSwitch)

  if (diff4.applicationChanged) {
    logSuccess(`Application changed: ${diff4.applicationBefore?.title} → ${diff4.applicationAfter?.title}`)
  } else {
    logError('Failed to detect application change')
  }

  log(`Summary: ${diff4.summary.join(', ')}`)

  // Test 5: Format diff for agent
  log('\nTest 5: Format diff for agent')
  const formatted = formatDiffForAgent(diff1)
  log('Formatted output:')
  log(formatted)

  if (formatted.includes('UI Changes:')) {
    logSuccess('Formatted output contains UI Changes header')
  } else {
    logError('Formatted output missing UI Changes header')
  }
}

// ============================================================================
// Test: Live capture (requires accessibility permission)
// ============================================================================

async function testLiveCapture() {
  logSection('Test: Live state capture')

  logInfo('Capturing current UI state...')

  const snapshot = await captureState()

  if (!snapshot.success) {
    logError(`Capture failed: ${snapshot.error}`)
    return
  }

  logSuccess(`Capture successful in ${snapshot.queryTimeMs.toFixed(0)}ms`)

  if (snapshot.focusedApplication) {
    logSuccess(`Focused app: ${snapshot.focusedApplication.title} (${snapshot.focusedApplication.bundleIdentifier})`)
  }

  if (snapshot.focusedWindow) {
    logSuccess(`Focused window: ${snapshot.focusedWindow.title}`)
  }

  if (snapshot.focusedElement) {
    logSuccess(`Focused element: [${snapshot.focusedElement.role}] ${snapshot.focusedElement.title || '(no title)'}`)
  }

  logInfo(`Windows: ${snapshot.windows.length}`)
  for (const w of snapshot.windows) {
    log(`  - ${w.title || '(untitled)'} ${w.isMain ? '(main)' : ''} ${w.isFocused ? '(focused)' : ''}`)
  }

  logInfo(`Open menus: ${snapshot.openMenus.length}`)
  for (const m of snapshot.openMenus) {
    log(`  - ${m.title || '(popup)'}: ${m.items?.slice(0, 3).join(', ')}${(m.items?.length || 0) > 3 ? '...' : ''}`)
  }
}

// ============================================================================
// Test: Live diff (captures before and after with delay)
// ============================================================================

async function testLiveDiff() {
  logSection('Test: Live state diff')

  logInfo('This test will:')
  logInfo('1. Capture state now')
  logInfo('2. Wait 3 seconds (make a UI change!)')
  logInfo('3. Capture state again')
  logInfo('4. Show the diff')
  log('')

  logInfo('Capturing BEFORE state...')
  const before = await captureState()

  if (!before.success) {
    logError(`Before capture failed: ${before.error}`)
    return
  }

  logSuccess('Before state captured')
  logInfo('Waiting 3 seconds... Make a UI change now! (click something, open a menu, etc.)')

  await new Promise(resolve => setTimeout(resolve, 3000))

  logInfo('Capturing AFTER state...')
  const after = await captureState()

  if (!after.success) {
    logError(`After capture failed: ${after.error}`)
    return
  }

  logSuccess('After state captured')

  log('\n--- Diff Results ---\n')

  const diff = diffState(before, after)
  const formatted = formatDiffForAgent(diff)

  log(formatted)

  log('\n--- Detailed Changes ---\n')

  if (diff.applicationChanged) {
    logInfo(`App: ${diff.applicationBefore?.title} → ${diff.applicationAfter?.title}`)
  }

  if (diff.windowFocusChanged) {
    logInfo(`Window: ${diff.focusedWindowBefore?.title} → ${diff.focusedWindowAfter?.title}`)
  }

  if (diff.focusChanged) {
    const beforeEl = diff.focusedElementBefore
    const afterEl = diff.focusedElementAfter
    logInfo(`Focus: [${beforeEl?.role}] ${beforeEl?.title || '?'} → [${afterEl?.role}] ${afterEl?.title || '?'}`)
  }

  if (diff.windowsOpened.length > 0) {
    logInfo(`Windows opened: ${diff.windowsOpened.map(w => w.title).join(', ')}`)
  }

  if (diff.windowsClosed.length > 0) {
    logInfo(`Windows closed: ${diff.windowsClosed.map(w => w.title).join(', ')}`)
  }

  if (diff.menusOpened.length > 0) {
    logInfo(`Menus opened: ${diff.menusOpened.map(m => m.title || 'popup').join(', ')}`)
  }

  if (diff.menusClosed.length > 0) {
    logInfo(`Menus closed: ${diff.menusClosed.map(m => m.title || 'popup').join(', ')}`)
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`${colors.bold}State Diff Tests${colors.reset}`)
  console.log('='.repeat(50))

  const args = process.argv.slice(2)
  const testMode = args[0] || 'mock'

  if (testMode === 'mock' || testMode === 'all') {
    testDiffStateWithMockData()
  }

  if (testMode === 'live' || testMode === 'all') {
    await testLiveCapture()
  }

  if (testMode === 'diff' || testMode === 'all') {
    await testLiveDiff()
  }

  if (!['mock', 'live', 'diff', 'all'].includes(testMode)) {
    log('\nUsage: npx tsx test/state-diff.test.ts [mode]')
    log('Modes:')
    log('  mock  - Test diffState with mock data (default)')
    log('  live  - Test live state capture')
    log('  diff  - Test live diff (3 second delay to make changes)')
    log('  all   - Run all tests')
  }

  console.log('\n' + '='.repeat(50))
  console.log('Tests completed')
}

main().catch(console.error)
