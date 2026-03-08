---
name: libreoffice_calc
description: LibreOffice Calc spreadsheet skill. Activate when working with .ods, .xlsx, .csv files or performing spreadsheet operations like formulas, charts, pivot tables, data manipulation.
---

# LibreOffice Calc Skill

## Strategy: Programmatic-First

**For any data manipulation, formula entry, or formatting task: use bash + Python FIRST.**

bash is available and deterministic. GUI clicks on spreadsheets are fragile and error-prone.

### When to use bash (Python/openpyxl/pandas):
- Creating or populating cells with formulas
- Batch formatting (number formats, colors, borders)
- Pivot table creation
- Chart creation via script
- CSV import/export
- Any operation requiring 5+ cell interactions

### When to use GUI:
- Single cell edits that are faster to click
- Visual inspection/verification
- Operations that require the Calc UI specifically (e.g., Chart Wizard visual adjustments)

## Bash Approach (Preferred)

```python
import subprocess
import openpyxl
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, numbers
import pandas as pd

# Load existing file
wb = load_workbook('/path/to/file.xlsx')
ws = wb.active

# Enter a formula
ws['B2'] = '=SUM(B3:B10)'

# Cross-sheet reference
ws['C1'] = '=Sheet2!A1'

# Custom number format (millions)
ws['D1'].number_format = '#,##0.0,,"M"'

# Custom number format (billions)
ws['E1'].number_format = '#,##0.0,,,"B"'

# Save
wb.save('/path/to/file.xlsx')

# Then open with LibreOffice to verify
subprocess.run(['libreoffice', '--calc', '/path/to/file.xlsx'])
```

For CSV export:
```python
df = pd.read_excel('/path/to/file.xlsx')
df.to_csv('/path/to/output.csv', index=False)
```

## GUI Approach (When Required)

### Cell Navigation
- **Name Box** (top-left, shows cell address): click it, type address (e.g., `B5`), press Enter to jump
- **Keyboard navigation**: Arrow keys, Tab (right), Shift+Tab (left), Enter (down)
- **Go To Cell**: Ctrl+G or F5, type address

### Entering Formulas
1. Click target cell
2. Type `=` then formula (e.g., `=SUM(A1:A10)`)
3. Press Enter to confirm

**Fill multiple cells simultaneously:**
1. Select the range (e.g., B2:B10)
2. Type the formula
3. Press **Ctrl+Enter** (NOT just Enter) to fill ALL selected cells

**Auto-fill formula down a column:**
1. Enter formula in first cell
2. Copy cell (Ctrl+C)
3. Select remaining cells
4. Paste (Ctrl+V)
OR drag the fill handle (small square at bottom-right of selected cell)

### Key Formulas
```
=SUM(B2:B10)                    # Sum a range
=AVERAGE(B2:B10)                # Average
=IF(A1>0, "positive", "negative") # Conditional
=VLOOKUP(A1, Sheet2!A:B, 2, 0)  # Lookup
=INDEX(A:A, MATCH(B1, B:B, 0))  # Index/Match
=TEXT(A1, "0000000")            # Pad to 7 digits
=PROPER(A1)                     # Title case
=TRIM(A1)                       # Remove extra spaces
=TODAY()                        # Current date
=DATEDIF(A1, TODAY(), "Y")      # Age in years
=IFERROR(formula, "")           # Handle errors
=UNIQUE(A1:A100)                # Unique values (if supported)
```

### Cross-Sheet References
```
=Sheet2!A1           # Single cell from Sheet2
=SUM(Sheet2!A1:A10)  # Sum from Sheet2
='My Sheet'!A1       # Sheet name with spaces needs quotes
```

### Selecting Blank Cells (Go To Special)
- LibreOffice: **Edit > Find & Replace** with regex `^$` to find blanks
- OR: Edit > Navigator, or use F5
- Note: Excel's Go To Special > Blanks (F5 > Special > Blanks) does NOT exist in LibreOffice the same way

### Non-Contiguous Selection
- Hold **Ctrl** while clicking/dragging to select multiple separate ranges
- Useful for charts with non-adjacent data

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl+Enter | Fill selected cells with same content |
| Ctrl+Home | Go to A1 |
| Ctrl+End | Go to last used cell |
| Ctrl+Shift+End | Extend selection to last cell |
| F2 | Edit current cell |
| Ctrl+; | Insert current date |
| Alt+= | AutoSum |
| Ctrl+1 | Format Cells dialog |
| Ctrl+Shift+1 | Number format |

### Number Formats (Format > Cells > Number tab)
- **Millions**: `#,##0.0,,"M"` or `0.0,,"M"`
- **Billions**: `#,##0.0,,,"B"` or `0.0,,,"B"`
- **Percentage**: `0.00%`
- **Padded numbers**: `0000000` (7 digits with leading zeros)

### Sheets
- **Insert sheet**: Right-click on sheet tab > Insert Sheet
- **Rename**: Double-click sheet tab
- **Move/Copy**: Right-click tab > Move or Copy Sheet
- **Navigate**: Ctrl+PageUp/PageDown

### Charts (Chart Wizard)
1. Select data range (including headers)
2. Insert > Chart
3. Chart Wizard opens as a modal (4 steps: Chart type, Data range, Data series, Chart elements)
4. Navigate steps with Next/Back buttons or click step numbers
5. Double-click chart to enter edit mode
6. Click outside chart to exit edit mode

**Chart types:** Column, Bar, Line, Pie, Area, XY (Scatter), Bubble

### Pivot Tables (DataPilot)
1. Select data range
2. Insert > Pivot Table (or Data > Pivot Table)
3. Drag fields to Row, Column, Data areas
4. Configure aggregation (Sum, Count, Average)
5. Click OK

### Sparklines
- Insert > Sparklines (if available in version)
- Select target range, specify data range

### Freeze Rows/Columns
- Click cell BELOW and to the RIGHT of where you want to freeze
- View > Freeze Rows and Columns

### Sorting
1. Click any cell in the column to sort by
2. Data > Sort
3. Configure sort criteria

### Find and Replace
- Ctrl+H to open
- Check "Regular Expressions" for regex
- `^$` matches empty cells
- `^\s*$` matches blank/whitespace cells

## Common Task Patterns

### Fill blank cells with value above
```python
# Via bash (preferred)
import openpyxl
wb = load_workbook('file.xlsx')
ws = wb.active
for row in range(2, ws.max_row + 1):
    for col in range(1, ws.max_column + 1):
        if ws.cell(row, col).value is None:
            ws.cell(row, col).value = ws.cell(row-1, col).value
wb.save('file.xlsx')
```

### Calculate MoM Growth
```
=(B3-B2)/B2    # Month-over-Month growth percentage
```

### Reorder columns
1. Select entire column (click column letter)
2. Cut (Ctrl+X)
3. Right-click target column > Insert Cut Cells

### Export to CSV
- File > Save As > File type: "Text CSV (.csv)"
- OR bash: `python3 -c "import pandas as pd; pd.read_excel('file.xlsx').to_csv('file.csv', index=False)"`

### Export to PDF
- File > Export as PDF
- OR bash: `libreoffice --headless --convert-to pdf file.xlsx`

## Critical Rules

1. **NEVER use hardcoded pixel coordinates for cells** - use Name Box or keyboard navigation
2. **Always use find_element** if you must click a UI button
3. **After entering a formula, press Enter** - just clicking away may cancel the edit
4. **Verify the result** by taking a screenshot after each operation
5. **For complex tasks (>5 cell operations): use bash + openpyxl**
