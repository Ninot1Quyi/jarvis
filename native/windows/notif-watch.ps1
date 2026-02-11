# notif-watch.ps1 -- Windows Toast Notification Watcher via UserNotificationListener
# Long-lived process: polls for new notifications, outputs JSON lines to stdout.
# Protocol: {"status":"ready"} on startup, {"type":"notification",...} per toast, {"error":"..."} on failure.
#
# Requires: Windows 10 1709+ with notification access enabled in Settings > System > Notifications.

param(
    [int]$PollIntervalMs = 2000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Helpers ---

function Write-JsonLine {
    param([hashtable]$Data)
    $json = $Data | ConvertTo-Json -Depth 5 -Compress
    [Console]::WriteLine($json)
    [Console]::Out.Flush()
}

function Get-Sha256Short {
    param([string]$Text)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = $sha.ComputeHash($bytes)
    $hex = [BitConverter]::ToString($hash).Replace('-', '').ToLower()
    return $hex.Substring(0, 16)
}

# --- WinRT Async Helper ---

try {
    Add-Type -AssemblyName 'System.Runtime.WindowsRuntime'
} catch {
    Write-JsonLine @{ error = "Failed to load System.Runtime.WindowsRuntime: $_" }
    exit 1
}

$script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.IsGenericMethod
})[0]

function Await-WinRT {
    param($asyncOp, [Type]$resultType)
    $asTask = $script:asTaskGeneric.MakeGenericMethod($resultType)
    $task = $asTask.Invoke($null, @($asyncOp))
    $task.Wait()
    return $task.Result
}

# --- Load WinRT Types ---

try {
    [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
} catch {
    Write-JsonLine @{ error = "Failed to load WinRT notification types: $_" }
    exit 1
}

# --- Initialize Listener ---

try {
    $script:listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current

    $accessOp = $script:listener.RequestAccessAsync()
    $access = Await-WinRT $accessOp ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus])

    if ($access -ne [Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]::Allowed) {
        Write-JsonLine @{ error = "Notification access not allowed (status: $access). Enable in Settings > System > Notifications." }
        exit 1
    }
} catch {
    Write-JsonLine @{ error = "Failed to initialize notification listener: $_" }
    exit 1
}

# Pre-compute types for async calls
$script:userNotifType = [Windows.UI.Notifications.UserNotification]
$script:listType = [System.Collections.Generic.IReadOnlyList`1].MakeGenericType($script:userNotifType)
$script:toastKind = [Windows.UI.Notifications.NotificationKinds]::Toast
$script:toastGenericBinding = [Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric

# --- State: track seen notification IDs ---

$script:seenIds = @{}  # notificationId -> $true

# --- Seed with current notifications so we only report NEW ones ---

function Get-CurrentNotifications {
    $getOp = $script:listener.GetNotificationsAsync($script:toastKind)
    return Await-WinRT $getOp $script:listType
}

try {
    $existing = Get-CurrentNotifications
    foreach ($notif in $existing) {
        $script:seenIds[$notif.Id] = $true
    }
} catch {
    Write-JsonLine @{ error = "Failed to seed existing notifications: $_" }
}

# --- Signal ready ---

Write-JsonLine @{ status = 'ready' }

# --- Main Poll Loop ---

while ($true) {
    try {
        $notifications = Get-CurrentNotifications

        foreach ($notif in $notifications) {
            $nid = $notif.Id

            # Skip already-seen notifications
            if ($script:seenIds.ContainsKey($nid)) { continue }
            $script:seenIds[$nid] = $true

            # Extract content
            try {
                $appName = ''
                try { $appName = $notif.AppInfo.DisplayInfo.DisplayName } catch {}

                $texts = @()
                try {
                    $binding = $notif.Notification.Visual.GetBinding($script:toastGenericBinding)
                    if ($binding) {
                        $textElements = $binding.GetTextElements()
                        foreach ($te in $textElements) {
                            if ($te.Text) { $texts += $te.Text }
                        }
                    }
                } catch {}

                # If no appName from AppInfo, use first text element as appName
                if (-not $appName -and $texts.Count -ge 1) {
                    $appName = $texts[0]
                    $texts = @($texts | Select-Object -Skip 1)
                }

                $title = ''
                $body = ''
                if ($texts.Count -ge 1) { $title = $texts[0] }
                if ($texts.Count -ge 2) { $body = ($texts[1..($texts.Count - 1)]) -join "`n" }

                # Generate stable hash ID (same scheme as macOS)
                $raw = "$appName|$title|$body"
                $hash = Get-Sha256Short -Text $raw

                # Compute Unix timestamp
                $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

                Write-JsonLine @{
                    type      = 'notification'
                    id        = $hash
                    appName   = $appName
                    title     = $title
                    body      = $body
                    timestamp = $epoch
                }
            } catch {
                Write-JsonLine @{ error = "Failed to extract notification $nid`: $_" }
            }
        }
    } catch {
        Write-JsonLine @{ error = "Poll cycle failed: $_" }
    }

    Start-Sleep -Milliseconds $PollIntervalMs
}
