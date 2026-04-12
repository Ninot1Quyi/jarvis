//! MouseTool - Mouse operations for GUI automation
//!
//! Supports macOS (cliclick) and Linux (xdotool).
//! Coordinates are normalized [0, 1000] where (0,0) is top-left.

use crate::accessibility::{capture_state, diff_state, StateSnapshot};
use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use serde_json::json;

/// Coordinate in normalized [0, 1000] range
#[derive(Debug, Clone)]
pub struct NormalizedCoord {
    pub x: f64,
    pub y: f64,
}

impl NormalizedCoord {
    pub fn from_json(value: &serde_json::Value) -> Result<Self, String> {
        let arr = value
            .as_array()
            .ok_or("Coordinate must be an array [x, y]")?;
        if arr.len() != 2 {
            return Err("Coordinate must have exactly 2 elements [x, y]".to_string());
        }
        let x = arr[0].as_f64().ok_or("x must be a number")?;
        let y = arr[1].as_f64().ok_or("y must be a number")?;
        Ok(Self { x, y })
    }

    /// Convert to screen pixels
    pub fn to_screen(&self, screen_width: u32, screen_height: u32) -> (i32, i32) {
        let x = ((self.x / 1000.0) * screen_width as f64).round() as i32;
        let y = ((self.y / 1000.0) * screen_height as f64).round() as i32;
        (x, y)
    }
}

/// Screen size
#[derive(Debug, Clone)]
pub struct ScreenSize {
    pub width: u32,
    pub height: u32,
}

