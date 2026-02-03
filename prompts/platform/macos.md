## macOS Platform Rules

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
- `cmd space` → Spotlight search, type app name, `enter` to launch
- `cmd tab` → Switch applications
- `cmd q` → Quit current application
- `cmd h` → Hide current window
- `cmd m` → Minimize current window

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
