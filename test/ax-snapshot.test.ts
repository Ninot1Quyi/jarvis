/**
 * AX Snapshot Unit Tests
 *
 * Tests for captureAXSnapshot (cross-platform) and computeAXDiff.
 * Run with: npx tsx test/ax-snapshot.test.ts [mode]
 *
 * Modes:
 *   mock  - Test computeAXDiff with mock data (default, no OS dependency)
 *   live  - Test captureAXSnapshot on current platform (requires running GUI)
 *   all   - Run both
 */

import { captureAXSnapshot, computeAXDiff, filterDiffNoise } from '../src/notification/axSnapshot.js'

// ANSI colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
}

let passed = 0
let failed = 0

function logSuccess(message: string) {
  passed++
  console.log(`${colors.green}[PASS]${colors.reset} ${message}`)
}

function logError(message: string) {
  failed++
  console.log(`${colors.red}[FAIL]${colors.reset} ${message}`)
}

function logInfo(message: string) {
  console.log(`${colors.cyan}  ->  ${colors.reset} ${message}`)
}

function logSection(title: string) {
  console.log(`\n${colors.bold}${colors.yellow}=== ${title} ===${colors.reset}\n`)
}

function assert(condition: boolean, passMsg: string, failMsg: string) {
  if (condition) {
    logSuccess(passMsg)
  } else {
    logError(failMsg)
  }
}

// ============================================================================
// Mock tests for computeAXDiff
// ============================================================================

function testDiffEmpty() {
  logSection('computeAXDiff: both empty')
  const diff = computeAXDiff([], [])
  assert(diff.added.length === 0 && diff.removed.length === 0,
    'Empty arrays produce empty diff',
    `Expected empty diff, got +${diff.added.length} -${diff.removed.length}`)
}

function testDiffIdentical() {
  logSection('computeAXDiff: identical arrays')
  const lines = [
    'Button|t=Send',
    'StaticText|t=Hello',
    'TextField|t=Message|d=inputField',
  ]
  const diff = computeAXDiff(lines, lines)
  assert(diff.added.length === 0 && diff.removed.length === 0,
    'Identical arrays produce empty diff',
    `Expected empty diff, got +${diff.added.length} -${diff.removed.length}`)
}

function testDiffAddedLines() {
  logSection('computeAXDiff: new lines added')
  const before = [
    'Button|t=Send',
    'StaticText|t=Hello',
  ]
  const after = [
    'Button|t=Send',
    'StaticText|t=Hello',
    'StaticText|t=New message from Alice',
    'Image|d=avatar_alice',
  ]
  const diff = computeAXDiff(before, after)
  assert(diff.added.length === 2,
    `Detected 2 added lines`,
    `Expected 2 added, got ${diff.added.length}`)
  assert(diff.removed.length === 0,
    'No removed lines',
    `Expected 0 removed, got ${diff.removed.length}`)
  assert(diff.added.includes('StaticText|t=New message from Alice'),
    'Added lines contain the new message',
    'New message line not found in added')
}

function testDiffRemovedLines() {
  logSection('computeAXDiff: lines removed')
  const before = [
    'Button|t=Send',
    'StaticText|t=Hello',
    'StaticText|t=Typing...',
  ]
  const after = [
    'Button|t=Send',
    'StaticText|t=Hello',
  ]
  const diff = computeAXDiff(before, after)
  assert(diff.added.length === 0,
    'No added lines',
    `Expected 0 added, got ${diff.added.length}`)
  assert(diff.removed.length === 1,
    'Detected 1 removed line',
    `Expected 1 removed, got ${diff.removed.length}`)
  assert(diff.removed[0] === 'StaticText|t=Typing...',
    'Removed line is the typing indicator',
    `Unexpected removed line: ${diff.removed[0]}`)
}

function testDiffMixed() {
  logSection('computeAXDiff: mixed add/remove (IM message scenario)')
  const before = [
    'ListItem|t=Chat with Bob',
    'StaticText|t=Bob: Hey',
    'StaticText|t=You: Hi',
    'StaticText|t=Typing...',
    'TextField|t=Message|d=inputField',
    'Button|t=Send|d=sendBtn',
  ]
  const after = [
    'ListItem|t=Chat with Bob',
    'StaticText|t=Bob: Hey',
    'StaticText|t=You: Hi',
    'StaticText|t=Bob: Check this out',
    'StaticText|t=Bob: [image]',
    'TextField|t=Message|d=inputField',
    'Button|t=Send|d=sendBtn',
  ]
  const diff = computeAXDiff(before, after)
  assert(diff.added.length === 2,
    `Detected 2 new messages from Bob`,
    `Expected 2 added, got ${diff.added.length}`)
  assert(diff.removed.length === 1,
    'Typing indicator removed',
    `Expected 1 removed, got ${diff.removed.length}`)
  assert(diff.removed[0] === 'StaticText|t=Typing...',
    'Removed line is typing indicator',
    `Unexpected removed: ${diff.removed[0]}`)
}

