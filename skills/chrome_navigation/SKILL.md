---
name: chrome_navigation
description: Chrome general web navigation skill. Activate for web browsing tasks: finding information on websites, reading page content, extracting data, navigating complex sites, handling popups, and general web research.
---

# Chrome Web Navigation Skill

## Core Pattern: find_element First

**EVERY click on a web page must be preceded by find_element.**

```
# CORRECT:
find_element("Accept cookies button")
click(found_coords)

# WRONG:
click(x=863, y=944)  # coordinates will be different every time
```

Web pages are dynamic. Coordinates change based on:
- Window size and scroll position
- Dynamic content (ads, banners, lazy loading)
- Responsive layout breakpoints
- Previous page state

## Navigating to Pages

### Using the Address Bar
```
hotkey("ctrl l")    # Focus address bar (always works, even in background)
type("https://website.com")
hotkey("enter")
wait(2000)          # Wait for page to load
take_screenshot()   # Verify page loaded correctly
```

### Focus Address Bar Reliably
- `Ctrl+L` is the most reliable method
- `F6` also works
- Never click the address bar at hardcoded coordinates — it moves

### Checking Page Loaded
After navigation, always verify:
```
take_screenshot()
# Is the expected page title/content visible?
# Is there a loading spinner still?
# Did an error page appear (404, timeout)?
```

## Handling Page Obstructions

### Cookie Consent Banners
```
find_element("Accept" or "Accept All" or "Accept Cookies")
click it
wait(500)
# OR if "Reject" is fine:
find_element("Reject" or "Decline")
click it
```

### Login Popups / Paywalls
```
find_element("Close" or "X" or "No thanks")
click it
# OR press Escape:
hotkey("escape")
wait(300)
```

### Newsletter / Subscription Popups
```
hotkey("escape")
# If escape doesn't work:
find_element("No thanks" or "Close" or "X button")
click it
```

**Always handle obstructions FIRST before trying to interact with page content.**

## Reading Page Content

### Scrolling to Read More
```
take_screenshot()   # Check scrollbar position
# If scrollbar not at bottom, more content below
hotkey("pagedown")  # Scroll one screen
take_screenshot()
# Repeat until scrollbar at bottom or you have what you need
```

### Finding Information on Long Pages
```
hotkey("ctrl f")    # Open Find in Page
type("keyword to find")
# Chrome highlights matches and shows count
take_screenshot()   # See where highlighted text appears
hotkey("escape")    # Close find bar
# Navigate to the highlighted area
```

### Extracting Text / Data
After finding the right page section:
1. Take a screenshot
2. Read the visible text in the screenshot **literally**
3. Do NOT use prior knowledge to "fill in" what you think it should say
4. If text is too small, zoom in: `Ctrl++` (increase zoom)
5. For tables: read each row/column explicitly from screenshots

**Anti-hallucination rule**: If you cannot read the value from the current screenshot, you do NOT know the value. Navigate to the correct page and read it.

## Site-Specific Navigation Patterns

### Government / Institutional Sites
- Look for navigation menu at top or left sidebar
- Try Ctrl+F to search within page for keywords
- Look for a "Search" bar on the site (not browser search)
- FAQ pages are usually under "Help", "Support", or "Resources"

### News / Article Sites
- Handle cookie banners and subscription modals first
- Use Page Down for long articles
- Look for "Continue reading" buttons if content is cut off

### NFL / Sports Sites
```
# Navigate to team history or scores:
hotkey("ctrl l") -> type("https://www.nfl.com") -> hotkey("enter") -> wait(2000)
find_element("Accept Cookies")   # Handle cookie banner
click it
# Look for "Scores", "Schedule", or "History" in navigation
find_element("Scores" or "Schedule")
click it
# Filter by season:
find_element("Season dropdown" or year selector)
click -> select correct year
```

### Forums / Community Sites
- Look for sort options: "Most Replies", "Hot", "Top"
- Use find_element to find sort controls
- Read thread titles and reply counts from page

## Forms and Input Fields

