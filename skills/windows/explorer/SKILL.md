---
name: windows-explorer
description: Windows File Explorer operations. Use when navigating folders, managing files, renaming, deleting, or organizing files and directories.
---

# Windows File Explorer

## Opening File Explorer

- Press `win e` to open File Explorer
- Or click the folder icon in taskbar

## Key Operations

| Action | Shortcut | Description |
|--------|----------|-------------|
| Open item | `enter` | Opens selected file/folder (NOT rename!) |
| Rename | `f2` | Rename selected item |
| Delete | `delete` | Move to Recycle Bin |
| Permanent delete | `shift delete` | Delete without Recycle Bin |
| New folder | `ctrl shift n` | Create new folder |
| Focus address bar | `alt d` | Jump to path input |
| Copy | `ctrl c` | Copy selected items |
| Cut | `ctrl x` | Cut selected items |
| Paste | `ctrl v` | Paste items |
| Select all | `ctrl a` | Select all items in current view |
| Undo | `ctrl z` | Undo last action |

## Navigation

| Action | Shortcut |
|--------|----------|
| Go back | `alt left` |
| Go forward | `alt right` |
| Go up one level | `alt up` |
| Focus address bar | `alt d` |

## Common Mistakes to Avoid

1. **Enter does NOT rename** - Use `f2` to rename, `enter` opens the item
2. **Single click selects** - Double-click to open, or single-click + `enter`

## Operation Examples

### Navigate to a Path
```
hotkey("alt d")  # Focus address bar
type("C:\\Users\\Documents")
hotkey("enter")
wait(500)
```

### Create New Folder
```
hotkey("ctrl shift n")
wait(300)
type("New Folder Name")
hotkey("enter")
```

### Rename a File
```
click([file_position])  # Select file
hotkey("f2")  # Enter rename mode
wait(200)
type("new_filename.txt")
hotkey("enter")
```

### Delete Files
```
click([file_position])  # Select file
hotkey("delete")  # Move to Recycle Bin
# Or shift+delete for permanent deletion
```
