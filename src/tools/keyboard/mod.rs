//! KeyboardTool - Keyboard input for GUI automation
//!
//! Handles typing text and hotkey combinations

use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;

/// Check if text contains non-ASCII characters
fn is_non_ascii(text: &str) -> bool {
    text.chars().any(|c| c.len_utf8() > 1 || c.is_control())
}

/// Normalize modifier key name
fn normalize_modifier(key: &str) -> Option<&'static str> {
    match key {
        k if k.eq_ignore_ascii_case("cmd")
            || k.eq_ignore_ascii_case("command")
            || k.eq_ignore_ascii_case("super") =>
        {
            Some("cmd")
        }
        k if k.eq_ignore_ascii_case("ctrl") || k.eq_ignore_ascii_case("control") => Some("ctrl"),
        k if k.eq_ignore_ascii_case("alt") || k.eq_ignore_ascii_case("option") => Some("alt"),
        k if k.eq_ignore_ascii_case("shift") => Some("shift"),
        _ => None,
    }
}

/// Map key name to cliclick format
fn map_key(key: &str) -> String {
    match key {
        k if k.eq_ignore_ascii_case("return") || k.eq_ignore_ascii_case("enter") => {
            "return".to_string()
        }
        k if k.eq_ignore_ascii_case("escape") || k.eq_ignore_ascii_case("esc") => {
            "escape".to_string()
        }
        k if k.eq_ignore_ascii_case("tab") => "tab".to_string(),
        k if k.eq_ignore_ascii_case("space") => "space".to_string(),
        k if k.eq_ignore_ascii_case("delete") => "delete".to_string(),
        k if k.eq_ignore_ascii_case("backspace") => "backspace".to_string(),
        k if k.eq_ignore_ascii_case("up") || k.eq_ignore_ascii_case("uparrow") => "up".to_string(),
        k if k.eq_ignore_ascii_case("down") || k.eq_ignore_ascii_case("downarrow") => {
            "down".to_string()
        }
        k if k.eq_ignore_ascii_case("left") || k.eq_ignore_ascii_case("leftarrow") => {
            "left".to_string()
        }
        k if k.eq_ignore_ascii_case("right") || k.eq_ignore_ascii_case("rightarrow") => {
            "right".to_string()
        }
        k if k.eq_ignore_ascii_case("pageup") => "pageup".to_string(),
        k if k.eq_ignore_ascii_case("pagedown") => "pagedown".to_string(),
        k if k.eq_ignore_ascii_case("home") => "home".to_string(),
        k if k.eq_ignore_ascii_case("end") => "end".to_string(),
        k if k.eq_ignore_ascii_case("f1") => "f1".to_string(),
        k if k.eq_ignore_ascii_case("f2") => "f2".to_string(),
        k if k.eq_ignore_ascii_case("f3") => "f3".to_string(),
        k if k.eq_ignore_ascii_case("f4") => "f4".to_string(),
        k if k.eq_ignore_ascii_case("f5") => "f5".to_string(),
        k if k.eq_ignore_ascii_case("f6") => "f6".to_string(),
        k if k.eq_ignore_ascii_case("f7") => "f7".to_string(),
        k if k.eq_ignore_ascii_case("f8") => "f8".to_string(),
        k if k.eq_ignore_ascii_case("f9") => "f9".to_string(),
        k if k.eq_ignore_ascii_case("f10") => "f10".to_string(),
        k if k.eq_ignore_ascii_case("f11") => "f11".to_string(),
        k if k.eq_ignore_ascii_case("f12") => "f12".to_string(),
        other
            if other.len() == 1
                && other
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_graphic())
                    .unwrap_or(false) =>
        {
            other.to_lowercase()
        }
        _ => key.to_lowercase(),
    }
}

/// Keyboard tool for text input and hotkeys
pub struct KeyboardTool;

impl KeyboardTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for KeyboardTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for KeyboardTool {
    fn name(&self) -> &str {
        "keyboard"
    }

