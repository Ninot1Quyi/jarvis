<#
.SYNOPSIS
    Pack Jarvis for Windows distribution (self-contained, no Node.js required).
.DESCRIPTION
    Creates a zip with embedded Node.js runtime, compiled code, production
    dependencies, and runtime resources. Users unzip and run jarvis.exe directly.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/pack-win.ps1
    # Output: dist-pack/jarvis-win.zip
#>

$ErrorActionPreference = "Stop"

$NODE_VERSION = "v22.16.0"  # LTS version for stability
$NODE_ARCH = "win-x64"
$NODE_DIST = "node-${NODE_VERSION}-${NODE_ARCH}"
$NODE_URL = "https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST}.zip"

$ROOT = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$OUT = Join-Path $ROOT "dist-pack"
$TARGET = Join-Path $OUT "jarvis-win"
$TEMP_DIR = Join-Path $OUT "temp"

Write-Host "=== Jarvis Windows Pack (Self-Contained) ===" -ForegroundColor Cyan
Write-Host "Root: $ROOT"
Write-Host "Output: $TARGET"
Write-Host "Node.js: $NODE_VERSION ($NODE_ARCH)"

# Clean previous build
if (Test-Path $TARGET) {
    Write-Host "Cleaning previous build..."
    Remove-Item -Recurse -Force $TARGET
}
if (Test-Path $TEMP_DIR) {
    Remove-Item -Recurse -Force $TEMP_DIR
}
New-Item -ItemType Directory -Path $TARGET -Force | Out-Null
New-Item -ItemType Directory -Path $TEMP_DIR -Force | Out-Null

# Step 1: Locate Node.js
Write-Host "`n[1/8] Locating Node.js..." -ForegroundColor Yellow

# Prefer local installed node.exe, fallback to download
$localNode = (Get-Command node -ErrorAction SilentlyContinue).Source
$nodeSourceDir = $null

if ($localNode) {
    $nodeSourceDir = Split-Path -Parent $localNode
    $nodeVer = & $localNode -v
    Write-Host "  Using local Node.js: $localNode ($nodeVer)" -ForegroundColor Gray
} else {
    # Download Node.js
    $nodeZip = Join-Path $TEMP_DIR "${NODE_DIST}.zip"
    $nodeDir = Join-Path $TEMP_DIR $NODE_DIST

    if (-not (Test-Path $nodeDir)) {
        if (-not (Test-Path $nodeZip)) {
            Write-Host "  Downloading Node.js ${NODE_VERSION}..." -ForegroundColor Gray
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $NODE_URL -OutFile $nodeZip -UseBasicParsing
        }
        Expand-Archive -Path $nodeZip -DestinationPath $TEMP_DIR -Force
    }
    $nodeSourceDir = $nodeDir
}

# Step 2: Copy Node.js runtime
Write-Host "[2/8] Embedding Node.js runtime..." -ForegroundColor Yellow
$runtimeDir = Join-Path $TARGET "runtime"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
Copy-Item (Join-Path $nodeSourceDir "node.exe") $runtimeDir

# Step 3: Build TypeScript
Write-Host "[3/8] Building TypeScript..." -ForegroundColor Yellow
Push-Location $ROOT
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
Pop-Location

# Step 4: Copy compiled output
Write-Host "[4/8] Copying dist/..." -ForegroundColor Yellow
Copy-Item -Recurse (Join-Path $ROOT "dist") (Join-Path $TARGET "dist")

# Step 5: Copy runtime resources
Write-Host "[5/8] Copying runtime resources..." -ForegroundColor Yellow

Copy-Item -Recurse (Join-Path $ROOT "prompts") (Join-Path $TARGET "prompts")
Copy-Item -Recurse (Join-Path $ROOT "skills") (Join-Path $TARGET "skills")

$nativeDir = Join-Path (Join-Path $TARGET "native") "windows"
New-Item -ItemType Directory -Path $nativeDir -Force | Out-Null
Copy-Item (Join-Path (Join-Path (Join-Path $ROOT "native") "windows") "*.ps1") $nativeDir

$configDir = Join-Path $TARGET "config"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$exampleConfig = Join-Path (Join-Path $ROOT "config") "config.example.json"
if (Test-Path $exampleConfig) {
    Copy-Item $exampleConfig $configDir
}

# overlay-ui (Tauri exe) - build if needed, then copy
$overlayDir = Join-Path $TARGET "overlay-ui"
New-Item -ItemType Directory -Path $overlayDir -Force | Out-Null
$tauriExe = Join-Path (Join-Path (Join-Path (Join-Path (Join-Path $ROOT "overlay-ui") "src-tauri") "target") "release") "jarvis-overlay.exe"
if (-not (Test-Path $tauriExe)) {
    Write-Host "  Building overlay UI (Tauri)..." -ForegroundColor Gray
    Push-Location (Join-Path $ROOT "overlay-ui")
    npx tauri build
    if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }
    Pop-Location
}
if (Test-Path $tauriExe) {
    Copy-Item $tauriExe $overlayDir
    Write-Host "  Included overlay UI: jarvis-overlay.exe" -ForegroundColor Gray
} else {
    throw "Tauri exe not found after build. Check overlay-ui build output."
}

