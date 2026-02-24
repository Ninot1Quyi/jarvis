/**
 * MCP HTTP transport test -- verifies Streamable HTTP connection.
 *
 * Requires: npx @modelcontextprotocol/server-everything streamableHttp
 * running on localhost:3001 before executing this test.
 *
 * Run: npx tsx test/mcp-http.test.ts
 */
import { McpManager } from '../src/mcp/McpManager.js'
import type { McpServerConfig } from '../src/types.js'

async function test() {
  const manager = new McpManager()

  console.log('=== Test: HTTP (Streamable HTTP) transport ===')

  const servers: Record<string, McpServerConfig> = {
    everything: {
      url: 'http://localhost:3001/mcp',
    },
  }

  const tools = await manager.connectAll(servers)

  console.log(`Connected. Tools count: ${tools.length}`)
  console.log('Tool names:', tools.map(t => t.definition.name))

  if (tools.length === 0) {
    console.error('FAIL: No tools registered')
    process.exit(1)
  }
  console.log('PASS: tools registered via HTTP transport')

  // Verify naming
  const echoTool = tools.find(t => t.definition.name === 'mcp__everything__echo')
  if (!echoTool) {
    console.error('FAIL: mcp__everything__echo not found')
    process.exit(1)
  }
  console.log('PASS: echo tool found with correct prefix')

  // Call echo
  console.log('\n--- Calling echo tool via HTTP ---')
  const echoResult = await echoTool.execute({ message: 'hello via HTTP' })
  console.log('Echo result:', JSON.stringify(echoResult, null, 2))

  if (!echoResult.success || !echoResult.message?.includes('hello via HTTP')) {
    console.error('FAIL: echo tool did not return expected result')
    process.exit(1)
  }
  console.log('PASS: echo tool works via HTTP')

  // Call add (get-sum in server-everything)
  const addTool = tools.find(t => t.definition.name === 'mcp__everything__get-sum')
  if (addTool) {
    console.log('\n--- Calling get-sum tool via HTTP ---')
    const addResult = await addTool.execute({ a: 42, b: 58 })
    console.log('Sum result:', JSON.stringify(addResult, null, 2))

    if (!addResult.success || !addResult.message?.includes('100')) {
      console.error('FAIL: get-sum did not return 100')
      process.exit(1)
    }
    console.log('PASS: get-sum tool works via HTTP')
  }

  // Cleanup
  console.log('\n=== Cleanup ===')
  await manager.disconnectAll()
  console.log('PASS: disconnected')

  console.log('\n=============================')
  console.log('ALL HTTP TESTS PASSED')
  console.log('=============================')
}

test().catch(err => {
  console.error('Test failed with error:', err)
  process.exit(1)
})
