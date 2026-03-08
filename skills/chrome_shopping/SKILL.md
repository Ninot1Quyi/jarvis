---
name: chrome_shopping
description: Chrome shopping, travel booking, and e-commerce skill. Activate for tasks involving online shopping, flight search, hotel booking, car rental, product filtering, price comparison, and travel sites.
---

# Chrome Shopping & Travel Skill

## Core Rules

1. **find_element BEFORE every click** — never hardcode coordinates on dynamic pages
2. **Search core terms only** — apply filters separately (not in search query)
3. **Verify form fields** — take screenshot after each input to confirm value registered
4. **Use bash for dates** — never guess "next Monday", calculate with `date` command
5. **Never hallucinate results** — read data FROM the page, not from memory

## Date Calculation (Always Use bash)

When tasks mention relative dates ("next Monday", "next weekend", "5th of next month"):

```bash
# Get current date
bash("date '+%Y-%m-%d'")

# Get next Monday
bash("date -d 'next monday' '+%Y-%m-%d'")   # Linux
bash("date -v+mon '+%Y-%m-%d'")              # macOS

# Get first Monday 8 months from now
bash("python3 -c \"from datetime import date, timedelta; d = date.today().replace(month=date.today().month+8 if date.today().month<=4 else date.today().month-4, year=date.today().year+(1 if date.today().month>4 else 0)); days_ahead = 0 - d.weekday(); d = d + timedelta(days=days_ahead if days_ahead >= 0 else days_ahead+7); print(d)\"")

# Get 5th of next month
bash("python3 -c \"from datetime import date; import calendar; today=date.today(); next_m = today.month % 12 + 1; next_y = today.year + (1 if today.month==12 else 0); print(date(next_y, next_m, 5))\"")
```

**Always** calculate exact dates before filling date pickers — never guess.

## E-Commerce Shopping

### Search Strategy
1. Search for **core product terms only**: "running shoes" not "red size 10 running shoes for men"
2. Let search engine return broad results
3. Apply filters separately using the filter panel

### Applying Filters (Critical Pattern)
```
# After search results load:
find_element("Category filter panel" or "Filters" or "Refine By")
# For size filter:
find_element("Size")
click to expand
find_element("size value, e.g., 'L' or '10'")
click it
wait(1000)
# For price filter:
find_element("Price")
click to expand
find_element("min price input")
click -> type min price
find_element("max price input")
click -> type max price
find_element("Apply" or "Go")
click it
wait(1000)
# For color filter:
find_element("Color")
click to expand
find_element("color name, e.g., 'Black'")
click it
wait(1000)
# For discount/sale filter:
find_element("Discount" or "Sale" or "% off")
click to expand
find_element("50% off" or "On Sale")
click it
```

### Sort Results
```
find_element("Sort by" dropdown)
click to open
find_element("Price: Low to High" or "Lowest Price")
click it
wait(1000)
# Verify sort applied by taking screenshot
```

### Reading Product Lists
After filtering, **read the actual page content**:
```
take_screenshot()
# Read product names, prices, ratings FROM the screenshot
# DO NOT guess or use memory for prices/availability
# If list is long, scroll and take multiple screenshots
```

### Steam Store
```
# Navigate to game page first
find_element("game title in search results")
click it
wait(1000)
# Then find DLC section
scroll down
find_element("Add all DLC to Cart")  # This is a dynamic button
click it
# Verify cart updated
```

## Flight Search

### General Pattern
```
# 1. Calculate exact date first
bash("date -d 'next monday' '+%Y-%m-%d'")  # Get the actual date

# 2. Navigate to flight search site (Google Flights is reliable)
hotkey("ctrl l")
type("https://flights.google.com")
hotkey("enter")
wait(2000)

# 3. Fill origin
find_element("Where from? input")
click it
hotkey("ctrl a")
type("New York JFK")
wait(500)
find_element("John F. Kennedy International Airport")  # Autocomplete option
click it

# 4. Fill destination
find_element("Where to? input")
click it
hotkey("ctrl a")
type("Chicago O'Hare")
wait(500)
find_element("O'Hare International Airport")
click it

# 5. Set trip type
find_element("Round trip dropdown" or "One way")
click it
find_element("One way")
click it

# 6. Set date
find_element("Departure date")
click it
# Calendar appears - navigate to correct month/day
find_element("month forward button") if needed
find_element("date cell for April 15")  # Use actual date from bash
click it

# 7. Search
find_element("Search" or "Explore")
click it
wait(3000)

# 8. Apply miles filter if needed
find_element("Bags, price, emissions" or "Filters")
click it
find_element("Stops" or "Miles")
# Apply relevant filters

# 9. Read results FROM screenshot - do not hallucinate
take_screenshot()
```

### Verifying Each Field Before Search
**Critical**: After filling each field, take a screenshot and confirm:
- Origin: shows correct airport name (not just code)
- Destination: shows correct airport name
- Date: shows the correct date
- Trip type: shows "One way" or "Round trip" as required

If a field shows wrong value, click it and retype.