impl ScreenSize {
    /// Get screen size for the current platform
    /// Returns physical pixel dimensions for consistent coordinate mapping with screenshots
    pub async fn get() -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        {
            // Use system_profiler to get physical pixel resolution
            // This is critical for Retina displays where logical pixels != physical pixels
            // Screenshot (screencapture) returns physical pixels, so we must match
            let output = tokio::process::Command::new("system_profiler")
                .args(["SPDisplaysDataType", "-json"])
                .output()
                .await
                .map_err(|e| format!("Failed to get screen info: {}", e))?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                if let Some(displays) = json.get("SPDisplaysDataType") {
                    if let Some(arr) = displays.as_array() {
                        if let Some(display) = arr.get(0) {
                            // Try "Resolution" which may contain physical pixels
                            if let Some(res) = display.get("Resolution") {
                                let res_str = res.as_str().unwrap_or("");
                                // Format: "3456 x 2234 Retina" (physical) or "1728 x 1117" (logical)
                                if res_str.contains("x") {
                                    let parts: Vec<&str> = res_str.split_whitespace().collect();
                                    if parts.len() >= 2 {
                                        if let (Ok(w), Ok(h)) =
                                            (parts[0].parse::<u32>(), parts[2].parse::<u32>())
                                        {
                                            return Ok(Self {
                                                width: w,
                                                height: h,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // Fallback: use system_profiler text output
            let output = tokio::process::Command::new("system_profiler")
                .args(["SPDisplaysDataType"])
                .output()
                .await
                .map_err(|e| format!("Failed to get screen info: {}", e))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Parse "Resolution: 3456 x 2234 Retina"
            for line in stdout.lines() {
                if line.contains("Resolution:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    // Looking for pattern: "Resolution:" "3456" "x" "2234" "Retina"
                    let mut x_idx = 0;
                    for (i, p) in parts.iter().enumerate() {
                        if *p == "Resolution:" {
                            x_idx = i + 1;
                            break;
                        }
                    }
                    if x_idx > 0 && x_idx + 2 < parts.len() {
                        if let (Ok(w), Ok(h)) =
                            (parts[x_idx].parse::<u32>(), parts[x_idx + 2].parse::<u32>())
                        {
                            // Skip if this looks like logical resolution (even number that when doubled gives another even)
                            // Physical Retina resolution is what we want
                            return Ok(Self {
                                width: w,
                                height: h,
                            });
                        }
                    }
                }
            }
            // Final fallback
            return Ok(Self {
                width: 1920,
                height: 1080,
            });
        }

        #[cfg(target_os = "linux")]
        {
            // Use xdotool to get screen geometry: "1920x1080"
            let output = tokio::process::Command::new("sh")
                .args([
                    "-c",
                    "xdotool getdisplaygeometry 2>/dev/null || echo '1920 1080'",
                ])
                .output()
                .await
                .map_err(|e| format!("Failed to get screen size: {}", e))?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut parts = stdout.trim().split_whitespace();
            let width = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1920);
            let height = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1080);
            return Ok(Self { width, height });
        }

        #[cfg(target_os = "windows")]
        {
            // Use PowerShell to get screen size on Windows
            // IMPORTANT: SetProcessDPIAware() must be called first to get physical pixels,
            // not virtualized coordinates when DPI scaling is enabled
            let ps = r#"
Add-Type @"
using System.Runtime.InteropServices;
public static class DpiAwareness {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[DpiAwareness]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Windows.Forms
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output "$($b.Width),$($b.Height)"
"#;
            let output = tokio::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", ps])
                .output()
                .await
                .map_err(|e| format!("Failed to get screen size: {}", e))?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut parts = stdout.trim().split_whitespace();
            let width = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1920);
            let height = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1080);
            return Ok(Self { width, height });
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }
}

/// Execute a shell command and return stdout
async fn exec_command(cmd: &str) -> Result<String, String> {
    let output = tokio::process::Command::new("sh")
        .args(["-c", cmd])
        .output()
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Command failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn capture_ui_feedback(x: i32, y: i32) -> Option<StateSnapshot> {
    capture_state(Some((x, y)))
        .await
        .ok()
        .filter(|snapshot| snapshot.success)
}

fn format_feedback_output(
    action: &str,
    coord: &NormalizedCoord,
    screen_xy: (i32, i32),
    before: Option<&StateSnapshot>,
    after: Option<&StateSnapshot>,
) -> String {
    let mut payload = json!({
        "action": action,
        "normalized": { "x": coord.x, "y": coord.y },
        "screen": { "x": screen_xy.0, "y": screen_xy.1 },
    });

    if let (Some(before), Some(after)) = (before, after) {
        let diff = diff_state(before, after);
        payload["feedback"] = json!({
            "available": true,
            "summary": diff.summary,
            "applicationChanged": diff.application_changed,
            "windowFocusChanged": diff.window_focus_changed,
            "focusChanged": diff.focus_changed,
            "clickedElementChanged": diff.clicked_element_changed,
            "busyStateChanged": diff.busy_state_changed,
            "focusedWindowAfter": after.focused_window.as_ref().and_then(|w| w.title.clone()),
            "elementAtPointAfter": after
                .element_at_point
                .as_ref()
                .map(|el| json!({"role": el.role, "title": el.title, "identifier": el.identifier})),
        });
    } else {
        payload["feedback"] = json!({
            "available": false,
            "reason": "accessibility_snapshot_unavailable"
        });
    }

    payload.to_string()
}

/// Left single click (primary mouse button)
pub struct LeftSingleTool;

impl LeftSingleTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LeftSingleTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for LeftSingleTool {
    fn name(&self) -> &str {
        "left_single"
    }

    fn description(&self) -> &str {
        "Click left mouse button at normalized coordinates [0, 1000]. (0,0) is top-left, (1000,1000) is bottom-right."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "coordinate": {
                    "type": "array",
                    "items": { "type": "number" },
                    "description": "[x, y] coordinate in range [0, 1000]"
                }
            },
            "required": ["coordinate"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let coord = NormalizedCoord::from_json(&input["coordinate"])?;
        let screen = ScreenSize::get().await?;
        let (x, y) = coord.to_screen(screen.width, screen.height);
        let before = capture_ui_feedback(x, y).await;

        #[cfg(target_os = "macos")]
        {
            // Use -r flag for raw/physical pixels (critical for Retina displays)
            // Screenshot returns physical pixels, so clicks must match
            exec_command(&format!("cliclick -r c:{},{}", x, y)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "left_single",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "linux")]
        {
            exec_command(&format!(
                "xdotool mousemove --sync {} {} && xdotool click 1",
                x, y
            ))
            .await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "left_single",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "windows")]
        {
            let ps = format!(
                r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}}
'@
[WinMouse]::SetProcessDPIAware() | Out-Null
[WinMouse]::SetCursorPos({}, {});
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
"#,
                x, y
            );
            exec_command(&format!("powershell -NoProfile -Command \"{}\"", ps)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "left_single",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }
}

/// Left double click
pub struct LeftDoubleTool;

impl LeftDoubleTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LeftDoubleTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for LeftDoubleTool {
    fn name(&self) -> &str {
        "left_double"
    }

    fn description(&self) -> &str {
        "Double click left mouse button at normalized coordinates [0, 1000]."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "coordinate": {
                    "type": "array",
                    "items": { "type": "number" },
                    "description": "[x, y] coordinate in range [0, 1000]"
                }
            },
            "required": ["coordinate"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let coord = NormalizedCoord::from_json(&input["coordinate"])?;
        let screen = ScreenSize::get().await?;
        let (x, y) = coord.to_screen(screen.width, screen.height);
        let before = capture_ui_feedback(x, y).await;

        #[cfg(target_os = "macos")]
        {
            exec_command(&format!("cliclick -r dc:{},{}", x, y)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "left_double",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "linux")]
        {
            exec_command(&format!(
                "xdotool mousemove --sync {} {} && xdotool click --repeat 2 1",
                x, y
            ))
            .await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "left_double",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "windows")]
        {
            let ps = format!(
                r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}}
'@
[WinMouse]::SetProcessDPIAware() | Out-Null
[WinMouse]::SetCursorPos({}, {});
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
Start-Sleep -Milliseconds 50;
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
"#,
                x, y
            );
            exec_command(&format!("powershell -NoProfile -Command \"{}\"", ps)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "left_double",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }
}

/// Right single click (secondary mouse button)
pub struct RightSingleTool;

impl RightSingleTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RightSingleTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for RightSingleTool {
    fn name(&self) -> &str {
        "right_single"
    }

    fn description(&self) -> &str {
        "Right click (secondary mouse button) at normalized coordinates [0, 1000]."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "coordinate": {
                    "type": "array",
                    "items": { "type": "number" },
                    "description": "[x, y] coordinate in range [0, 1000]"
                }
            },
            "required": ["coordinate"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let coord = NormalizedCoord::from_json(&input["coordinate"])?;
        let screen = ScreenSize::get().await?;
        let (x, y) = coord.to_screen(screen.width, screen.height);
        let before = capture_ui_feedback(x, y).await;

        #[cfg(target_os = "macos")]
        {
            exec_command(&format!("cliclick -r rc:{},{}", x, y)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "right_single",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "linux")]
        {
            exec_command(&format!(
                "xdotool mousemove --sync {} {} && xdotool click 3",
                x, y
            ))
            .await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "right_single",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "windows")]
        {
            let ps = format!(
                r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
}}
'@
[WinMouse]::SetProcessDPIAware() | Out-Null
[WinMouse]::SetCursorPos({}, {});
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
"#,
                x, y
            );
            exec_command(&format!("powershell -NoProfile -Command \"{}\"", ps)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "right_single",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }
}

/// Middle mouse button click
pub struct MiddleClickTool;

impl MiddleClickTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MiddleClickTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for MiddleClickTool {
    fn name(&self) -> &str {
        "middle_click"
    }

    fn description(&self) -> &str {
        "Middle click at normalized coordinates [0, 1000]. Opens link in new tab without switching."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "coordinate": {
                    "type": "array",
                    "items": { "type": "number" },
                    "description": "[x, y] coordinate in range [0, 1000]"
                }
            },
            "required": ["coordinate"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let coord = NormalizedCoord::from_json(&input["coordinate"])?;
        let screen = ScreenSize::get().await?;
        let (x, y) = coord.to_screen(screen.width, screen.height);
        let before = capture_ui_feedback(x, y).await;

        #[cfg(target_os = "macos")]
        {
            exec_command(&format!("cliclick -r mc:{},{}", x, y)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "middle_click",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "linux")]
        {
            exec_command(&format!(
                "xdotool mousemove --sync {} {} && xdotool click 2",
                x, y
            ))
            .await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "middle_click",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "windows")]
        {
            let ps = format!(
                r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
}}
'@
[WinMouse]::SetProcessDPIAware() | Out-Null
[WinMouse]::SetCursorPos({}, {});
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0);
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0);
"#,
                x, y
            );
            exec_command(&format!("powershell -NoProfile -Command \"{}\"", ps)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "middle_click",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }
}

/// Drag from start to end position
pub struct DragTool;

impl DragTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for DragTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for DragTool {
    fn name(&self) -> &str {
        "drag"
    }

