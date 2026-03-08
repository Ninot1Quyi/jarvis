---
name: chrome_advanced
description: Chrome advanced navigation skill. Activate for complex Chrome tasks including settings navigation, e-commerce shopping, booking/travel sites, form filling, and dynamic DOM interaction.
---

# Chrome Advanced Navigation Skill

## Core Principle: Never Hardcode Coordinates

**ALWAYS use find_element or locate before clicking ANY element in Chrome.**

Web pages have dynamic layouts. Pixel coordinates change based on:
- Window size
- Page scroll position
- Dynamic content loading
- Responsive design breakpoints

### Correct Pattern
```
find_element("Search button") -> click on found coordinates
find_element("Privacy toggle for Do Not Track") -> click
find_element("Add to Cart button") -> click
```

### Wrong Pattern
```
click(x=750, y=300)  # NEVER do this for web elements
```

## Chrome Settings Navigation

### Open Settings
- Address bar: type `chrome://settings` and press Enter
- OR: Hamburger menu (3 dots) > Settings

### Search Within Settings
- There is a **search bar at the top of the chrome://settings page**
- Type the setting name to filter directly to the relevant section
- Example: search "Do Not Track" to find privacy settings
- Example: search "cookies" to find cookie settings

### Common Settings Paths
- Privacy: Settings > Privacy and security
- Do Not Track: Settings > Privacy and security > Cookies and other site data > "Send a Do Not Track request"
- Extensions: `chrome://extensions`
- Downloads: Settings > Downloads
- Bookmarks: Ctrl+Shift+B (toggle bookmark bar)

## Navigation Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+L or F6 | Focus address bar |
| Ctrl+T | New tab |
| Ctrl+W | Close current tab |
| Ctrl+Shift+T | Reopen closed tab |
| Ctrl+Tab | Next tab |
| Ctrl+Shift+Tab | Previous tab |
| Alt+Left/Right | Back/Forward |
| Ctrl+R | Reload |
| Ctrl+F | Find in page |
| Ctrl+D | Bookmark current page |

## Form Interaction

### Input Fields
- After clicking an input, always verify it's focused before typing
- Use find_element to locate the field by label/placeholder text
- Clear existing text: Ctrl+A then type new text

### Dropdowns and Select Elements
- Use find_element to locate the dropdown
- Some dropdowns are native `<select>` (use select_option tool)
- Some are custom UI dropdowns (click to open, then find_element for option)

### Date Pickers
1. find_element("date input field")
2. Click to open the date picker widget
3. Use the calendar navigation (prev/next month buttons)
4. find_element("specific date cell") then click
5. Verify the selected date is shown in the input

### Form Verification
**After filling any form field, VERIFY the value was entered:**
1. Take a screenshot
2. Read the field value from the screenshot
3. Only proceed if the value is correct

If a value didn't register: try clicking the field first, then retype.

## E-Commerce and Shopping

### Product Search Best Practices
- Search for CORE product terms only (e.g., "running shoes" not "red size 10 running shoes for men")
- Apply FILTERS separately after search results load
- This is more reliable than trying to encode all attributes in search query

### Using Filters
1. Search for core product term
2. Wait for results to load
3. find_element("Size filter" or "Color filter") in the left sidebar/filter panel
4. Click to expand filter category
5. find_element("specific filter value, e.g., '10' for size")
6. Click to apply filter
7. Verify filtered results update

### Price Filters
- Look for price range slider or min/max inputs
- Use find_element to locate them
- Type or drag to set price range
- Click "Apply" or "Search" if present

### Add to Cart
1. find_element("Add to Cart button") on product page
2. Check if size/color selection is required first
3. Verify cart count increases after clicking

### Steam Store Specifics
- "Add all DLC to Cart" button is dynamic — use find_element to locate it
- DLC list may require scrolling; use Page Down then find_element

## Booking and Travel Sites

### Flight Search
1. find_element("From airport input")
2. Click, type airport code or name
3. find_element("autocomplete suggestion") and click to select
4. Repeat for destination
5. find_element("Date picker") and set dates
6. find_element("Trip type: One Way / Round Trip")
7. find_element("Search button") and click
8. **Verify each field BEFORE searching**

### Hotel/Accommodation Search
1. Set destination city
2. Set check-in and check-out dates using date picker
3. Set number of guests
4. Apply price/rating filters after results load
5. find_element to click on specific hotel

### Loop Detection
If you're repeating the same form interaction 3+ times without progress:
1. Try pressing Tab to move to next field instead of clicking
2. Try pressing Enter to submit instead of clicking button
3. Try using keyboard shortcuts instead of mouse
4. Take screenshot and reassess what went wrong

## DOM Inspection Approach

When a page element is hard to find visually:
1. Use find_element with descriptive text
2. Try multiple descriptions: aria-label, button text, icon description
3. Scroll to bring element into view first, then find_element

## Information Extraction

### Reading Text from Pages
- Use take_screenshot then read text from the screenshot
- For structured data (tables, lists): take screenshot and extract systematically
- Do NOT rely on prior knowledge for product specs/prices — ALWAYS read from page

### iPhone Comparison Example (Correct approach)
1. Navigate to apple.com/iphone/compare
2. Use find_element to select comparison models
3. Take screenshot of comparison table
4. Extract specs FROM the screenshot, not from memory

## Verification Before Finishing

Before calling finished():
1. Take a screenshot
2. Verify the task outcome is visible on screen
3. If task was "find X", confirm X is displayed
4. If task was "click X", confirm the result of clicking is visible

## Critical Rules

1. **find_element BEFORE every click** — no hardcoded coordinates
2. **Search settings page** using the settings search bar
3. **Apply filters** after search, not in search query
4. **Verify form inputs** — check field actually received the value
5. **Loop detection**: 3 failed attempts → switch to keyboard input or different approach
6. **Ground answers in page content** — never use AI knowledge for factual lookups
