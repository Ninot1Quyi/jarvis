# Build script for Windows Notification Watcher
# Run: powershell -ExecutionPolicy Bypass -File build.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

try {
    Write-Host "Building notif-watch..." -ForegroundColor Cyan

    # Restore and build
    dotnet publish -c Release -o bin/release --self-contained false

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Build successful!" -ForegroundColor Green
        Write-Host "Output: $scriptDir\bin\release\NotifWatch.exe" -ForegroundColor Gray
    } else {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}