    fn description(&self) -> &str {
        "Drag from start coordinate to end coordinate. Both coordinates in normalized [0, 1000] range."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "startCoordinate": {
                    "type": "array",
                    "items": { "type": "number" },
                    "description": "[x, y] start coordinate in range [0, 1000]"
                },
                "endCoordinate": {
                    "type": "array",
                    "items": { "type": "number" },
                    "description": "[x, y] end coordinate in range [0, 1000]"
                }
            },
            "required": ["startCoordinate", "endCoordinate"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let start = NormalizedCoord::from_json(&input["startCoordinate"])?;
        let end = NormalizedCoord::from_json(&input["endCoordinate"])?;
        let screen = ScreenSize::get().await?;
        let (x1, y1) = start.to_screen(screen.width, screen.height);
        let (x2, y2) = end.to_screen(screen.width, screen.height);
        let before = capture_ui_feedback(x1, y1).await;

        #[cfg(target_os = "macos")]
        {
            // Use -r for raw/physical pixels (critical for Retina displays)
            // Note: drag starts from current position, so caller should move there first
            exec_command(&format!(
                "cliclick -r kd:mousedown 1 mv:{},{} ku:mouseup 1",
                x2, y2
            ))
            .await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x2, y2).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "drag",
                    &end,
                    (x2, y2),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "linux")]
        {
            exec_command(&format!(
                "xdotool mousemove --sync {} {} && xdotool mousedown 1 && xdotool mousemove --sync {} {} && xdotool mouseup 1",
                x1, y1, x2, y2
            ))
            .await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x2, y2).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "drag",
                    &end,
                    (x2, y2),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "windows")]
        {
            let ps = format!(
                r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_MOVE = 0x0001;
}}
'@
[WinMouse]::SetProcessDPIAware() | Out-Null
[WinMouse]::SetCursorPos({}, {});
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
[WinMouse]::SetCursorPos({}, {});
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_MOVE, 0, 0, 0, 0);
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
"#,
                x1, y1, x2, y2
            );
            exec_command(&format!("powershell -NoProfile -Command \"{}\"", ps)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x2, y2).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "drag",
                    &end,
                    (x2, y2),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }
}

