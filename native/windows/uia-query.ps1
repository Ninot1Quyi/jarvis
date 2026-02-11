<#
.SYNOPSIS
    Windows UI Automation Query Tool
.DESCRIPTION
    Queries UI elements using Windows UI Automation API.
    Outputs JSON for cross-platform compatibility with macOS ax-query.
.PARAMETER x
    Screen X coordinate for position query
.PARAMETER y
    Screen Y coordinate for position query
.PARAMETER search
    Keyword to search for in UI elements
.PARAMETER snapshot
    Capture complete UI state snapshot
.PARAMETER count
    Maximum number of elements to return (default: 5)
.PARAMETER distance
    Maximum distance in pixels for nearby elements (default: 200)
.PARAMETER includeNonInteractive
    Include non-interactive elements in results
#>

param(
    [int]$x = -1,
    [int]$y = -1,
    [string]$search = "",
    [switch]$snapshot,
    [switch]$axlines,
    [int]$count = 5,
    [int]$distance = 200,
    [switch]$includeNonInteractive
)

# Force UTF-8 output so Node.js (and other callers) get correct encoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Load UI Automation assemblies
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

# Control type to role mapping (matching macOS roles)
$ControlTypeToRole = @{
    "Button" = "Button"
    "Calendar" = "Group"
    "CheckBox" = "CheckBox"
    "ComboBox" = "ComboBox"
    "Edit" = "TextField"
    "Hyperlink" = "Link"
    "Image" = "Image"
    "ListItem" = "ListItem"
    "List" = "List"
    "Menu" = "Menu"
    "MenuBar" = "MenuBar"
    "MenuItem" = "MenuItem"
    "ProgressBar" = "ProgressIndicator"
    "RadioButton" = "RadioButton"
    "ScrollBar" = "ScrollBar"
    "Slider" = "Slider"
    "Spinner" = "Incrementor"
    "StatusBar" = "Group"
    "Tab" = "TabGroup"
    "TabItem" = "Tab"
    "Text" = "StaticText"
    "ToolBar" = "Toolbar"
    "ToolTip" = "HelpTag"
    "Tree" = "Outline"
    "TreeItem" = "OutlineRow"
    "Custom" = "Group"
    "Group" = "Group"
    "Thumb" = "Handle"
    "DataGrid" = "Table"
    "DataItem" = "Row"
    "Document" = "TextArea"
    "SplitButton" = "Button"
    "Window" = "Window"
    "Pane" = "Group"
    "Header" = "Group"
    "HeaderItem" = "Button"
    "Table" = "Table"
    "TitleBar" = "Group"
    "Separator" = "Splitter"
}

function Get-RoleFromControlType {
    param([System.Windows.Automation.AutomationElement]$element)

    try {
        $controlType = $element.Current.ControlType
        if ($null -eq $controlType) { return "Unknown" }

        $typeName = $controlType.ProgrammaticName -replace "ControlType.", ""
        if ($ControlTypeToRole.ContainsKey($typeName)) {
            return $ControlTypeToRole[$typeName]
        }
        return $typeName
    } catch {
        return "Unknown"
    }
}