# Step 6: Install production dependencies
Write-Host "[6/8] Installing production dependencies..." -ForegroundColor Yellow
Copy-Item (Join-Path $ROOT "package.json") $TARGET
Copy-Item (Join-Path $ROOT "package-lock.json") $TARGET -ErrorAction SilentlyContinue

Push-Location $TARGET
npm install --omit=dev --ignore-scripts=false
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
Pop-Location

# Step 7: Create jarvis.exe launcher (compiled C# for a real .exe)
Write-Host "[7/8] Building jarvis.exe launcher..." -ForegroundColor Yellow

$launcherCs = @'
using System;
using System.Diagnostics;
using System.IO;

class Program {
    static int Main(string[] args) {
        string exeDir = Path.GetDirectoryName(
            System.Reflection.Assembly.GetExecutingAssembly().Location);
        string nodeExe = Path.Combine(exeDir, "runtime", "node.exe");
        string mainJs = Path.Combine(exeDir, "dist", "cli", "main.js");

        if (!File.Exists(nodeExe)) {
            System.Windows.Forms.MessageBox.Show(
                "runtime\\node.exe not found.", "Jarvis Error",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Error);
            return 1;
        }
        if (!File.Exists(mainJs)) {
            System.Windows.Forms.MessageBox.Show(
                "dist\\cli\\main.js not found.", "Jarvis Error",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Error);
            return 1;
        }

        string arguments = "\"" + mainJs + "\"";
        foreach (string arg in args) {
            if (arg.Contains(" ") || arg.Contains("\"")) {
                arguments += " \"" + arg.Replace("\"", "\\\"") + "\"";
            } else {
                arguments += " " + arg;
            }
        }

        var psi = new ProcessStartInfo {
            FileName = nodeExe,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = exeDir
        };

        psi.EnvironmentVariables["JARVIS_ROOT"] = exeDir;

        try {
            var process = Process.Start(psi);
            process.WaitForExit();
            return process.ExitCode;
        } catch (Exception ex) {
            System.Windows.Forms.MessageBox.Show(
                ex.Message, "Jarvis Error",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Error);
            return 1;
        }
    }
}
'@

$csFile = Join-Path $TEMP_DIR "jarvis.cs"
Set-Content -Path $csFile -Value $launcherCs -Encoding UTF8

# Compile as Windows GUI app (no console window)
$cscPaths = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $null
foreach ($p in $cscPaths) {
    if (Test-Path $p) { $csc = $p; break }
}

$exePath = Join-Path $TARGET "jarvis.exe"
if ($csc) {
    & $csc /nologo /optimize /target:winexe /reference:System.Windows.Forms.dll /out:$exePath $csFile
    if ($LASTEXITCODE -ne 0) { throw "C# compilation failed" }
    Write-Host "  Compiled jarvis.exe with csc.exe" -ForegroundColor Gray
} else {
    # Fallback: create a .cmd launcher
    Write-Host "  Warning: csc.exe not found, creating .cmd launcher instead" -ForegroundColor DarkYellow
    $cmdContent = @'
@echo off
setlocal
set "JARVIS_ROOT=%~dp0"
"%JARVIS_ROOT%runtime\node.exe" "%JARVIS_ROOT%dist\cli\main.js" %*
'@
    Set-Content -Path (Join-Path $TARGET "jarvis.cmd") -Value $cmdContent -Encoding ASCII
}

# Step 8: Create zip
Write-Host "[8/8] Creating zip archive..." -ForegroundColor Yellow
$zipPath = Join-Path $OUT "jarvis-win.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $TARGET "*") -DestinationPath $zipPath -CompressionLevel Optimal

# Cleanup temp
Remove-Item -Recurse -Force $TEMP_DIR -ErrorAction SilentlyContinue

$zipSize = (Get-Item $zipPath).Length
$zipSizeMB = [Math]::Round($zipSize / 1MB, 1)
$dirSize = (Get-ChildItem -Recurse $TARGET | Measure-Object -Property Length -Sum).Sum
$dirSizeMB = [Math]::Round($dirSize / 1MB, 1)

Write-Host "`n=== Pack Complete ===" -ForegroundColor Green
Write-Host "Directory: $TARGET ($dirSizeMB MB)"
Write-Host "Archive:   $zipPath ($zipSizeMB MB)"
Write-Host ""
Write-Host "Contents:" -ForegroundColor Cyan
Write-Host "  jarvis.exe          - Main launcher"
Write-Host "  runtime/node.exe    - Embedded Node.js $NODE_VERSION"
Write-Host "  dist/               - Compiled JavaScript"
Write-Host "  node_modules/       - Production dependencies"
Write-Host "  prompts/            - Prompt templates"
Write-Host "  skills/             - Skill definitions"
Write-Host "  native/windows/     - PowerShell scripts"
Write-Host "  config/             - Configuration template"
Write-Host ""
Write-Host "Usage:" -ForegroundColor Cyan
Write-Host "  1. Unzip jarvis-win.zip"
Write-Host "  2. Copy config\config.example.json to config\config.json, fill in API keys"
Write-Host "  3. Run: jarvis.exe `"your task`""
Write-Host ""
Write-Host "No external dependencies required. Windows 10+ only."
