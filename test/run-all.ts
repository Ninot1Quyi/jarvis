/**
 * Unified test runner for Jarvis.
 * Runs all platform-safe tests (no GUI interaction, no mouse control).
 *
 * Run: npx tsx test/run-all.ts
 */

const tests: { name: string; run: () => Promise<void> }[] = []

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, run: fn })
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

// ============ Tool Registry Tests ============

test('ToolRegistry: registerTool and getTool', async () => {
  const { ToolRegistry } = await import('../src/agent/tools/index.js')
  const registry = new ToolRegistry()

  const mockTool = {
    definition: { name: 'test_tool', description: 'test', parameters: { type: 'object' as const, properties: {} } },
    execute: async () => ({ success: true }),
  }
  registry.registerTool(mockTool)
  assert(registry.getTool('test_tool') !== undefined, 'tool should be registered')
})

test('ToolRegistry: unregisterTool', async () => {
  const { ToolRegistry } = await import('../src/agent/tools/index.js')
  const registry = new ToolRegistry()

  const mockTool = {
    definition: { name: 'temp_tool', description: 'temp', parameters: { type: 'object' as const, properties: {} } },
    execute: async () => ({ success: true }),
  }
  registry.registerTool(mockTool)
  assert(registry.getTool('temp_tool') !== undefined, 'tool should exist before unregister')

  registry.unregisterTool('temp_tool')
  assert(registry.getTool('temp_tool') === undefined, 'tool should be gone after unregister')
})

test('ToolRegistry: unregisterTools batch', async () => {
  const { ToolRegistry } = await import('../src/agent/tools/index.js')
  const registry = new ToolRegistry()

  const tools = ['a', 'b', 'c'].map(name => ({
    definition: { name, description: name, parameters: { type: 'object' as const, properties: {} } },
    execute: async () => ({ success: true }),
  }))
  registry.registerTools(tools)
  assert(registry.getTool('a') !== undefined, 'a should exist')
  assert(registry.getTool('b') !== undefined, 'b should exist')

  registry.unregisterTools(['a', 'b'])
  assert(registry.getTool('a') === undefined, 'a should be gone')
  assert(registry.getTool('b') === undefined, 'b should be gone')
  assert(registry.getTool('c') !== undefined, 'c should still exist')
})

test('ToolRegistry: getDefinitions returns all tools', async () => {
  const { ToolRegistry } = await import('../src/agent/tools/index.js')
  const registry = new ToolRegistry()

  const defs = registry.getDefinitions()
  assert(defs.length > 0, 'should have built-in tools')
  assert(defs.some(d => d.name === 'click'), 'should have click tool')
  assert(defs.some(d => d.name === 'type'), 'should have type tool')
  assert(defs.some(d => d.name === 'bash'), 'should have bash tool')
})

test('ToolRegistry: execute unknown tool returns error', async () => {
  const { ToolRegistry } = await import('../src/agent/tools/index.js')
  const registry = new ToolRegistry()

  const result = await registry.execute({ id: '1', name: 'nonexistent_tool', arguments: {} })
  assert(!result.success, 'should fail for unknown tool')
  assert(result.error?.includes('Unknown tool'), 'error should mention unknown tool')
})

// ============ MCP Tool Adapter Tests ============

test('McpToolAdapter: adaptMcpTools naming convention', async () => {
  const { adaptMcpTools } = await import('../src/mcp/McpToolAdapter.js')

  // Mock client
  const mockClient = { callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }) } as any

  const mcpTools = [
    { name: 'echo', description: 'Echo tool', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
    { name: 'add', description: 'Add numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
  ]

  const adapted = adaptMcpTools('testserver', mcpTools as any[], mockClient)

  assert(adapted.length === 2, 'should adapt 2 tools')
  assert(adapted[0].definition.name === 'mcp__testserver__echo', 'should have correct prefix')
  assert(adapted[1].definition.name === 'mcp__testserver__add', 'should have correct prefix')
  assert(adapted[0].definition.description.startsWith('[MCP:testserver]'), 'description should have MCP prefix')
})

