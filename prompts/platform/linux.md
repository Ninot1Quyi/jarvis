## Linux Platform Rules

This guide covers GNOME desktop environment (Ubuntu 22.04/24.04 default).

### Desktop Environment Detection

- GNOME: Activities overview, GNOME Shell extensions
- KDE: Plasma desktop, different shortcuts
- XFCE: Lightweight, different shortcuts
- Detect via: `echo $XDG_CURRENT_DESKTOP`

### Window Focus Behavior

- Click to focus (standard focus follows mouse is optional in GNOME)
- Alt+Tab: Window switcher (not application switcher)
- Alt+`: Cycle windows of same application
- Clicking window title bar or any part activates it

### Modifier Keys

- Use `ctrl` as the primary modifier key
- Use `super` (Windows key) for system shortcuts
- `alt` is typically for application shortcuts

### System Hotkeys (GNOME)

- `super` → Activities overview / Application launcher
- `alt tab` → Switch windows
- `alt f4` → Close current application
- `super d` → Show desktop
- `super l` → Lock screen (GNOME)
- `super arrow` → Tile window left/right
- `ctrl alt arrow` → Switch workspace
- `ctrl alt t` → Open terminal (if configured)
- `print` → Screenshot (full screen)
- `alt print` → Screenshot of window
- `shift print` → Screenshot selection

### Text Editing

- `ctrl c/v/x` → Copy/Paste/Cut
- `ctrl a` → Select all
- `ctrl z` → Undo, `ctrl shift z` or `ctrl y` → Redo
- `ctrl f` → Find
- `ctrl h` → Find and replace
- `ctrl shift f` → Find in files
- `backspace` → Delete before cursor
- `delete` → Delete after cursor
- `ctrl backspace` → Delete word before cursor
- `home/end` → Move to line start/end
- `ctrl home/end` → Move to document start/end

### Browser/Tabs (Firefox/Chrome)

- `ctrl t` → New tab, `ctrl w` → Close tab
- `ctrl shift t` → Restore closed tab
- `ctrl l` or `f6` → Focus address bar
- `ctrl r` or `f5` → Refresh
- `ctrl shift r` → Force refresh
- `alt left/right` → Back/Forward
- `ctrl shift p` → Private browsing (Firefox)
- `ctrl shift n` → Private window (Chrome)
- `ctrl tab` → Next tab, `ctrl shift tab` → Previous tab
- `ctrl 1-8` → Switch to tab 1-8, `ctrl 9` → Last tab

### File Manager (Nautilus/Files)

- `enter` → Open selected item
- `f2` → Rename selected item
- `delete` → Move to Trash
- `shift delete` → Permanent delete
- `ctrl shift n` → New folder
- `ctrl l` → Location bar
- `ctrl h` → Show hidden files
- `backspace` → Go to parent folder

### Terminal (GNOME Terminal)

- `ctrl shift t` → New tab
- `ctrl shift w` → Close tab
- `ctrl shift c` → Copy
- `ctrl shift v` → Paste
- `ctrl + / -` → Zoom in/out
- `ctrl 0` → Reset zoom

### Application Launcher (GNOME Activities)

- `super` → Open Activities overview
- Type to search applications
- Arrow keys to navigate
- Enter to launch
- `super a` → Show applications
- `super s` → Overview (search)

### Window Management

- `super up` → Maximize
- `super down` → Minimize or restore
- `super left/right` → Tile window to half screen
- Drag window to top → Maximize
- Drag window to corners → Tile to quarter

### GNOME Specific

- Top bar: Activities, clock, system menu
- Click activities or press super to access app launcher
- Drag from right edge for notifications panel
- Right-click top bar for settings

### Predictable Sequences (Always Batch These)

- **Search**: click input → type query → enter → wait
- **Form fill**: click field1 → type → tab → type → submit → wait
- **Navigation**: ctrl+l → type url → enter → wait
- **Close tab**: ctrl+w → wait
- **Open multiple links**: middle_click link1 → middle_click link2 → middle_click link3 → wait
- **Screenshot**: press print or use gnome-screenshot tool

### Linux-Specific Considerations

1. **Multiple Monitors**: xdotool may need DISPLAY=:0 or :1
2. **Wayland vs X11**: Some tools only work on X11
3. **Permissions**: May need to enable "Accessibility" in system settings
4. **Chinese Input**: Use IBus or Fcitx input methods
5. **Sudo**: Use pkexec instead of sudo for GUI apps
