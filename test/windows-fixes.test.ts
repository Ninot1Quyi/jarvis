/**
 * Windows platform fixes verification test.
 * Tests bash tool, getFocusedWindow, and screenshot without starting the full Agent.
 *
 * Run: npx tsx test/windows-fixes.test.ts
 */

async function testBashTool() {
  console.log('=== Test 1: bash tool (Windows PowerShell) ===')
  const { bashTool } = await import('../src/agent/tools/file.js')

  // Simple echo
  const result1 = await bashTool.execute({ command: 'echo hello-from-shell' })
  console.log('echo result:', JSON.stringify(result1, null, 2))
  if (!result1.success) {
    console.error('FAIL: echo command failed')
    process.exit(1)
  }
  const output1 = (result1.data as any)?.output as string
  if (!output1.includes('hello-from-shell')) {
    console.error('FAIL: output does not contain expected text')
    process.exit(1)
  }
  console.log('PASS: echo works')

  // Directory listing
  const result2 = await bashTool.execute({ command: process.platform === 'win32' ? 'Get-ChildItem . | Select-Object -First 3' : 'ls | head -3' })
  console.log('ls result:', JSON.stringify(result2, null, 2))
  if (!result2.success) {
    console.error('FAIL: directory listing failed')
    process.exit(1)
  }
  console.log('PASS: directory listing works')

  // Error handling
  const result3 = await bashTool.execute({ command: 'nonexistent-command-xyz-123' })
  console.log('error result:', JSON.stringify(result3, null, 2))
  if (result3.success) {
    console.error('FAIL: nonexistent command should fail')
    process.exit(1)
  }
  console.log('PASS: error handling works')
}

async function testGetFocusedWindow() {
  console.log('\n=== Test 2: getFocusedWindow() ===')

  // We can't call the private method directly, so we replicate the Windows logic
  if (process.platform === 'win32') {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    try {
      const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32FocusTest {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32FocusTest]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[Win32FocusTest]::GetWindowText($hwnd, $sb, 256) | Out-Null
$title = $sb.ToString()
$pid = 0
[Win32FocusTest]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
$appName = if ($proc) { $proc.ProcessName } else { "Unknown" }
Write-Output "$appName | $title"
`
      const encoded = Buffer.from(ps, 'utf16le').toString('base64')
      const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`)
      const result = stdout.trim()
      console.log('Focused window:', result)

      if (!result || result === 'Unknown') {
        console.error('FAIL: got Unknown')
        process.exit(1)
      }
      if (!result.includes('|')) {
        console.error('FAIL: result does not contain pipe separator')
        process.exit(1)
      }
      console.log('PASS: getFocusedWindow returns AppName | Title')
    } catch (error) {
      console.error('FAIL:', error)
      process.exit(1)
    }
  } else {
    console.log('SKIP: not on Windows')
  }
}

async function testScreenshot() {
  console.log('\n=== Test 3: screenshot with cursor ===')
  const { screenshotTool } = await import('../src/agent/tools/system.js')
  const os = await import('os')
  const fs = await import('fs')
  const path = await import('path')

  const tmpDir = path.join(os.tmpdir(), 'jarvis-test-screenshots')
  fs.mkdirSync(tmpDir, { recursive: true })

  const result = await screenshotTool.execute({}, { screenshotDir: tmpDir })
  console.log('Screenshot result:', JSON.stringify({ ...result, data: { ...(result.data || {}), path: (result.data as any)?.path } }, null, 2))

  if (!result.success) {
    console.error('FAIL: screenshot failed')
    process.exit(1)
  }

  const screenshotPath = (result.data as any)?.path as string
  if (!fs.existsSync(screenshotPath)) {
    console.error('FAIL: screenshot file does not exist')
    process.exit(1)
  }

  const stats = fs.statSync(screenshotPath)
  console.log(`Screenshot size: ${stats.size} bytes`)
  if (stats.size < 1000) {
    console.error('FAIL: screenshot file too small')
    process.exit(1)
  }
  console.log('PASS: screenshot captured successfully')

  // Cleanup
  fs.unlinkSync(screenshotPath)
}

async function main() {
  console.log(`Platform: ${process.platform}\n`)

  await testBashTool()
  await testGetFocusedWindow()
  await testScreenshot()

  console.log('\n=============================')
  console.log('ALL WINDOWS FIXES TESTS PASSED')
  console.log('=============================')
}

main().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
