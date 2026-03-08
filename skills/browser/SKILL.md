---
name: browser
description: Browser operation skill for Chrome, Firefox, Safari, Edge. Activate when browsing the web or performing web-related tasks.
---

# Browser Skill

## Basic Rules

- **Browse like a human** - you only see what's on screen, scroll to see more
- **Use middle_click to open links in new tabs** - keeps current page, easy to return
- Address bar: **ALWAYS use `hotkey("ctrl l")` to focus** — never click address bar at hardcoded coordinates
- Search: click search box, type keyword, press enter, wait for results
- Form submit: press enter or click submit button
- **find_element BEFORE every click** on web pages — coordinates change constantly

## macOS Chrome Window Focus Issue

**CRITICAL (macOS only)**: Clicking on an inactive Chrome window **only activates** it — the click action does NOT register. This creates infinite menu-click loops.

**Correct approach** (always works):
```
hotkey("ctrl l")          # Focuses address bar, works even if Chrome is inactive
type("chrome://settings")
hotkey("enter")
```

**Wrong approach** (causes loops):
```
click(three_dots_menu)    # May only activate window, not open menu
click(Settings)           # Second click may also fail
```

This affects ALL Chrome navigation: always use `Ctrl+L` + URL instead of menu clicks.

## Browsing Web Pages (CRITICAL)

**You can only see what's visible on screen. Web pages are long - you MUST scroll or page to see more.**

### Search Results - Get Details by Clicking (IMPORTANT)

Search results only show brief summaries - you MUST click into each result to read full details!

**Best workflow for multiple results - open all at once:**
```
# Step 1: Get overview from search results
1. scroll to see search results
2. identify target results (e.g., top 3)

# Step 2: Open ALL result pages at ONCE with middle_click
3. middle_click: first result link
4. middle_click: second result link
5. middle_click: third result link
6. wait: 1000

# Step 3: Process each tab one by one
7. click: first tab - switch to first result page
8. wait: 500

# Step 4: Read page with keyboard shortcuts (FASTER than scroll)
9. hotkey: "pagedown" - flip to next "page" of content
10. hotkey: "pagedown" - flip again
11. take_screenshot(name: "result1_part1")
12. write_file: save what you read
13. hotkey: "ctrl w" - close tab

14. click: second tab
15. repeat steps 9-13 for second result
16. close tab

17. click: third tab
18. repeat steps 9-13 for third result
19. close tab
```

**Why keyboard shortcuts (Page Up/Down)?**
- Page Down flips one "screen" of content at a time - much faster than incremental scroll
- Home/End to jump to top/bottom
- Arrow keys for fine-grained control
- Much more efficient for reading long content

### Reading Single Page

**The scrollbar on the right edge is your guide for how much content remains:**

- **Scrollbar at TOP**: You're at the beginning, most content is below
- **Scrollbar in MIDDLE**: About half the content has been viewed
- **Scrollbar near BOTTOM**: You're approaching the end, most content has been viewed

**How much to read - make a smart decision based on the task:**

| Task Type | How to Read |
|-----------|-------------|
| **Quick overview** | Scrollbar at top ~20% is enough |
| **Get details** | Scrollbar at 80%-95% |
| **Full information** | Scrollbar near bottom (95%+) or press `End` to jump to bottom |

**Reading workflow with scrollbar awareness:**
```
# After opening a page:
1. take_screenshot()        # Note scrollbar position
2. If scrollbar is LOW (near bottom) -> you're done
3. If scrollbar is HIGH (near top) or MIDDLE -> continue reading:
   - hotkey("pagedown")   # flip to next screen
   - take_screenshot()    # check scrollbar again
   - repeat until scrollbar is near bottom OR you've seen enough
```

**Key insight**: The scrollbar position tells you how much more content exists. Don't guess - look at it!

## Handling Multiple Search Results

**The right way:**
1. Search completes - you see a list of results with brief descriptions
2. Use middle_click to open ALL results you want at once (they open in new tabs)
3. Then process each tab one by one
4. Don't open one, read all, close, then open next - that's SLOW

**Why middle_click?**
- Regular click navigates away from search results
- middle_click opens in new tab - keeps search results open
- You can compare results side by side

## Page Navigation Shortcuts

| Shortcut | Action |
|----------|--------|
| Page Down | Next screen of content |
| Page Up | Previous screen of content |
| Home | Go to top of page |
| End | Go to bottom of page |
| Arrow Up/Down | Scroll line by line |

## Handling Page Obstructions

Many pages have elements that block content:
- **Cookie consent banners**: Look for "Accept" or "X" button
- **Login popups**: Look for "X" close button, or press `escape`
- **Ad overlays**: Look for close button, usually in corner
- **Newsletter popups**: Press `escape` or find close button

Always check screenshot after loading a page. If blocked, handle first.

## Tips

- **Batch open links**: Use middle_click to open multiple links, then process one by one
- **Keyboard shortcuts faster**: Address bar, refresh, back, etc.
- **Wait for load**: Always wait after page navigation
- **Tab management**: Close tabs when done to avoid confusion
- **Save often**: write_file after each page/flip, not just at end

## Notes

- Click vs middle_click: decide if you need to keep current page
- Page load takes time - add appropriate waits
- Popups and dialogs may block actions - handle first
- Some sites have anti-bot measures - don't act too fast
