## Windows Platform Rules

### Screen Layout
**IMPORTANT**: Windows has TWO key UI areas:
1. **Taskbar** (bottom of screen, y ≈ 975-1000): Start button, pinned apps, system tray, clock - **AVOID clicking here** unless intentionally launching apps or checking notifications, as it may open flyout menus and interfere with automation
2. **App Toolbar/Ribbon**: Located INSIDE the application window, below the title bar. Position varies by app.

When targeting app features like "Insert", "Format", etc., look at the **screenshot carefully** to find the toolbar/ribbon inside the app window, NOT the Windows taskbar at the bottom of the screen.

**WARNING**: Clicking the taskbar area (y > 970) may open flyout menus or switch applications unexpectedly. Always use the app's internal toolbar/ribbon instead.

### Window Focus Behavior
**IMPORTANT**: Always check `Focused Window` in the message.

If your target is in a DIFFERENT window than the focused one:
1. **First click** → Activates/focuses the window AND usually triggers the action (unlike macOS)
2. However, some applications (e.g., certain dialogs, elevated windows) may require a **second click** to perform the action

Windows generally activates and clicks through on first click, but always verify the action was performed.

### Modifier Keys
- Use `ctrl` as the primary modifier key
- Use `win` for Windows system shortcuts
- Common mistakes: `cmd+c` should be `ctrl c`, `cmd+v` should be `ctrl v`

### System Hotkeys
- `win` → Open Start menu
- `win s` → Windows Search (see important note below)
- `alt tab` → Switch applications
- `alt f4` → Close current application
- `win d` → Show desktop
- `win e` → Open File Explorer
- `win m` → Minimize all windows (**WARNING**: This is a system-level shortcut that CANNOT be overridden by applications. Do NOT use `win m` for app-specific functions - it will minimize all windows instead!)
- `win l` → Lock screen
- `win i` → Open Settings

### Windows Search (win s)
**IMPORTANT**: When using Windows Search to open applications:
- Always type the **FULL application name** (e.g., "Microsoft Word", "Visual Studio Code", "Google Chrome")
- If you type a partial name, Search may show web results or files containing that name instead of the application
- Example: typing "Word" may show web results or Word documents; type "Microsoft Word" to ensure the app appears first
- **After typing, add `wait(500)` before pressing `enter`** to ensure results appear correctly.

**Correct Search sequence**:
```
hotkey("win s") → wait(300) → type("Application Name") → wait(500) → hotkey("enter")
```

**Selecting results**:
- Use `arrow keys` + `enter` to quickly select (recommended)
- Or `double-click` to select and launch
- Single click only highlights the item, does NOT launch it

### Text Editing
- `ctrl c/v/x` → Copy/Paste/Cut
- `ctrl a` → Select all
- `ctrl z` → Undo, `ctrl y` → Redo
- `ctrl f` → Find, `f3` or `ctrl g` → Find next
- `backspace` → Delete before cursor
- `delete` → Delete after cursor
- `ctrl backspace` → Delete word before cursor
- `ctrl delete` → Delete word after cursor
- `ctrl shift left/right` → Select word left/right
- `shift home/end` → Select to line start/end
- `ctrl left/right` → Move cursor by word
- `home/end` → Move to line start/end
- `ctrl home/end` → Move to document start/end
- `ctrl a` then `backspace` → Clear all text in a field

### Browser/Tabs
- `ctrl t` → New tab, `ctrl w` → Close tab
- `ctrl shift t` → Restore closed tab
- `ctrl l` or `f6` → Focus address bar (faster than clicking)
- `ctrl r` or `f5` → Refresh, `ctrl shift r` or `ctrl f5` → Force refresh
- `alt left` / `alt right` → Back/Forward
- `ctrl 1-9` → Switch to tab N

### File Explorer
- `enter` → Open selected item (NOT rename!)
- `f2` → Rename selected item
- `delete` → Delete to Recycle Bin
- `shift delete` → Permanent delete
- `ctrl shift n` → New folder
- `alt d` → Focus address bar / path

### Predictable Sequences (Always Batch These)
- **Search**: click input → type query → enter → wait
- **Form fill**: click field1 → type → tab → type → submit → wait
- **Navigation**: ctrl+l → type url → enter → wait
- **Close tab**: ctrl+w → wait
- **Open multiple links**: middle_click link1 → middle_click link2 → middle_click link3 → wait
