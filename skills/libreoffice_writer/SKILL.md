---
name: libreoffice_writer
description: LibreOffice Writer word processor skill. Activate when working with .odt, .docx, .doc files or performing document editing, styles, tables, TOC, find-replace operations.
---

# LibreOffice Writer Skill

## Strategy: Programmatic-First

For complex document operations, use bash + python-docx FIRST.

```python
# Install if needed: pip install python-docx
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

# Load existing document
doc = Document('/path/to/file.docx')

# Read content
for para in doc.paragraphs:
    print(para.text, para.style.name)

# Modify text
for para in doc.paragraphs:
    if 'target text' in para.text:
        para.text = 'new text'

# Add heading
doc.add_heading('Chapter 1', level=1)

# Add paragraph
doc.add_paragraph('Body text here.')

# Format text
para = doc.add_paragraph()
run = para.add_run('Bold text')
run.bold = True
run.font.size = Pt(12)

# Save
doc.save('/path/to/file.docx')
```

For ODT files, use bash conversion first:
```bash
libreoffice --headless --convert-to docx /path/to/file.odt
```

## GUI Approach

### Styles
- **Paragraph styles**: Format > Styles > Manage Styles (F11), or the style dropdown in toolbar
- Apply style: click in paragraph, then select style from dropdown
- **Heading levels**: Heading 1, Heading 2, Heading 3, etc.
- **Character styles**: Select text, Format > Character

### Tables
- Insert > Table (Ctrl+F12)
- Set rows and columns in dialog
- Tab to move between cells (Tab in last cell adds new row)
- Select table: click inside, then Table > Select > Table

### Table of Contents
- Place cursor where TOC should be
- Insert > Table of Contents and Index > Table of Contents, Index or Bibliography
- Click OK for default settings based on heading styles

### Find and Replace
- Ctrl+H to open dialog
- Check "Other options" to expand
- Enable "Regular Expressions" for regex search
- Examples: `\n` for newline, `.+` for any text

### Formatting Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+U | Underline |
| Ctrl+L | Align Left |
| Ctrl+E | Center |
| Ctrl+R | Align Right |
| Ctrl+J | Justify |
| Ctrl+1 | Heading 1 |
| Ctrl+2 | Heading 2 |
| Ctrl+3 | Heading 3 |
| Ctrl+0 | Default paragraph style |

### Page Setup
- Format > Page Style
- Set margins, orientation, paper size

### Export
- **PDF**: File > Export as PDF
- **DOCX**: File > Save As > Microsoft Word 2007-365 (.docx)
- **Bash export**: `libreoffice --headless --convert-to pdf file.odt`

## find_element Usage

Always use find_element for UI elements:
```
find_element("Styles dropdown in toolbar")
find_element("Table of Contents menu item")
find_element("Regular Expressions checkbox in Find & Replace")
```

## Critical Rules

1. For bulk text changes: use bash + python-docx
2. Always verify heading style is applied (not just bold text)
3. After inserting TOC, it needs to be updated if content changes: right-click TOC > Update Index
4. .odt files require LibreOffice; for python-docx, convert to .docx first
