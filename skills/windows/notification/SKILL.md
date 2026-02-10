---
name: windows-notification
description: Windows notification center operations. Use when you need to view, click, or manage system notifications. Triggered by notification events or when user asks about notifications.
---

# Windows Notification Center

## Opening Notification Center

- Click the **date/time area** in the taskbar (bottom-right corner, near system tray)
- Or use hotkey: `win n`
- The notification panel will pop up ABOVE the taskbar

## Notification Panel Layout

```
+----------------------------------+
|  Notifications                   |
|  ------------------------------  |
|  [App Name]           [X] [...] |
|  Notification Title              |
|  Notification Body...            |
|  ------------------------------  |
|  [App Name]           [X] [...] |
|  Another notification...         |
|  ------------------------------  |
|                                  |
|  Quick Settings (toggles)        |
|  [WiFi] [Bluetooth] [Focus]...   |
+----------------------------------+
+----------------------------------+
| [Taskbar]    ...    [Date/Time]  |
+----------------------------------+
```

## Interacting with Notifications

| Action | Result |
|--------|--------|
| Click notification | Opens the related app/content |
| Click [X] | Dismiss single notification |
| Click [...] | Show more options (turn off notifications for app, etc.) |
| Click "Clear all" | Dismiss all notifications |

## Operation Sequence

```
# Open notification center
hotkey("win n") -> wait(500)

# Or click date/time area (bottom-right, typically x ~ 920-980, y ~ 985-1000)
click([950, 995]) -> wait(500)

# Find and click target notification
# Notifications are stacked vertically, newest at top
click([notification_position])
```

## Tips

- Notifications are grouped by app - look for the app name header
- If notification center is empty, there are no pending notifications
- Some notifications have action buttons (e.g., "Reply", "Mark as read") - click these for quick actions
- To close notification center without action: click outside the panel or press `escape`