function testDiffDuplicateLines() {
  logSection('computeAXDiff: duplicate lines handled correctly')
  const before = [
    'StaticText|t=Hello',
    'StaticText|t=Hello',
  ]
  const after = [
    'StaticText|t=Hello',
    'StaticText|t=Hello',
    'StaticText|t=Hello',
  ]
  const diff = computeAXDiff(before, after)
  assert(diff.added.length === 1,
    'One duplicate added correctly (2->3)',
    `Expected 1 added, got ${diff.added.length}`)
  assert(diff.removed.length === 0,
    'No removed lines',
    `Expected 0 removed, got ${diff.removed.length}`)
}

function testDiffLineFormat() {
  logSection('computeAXDiff: Windows UIA line format compatibility')
  // Simulate the exact format Get-AXLines produces
  const before = [
    'Button|t=Send|d=sendBtn',
    'TextField|t=Message|v=|d=inputField',
    'StaticText|t=12:30 PM',
    'Group|d=chatContainer',
    'ListItem|t=Alice',
  ]
  const after = [
    'Button|t=Send|d=sendBtn',
    'TextField|t=Message|v=Hello!|d=inputField',
    'StaticText|t=12:30 PM',
    'StaticText|t=12:31 PM',
    'Group|d=chatContainer',
    'ListItem|t=Alice',
    'StaticText|t=Alice: Got it',
  ]
  const diff = computeAXDiff(before, after)
  assert(diff.added.length === 3,
    'Detected 3 changes (value change + timestamp + new message)',
    `Expected 3 added, got ${diff.added.length}: ${JSON.stringify(diff.added)}`)
  assert(diff.removed.length === 1,
    'Old value line removed',
    `Expected 1 removed, got ${diff.removed.length}: ${JSON.stringify(diff.removed)}`)
}

function testFilterNoiseUIRefresh() {
  logSection('filterDiffNoise: pure UI refresh noise (same element, text changed)')
  // Scrollbar position changed, button text updated -- same automationId
  const diff = {
    added: [
      'Button|t=垂直小幅下降 (2)|d=VerticalSmallDecrease',
      'ScrollBar|t=垂直|v=280|d=ScrollBar',
      'StaticText|t=12:31 PM|d=ClockText',
    ],
    removed: [
      'Button|t=垂直小幅下降|d=VerticalSmallDecrease',
      'ScrollBar|t=垂直|v=274|d=ScrollBar',
      'StaticText|t=12:30 PM|d=ClockText',
    ],
  }
  const genuine = filterDiffNoise(diff)
  assert(genuine.length === 0,
    'All noise filtered out (0 genuine)',
    `Expected 0 genuine, got ${genuine.length}: ${JSON.stringify(genuine)}`)
}

function testFilterNoiseRealMessage() {
  logSection('filterDiffNoise: real IM messages (no matching removed skeleton)')
  const diff = {
    added: [
      'StaticText|t=Alice: Got it',
      'StaticText|t=Alice: See you tomorrow',
      'Group|t=Alice',
    ],
    removed: [],
  }
  const genuine = filterDiffNoise(diff)
  assert(genuine.length === 3,
    'All 3 lines are genuine (no noise to filter)',
    `Expected 3 genuine, got ${genuine.length}`)
}

function testFilterNoiseMixed() {
  logSection('filterDiffNoise: mixed noise + real messages')
  // Scenario: terminal scrollbar changed (noise) + new IM message appeared (real)
  const diff = {
    added: [
      'ScrollBar|t=垂直|v=300|d=ScrollBar',
      'Button|t=关闭标签页 (2)|d=CloseButton',
      'StaticText|t=Bob: New message!',
      'StaticText|t=10:05 AM',
    ],
    removed: [
      'ScrollBar|t=垂直|v=274|d=ScrollBar',
      'Button|t=关闭标签页|d=CloseButton',
    ],
  }
  const genuine = filterDiffNoise(diff)
  assert(genuine.length === 2,
    'Filtered to 2 genuine lines (noise cancelled)',
    `Expected 2 genuine, got ${genuine.length}: ${JSON.stringify(genuine)}`)
  assert(genuine.includes('StaticText|t=Bob: New message!'),
    'Real message preserved',
    'Real message was incorrectly filtered')
}

function testFilterNoiseNoAutomationId() {
  logSection('filterDiffNoise: lines without automationId are always genuine')
  // Lines without d= field can't be matched by skeleton, so they pass through
  const diff = {
    added: [
      'StaticText|t=Hello',
      'Group|t=SomeGroup',
    ],
    removed: [
      'StaticText|t=Goodbye',
      'Group|t=OtherGroup',
    ],
  }
  const genuine = filterDiffNoise(diff)
  assert(genuine.length === 2,
    'Lines without automationId pass through (2 genuine)',
    `Expected 2 genuine, got ${genuine.length}: ${JSON.stringify(genuine)}`)
}