function Get-ElementInfo {
    param(
        [System.Windows.Automation.AutomationElement]$element,
        [int]$queryX = 0,
        [int]$queryY = 0,
        [switch]$detailed
    )

    try {
        $rect = $element.Current.BoundingRectangle
        if ([System.Windows.Rect]::Empty.Equals($rect)) {
            return $null
        }

        $centerX = $rect.X + $rect.Width / 2
        $centerY = $rect.Y + $rect.Height / 2
        $dist = [Math]::Sqrt([Math]::Pow($centerX - $queryX, 2) + [Math]::Pow($centerY - $queryY, 2))

        $role = Get-RoleFromControlType -element $element
        $name = $element.Current.Name
        $automationId = $element.Current.AutomationId
        $className = $element.Current.ClassName

        # Get value if available
        $value = $null
        try {
            $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($valuePattern) {
                $value = $valuePattern.Current.Value
            }
        } catch {}

        # Try range value pattern for sliders/progress bars
        if ($null -eq $value) {
            try {
                $rangePattern = $element.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
                if ($rangePattern) {
                    $value = $rangePattern.Current.Value.ToString()
                }
            } catch {}
        }

        $info = @{
            role = $role
            title = if ($name) { $name } else { "" }
            x = [Math]::Round($rect.X)
            y = [Math]::Round($rect.Y)
            width = [Math]::Round($rect.Width)
            height = [Math]::Round($rect.Height)
            distance = [Math]::Round($dist)
        }

        if ($automationId) { $info.description = $automationId }
        if ($value) { $info.value = $value }

        if ($detailed) {
            $info.identifier = $automationId
            $info.className = $className
            $info.enabled = $element.Current.IsEnabled
            $info.focused = $element.Current.HasKeyboardFocus

            # Check expanded state
            try {
                $expandPattern = $element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
                if ($expandPattern) {
                    $state = $expandPattern.Current.ExpandCollapseState
                    $info.expanded = ($state -eq [System.Windows.Automation.ExpandCollapseState]::Expanded)
                }
            } catch {}

            # Check toggle state (for checkboxes)
            try {
                $togglePattern = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
                if ($togglePattern) {
                    $state = $togglePattern.Current.ToggleState
                    $info.selected = ($state -eq [System.Windows.Automation.ToggleState]::On)
                }
            } catch {}

            # Check selection state
            try {
                $selectionItemPattern = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                if ($selectionItemPattern) {
                    $info.selected = $selectionItemPattern.Current.IsSelected
                }
            } catch {}

            # Get available actions
            $actions = @()
            $patterns = $element.GetSupportedPatterns()
            foreach ($pattern in $patterns) {
                $patternName = $pattern.ProgrammaticName -replace "PatternIdentifiers.Pattern", ""
                switch ($patternName) {
                    "Invoke" { $actions += "Press" }
                    "ExpandCollapse" { $actions += "Expand"; $actions += "Collapse" }
                    "Toggle" { $actions += "Toggle" }
                    "SelectionItem" { $actions += "Select" }
                    "Value" { $actions += "SetValue" }
                    "RangeValue" { $actions += "SetValue" }
                    "Scroll" { $actions += "Scroll" }
                }
            }
            if ($actions.Count -gt 0) {
                $info.actions = $actions
            }
        }

        return $info
    } catch {
        return $null
    }
}

function Get-WindowInfo {
    param([System.Windows.Automation.AutomationElement]$window)

    try {
        $rect = $window.Current.BoundingRectangle

        # Check window pattern for state
        $isMinimized = $false
        $isModal = $false
        try {
            $windowPattern = $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
            if ($windowPattern) {
                $isMinimized = ($windowPattern.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized)
                $isModal = $windowPattern.Current.IsModal
            }
        } catch {}

        return @{
            title = $window.Current.Name
            role = "Window"
            isMain = $true
            isMinimized = $isMinimized
            isFocused = $window.Current.HasKeyboardFocus
            modal = $isModal
            x = [Math]::Round($rect.X)
            y = [Math]::Round($rect.Y)
            width = [Math]::Round($rect.Width)
            height = [Math]::Round($rect.Height)
            identifier = $window.Current.AutomationId
        }
    } catch {
        return $null
    }
}

function Is-InteractiveRole {
    param([string]$role)

    $interactiveRoles = @(
        "Button", "TextField", "CheckBox", "RadioButton",
        "ComboBox", "MenuItem", "Tab", "Slider", "Link",
        "ListItem", "TreeItem", "TabItem", "Hyperlink"
    )
    return $interactiveRoles -contains $role
}

