## macOS Platform Rules

### Screen Layout
**IMPORTANT**: macOS has TWO menu areas:
1. **System Menu Bar** (very top of screen, y ≈ 0-25): Apple menu, app name, File, Edit, View... - **AVOID clicking here** as it opens dropdown menus and may cause the automation to hang
2. **App Toolbar/Ribbon**: Located INSIDE the application window, below the title bar. Position varies by app.

When targeting app features like "Insert", "Format", etc., look at the **screenshot carefully** to find the toolbar inside the app window, NOT the macOS menu bar at the very top of the screen.

**WARNING**: Clicking the system menu bar (y < 30) will open a dropdown menu and may cause the program to hang. Always use the app's internal toolbar instead.

### Window Focus Behavior
**IMPORTANT**: Always check `Focused Window` in the message.

If your target is in a DIFFERENT window than the focused one:
1. **First click** → ONLY activates/focuses the window (no action triggered)
2. **Second click** → Actually performs the action on the element

This is macOS system behavior - the first click on an inactive window ONLY brings it to focus.

### Modifier Keys
- Use `cmd` instead of `ctrl` as the primary modifier key
- Common mistakes: `ctrl+c` should be `cmd c`, `ctrl+v` should be `cmd v`

### System Hotkeys
- `cmd space` → Spotlight search (see important note below)
- `cmd tab` → Switch applications
- `cmd q` → Quit current application
- `cmd h` → Hide current window
- `cmd m` → Minimize current window (**WARNING**: This is a system-level shortcut that CANNOT be overridden by applications. Do NOT use `cmd m` for app-specific functions like "new slide" in PowerPoint - it will minimize the window instead!)

### Spotlight Search (cmd space)
**IMPORTANT**: When using Spotlight to open applications:
- Always type the **FULL application name** (e.g., "Microsoft Word", "Visual Studio Code", "Google Chrome")
- If you type a partial name, Spotlight may show files/documents containing that name instead of the application
- Example: typing "Word" may show Word documents; type "Microsoft Word" to ensure the app appears first
- **After typing, add `wait(500)` before pressing `enter`** to ensure results appear correctly.

**Correct Spotlight sequence**:
```
hotkey("cmd space") → wait(300) → type("Application Name") → wait(500) → hotkey("enter")
```

**Selecting results**:
- Use `arrow keys` + `enter` to quickly select (recommended)
- Or `double-click` to select and launch
- Single click only highlights the item, does NOT launch it

### Text Editing
- `cmd c/v/x` → Copy/Paste/Cut
- `cmd a` → Select all
- `cmd z` → Undo, `cmd shift z` → Redo
- `cmd f` → Find, `cmd g` → Find next
- `backspace` → Delete before cursor
- `delete` or `fn backspace` → Delete after cursor
- `cmd backspace` → Delete to line start
- `cmd shift left/right` → Select to line start/end
- `option left/right` → Move cursor by word
- `cmd left/right` → Move to line start/end
- `cmd a` then `backspace` → Clear all text in a field

### Browser/Tabs
- `cmd t` → New tab, `cmd w` → Close tab
- `cmd shift t` → Restore closed tab
- `cmd l` → Focus address bar (faster than clicking)
- `cmd r` → Refresh, `cmd shift r` → Force refresh
- `cmd [` / `cmd ]` → Back/Forward
- `cmd 1-9` → Switch to tab N

### Finder
- `enter` → Rename selected item (NOT open!)
- `cmd o` → Open selected item
- `cmd backspace` → Move to Trash
- `cmd shift n` → New folder
- `space` → Quick Look preview

### Predictable Sequences (Always Batch These)
- **Search**: click input → type query → enter → wait
- **Form fill**: click field1 → type → tab → type → submit → wait
- **Navigation**: cmd+l → type url → enter → wait
- **Close tab**: cmd+w → wait
- **Open multiple links**: middle_click link1 → middle_click link2 → middle_click link3 → wait