### Filling Text Fields
```
find_element("label text or placeholder text")
click it
# Verify field is focused (cursor visible)
hotkey("ctrl a")   # Select all existing text
type("new value")
# Verify the value registered:
take_screenshot()
```

### Submitting Forms
```
# After filling all fields:
find_element("Submit" or "Search" or "Go")
click it
# OR press Enter if single-field form:
hotkey("enter")
wait(2000)
# Verify page changed / form submitted
take_screenshot()
```

### Select / Dropdown Elements
```
# HTML select elements:
find_element("dropdown label")
click to open
find_element("desired option text")
click it

# Custom dropdowns (not native HTML select):
find_element("dropdown button" with current value)
click to open
wait(300)
find_element("option you want")
click it
```

## Tab Management

```
# Open link in new tab (keep current page):
find_element("link text")
middle_click(found_coords)

# Switch between tabs:
hotkey("ctrl tab")     # Next tab
hotkey("ctrl shift tab")  # Previous tab

# Close current tab:
hotkey("ctrl w")

# Reopen accidentally closed tab:
hotkey("ctrl shift t")
```

## Multi-Result Workflows

When you need to visit multiple pages:
```
# 1. From search results, open all targets at once
scroll to see all relevant results
find_element("First result link")
middle_click(coords)   # Opens in new tab
find_element("Second result link")
middle_click(coords)
find_element("Third result link")
middle_click(coords)

# 2. Process each tab
hotkey("ctrl 2")   # Switch to tab 2 (the first new tab)
wait(1000)
take_screenshot()
# Read content, save to notes
write_file("/workspace/notes.md", "# Source 1\n" + extracted_content)

hotkey("ctrl w")   # Close tab
# Now on previous tab
hotkey("ctrl 2")   # Next tab (was tab 3, now tab 2 after closing)
# Repeat
```

## Verifying Actions Succeeded

After EVERY significant action, verify it worked:

```
# After clicking a link:
take_screenshot()
# Did the page change? Is the expected page title visible?

# After submitting a form:
take_screenshot()
# Did results appear? Or did an error message show?

# After clicking a button:
take_screenshot()
# Did the UI state change (toggle flipped, item added to cart, etc.)?
```

Never assume an action worked. Always verify via screenshot.

## When Find_element Fails

If find_element can't locate an element:
1. **Scroll to bring it into view** — elements must be visible to be found
2. **Try different description**: "Login button" → "Sign in" → "Submit"
3. **Check if covered by popup** — dismiss overlays first
4. **Check if in iframe** — some elements are in nested frames
5. **Try Ctrl+F** to search for the text you expect to find

```
# Element not found → try scrolling:
hotkey("pagedown")
take_screenshot()
find_element("element text")
# Try again
```

## Reading Results and Reporting

**The golden rule**: Ground every factual answer in something you explicitly read from the screen.

Wrong:
```
# Task: "What is the score of Super Bowl LIV?"
# Agent from memory: "Kansas City Chiefs 31, San Francisco 49ers 20"
# WRONG - never report from memory
```

Correct:
```
# Navigate to the actual page
# Take screenshot of the score section
# Read the numbers from the screenshot
# Report what you read
```

If you can't navigate to the page with the information, say "I was unable to retrieve this from the current browser — here's what I found: [URL you'd recommend they visit]".

## Common Failure Patterns to Avoid

| Pattern | Why It Fails | Correct Approach |
|---------|-------------|-----------------|
| `click(x=225, y=130)` for address bar | Coordinates vary | `hotkey("ctrl l")` |
| Click 3-dots → Settings repeatedly | Window activation issue | `ctrl l` + `chrome://settings` |
| `wait(10000)` × 5 in a loop | Never resolves | Take screenshot, assess, act |
| Type "JFK to ORD nonstop under $200" | Too specific for search | Search "JFK to ORD", filter after |
| "Next Monday is the 15th" | Guess may be wrong | `bash("date -d 'next monday'...")` |
| Answer from memory without reading page | Hallucination risk | Navigate to page, read, answer |