function Get-NearbyElements {
    param(
        [int]$queryX,
        [int]$queryY,
        [int]$maxCount,
        [int]$maxDistance,
        [bool]$includeNonInteractive
    )

    $elements = @()
    $elementAtPoint = $null

    try {
        # Get element at point
        $point = New-Object System.Windows.Point($queryX, $queryY)
        $elementAtPointRaw = [System.Windows.Automation.AutomationElement]::FromPoint($point)

        if ($elementAtPointRaw) {
            $elementAtPoint = Get-ElementInfo -element $elementAtPointRaw -queryX $queryX -queryY $queryY
        }

        # Get root element and focused window
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement

        # Find the window containing the point
        $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Window
        )
        $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)

        $targetWindow = $null
        foreach ($win in $windows) {
            try {
                $rect = $win.Current.BoundingRectangle
                if (-not [System.Windows.Rect]::Empty.Equals($rect)) {
                    # Manual bounds check (more reliable than Contains)
                    if ($queryX -ge $rect.X -and $queryX -le ($rect.X + $rect.Width) -and
                        $queryY -ge $rect.Y -and $queryY -le ($rect.Y + $rect.Height)) {
                        $targetWindow = $win
                        break
                    }
                }
            } catch {}
        }

        if ($null -eq $targetWindow -and $focusedElement) {
            # Try to get window from focused element
            $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
            $current = $focusedElement
            while ($current -and $current.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
                $current = $walker.GetParent($current)
            }
            if ($current) {
                $targetWindow = $current
            }
        }

        if ($targetWindow) {
            # Get all elements in the window
            $condition = [System.Windows.Automation.Condition]::TrueCondition
            $allElements = $targetWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)

            foreach ($elem in $allElements) {
                $info = Get-ElementInfo -element $elem -queryX $queryX -queryY $queryY
                if ($info -and $info.distance -le $maxDistance) {
                    if ($includeNonInteractive -or (Is-InteractiveRole -role $info.role)) {
                        $elements += $info
                    }
                }
            }
        }

        # Sort by distance and take top N
        if ($elements.Count -gt 0) {
            $elements = @($elements | Sort-Object { $_.distance } | Select-Object -First $maxCount)
        }

    } catch {
        # Return empty on error
    }

    # Ensure nearbyElements is always an array
    if ($null -eq $elements) { $elements = @() }

    return @{
        elementAtPoint = $elementAtPoint
        nearbyElements = @($elements)
    }
}

function Search-Elements {
    param(
        [string]$keyword,
        [int]$maxResults
    )

    $results = @()
    $keywordLower = $keyword.ToLower()

    try {
        $root = [System.Windows.Automation.AutomationElement]::RootElement

        # Get all windows
        $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Window
        )
        $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)

        foreach ($win in $windows) {
            if ($results.Count -ge $maxResults) { break }

            # Skip minimized windows
            try {
                $windowPattern = $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
                if ($windowPattern -and $windowPattern.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) {
                    continue
                }
            } catch {}

            $condition = [System.Windows.Automation.Condition]::TrueCondition
            $allElements = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)

            foreach ($elem in $allElements) {
                if ($results.Count -ge $maxResults) { break }

                $name = $elem.Current.Name
                $automationId = $elem.Current.AutomationId

                $matchScore = 0
                if ($name -and $name.ToLower().Contains($keywordLower)) {
                    $matchScore = 1.0 - ($name.Length - $keyword.Length) / [Math]::Max($name.Length, 1)
                    if ($name.ToLower() -eq $keywordLower) { $matchScore = 1.0 }
                } elseif ($automationId -and $automationId.ToLower().Contains($keywordLower)) {
                    $matchScore = 0.8 - ($automationId.Length - $keyword.Length) / [Math]::Max($automationId.Length, 1)
                }

                if ($matchScore -gt 0) {
                    $info = Get-ElementInfo -element $elem -queryX 0 -queryY 0
                    if ($info) {
                        $info.similarity = [Math]::Round($matchScore, 2)
                        $info.distance = 0
                        $results += $info
                    }
                }
            }
        }

        # Sort by similarity
        if ($results.Count -gt 0) {
            $results = @($results | Sort-Object { -$_.similarity } | Select-Object -First $maxResults)
        }

    } catch {
        # Return empty on error
    }

    # Ensure results is always an array
    if ($null -eq $results) { $results = @() }

    return @($results)
}

