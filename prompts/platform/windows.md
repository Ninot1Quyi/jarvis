## Windows Platform Rules

### Screen Layout

**IMPORTANT**: Windows has TWO key UI areas:
1. **Taskbar** (bottom of screen, y > 970): Start button, pinned apps, system tray, clock
2. **App Toolbar/Ribbon**: Located INSIDE the application window, below the title bar

**WARNING**: Clicking the taskbar area may open flyout menus or switch applications unexpectedly. When targeting app features like "Insert", "Format", etc., look at the **screenshot carefully** to find the toolbar/ribbon inside the app window.

### Window Focus Behavior

**IMPORTANT**: Always check `Focused Window` in the message.

If your target is in a DIFFERENT window than the focused one:
1. **First click** -> Activates/focuses the window AND usually triggers the action (unlike macOS)
2. Some applications may require a **second click** to perform the action

### Modifier Keys

- Use `ctrl` as the primary modifier (NOT `cmd`)
- Use `win` for Windows system shortcuts
- Common mistakes: `cmd+c` should be `ctrl c`, `cmd+v` should be `ctrl v`

### Essential Shortcuts

| Shortcut | Action |
|----------|--------|
| `win s` | Windows Search (type full app name!) |
| `win e` | Open File Explorer |
| `win n` | Open Notification Center |
| `alt tab` | Switch applications |
| `alt f4` | Close application |
| `ctrl c/v/x` | Copy/Paste/Cut |
| `ctrl z/y` | Undo/Redo |

### Predictable Sequences (Always Batch These)

- **Search**: click input -> type query -> enter -> wait
- **Form fill**: click field1 -> type -> tab -> type -> submit -> wait
- **Navigation**: ctrl+l -> type url -> enter -> wait
- **Open app**: win s -> wait(300) -> type("Full App Name") -> wait(500) -> enter

---

## Available Skills

For detailed operations, read the corresponding skill file using `read_file`:

| Skill | Location | Use When |
|-------|----------|----------|
| **hotkeys** | `skills/windows/hotkeys/SKILL.md` | Need keyboard shortcuts reference |
| **search** | `skills/windows/search/SKILL.md` | Launching apps, searching files |
| **explorer** | `skills/windows/explorer/SKILL.md` | File/folder operations |
| **notification** | `skills/windows/notification/SKILL.md` | Viewing/clicking system notifications |
| **browser** | `skills/browser/SKILL.md` | Web browsing operations |
| **wechat** | `skills/wechat/SKILL.md` | WeChat messaging |

**Usage**: When you need detailed guidance, use `read_file("skills/windows/<skill>/SKILL.md")` to load the full instructions.
