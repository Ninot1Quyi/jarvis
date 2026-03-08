---
name: libreoffice_impress
description: LibreOffice Impress presentation skill. Activate when working with .odp, .pptx, .ppt files or performing slide editing, transitions, animations, presenter console operations.
---

# LibreOffice Impress Skill

## Slide Management

### Navigate Slides
- Slides panel on the left: click to select a slide
- Keyboard: Page Up / Page Down
- Direct slide number: click in slide panel, press desired slide's thumbnail

### Insert New Slide
- Right-click in slide panel > Insert Slide
- OR: Menu > Slide > Insert Slide at End
- OR: Ctrl+M (Insert Slide)

### Delete Slide
- Click slide in panel, press Delete key
- OR Right-click > Delete Slide

### Reorder Slides
- Drag slide thumbnails in the slide panel
- OR: View > Slide Sorter, then drag

### Duplicate Slide
- Right-click slide > Copy, then right-click where to paste > Paste Slide

## Text and Objects

### Edit Text in Text Box
- **Double-click** text box to enter edit mode
- Click outside to exit text mode, single click to select the object

### Select Object Without Entering Edit Mode
- **Single click** on a text box selects it as an object
- Double-click enters text edit mode

### Object Alignment
- Right-click selected object > Position and Size (F4)
- OR Format > Position and Size
- **Keyboard alignment shortcuts** (works on selected objects):
  - Ctrl+L: Align Left
  - Ctrl+E: Align Center (horizontal)
  - Ctrl+R: Align Right
  - These are TEXT alignment shortcuts (affects text inside a text box)
- For object alignment: Format > Position and Size, or right-click > Align

### Font Size
- **Use the font size field in the top toolbar** (formatting bar)
- Do NOT use Format > Character dialog for quick font size changes
- Select text first, then click font size field and type the new size, press Enter

### Font Family
- Select text first, then use the font name dropdown in the toolbar

## Formatting and Design

### Apply Slide Layout
- View > Master > Slide Layout (or right-click slide > Layout)

### Master Slides
- View > Master > Slide Master to enter master editing mode
- Changes here affect all slides using that master
- Click "Close Master View" when done

### Themes
- Slide > Slide Properties > Background (for individual slide)
- For templates: use File > New > Templates

## Transitions and Animations

### Slide Transitions
- Slide > Slide Transition (or right-click slide > Slide Transition)
- Choose effect, duration, advance slide settings
- "Apply to All Slides" to apply to entire presentation

### Object Animations
- View > Animation (or Slide > Animation)
- Select an object, then click "Add Effect"
- Configure entrance, emphasis, exit effects
- Set timing (On Click, After Previous, With Previous)

## Presenter Console

### Enable/Disable Presenter Console
- **Slide Show > Presenter Console** — toggle it on or off
- The Presenter Console shows current slide + next slide + timer in dual-screen mode
- To DISABLE: uncheck "Slide Show > Presenter Console"
- When disabled, both screens show the presentation view

### Start Presentation
- F5 to start from beginning
- Shift+F5 to start from current slide
- Escape to end presentation

## Navigation During Presentation
- Arrow keys or Page Up/Down to advance
- Number + Enter to go to specific slide
- B to black out screen, W to white out

## Export

### Export to PDF
- File > Export as PDF
- Choose "All" slides or a range
- Click "Export" button

### Export to PowerPoint (.pptx)
- File > Save As > Choose "Microsoft PowerPoint 2007-365"

## find_element Usage

**Always use find_element for UI navigation.** Never hardcode coordinates.

Examples:
```
find_element("Presenter Console checkbox")
find_element("Insert Slide button")
find_element("Font Size field in toolbar")
find_element("Slide Transition panel")
```

## Critical Rules

1. **Font size**: use the TOOLBAR field, not Format menu
2. **Presenter Console**: found under Slide Show menu
3. **Text alignment (Ctrl+L/E/R)**: aligns text INSIDE text box; for object position use Format > Position and Size
4. **After double-clicking text**: you're in text edit mode; single-click outside to exit to object select mode
5. **Always verify** slide count and content after operations via screenshot

## Common Task Patterns

### Change title on slide N
1. navigate to slide N (click in slide panel or use Page Down)
2. double-click the title text box
3. Select all text: Ctrl+A
4. Type new title
5. Click outside to deselect

### Set specific font for text
1. Double-click text box to enter edit mode
2. Ctrl+A to select all text in box
3. Click font name field in toolbar, type font name, press Enter
4. Click font size field, type size, press Enter

### Disable Presenter Console
1. Slide Show > Presenter Console (uncheck if checked)
2. Verify the checkmark is gone

### Match title color to another slide's title
1. Go to the source slide, double-click its title
2. Select all text, note/copy the color from Format > Character or the font color button
3. Go to target slide, double-click its title
4. Select all text
5. Apply same color via the font color button in toolbar