test('McpToolAdapter: execute calls client.callTool with original name', async () => {
  const { adaptMcpTools } = await import('../src/mcp/McpToolAdapter.js')

  let calledWith: any = null
  const mockClient = {
    callTool: async (params: any) => {
      calledWith = params
      return { content: [{ type: 'text', text: 'Echo: hello' }] }
    },
  } as any

  const adapted = adaptMcpTools('srv', [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] as any[], mockClient)
  const result = await adapted[0].execute({ message: 'hello' })

  assert(calledWith.name === 'echo', 'should call with original name, not prefixed')
  assert(result.success, 'should succeed')
  assert(result.message === 'Echo: hello', 'should contain response text')
})

test('McpToolAdapter: maps isError to success:false', async () => {
  const { adaptMcpTools } = await import('../src/mcp/McpToolAdapter.js')

  const mockClient = {
    callTool: async () => ({ content: [{ type: 'text', text: 'something went wrong' }], isError: true }),
  } as any

  const adapted = adaptMcpTools('srv', [{ name: 'fail', inputSchema: { type: 'object', properties: {} } }] as any[], mockClient)
  const result = await adapted[0].execute({})

  assert(!result.success, 'should be failure')
  assert(result.error === 'something went wrong', 'error should contain text')
})

test('McpToolAdapter: handles client exception gracefully', async () => {
  const { adaptMcpTools } = await import('../src/mcp/McpToolAdapter.js')

  const mockClient = {
    callTool: async () => { throw new Error('connection lost') },
  } as any

  const adapted = adaptMcpTools('srv', [{ name: 'broken', inputSchema: { type: 'object', properties: {} } }] as any[], mockClient)
  const result = await adapted[0].execute({})

  assert(!result.success, 'should be failure')
  assert(result.error!.includes('connection lost'), 'error should contain exception message')
})

test('McpToolAdapter: handles image content blocks', async () => {
  const { adaptMcpTools } = await import('../src/mcp/McpToolAdapter.js')

  const mockClient = {
    callTool: async () => ({
      content: [
        { type: 'text', text: 'Here is an image:' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      ],
    }),
  } as any

  const adapted = adaptMcpTools('srv', [{ name: 'img', inputSchema: { type: 'object', properties: {} } }] as any[], mockClient)
  const result = await adapted[0].execute({})

  assert(result.success, 'should succeed')
  assert(result.message === 'Here is an image:', 'text should be extracted')
  assert((result.data as any)?.image?.base64 === 'aGVsbG8=', 'image data should be extracted')
  assert((result.data as any)?.image?.mimeType === 'image/png', 'image mimeType should be extracted')
})

// ============ MCP Manager Tests ============

test('McpManager: disabled server is skipped', async () => {
  const { McpManager } = await import('../src/mcp/McpManager.js')
  const manager = new McpManager()

  const tools = await manager.connectAll({
    disabled: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], enabled: false },
  })
  assert(tools.length === 0, 'disabled server should produce 0 tools')
  await manager.disconnectAll()
})

test('McpManager: bad server is gracefully skipped', async () => {
  const { McpManager } = await import('../src/mcp/McpManager.js')
  const manager = new McpManager()

  const tools = await manager.connectAll({
    bad: { command: 'nonexistent-command-that-does-not-exist-xyz' },
  })
  assert(tools.length === 0, 'bad server should produce 0 tools')
  await manager.disconnectAll()
})

test('McpManager: missing command and url throws', async () => {
  const { McpManager } = await import('../src/mcp/McpManager.js')
  const manager = new McpManager()

  const tools = await manager.connectAll({
    empty: {} as any,
  })
  assert(tools.length === 0, 'empty config should produce 0 tools (error caught)')
  await manager.disconnectAll()
})

// ============ Bash Tool Platform Tests ============

