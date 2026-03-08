---
name: chrome_settings
description: Chrome browser settings navigation. Activate for any Chrome settings task: privacy, appearance, language, profile, extensions, flags, dark mode, Do Not Track, cookies, downloads, etc.
---

# Chrome Settings Skill

## CRITICAL: Use Direct URLs, Not Menu Clicks

**NEVER navigate Chrome settings through the 3-dots menu.** The dropdown is unreliable — the first click on an inactive Chrome window only activates it (macOS behavior), and menu coordinates shift. Instead:

### Open Settings Directly
```
hotkey("ctrl l")          # Focus address bar (or Ctrl+L / F6)
type("chrome://settings")
hotkey("enter")
wait(1000)
```

### Quick Direct URLs (Use These Instead of Navigating)
| Setting | Direct URL |
|---------|-----------|
| Main Settings | `chrome://settings` |
| Appearance (dark/light mode) | `chrome://settings/appearance` |
| Privacy & Security | `chrome://settings/privacy` |
| Cookies & Site Data | `chrome://settings/cookies` |
| Languages | `chrome://settings/languages` |
| Downloads | `chrome://settings/downloads` |
| Extensions | `chrome://extensions` |
| Chrome Flags | `chrome://flags` |
| Profile Management | `chrome://settings/manageProfile` |
| Sync | `chrome://settings/syncSetup` |
| Passwords | `chrome://settings/passwords` |
| Autofill | `chrome://settings/autofill` |
| Search Engine | `chrome://settings/search` |
| Startup | `chrome://settings/onStartup` |
| Accessibility | `chrome://settings/accessibility` |
| System | `chrome://settings/system` |
| Reset Settings | `chrome://settings/reset` |

## Using the Settings Search Bar

Once on `chrome://settings`, there is a **search bar at the top**. Always try search first:

```
hotkey("ctrl l")
type("chrome://settings")
hotkey("enter")
wait(1000)
find_element("Search settings")
click(found_coords)
type("Do Not Track")
wait(500)
# Read the results, find the correct item, find_element it, click it
```

## Common Settings Tasks

### Enable/Disable Dark Mode
1. Navigate to `chrome://settings/appearance`
2. find_element("Mode") or find_element("Theme")
3. Look for "Light", "Dark", "Device" radio buttons or dropdown
4. Click the desired mode option
5. Screenshot to verify

### Do Not Track
Path: Privacy and Security > Cookies and other site data > "Send a 'Do Not Track' request"

```
hotkey("ctrl l") -> type("chrome://settings/cookies") -> hotkey("enter") -> wait(1000)
scroll down to find "Send a \"Do Not Track\" request with your browsing traffic"
find_element("Do Not Track toggle")
click to enable/disable
```