/// Scroll at position
pub struct ScrollTool;

impl ScrollTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ScrollTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for ScrollTool {
    fn name(&self) -> &str {
        "scroll"
    }

    fn description(&self) -> &str {
        "Scroll at position. Direction: up, down, left, right. Amount is number of scroll units (default 3)."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "coordinate": {
                    "type": "array",
                    "items": { "type": "number" },
                    "description": "[x, y] coordinate in range [0, 1000]"
                },
                "direction": {
                    "type": "string",
                    "enum": ["up", "down", "left", "right"],
                    "description": "Scroll direction"
                },
                "amount": {
                    "type": "number",
                    "description": "Number of scroll units (default 3)"
                }
            },
            "required": ["coordinate", "direction"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let coord = NormalizedCoord::from_json(&input["coordinate"])?;
        let direction = input["direction"]
            .as_str()
            .ok_or("Missing 'direction' parameter")?;
        #[allow(unused_variables)]
        let amount = input["amount"].as_u64().unwrap_or(3) as u32;
        let screen = ScreenSize::get().await?;
        let (x, y) = coord.to_screen(screen.width, screen.height);
        let before = capture_ui_feedback(x, y).await;

        #[cfg(target_os = "macos")]
        {
            // Map direction to cliclick scroll commands: up→wu, down→wd, left→wl, right→wr
            // Use -r flag for raw/physical pixels (critical for Retina displays)
            let cliclick_dir = match direction {
                "up" => "wu",
                "down" => "wd",
                "left" => "wl",
                "right" => "wr",
                _ => return Err(format!("Invalid direction: {}", direction)),
            };
            exec_command(&format!("cliclick -r {}:{},{}", cliclick_dir, x, y)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "scroll",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "linux")]
        {
            // xdotool scroll mapping: up=4, down=5, left=6, right=7
            let button = match direction {
                "up" => "4",
                "down" => "5",
                "left" => "6",
                "right" => "7",
                _ => return Err(format!("Invalid direction: {}", direction)),
            };
            exec_command(&format!(
                "xdotool mousemove --sync {} {} && xdotool click --repeat {} {}",
                x, y, amount, button
            ))
            .await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "scroll",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(target_os = "windows")]
        {
            // Windows wheel event: up=120, down=-120, left/right require horizontal wheel
            let wheel_delta = match direction {
                "up" => (amount * 120) as i32,
                "down" => -(amount * 120) as i32,
                "left" | "right" => {
                    // Horizontal scroll on Windows requires mouse_event with MOUSEEVENTF_HWHEEL
                    let ps = format!(
                        r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public const uint MOUSEEVENTF_HWHEEL = 0x01000;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_MOVE = 0x0001;
}}
'@
[WinMouse]::SetProcessDPIAware() | Out-Null
[WinMouse]::SetCursorPos({}, {});
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_MOVE, 0, 0, 0, 0);
"#,
                        x, y
                    );
                    exec_command(&format!("powershell -NoProfile -Command \"{}\"", ps)).await?;
                    return Ok(ToolResult {
                        success: true,
                        output: format!(
                            "Scrolled {} {} times at ({}, {}) -> screen ({}, {})",
                            direction, amount, coord.x, coord.y, x, y
                        ),
                        error: None,
                    });
                }
                _ => return Err(format!("Invalid direction: {}", direction)),
            };
            let ps = format!(
                r#"Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_MOVE = 0x0001;
}}
'@
[WinMouse]::SetProcessDPIAware() | Out-Null
[WinMouse]::SetCursorPos({}, {});
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_MOVE, 0, 0, 0, 0);
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_WHEEL, 0, 0, {}, 0);
"#,
                x, y, wheel_delta
            );
            exec_command(&format!("powershell -NoProfile -Command \"{}\"", ps)).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
            let after = capture_ui_feedback(x, y).await;
            Ok(ToolResult {
                success: true,
                output: format_feedback_output(
                    "scroll",
                    &coord,
                    (x, y),
                    before.as_ref(),
                    after.as_ref(),
                ),
                error: None,
            })
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }
}

/// All mouse tools
pub mod all {
    use super::*;

    pub fn tools() -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(LeftSingleTool::new()),
            Box::new(LeftDoubleTool::new()),
            Box::new(RightSingleTool::new()),
            Box::new(MiddleClickTool::new()),
            Box::new(DragTool::new()),
            Box::new(ScrollTool::new()),
        ]
    }
}