    fn description(&self) -> &str {
        "Handle keyboard input: type text and press hotkey combinations"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "oneOf": [
                {
                    "type": "object",
                    "properties": {
                        "action": { "const": "type" },
                        "text": { "type": "string", "description": "Text to type" }
                    },
                    "required": ["action", "text"]
                },
                {
                    "type": "object",
                    "properties": {
                        "action": { "const": "hotkey" },
                        "keys": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Keys in hotkey combination (e.g. [\"ctrl\", \"c\"])"
                        }
                    },
                    "required": ["action", "keys"]
                }
            ]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false
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
            "type" => self.do_type(input).await,
            "hotkey" => self.do_hotkey(input).await,
            _ => Err(format!("Unknown action: {}", action)),
        }
    }
}

impl KeyboardTool {
    /// Type text using keyboard
    async fn do_type(&self, input: &serde_json::Value) -> Result<ToolResult, String> {
        let text = input["text"].as_str().ok_or("Missing 'text' parameter")?;

        // For non-ASCII text (Chinese, special chars), use clipboard paste
        if is_non_ascii(text) {
            // Save current clipboard content
            let backup_output = tokio::process::Command::new("pbpaste")
                .output()
                .await
                .map_err(|e| format!("Failed to read clipboard: {}", e))?;
            let backup = String::from_utf8_lossy(&backup_output.stdout).to_string();

            // Copy text to clipboard
            tokio::process::Command::new("sh")
                .args(["-c", &format!("echo -n {} | pbcopy", shell_escape(text))])
                .output()
                .await
                .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;

            // Paste via Cmd+V
            let result = self.execute_hotkey(&["cmd", "v"]).await;

            // Restore clipboard
            if !backup.is_empty() {
                tokio::process::Command::new("sh")
                    .args(["-c", &format!("echo -n {} | pbcopy", shell_escape(&backup))])
                    .output()
                    .await
                    .ok();
            }

            return result;
        }

        // For ASCII text, use cliclick type
        let output = tokio::process::Command::new("cliclick")
            .args(["t", text])
            .output()
            .await
            .map_err(|e| format!("Failed to type: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let success = output.status.success();

        Ok(ToolResult {
            success,
            output: stdout.to_string(),
            error: if success {
                None
            } else {
                Some(format!("Type failed: {}", stdout))
            },
        })
    }

    /// Press a hotkey combination
    async fn do_hotkey(&self, input: &serde_json::Value) -> Result<ToolResult, String> {
        let keys = input["keys"].as_array().ok_or("Missing 'keys' parameter")?;

        let key_strs: Result<Vec<&str>, _> = keys
            .iter()
            .map(|k| k.as_str().ok_or("Invalid key"))
            .collect();
        let key_strs = key_strs?;

        self.execute_hotkey(&key_strs).await
    }

    /// Execute a hotkey combination using cliclick
    async fn execute_hotkey(&self, keys: &[&str]) -> Result<ToolResult, String> {
        if keys.is_empty() {
            return Err("No keys specified".to_string());
        }

        let mut key_parts: Vec<String> = Vec::new();

        for key in keys {
            if let Some(modifier) = normalize_modifier(key) {
                key_parts.push(format!("kd:{}", modifier));
            } else {
                key_parts.push(format!("kd:{}", map_key(key)));
            }
        }

        // Release keys in reverse order
        for key in keys.iter().rev() {
            if let Some(modifier) = normalize_modifier(key) {
                key_parts.push(format!("ku:{}", modifier));
            } else {
                key_parts.push(format!("ku:{}", map_key(key)));
            }
        }

        let output = tokio::process::Command::new("cliclick")
            .args(&key_parts)
            .output()
            .await
            .map_err(|e| format!("Failed to execute hotkey: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let success = output.status.success();

        Ok(ToolResult {
            success,
            output: stdout.to_string(),
            error: if success {
                None
            } else {
                Some(format!("Hotkey failed: {}", stdout))
            },
        })
    }
}

/// Escape a string for shell
fn shell_escape(s: &str) -> String {
    s.replace("\\", "\\\\").replace("'", "'\\''")
}