test('bash tool: echo command works', async () => {
  const { bashTool } = await import('../src/agent/tools/file.js')
  const result = await bashTool.execute({ command: 'echo test123' })
  assert(result.success, 'echo should succeed')
  assert(((result.data as any)?.output as string).includes('test123'), 'output should contain test123')
})

test('bash tool: nonexistent command fails gracefully', async () => {
  const { bashTool } = await import('../src/agent/tools/file.js')
  const result = await bashTool.execute({ command: 'nonexistent_cmd_xyz_999' })
  assert(!result.success, 'should fail')
})

test('bash tool: cwd parameter works', async () => {
  const os = await import('os')
  const { bashTool } = await import('../src/agent/tools/file.js')
  const cmd = process.platform === 'win32' ? 'Get-Location' : 'pwd'
  const result = await bashTool.execute({ command: cmd, cwd: os.tmpdir() })
  assert(result.success, 'should succeed')
})

// ============ getFocusedWindow Tests (Windows only) ============

if (process.platform === 'win32') {
  test('getFocusedWindow: returns AppName | Title on Windows', async () => {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32FocusRunAll {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32FocusRunAll]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[Win32FocusRunAll]::GetWindowText($hwnd, $sb, 256) | Out-Null
$title = $sb.ToString()
$pid = 0
[Win32FocusRunAll]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
$appName = if ($proc) { $proc.ProcessName } else { "Unknown" }
Write-Output "$appName | $title"
`
    const encoded = Buffer.from(ps, 'utf16le').toString('base64')
    const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`)
    const result = stdout.trim()

    assert(result.includes('|'), 'should contain pipe separator')
    assert(result !== 'Unknown', 'should not be Unknown')
  })
}

// ============ Screenshot Tests ============

test('screenshot: captures screen successfully', async () => {
  const { screenshotTool } = await import('../src/agent/tools/system.js')
  const os = await import('os')
  const fs = await import('fs')
  const path = await import('path')

  const tmpDir = path.join(os.tmpdir(), 'jarvis-test-run-all')
  fs.mkdirSync(tmpDir, { recursive: true })

  const result = await screenshotTool.execute({}, { screenshotDir: tmpDir })
  assert(result.success, 'screenshot should succeed')

  const screenshotPath = (result.data as any)?.path as string
  assert(fs.existsSync(screenshotPath), 'screenshot file should exist')

  const stats = fs.statSync(screenshotPath)
  assert(stats.size > 1000, 'screenshot should be larger than 1KB')

  // Cleanup
  fs.unlinkSync(screenshotPath)
})

// ============ Type System Tests ============

test('McpServerConfig: supports stdio config', async () => {
  const config: import('../src/types.js').McpServerConfig = {
    command: 'node',
    args: ['server.js'],
    env: { KEY: 'value' },
    enabled: true,
  }
  assert(config.command === 'node', 'command should be set')
  assert(config.url === undefined, 'url should be undefined for stdio')
})

test('McpServerConfig: supports HTTP config', async () => {
  const config: import('../src/types.js').McpServerConfig = {
    url: 'http://localhost:3001/mcp',
    headers: { Authorization: 'Bearer token' },
    enabled: true,
  }
  assert(config.url === 'http://localhost:3001/mcp', 'url should be set')
  assert(config.command === undefined, 'command should be undefined for HTTP')
})

// ============ Runner ============

async function main() {
  console.log(`Platform: ${process.platform}`)
  console.log(`Tests: ${tests.length}\n`)

  let passed = 0
  let failed = 0
  const failures: { name: string; error: string }[] = []

  for (const t of tests) {
    try {
      await t.run()
      passed++
      console.log(`  PASS  ${t.name}`)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      failures.push({ name: t.name, error: msg })
      console.log(`  FAIL  ${t.name}: ${msg}`)
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)

  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`)
    }
    process.exit(1)
  }

  console.log('\nALL TESTS PASSED')
}

main()