function runMockTests() {
  logSection('Mock Tests: computeAXDiff')
  testDiffEmpty()
  testDiffIdentical()
  testDiffAddedLines()
  testDiffRemovedLines()
  testDiffMixed()
  testDiffDuplicateLines()
  testDiffLineFormat()
  testFilterNoiseUIRefresh()
  testFilterNoiseRealMessage()
  testFilterNoiseMixed()
  testFilterNoiseNoAutomationId()
}

// ============================================================================
// Live test: captureAXSnapshot on current platform
// ============================================================================

async function runLiveTests() {
  logSection(`Live Tests: captureAXSnapshot (platform: ${process.platform})`)

  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    logInfo(`Platform ${process.platform} not supported, skipping live tests`)
    return
  }

  // Test 1: Single capture
  logInfo('Capturing AX snapshot of foreground window...')
  const t0 = Date.now()
  const snap = await captureAXSnapshot()
  const elapsed = Date.now() - t0

  if (!snap) {
    logError(`captureAXSnapshot returned null (${elapsed}ms). Is the native binary/script available?`)
    return
  }

  logSuccess(`Snapshot captured in ${elapsed}ms`)

  assert(typeof snap.appName === 'string' && snap.appName.length > 0,
    `appName: "${snap.appName}"`,
    `appName is empty or not a string: ${JSON.stringify(snap.appName)}`)

  assert(typeof snap.bundleId === 'string' && snap.bundleId.length > 0,
    `bundleId: "${snap.bundleId}"`,
    `bundleId is empty or not a string: ${JSON.stringify(snap.bundleId)}`)

  assert(Array.isArray(snap.lines),
    `lines is an array with ${snap.lines.length} elements`,
    `lines is not an array: ${typeof snap.lines}`)

  assert(snap.lines.length > 0,
    `lines is non-empty (${snap.lines.length} nodes)`,
    'lines array is empty -- foreground window has no UIA elements?')

  // Validate line format: first field should be a role, optionally followed by |key=value pairs
  const lineFormatOk = snap.lines.every(line => {
    // At minimum: "Role" or "Role|t=..." or "Role|v=..." or "Role|d=..."
    const parts = line.split('|')
    if (parts.length === 0) return false
    // Role should be non-empty and not contain '='
    if (!parts[0] || parts[0].includes('=')) return false
    // Remaining parts should be key=value
    for (let i = 1; i < parts.length; i++) {
      if (!/^[tvd]=/.test(parts[i])) return false
    }
    return true
  })
  assert(lineFormatOk,
    'All lines match expected format: Role|t=...|v=...|d=...',
    `Some lines have unexpected format. First 5: ${JSON.stringify(snap.lines.slice(0, 5))}`)

  // Show sample lines
  logInfo('Sample lines (first 10):')
  for (const line of snap.lines.slice(0, 10)) {
    logInfo(`  ${line}`)
  }

  // Test 2: Two consecutive captures -- filterDiffNoise should eliminate UI refresh noise
  logInfo('Capturing second snapshot for diff stability test...')
  const snap2 = await captureAXSnapshot()
  if (snap2 && snap2.bundleId === snap.bundleId) {
    const diff = computeAXDiff(snap.lines, snap2.lines)
    const totalChanges = diff.added.length + diff.removed.length
    if (totalChanges > 0) {
      logInfo(`Raw diff: +${diff.added.length} -${diff.removed.length}`)
    }
    const genuine = filterDiffNoise(diff)
    assert(genuine.length === 0,
      `Rapid diff after noise filter: 0 genuine (raw: +${diff.added.length} -${diff.removed.length})`,
      `Rapid diff has ${genuine.length} genuine changes after filtering: ${JSON.stringify(genuine.slice(0, 5))}`)
  } else {
    logInfo('Second snapshot returned different app or null, skipping diff stability test')
  }

  // Test 3: Timeout / performance
  assert(elapsed < 5000,
    `Capture completed within timeout (${elapsed}ms < 5000ms)`,
    `Capture too slow: ${elapsed}ms`)
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`${colors.bold}AX Snapshot Tests${colors.reset}`)
  console.log('='.repeat(50))

  const args = process.argv.slice(2)
  const testMode = args[0] || 'mock'

  if (testMode === 'mock' || testMode === 'all') {
    runMockTests()
  }

  if (testMode === 'live' || testMode === 'all') {
    await runLiveTests()
  }

  if (!['mock', 'live', 'all'].includes(testMode)) {
    console.log('\nUsage: npx tsx test/ax-snapshot.test.ts [mode]')
    console.log('Modes:')
    console.log('  mock  - Test computeAXDiff with mock data (default)')
    console.log('  live  - Test captureAXSnapshot on current platform')
    console.log('  all   - Run both')
    return
  }

  console.log('\n' + '='.repeat(50))
  console.log(`Results: ${colors.green}${passed} passed${colors.reset}, ${colors.red}${failed} failed${colors.reset}`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(console.error)
