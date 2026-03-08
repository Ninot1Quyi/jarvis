---
name: chrome_advanced
description: Chrome advanced navigation skill. Activate for complex Chrome tasks including settings navigation, e-commerce shopping, booking/travel sites, form filling, and dynamic DOM interaction.
---

# Chrome Advanced Skill — Navigation Hub

This skill provides quick-reference guidance. For detailed module-specific instructions, load the appropriate sub-skill using `activate_skill`.

## Sub-Skills Available

| Task Type | Skill to Load | When to Use |
|-----------|--------------|-------------|
| Chrome Settings | `chrome_settings` | Dark mode, Do Not Track, delete on close, language, profile, extensions, flags |
| Shopping & Travel | `chrome_shopping` | Flight search, hotel booking, car rental, product filtering, price sorting |
| Web Navigation | `chrome_navigation` | Reading pages, finding info, handling popups, multi-tab workflows, data extraction |

## Universal Rules (Apply to ALL Chrome Tasks)

### 1. Never Hardcode Coordinates
```
WRONG:  click(x=750, y=300)
CORRECT: find_element("button text") -> click(found_coords)
```

### 2. Navigate Settings via Direct URL
```
WRONG:  click(three_dots) -> click(Settings)  [causes activation loops]
CORRECT: hotkey("ctrl l") -> type("chrome://settings") -> hotkey("enter")
```

### 3. Verify Every Action
```
After EVERY click: take_screenshot() to confirm state changed
After EVERY form fill: verify value is visible in field
After EVERY navigation: confirm expected page loaded
```

### 4. Use bash for Date Calculation
```
WRONG:  assume "next Monday is the 15th"
CORRECT: bash("date -d 'next monday' '+%Y-%m-%d'")  [or macOS: date -v+mon]
```

### 5. Read From Page, Not Memory
```
WRONG:  report "The score was 31-20" from memory
CORRECT: navigate to page -> take_screenshot() -> read actual values shown
```

## Quick Reference: Chrome Settings URLs

| Setting | URL |
|---------|-----|
| Main | `chrome://settings` |
| Appearance/Dark Mode | `chrome://settings/appearance` |
| Privacy & Security | `chrome://settings/privacy` |
| Cookies / Do Not Track / Delete-on-Close | `chrome://settings/cookies` |
| Languages | `chrome://settings/languages` |
| Downloads | `chrome://settings/downloads` |
| Extensions | `chrome://extensions` |
| Flags | `chrome://flags` |
| Profile | `chrome://settings/manageProfile` |

## Quick Reference: Key Patterns

### Chrome Window Focus Issue (macOS)
The first click on an inactive Chrome window **activates** it but does NOT perform the action. This causes repeated failed menu clicks. Solution: always use `Ctrl+L` + URL navigation instead of clicking menus.

### Settings Search Bar
Navigate to `chrome://settings` and use the search bar at the top to find any setting by keyword. Much faster than manual navigation.

### Form Field Commit
After typing in a settings field, **always press Enter** to save the value. Many input fields in Chrome do not auto-save on blur.

### Enter Key for Dialogs
For any file save dialog, confirmation dialog, or single-input form: press `hotkey("enter")` instead of clicking the OK/Save button. Coordinate guessing fails.

### Loop Detection
If the same click fails 3+ times:
- Try `hotkey("tab")` to advance to next field
- Try `hotkey("enter")` to submit
- Try `hotkey("ctrl l")` + direct URL instead of menu navigation
- Take screenshot and reassess

## Do Not Track — Exact Location
Settings > Privacy and security > **Cookies and other site data** (NOT Ad privacy)
Direct URL: `chrome://settings/cookies`
Look for: "Send a 'Do Not Track' request with your browsing traffic"

## Delete Browsing Data on Close — Exact Location
Settings > Privacy and security > **Cookies and other site data**
Direct URL: `chrome://settings/cookies`
Look for: "Clear cookies and site data when you close all windows"
(This is a TOGGLE — different from the "Clear browsing data" button which clears immediately)

## Chrome 2023 UI — Important Note
The `chrome-refresh-2023` flag was **permanently removed** in Chrome 117+. If a user asks to disable the 2023 Chrome UI:
- Search `chrome://flags` for "chrome-refresh-2023"
- If not found, tell the user: "This flag was removed in Chrome 117 — the UI change is permanent and cannot be reverted via flags on your current Chrome version"
- Do NOT disable unrelated flags like "Chrome Refresh Token Binding" (a security protocol, not UI-related)