**CRITICAL**: Do Not Track is under "Cookies and other site data" (chrome://settings/cookies), NOT under "Ad privacy". Ad privacy is a completely different setting.

### Delete Browsing Data on Close
Path: Privacy and Security > Cookies and other site data > "Clear cookies and site data when you close all windows"

```
hotkey("ctrl l") -> type("chrome://settings/cookies") -> hotkey("enter") -> wait(1000)
find_element("Clear cookies and site data when you close all windows")
click the toggle to enable
```

**NOT the same as "Clear browsing data"** (which clears data immediately). The "on close" setting is a persistent toggle.

### Change Appearance / Disable Dark Mode
```
hotkey("ctrl l") -> type("chrome://settings/appearance") -> hotkey("enter") -> wait(1000)
find_element("Mode")
# Look for Light/Dark/Device options
find_element("Light") -> click it
# OR find_element("Theme") and look for Customize Chrome panel
```

### Change Chrome Language
```
hotkey("ctrl l") -> type("chrome://settings/languages") -> hotkey("enter") -> wait(1000)
find_element("Add languages")
click it
type(language_name)  # in the search box that appears
find_element(language_in_list)
click to add
```

**IMPORTANT**: Chrome only supports real languages. If a user requests a fictional language (e.g., "Xenothian", "Klingon"), inform the user immediately that this language is not supported — do NOT spend steps trying to find it.

### Change Profile Username/Name
```
# Click the profile avatar icon (top-right of Chrome window)
find_element("Profile avatar" or "Account icon")
click it
find_element("Customize profile")
click it
find_element("Profile name input" or "Name field")
click it
hotkey("ctrl a")   # Select all existing text
type("New Name")
hotkey("enter")    # IMPORTANT: press Enter to commit the change
# Verify: take screenshot and confirm name changed
```

### Disable Chrome 2023 UI / Chrome Flags
```
hotkey("ctrl l") -> type("chrome://flags") -> hotkey("enter") -> wait(1000)
find_element("Search flags")
click it
type("chrome-refresh-2023")   # Use the exact flag ID, not display name
```

**IMPORTANT**: The `chrome-refresh-2023` flag was REMOVED in Chrome 117+ because the 2023 UI became permanent. If you search and it's not found, tell the user: "The Chrome Refresh 2023 flag was permanently removed in Chrome 117. The new UI cannot be reverted via chrome://flags on modern Chrome. Alternative: use an older Chrome version."

**Do NOT** disable random "Chrome Refresh" flags you find — "Chrome Refresh Token Binding" is a security protocol, unrelated to UI appearance.

### Set Chrome as Default Browser
```
hotkey("ctrl l") -> type("chrome://settings") -> hotkey("enter") -> wait(1000)
find_element("Default browser")
```

### Manage Extensions
```
hotkey("ctrl l") -> type("chrome://extensions") -> hotkey("enter") -> wait(1000)
find_element(extension_name)
```

### Print to PDF
```
hotkey("ctrl p")   # Open print dialog
wait(1000)
find_element("Destination")
# If not "Save as PDF", click Destination dropdown
find_element("Save as PDF")
click it
find_element("More settings")  # If you need margins
click it
find_element("Margins")
click Margins dropdown
find_element("None")
click it
find_element("Save")
click it
wait(1000)
# File save dialog opens
find_element("Desktop")
click it
hotkey("enter")    # Confirm save — DO NOT guess Save button coordinates
wait(1000)
# Verify the dialog closed (take screenshot)
```

**Key**: Use `hotkey("enter")` to confirm file save dialogs — never guess the Save button coordinates.

## Window Focus / Activation Issue

**macOS-specific**: Clicking on an inactive Chrome window first activates it WITHOUT performing the intended action. This causes failed menu clicks.

**Correct approach**: Always use direct URL navigation (`Ctrl+L` then type URL) instead of clicking dropdown menus. This works even when Chrome is inactive.

**Wrong approach (causes loops)**:
```
# DON'T do this:
click(three_dots_menu)    # May only activate window
click(Settings)           # May not register
click(three_dots_menu)    # Repeat loop
```

## Verifying Settings Changes

**Always verify after changing a setting:**
1. Take a screenshot
2. Confirm the toggle/option shows the new state visually
3. If it's a toggle: look for the enabled/disabled visual indicator
4. If it's a text field: confirm the text changed

## Chrome Settings Knowledge Base

### Privacy and Security (chrome://settings/privacy)
- Safe Browsing (Enhanced/Standard/None)
- Always use secure connections
- Privacy sandbox

### Third-party cookies (chrome://settings/cookies)
- Block third-party cookies
- **Clear cookies and site data when you close all windows** ← "delete on close" setting
- **Send a "Do Not Track" request** ← Do Not Track toggle
- Site data management

### Appearance (chrome://settings/appearance)
- Themes / Mode (Light/Dark/Device)
- Font size / Custom fonts
- Page zoom
- Show home button
- Show bookmarks bar

### Languages (chrome://settings/languages)
- Interface language
- Spell check languages
- Offer to translate pages