### Loop Detection for Flight Forms
If the same click has failed 3+ times:
```
# Don't keep clicking the same spot
# Try:
hotkey("tab")  # Move to next field
# OR
hotkey("enter")  # Submit current field
# OR
find_element("field again")  # Re-locate, coordinates may have shifted
```

## Hotel / Accommodation Search

### Pattern
```
# 1. Calculate dates with bash
bash("python3 -c \"from datetime import date, timedelta; today=date.today(); friday=(today + timedelta((4-today.weekday()) % 7 + 7)).strftime('%Y-%m-%d'); sunday=(today + timedelta((6-today.weekday()) % 7 + 7)).strftime('%Y-%m-%d'); print(friday, sunday)\"")

# 2. Navigate to booking site
hotkey("ctrl l") -> type("https://booking.com") -> hotkey("enter") -> wait(2000)

# 3. Fill destination
find_element("Where are you going?")
click -> type("New York City")
wait(500)
find_element("New York City" in autocomplete)
click it

# 4. Set check-in date
find_element("Check-in date")
click it
# Navigate calendar
find_element("date cell")
click it

# 5. Set check-out date (similar to check-in)

# 6. Set guests
find_element("2 adults")
# Adjust if needed

# 7. Search
find_element("Search" button)
click it
wait(3000)

# 8. Filter: sort by price
find_element("Sort by: Our top picks" dropdown)
click it
find_element("Price (lowest first)")
click it
wait(1500)

# 9. Read actual results - take screenshots, extract from page
take_screenshot()
```

## Car Rental

### Booking Pattern
```
# 1. Fill pickup location
find_element("Pick-up location input")
click it
type("Boston Logan International Airport")
wait(500)
find_element("Boston Logan" in autocomplete dropdown)
click it

# 2. Set pickup date (use bash to get exact date first)
bash("python3 -c \"from datetime import date; import calendar; today=date.today(); next_m=today.month%12+1; next_y=today.year+(1 if today.month==12 else 0); print(date(next_y,next_m,10))\"")

find_element("Pick-up date input")
click it
# Navigate calendar to correct month
find_element("next month arrow") if needed
find_element("10" date cell in correct month)
click it

# 3. Set dropoff date
find_element("11" date cell)
click it

# 4. Search
find_element("Search" or "Select My Car" button)
click it
wait(3000)

# 5. VERIFY page navigated to results (check heading says "Available Cars" etc.)
take_screenshot()
# If still on search form, re-fill and search again

# 6. Sort by seat capacity
find_element("Sort by" dropdown)
click it
find_element("Passengers" or "Seats" or "Capacity")
click it
wait(1000)

# 7. Read results FROM screenshot
take_screenshot()
```

### Date Picker - Critical Pattern
After clicking a date in a calendar widget:
1. Take a screenshot immediately
2. Verify the selected date is highlighted/shown in the date field
3. If wrong date, click again - calendar cells move when month changes

**Never assume a click on a calendar cell worked** — always verify via screenshot.

## Sorting Results

After search results load:
```
find_element("Sort" or "Sort by")
click to expand options
take_screenshot()  # See available sort options
find_element("the sort option you need, e.g., 'Lowest price'")
click it
wait(1500)
take_screenshot()  # Verify sort applied (check first result changed)
```

## Information Extraction (Anti-Hallucination)

**NEVER** state facts from memory. Always extract from the page:

```
# After navigating to the result page:
take_screenshot()
# Read the visible text in the screenshot
# If data is cut off, scroll and take more screenshots

# For tables/comparisons:
# Take screenshot of comparison table
# Read EACH cell value explicitly
# Do not "fill in" missing data from memory
```

### When You Can't Find Information on Page
```
# If the page doesn't have what you need:
# 1. Use page Ctrl+F to search for keywords
hotkey("ctrl f")
type("keyword")
hotkey("enter")
# 2. Read what's highlighted
take_screenshot()
# 3. If truly not there, tell the user honestly
```

## CAPTCHA Handling

When a CAPTCHA appears:
1. find_element("I'm not a robot checkbox" or "verify you're human")
2. Click the checkbox
3. Wait for verification (may show image puzzles)
4. If image puzzle appears: find_element each image option, click correct ones
5. find_element("Verify" or "Submit")
6. Click it
7. Wait and proceed

**Do NOT give up on CAPTCHA** — most are simple checkbox verification.

## Common Mistakes to Avoid

1. **Hardcoding coordinates**: `click(x=750, y=400)` — WRONG. Always use find_element.
2. **Guessing dates**: "Next Monday is the 15th" — WRONG. Use bash to calculate.
3. **Ignoring filter requirements**: Task says "over $60" — you MUST apply the price filter.
4. **Not verifying form fields**: Typing but not checking if the value registered.
5. **Entering full flight spec in search**: "JFK to ORD nonstop under $200" — search "JFK to ORD", filter after.
6. **Infinite wait loops**: `wait(10000)` x5 — WRONG. Take screenshot, assess, act.
7. **Hallucinating prices/results**: "The hotel costs $89" — WRONG unless you read it from the page.
