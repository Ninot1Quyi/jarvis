/**
 * Accessibility Module Test
 *
 * Run: npx tsx test/accessibility.test.ts
 *
 * Note: On macOS, you need to grant accessibility permission to the terminal app
 * in System Preferences > Security & Privacy > Privacy > Accessibility
 */

import {
  isAccessibilityAvailable,
  queryNearbyElements,
  formatResultForAgent,
} from '../src/accessibility/index.js'

const SCREEN_WIDTH = 1728  // Adjust to your screen
const SCREEN_HEIGHT = 1117

async function testAccessibility() {
  console.log('='.repeat(60))
  console.log('Accessibility Module Test')
  console.log('='.repeat(60))
  console.log()

  // Test 1: Check availability
  console.log('📋 Test 1: Check if accessibility is available')
  const available = await isAccessibilityAvailable()
  console.log(`   Available: ${available ? '✅ Yes' : '❌ No'}`)

  if (!available) {
    console.log()
    console.log('⚠️  Accessibility not available.')
    console.log('   On macOS:')
    console.log('   1. Go to System Preferences > Security & Privacy > Privacy > Accessibility')
    console.log('   2. Add your terminal app (Terminal, iTerm2, etc.)')
    console.log('   3. Make sure the Swift CLI is built:')
    console.log('      cd native/macos/ax-query && swift build -c release')
    return
  }

  console.log()

  // Test 2: Query center of screen
  console.log('📋 Test 2: Query center of screen')
  const centerX = Math.round(SCREEN_WIDTH / 2)
  const centerY = Math.round(SCREEN_HEIGHT / 2)
  console.log(`   Query position: (${centerX}, ${centerY})`)

  const result1 = await queryNearbyElements(centerX, centerY, {
    maxElements: 5,
    maxDistance: 300,
    includeNonInteractive: true,
  })

  console.log(`   Success: ${result1.success ? '✅' : '❌'}`)
  console.log(`   Query time: ${result1.queryTimeMs}ms`)

  if (result1.error) {
    console.log(`   Error: ${result1.error}`)
  }

  if (result1.elementAtPoint) {
    console.log(`   Element at point:`)
    console.log(`     Role: ${result1.elementAtPoint.role} (${result1.elementAtPoint.rawRole})`)
    console.log(`     Title: "${result1.elementAtPoint.title}"`)
    console.log(`     Center: [${result1.elementAtPoint.center.join(', ')}]`)
    console.log(`     Size: ${result1.elementAtPoint.size[0]}×${result1.elementAtPoint.size[1]}px`)
  }

  console.log(`   Nearby elements: ${result1.nearbyElements.length}`)
  for (const el of result1.nearbyElements) {
    const marker = el.interactive ? '🔘' : '📄'
    console.log(`     ${marker} [${el.role}] "${el.title}" @ [${el.center.join(', ')}], ${el.distance.toFixed(0)}px away`)
  }

  console.log()

  // Test 3: Query top-left corner (likely menu bar on macOS)
  console.log('📋 Test 3: Query top-left corner (menu bar area)')
  const result2 = await queryNearbyElements(100, 15, {
    maxElements: 5,
    maxDistance: 200,
    includeNonInteractive: false,
  })

  console.log(`   Success: ${result2.success ? '✅' : '❌'}`)
  console.log(`   Query time: ${result2.queryTimeMs}ms`)
  console.log(`   Nearby interactive elements: ${result2.nearbyElements.length}`)

  for (const el of result2.nearbyElements) {
    console.log(`     🔘 [${el.role}] "${el.title}" @ [${el.center.join(', ')}]`)
  }

  console.log()

  // Test 4: Format result for agent
  console.log('📋 Test 4: Format result for agent display')
  const formatted = formatResultForAgent(result1, SCREEN_WIDTH, SCREEN_HEIGHT)
  if (formatted) {
    console.log('   Formatted output:')
    console.log(formatted)
  } else {
    console.log('   (No elements to format)')
  }

  console.log()

  // Test 5: Performance test - multiple queries
  console.log('📋 Test 5: Performance test (10 queries)')
  const positions = [
    [100, 100], [500, 100], [900, 100],
    [100, 500], [500, 500], [900, 500],
    [100, 900], [500, 900], [900, 900],
    [centerX, centerY],
  ]

  const times: number[] = []
  for (const [x, y] of positions) {
    const result = await queryNearbyElements(x, y, { maxElements: 3 })
    times.push(result.queryTimeMs)
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)

  console.log(`   Queries: ${times.length}`)
  console.log(`   Avg time: ${avgTime.toFixed(1)}ms`)
  console.log(`   Min time: ${minTime.toFixed(1)}ms`)
  console.log(`   Max time: ${maxTime.toFixed(1)}ms`)

  console.log()
  console.log('='.repeat(60))
  console.log('Test completed!')
  console.log('='.repeat(60))
}

// Run tests
testAccessibility().catch(console.error)
