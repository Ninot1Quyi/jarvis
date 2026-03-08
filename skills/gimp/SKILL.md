---
name: gimp
description: GIMP image editing skill. Activate when editing images in GIMP - opening, exporting, color adjustments, layers, selections, CMYK conversion, transparency, themes, filters.
---

# GIMP Skill

## Strategy: Programmatic Where Possible

For batch operations or format conversions, use bash + ImageMagick or Python Pillow:

```bash
# Convert RAW to JPEG
convert input.cr2 output.jpg
# Or with Pillow:
python3 -c "from PIL import Image; img = Image.open('input.tiff'); img.save('output.jpg', 'JPEG', quality=95)"

# Resize image
convert input.jpg -resize 800x600 output.jpg

# Adjust brightness
convert input.jpg -brightness-contrast 20x10 output.jpg
```

## Opening and Importing

- File > Open (Ctrl+O): open standard image files
- File > Open As Layers: add image as a new layer
- RAW files: GIMP uses UFRaw or darktable-cli plugin; may prompt for settings

## Exporting / Saving

- **Export** (not Save): File > Export As (Shift+Ctrl+E)
- Save As = .xcf format (GIMP native)
- Export = .jpg, .png, .tiff, etc.
- For JPEG: Export As > choose .jpg extension > set quality > Export
- For PNG: Export As > choose .png extension > Export

### Convert RAW to JPEG
1. File > Open the RAW file (GIMP may show RAW import dialog)
2. File > Export As
3. Type filename with .jpg extension
4. Click Export
5. Set JPEG quality (85-95 recommended)
6. Click Export again to confirm

## Layers

- Layers panel: Windows > Dockable Dialogs > Layers (if not visible)
- New layer: Layer > New Layer (Shift+Ctrl+N)
- Delete layer: select in Layers panel, click trash icon
- Merge visible: Image > Flatten Image (removes transparency)

## Color Adjustments

- **Colors > Brightness-Contrast**: simple brightness/contrast control
- **Colors > Hue-Saturation**: adjust hue, saturation, lightness
- **Colors > Curves**: precise tone control
- **Colors > Levels**: histogram-based adjustment
- **Colors > Color Balance**: shadows/midtones/highlights tint

## Transparency (Alpha Channel)

### Make Background Transparent (3-Step Workflow)
1. **Image > Flatten Image** (to start clean) -- skip if already have alpha
2. **Image > Mode > RGB** (ensure RGB mode)
3. **Layer > Transparency > Add Alpha Channel**
4. Select background: **Tools > Selection Tools > Fuzzy Select** (or press U)
5. Click background area
6. Press **Delete** key to remove selection
7. Export as PNG (supports transparency)

## CMYK Color Mode

**IMPORTANT: GIMP does NOT have native CMYK mode under Image > Mode.**

GIMP's Image > Mode only shows: RGB, Grayscale, Indexed.

### To Convert to CMYK:
1. **Image > Color Management > Convert to Color Profile**
2. Select a CMYK ICC profile (e.g., "FOGRA39" or "US Web Coated SWOP")
3. Rendering intent: Perceptual (recommended)
4. Click OK
5. Export as TIFF for CMYK output

If no CMYK profiles are available, you may need to install them:
```bash
# On Ubuntu/Debian
apt-get install icc-profiles-free
```

## Selection Tools

| Tool | Shortcut | Use |
|------|----------|-----|
| Rectangle Select | R | Select rectangular area |
| Ellipse Select | E | Select elliptical/circular area |
| Free Select (Lasso) | F | Freehand selection |
| Fuzzy Select (Magic Wand) | U | Select by color/region |
| Select by Color | Shift+O | Select all pixels of similar color |
| Scissors Select | I | Intelligent scissors |

### Fuzzy Select Options
- Threshold: higher = selects more similar colors
- Add to selection: Shift+click
- Subtract: Ctrl+click

## Filters

- Script-Fu Console: Filters > Script-Fu > Console (for automation)
- Blur: Filters > Blur > Gaussian Blur
- Sharpen: Filters > Enhance > Unsharp Mask
- Distort: Filters > Distorts

## Preferences and Themes

### Change Color Theme
1. Edit > Preferences (or GIMP 2.10+: Edit > Preferences)
2. Navigate to Interface > Theme
3. Select theme (Dark, Light, System, or custom like "Blue" if installed)
4. Click OK (may need to restart GIMP for changes to take effect)

**CRITICAL**: The available themes depend on what's installed in your GIMP environment. Always **visually read the actual theme list** on screen - do NOT assume only the defaults (Dark, Light, System) are available. Custom themes like "Blue" may be present.

## Image Size and Canvas

- **Scale Image**: Image > Scale Image (changes actual pixel dimensions)
- **Canvas Size**: Image > Canvas Size (changes canvas without scaling)
- **Fit page**: View > Zoom > Fit Page in Window (Shift+Ctrl+E)

## Crop

- Tools > Transform Tools > Crop (Shift+C)
- Draw rectangle, press Enter to crop

## find_element Usage

Always use find_element for menus and dialogs:
```
find_element("Export As menu item")
find_element("JPEG quality slider")
find_element("Add Alpha Channel menu item")
find_element("Theme list in Preferences")
```

## Critical Rules

1. **CMYK**: use Image > Color Management > Convert to Color Profile, NOT Image > Mode
2. **Transparent background**: Add Alpha Channel FIRST, then use Fuzzy Select + Delete
3. **Save vs Export**: Save (.xcf) vs Export As (.jpg/.png/.tiff)
4. **Theme list**: always READ the actual available themes on screen; don't assume defaults
5. **RAW files**: GIMP needs a raw plugin; if not available, use ImageMagick via bash
6. **Always take screenshot after each operation** to verify result
