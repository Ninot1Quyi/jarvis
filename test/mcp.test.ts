/**
 * MCP integration test -- verifies McpManager + McpToolAdapter work end-to-end.
 *
 * Uses @modelcontextprotocol/server-everything as a test server (stdio mode).
 * Run: npx tsx test/mcp.test.ts
 */
import { McpManager } from '../src/mcp/McpManager.js'
import type { McpServerConfig } from '../src/types.js'

async function test() {
  const manager = new McpManager()

  // --- Test 1: stdio transport with server-everything ---
  console.log('=== Test 1: stdio transport ===')

  const servers: Record<string, McpServerConfig> = {
    everything: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    },
  }

  const tools = await manager.connectAll(servers)

  console.log(`Connected. Tools count: ${tools.length}`)
  console.log('Tool names:', tools.map(t => t.definition.name))

  if (tools.length === 0) {
    console.error('FAIL: No tools registered')
    process.exit(1)
  }

  // Verify naming convention: mcp__everything__<toolName>
  const echoTool = tools.find(t => t.definition.name === 'mcp__everything__echo')
  if (!echoTool) {
    console.error('FAIL: mcp__everything__echo not found')
    console.error('Available:', tools.map(t => t.definition.name))
    process.exit(1)
  }
  console.log('PASS: echo tool found with correct prefix')

  // Test tool execution: echo
  console.log('\n--- Calling echo tool ---')
  const echoResult = await echoTool.execute({ message: 'hello from jarvis' })
  console.log('Echo result:', JSON.stringify(echoResult, null, 2))

  if (!echoResult.success) {
    console.error('FAIL: echo tool returned error:', echoResult.error)
    process.exit(1)
  }
  if (!echoResult.message?.includes('hello from jarvis')) {
    console.error('FAIL: echo result does not contain expected text')
    process.exit(1)
  }
  console.log('PASS: echo tool works')

  // Test tool execution: add
  const addTool = tools.find(t => t.definition.name === 'mcp__everything__add')
  if (addTool) {
    console.log('\n--- Calling add tool ---')
    const addResult = await addTool.execute({ a: 3, b: 7 })
    console.log('Add result:', JSON.stringify(addResult, null, 2))

    if (!addResult.success) {
      console.error('FAIL: add tool returned error:', addResult.error)
      process.exit(1)
    }
    if (!addResult.message?.includes('10')) {
      console.error('FAIL: add result does not contain 10')
      process.exit(1)
    }
    console.log('PASS: add tool works')
  }

  // Test tool definition structure
  console.log('\n--- Checking tool definition structure ---')
  const def = echoTool.definition
  if (def.parameters.type !== 'object') {
    console.error('FAIL: parameters.type is not object')
    process.exit(1)
  }
  if (!def.description.startsWith('[MCP:everything]')) {
    console.error('FAIL: description missing MCP prefix')
    process.exit(1)
  }
  console.log('PASS: tool definition structure correct')

  // Test getToolNames
  console.log('\n--- Checking getToolNames ---')
  const names = manager.getToolNames()
  if (names.length !== tools.length) {
    console.error(`FAIL: getToolNames returned ${names.length}, expected ${tools.length}`)
    process.exit(1)
  }
  console.log(`PASS: getToolNames returns ${names.length} names`)

  // --- Test 2: error isolation (bad server) ---
  console.log('\n=== Test 2: error isolation ===')
  const manager2 = new McpManager()
  const badServers: Record<string, McpServerConfig> = {
    bad: {
      command: 'nonexistent-command-that-does-not-exist',
      args: [],
    },
  }
  const badTools = await manager2.connectAll(badServers)
  if (badTools.length !== 0) {
    console.error('FAIL: bad server should return 0 tools')
    process.exit(1)
  }
  console.log('PASS: bad server gracefully skipped, 0 tools')
  await manager2.disconnectAll()

  // --- Test 3: disabled server ---
  console.log('\n=== Test 3: disabled server ===')
  const manager3 = new McpManager()
  const disabledServers: Record<string, McpServerConfig> = {
    disabled: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
      enabled: false,
    },
  }
  const disabledTools = await manager3.connectAll(disabledServers)
  if (disabledTools.length !== 0) {
    console.error('FAIL: disabled server should return 0 tools')
    process.exit(1)
  }
  console.log('PASS: disabled server skipped')
  await manager3.disconnectAll()

  // Cleanup
  console.log('\n=== Cleanup ===')
  await manager.disconnectAll()
  console.log('PASS: disconnected all')

  console.log('\n=============================')
  console.log('ALL TESTS PASSED')
  console.log('=============================')
}

test().catch(err => {
  console.error('Test failed with error:', err)
  process.exit(1)
})