function Get-Snapshot {
    param(
        [int]$queryX = -1,
        [int]$queryY = -1
    )

    $snapshot = @{
        success = $true
        timestamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
        windows = @()
        openMenus = @()
    }

    try {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement

        # Get focused element info
        if ($focusedElement) {
            $snapshot.focusedElement = Get-ElementInfo -element $focusedElement -detailed
        }

        # Get element at point if coordinates provided
        if ($queryX -ge 0 -and $queryY -ge 0) {
            $point = New-Object System.Windows.Point($queryX, $queryY)
            $elementAtPoint = [System.Windows.Automation.AutomationElement]::FromPoint($point)
            if ($elementAtPoint) {
                $snapshot.elementAtPoint = Get-ElementInfo -element $elementAtPoint -detailed
            }
        }

        # Find focused window and application
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $current = $focusedElement
        $focusedWindow = $null

        while ($current) {
            $controlType = $current.Current.ControlType
            if ($controlType -eq [System.Windows.Automation.ControlType]::Window) {
                $focusedWindow = $current
                break
            }
            $current = $walker.GetParent($current)
        }

        if ($focusedWindow) {
            $snapshot.focusedWindow = Get-WindowInfo -window $focusedWindow

            # Get process info for focused application
            try {
                $processId = $focusedWindow.Current.ProcessId
                $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if ($process) {
                    $snapshot.focusedApplication = @{
                        title = $process.MainWindowTitle
                        bundleIdentifier = $process.ProcessName
                        isFrontmost = $true
                        isHidden = $false
                        pid = $processId
                    }
                }
            } catch {}

            # Get tabs if present (look for tab controls)
            $tabCondition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Tab
            )
            $tabGroups = $focusedWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)

            if ($tabGroups.Count -gt 0) {
                $tabs = @()
                foreach ($tabGroup in $tabGroups) {
                    $tabItemCondition = New-Object System.Windows.Automation.PropertyCondition(
                        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                        [System.Windows.Automation.ControlType]::TabItem
                    )
                    $tabItems = $tabGroup.FindAll([System.Windows.Automation.TreeScope]::Children, $tabItemCondition)

                    $index = 0
                    foreach ($tabItem in $tabItems) {
                        $isSelected = $false
                        try {
                            $selectionPattern = $tabItem.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                            if ($selectionPattern) {
                                $isSelected = $selectionPattern.Current.IsSelected
                            }
                        } catch {}

                        $tabs += @{
                            title = $tabItem.Current.Name
                            isSelected = $isSelected
                            index = $index
                        }
                        $index++
                    }
                }
                if ($tabs.Count -gt 0) {
                    $snapshot.tabs = $tabs
                }
            }
        }

        # Get all top-level windows
        $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Window
        )
        $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)

        foreach ($win in $windows) {
            $winInfo = Get-WindowInfo -window $win
            if ($winInfo) {
                $snapshot.windows += $winInfo
            }
        }

        # Check for open menus
        $menuCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Menu
        )

        foreach ($win in $windows) {
            $menus = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $menuCondition)
            foreach ($menu in $menus) {
                $rect = $menu.Current.BoundingRectangle
                if (-not [System.Windows.Rect]::Empty.Equals($rect)) {
                    # Get menu items
                    $menuItemCondition = New-Object System.Windows.Automation.PropertyCondition(
                        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                        [System.Windows.Automation.ControlType]::MenuItem
                    )
                    $menuItems = $menu.FindAll([System.Windows.Automation.TreeScope]::Children, $menuItemCondition)
                    $itemNames = @()
                    foreach ($item in $menuItems) {
                        if ($item.Current.Name) {
                            $itemNames += $item.Current.Name
                        }
                    }

                    $snapshot.openMenus += @{
                        title = $menu.Current.Name
                        role = "Menu"
                        x = [Math]::Round($rect.X)
                        y = [Math]::Round($rect.Y)
                        width = [Math]::Round($rect.Width)
                        height = [Math]::Round($rect.Height)
                        items = $itemNames
                    }
                }
            }
        }

        # Check for modal dialogs (sheets)
        $sheets = @()
        foreach ($win in $windows) {
            try {
                $windowPattern = $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
                if ($windowPattern -and $windowPattern.Current.IsModal) {
                    $rect = $win.Current.BoundingRectangle
                    $sheets += @{
                        title = $win.Current.Name
                        role = "Window"
                        subrole = "Dialog"
                        isModal = $true
                        identifier = $win.Current.AutomationId
                        x = [Math]::Round($rect.X)
                        y = [Math]::Round($rect.Y)
                        width = [Math]::Round($rect.Width)
                        height = [Math]::Round($rect.Height)
                    }
                }
            } catch {}
        }
        if ($sheets.Count -gt 0) {
            $snapshot.sheets = $sheets
        }

    } catch {
        $snapshot.success = $false
        $snapshot.error = $_.Exception.Message
    }

    return $snapshot
}

