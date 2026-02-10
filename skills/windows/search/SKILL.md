---
name: windows-search
description: Windows Search (win+s) operations. Use when launching applications, searching files, or using Windows search functionality.
---

# Windows Search

## Opening Search

- Press `win s` to open Windows Search
- Or click the search icon in taskbar

## Important Rules

**Always type the FULL application name**:
- Typing partial names may show web results or files instead of the application
- Example: typing "Word" may show web results; type "Microsoft Word" to ensure the app appears first

## Correct Search Sequence

```
hotkey("win s") -> wait(300) -> type("Application Name") -> wait(500) -> hotkey("enter")
```

## Selecting Results

| Method | Description |
|--------|-------------|
| `arrow keys` + `enter` | Quick select (recommended) |
| `double-click` | Select and launch |
| Single click | Only highlights, does NOT launch |

## Examples

### Launch Microsoft Word
```
hotkey("win s")
wait(300)
type("Microsoft Word")
wait(500)
hotkey("enter")
```

### Launch Visual Studio Code
```
hotkey("win s")
wait(300)
type("Visual Studio Code")
wait(500)
hotkey("enter")
```

### Search for Files
```
hotkey("win s")
wait(300)
type("filename.txt")
wait(500)
# Use arrow keys to navigate to the file result
hotkey("down")
hotkey("enter")
```
