//! SystemTool - System operations (screenshot, wait, call_user, etc.)

use crate::tools::mouse::ScreenSize;
use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// Global state for session management
static SCREEN_CAPTURE_ENABLED: AtomicBool = AtomicBool::new(true);
static MAX_STEPS: AtomicU64 = AtomicU64::new(500);
static CURRENT_TASK: Mutex<Option<String>> = Mutex::new(None);

/// ScreenshotTool - Capture screen images
pub struct ScreenshotTool;

impl ScreenshotTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ScreenshotTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for ScreenshotTool {
    fn name(&self) -> &str {
        "screenshot"
    }

    fn description(&self) -> &str {
        "Capture a screenshot of the current screen. Returns the path to the saved image."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {},
            "required": []
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        true
    }

    async fn call(
        &self,
        _input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("Failed to get timestamp: {}", e))?
            .as_secs();
        let path = format!("/tmp/screenshot_{}.png", timestamp);

        // Get screen size for coordinate mapping context
        let screen = ScreenSize::get().await?;

        let output = tokio::process::Command::new("screencapture")
            .args(["-C", "-x", &path])
            .output()
            .await
            .map_err(|e| format!("Failed to capture screenshot: {}", e))?;

        if output.status.success() {
            // Return both path and screen dimensions so LLM can map coordinates correctly
            let result_json = serde_json::json!({
                "path": path,
                "screenWidth": screen.width,
                "screenHeight": screen.height,
            });
            Ok(ToolResult {
                success: true,
                output: result_json.to_string(),
                error: None,
            })
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Screenshot failed: {}", stderr)),
            })
        }
    }
}

/// WaitTool - Wait for specified milliseconds
pub struct WaitTool;

impl WaitTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WaitTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for WaitTool {
    fn name(&self) -> &str {
        "wait"
    }

    fn description(&self) -> &str {
        "Wait for a specified number of milliseconds."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "milliseconds": {
                    "type": "number",
                    "description": "Number of milliseconds to wait"
                }
            },
            "required": ["milliseconds"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        true
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let ms = input["milliseconds"]
            .as_u64()
            .ok_or("Missing 'milliseconds' parameter")?;

        tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;

        Ok(ToolResult {
            success: true,
            output: format!("Waited {} ms", ms),
            error: None,
        })
    }
}

/// CallUserTool - Signal that user assistance is needed
pub struct CallUserTool;

impl CallUserTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CallUserTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for CallUserTool {
    fn name(&self) -> &str {
        "call_user"
    }

    fn description(&self) -> &str {
        "Signal that user assistance is needed. The agent will pause and wait for user input."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "Message to display to the user"
                }
            },
            "required": ["message"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let message = input["message"]
            .as_str()
            .ok_or("Missing 'message' parameter")?;

        Ok(ToolResult {
            success: true,
            output: format!("User called: {}", message),
            error: None,
        })
    }
}

/// RecordTaskTool - Record/set current task
pub struct RecordTaskTool;

impl RecordTaskTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RecordTaskTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for RecordTaskTool {
    fn name(&self) -> &str {
        "record_task"
    }

    fn description(&self) -> &str {
        "Record or update the current task being performed."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "The task description to record"
                }
            },
            "required": ["task"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let task = input["task"].as_str().ok_or("Missing 'task' parameter")?;

        let mut current = CURRENT_TASK
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        *current = Some(task.to_string());

        Ok(ToolResult {
            success: true,
            output: format!("Task recorded: {}", task),
            error: None,
        })
    }
}

/// ScreenTool - Control screen capture state
pub struct ScreenTool;

impl ScreenTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ScreenTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for ScreenTool {
    fn name(&self) -> &str {
        "screen"
    }

    fn description(&self) -> &str {
        "Control screen capture. Use 'open' to enable, 'close' to disable."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["open", "close"],
                    "description": "The action to perform: 'open' enables screen capture, 'close' disables it"
                }
            },
            "required": ["action"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let action = input["action"]
            .as_str()
            .ok_or("Missing 'action' parameter")?;

        match action {
            "open" => {
                SCREEN_CAPTURE_ENABLED.store(true, Ordering::SeqCst);
                Ok(ToolResult {
                    success: true,
                    output: "Screen capture enabled".to_string(),
                    error: None,
                })
            }
            "close" => {
                SCREEN_CAPTURE_ENABLED.store(false, Ordering::SeqCst);
                Ok(ToolResult {
                    success: true,
                    output: "Screen capture disabled".to_string(),
                    error: None,
                })
            }
            _ => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Invalid action. Use 'open' or 'close'".to_string()),
            }),
        }
    }
}

/// SetMaxStepsTool - Set maximum steps for session
pub struct SetMaxStepsTool;

impl SetMaxStepsTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SetMaxStepsTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for SetMaxStepsTool {
    fn name(&self) -> &str {
        "set_max_steps"
    }

    fn description(&self) -> &str {
        "Set the maximum number of steps for the current session."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "max_steps": {
                    "type": "number",
                    "description": "Maximum number of steps"
                }
            },
            "required": ["max_steps"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let max_steps = input["max_steps"]
            .as_u64()
            .ok_or("Missing 'max_steps' parameter")?;

        MAX_STEPS.store(max_steps, Ordering::SeqCst);

        Ok(ToolResult {
            success: true,
            output: format!("Max steps set to {}", max_steps),
            error: None,
        })
    }
}