# Win32 API for foreground window detection
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32FG {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

function Get-AXLines {
    $maxElements = 5000

    try {
        # Get foreground window process via Win32 (more reliable than UIA FocusedElement walk-up)
        $hwnd = [Win32FG]::GetForegroundWindow()
        $fgPid = [uint32]0
        [void][Win32FG]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)

        if ($fgPid -eq 0) {
            return @{ error = "No foreground window" }
        }

        $proc = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
        if (-not $proc) {
            return @{ error = "Process not found for PID $fgPid" }
        }

        $appName = $proc.MainWindowTitle
        if (-not $appName) { $appName = $proc.ProcessName }
        $bundleId = $proc.ProcessName

        # Find all top-level windows belonging to this process
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $pidCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$fgPid
        )
        $topWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCondition)

        $lines = [System.Collections.Generic.List[string]]::new()
        $totalElements = 0

        foreach ($win in $topWindows) {
            if ($totalElements -ge $maxElements) { break }

            try {
                # Skip minimized windows
                try {
                    $wp = $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
                    if ($wp -and $wp.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) {
                        continue
                    }
                } catch {}

                $condition = [System.Windows.Automation.Condition]::TrueCondition
                $allElements = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)

                foreach ($elem in $allElements) {
                    if ($totalElements -ge $maxElements) { break }
                    $totalElements++

                    try {
                        $ct = $elem.Current.ControlType
                        $typeName = $ct.ProgrammaticName -replace "ControlType.", ""
                        if ($ControlTypeToRole.ContainsKey($typeName)) {
                            $role = $ControlTypeToRole[$typeName]
                        } else {
                            $role = $typeName
                        }
                        $name = $elem.Current.Name
                        $automationId = $elem.Current.AutomationId

                        # Only query Value pattern for input-like controls (expensive COM call)
                        $value = $null
                        if ($typeName -eq "Edit" -or $typeName -eq "ComboBox" -or $typeName -eq "Slider" -or $typeName -eq "Spinner" -or $typeName -eq "Document") {
                            try {
                                $vp = $elem.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                                if ($vp) { $value = $vp.Current.Value }
                            } catch {}
                            if ($null -eq $value) {
                                try {
                                    $rp = $elem.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
                                    if ($rp) { $value = $rp.Current.Value.ToString() }
                                } catch {}
                            }
                        }

                        # Skip if all text fields are empty
                        if ((-not $name) -and (-not $value) -and (-not $automationId)) { continue }

                        # Build line: "Role|t=Name|v=Value|d=AutomationId"
                        $parts = [System.Collections.Generic.List[string]]::new()
                        $parts.Add($role)
                        if ($name) { $parts.Add("t=$name") }
                        if ($value) { $parts.Add("v=$value") }
                        if ($automationId) { $parts.Add("d=$automationId") }

                        $lines.Add($parts -join "|")
                    } catch {
                        # Skip individual element errors
                    }
                }
            } catch {
                # Skip window-level errors, continue to next window
            }
        }

        return @{
            appName = $appName
            bundleId = $bundleId
            lines = @($lines)
        }
    } catch {
        return @{ error = $_.Exception.Message }
    }
}

# Main execution
$startTime = Get-Date
$result = $null

try {
    if ($axlines) {
        # AX lines mode - flat tree dump for diff
        $result = Get-AXLines
        if (-not $result.ContainsKey("error")) {
            $result.queryTimeMs = [Math]::Round(((Get-Date) - $startTime).TotalMilliseconds)
        }
    }
    elseif ($snapshot) {
        # Snapshot mode
        $result = Get-Snapshot -queryX $x -queryY $y
        $result.queryTimeMs = [Math]::Round(((Get-Date) - $startTime).TotalMilliseconds)
    }
    elseif ($search -ne "") {
        # Search mode
        $searchResults = Search-Elements -keyword $search -maxResults $count
        $result = @{
            success = $true
            results = $searchResults
            searchKeyword = $search
            queryTimeMs = [Math]::Round(((Get-Date) - $startTime).TotalMilliseconds)
        }
    }
    elseif ($x -ge 0 -and $y -ge 0) {
        # Query mode
        $queryResult = Get-NearbyElements -queryX $x -queryY $y -maxCount $count -maxDistance $distance -includeNonInteractive $includeNonInteractive
        $result = @{
            success = $true
            elementAtPoint = $queryResult.elementAtPoint
            nearbyElements = $queryResult.nearbyElements
            queryX = $x
            queryY = $y
            queryTimeMs = [Math]::Round(((Get-Date) - $startTime).TotalMilliseconds)
        }
    }
    else {
        $result = @{
            success = $false
            error = "No valid operation specified. Use -x/-y for query, -search for search, or -snapshot for snapshot."
            queryTimeMs = 0
        }
    }
} catch {
    $result = @{
        success = $false
        error = $_.Exception.Message
        queryTimeMs = [Math]::Round(((Get-Date) - $startTime).TotalMilliseconds)
    }
}

# Output JSON
$result | ConvertTo-Json -Depth 10 -Compress
