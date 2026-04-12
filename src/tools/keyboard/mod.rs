//! KeyboardTool - Keyboard input for GUI automation.
//!
//! Handles typing text and hotkey combinations, with accessibility snapshot
//! feedback after each action so GUI flows can verify the effect.

use crate::accessibility::{capture_state, diff_state, StateSnapshot};
use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use serde_json::json;

/// Check if text contains non-ASCII characters.
fn is_non_ascii(text: &str) -> bool {
    text.chars().any(|c| c.len_utf8() > 1 || c.is_control())
}

/// Normalize modifier key name.
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

/// Map key name to backend-neutral symbolic name.
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

/// Keyboard tool for text input and hotkeys.
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
    async fn do_type(&self, input: &serde_json::Value) -> Result<ToolResult, String> {
        let text = input["text"].as_str().ok_or("Missing 'text' parameter")?;
        let before = capture_ui_feedback().await;

        let method = if is_non_ascii(text) {
            self.type_via_clipboard(text).await?;
            "clipboard_paste"
        } else {
            self.type_ascii(text).await?;
            "direct_type"
        };

        tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
        let after = capture_ui_feedback().await;

        Ok(ToolResult {
            success: true,
            output: format_feedback_output(
                "type",
                Some(text),
                None,
                method,
                before.as_ref(),
                after.as_ref(),
            ),
            error: None,
        })
    }

    async fn do_hotkey(&self, input: &serde_json::Value) -> Result<ToolResult, String> {
        let keys = input["keys"].as_array().ok_or("Missing 'keys' parameter")?;
        let key_strs: Result<Vec<&str>, _> = keys
            .iter()
            .map(|k| k.as_str().ok_or("Invalid key"))
            .collect();
        let key_strs = key_strs?;
        let before = capture_ui_feedback().await;

        self.execute_hotkey(&key_strs).await?;

        tokio::time::sleep(tokio::time::Duration::from_millis(120)).await;
        let after = capture_ui_feedback().await;

        Ok(ToolResult {
            success: true,
            output: format_feedback_output(
                "hotkey",
                None,
                Some(&key_strs.join("+")),
                "hotkey",
                before.as_ref(),
                after.as_ref(),
            ),
            error: None,
        })
    }

    async fn type_ascii(&self, text: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let output = tokio::process::Command::new("cliclick")
                .args(["t", text])
                .output()
                .await
                .map_err(|e| format!("Failed to type: {}", e))?;

            if output.status.success() {
                return Ok(());
            }

            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Type failed: {}", stderr.trim()));
        }

        #[cfg(target_os = "linux")]
        {
            let output = tokio::process::Command::new("xdotool")
                .args(["type", "--delay", "0", "--clearmodifiers", text])
                .output()
                .await
                .map_err(|e| format!("Failed to type via xdotool: {}", e))?;

            if output.status.success() {
                return Ok(());
            }

            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Type failed: {}", stderr.trim()));
        }

        #[cfg(target_os = "windows")]
        {
            let escaped = powershell_single_quote_escape(text);
            let ps = format!(
                "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{}')",
                escaped
            );
            let output = tokio::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &ps])
                .output()
                .await
                .map_err(|e| format!("Failed to type via PowerShell: {}", e))?;

            if output.status.success() {
                return Ok(());
            }

            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Type failed: {}", stderr.trim()));
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }

    async fn type_via_clipboard(&self, text: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let backup = tokio::process::Command::new("pbpaste")
                .output()
                .await
                .map_err(|e| format!("Failed to read clipboard: {}", e))?;
            let backup_text = String::from_utf8_lossy(&backup.stdout).to_string();

            tokio::process::Command::new("sh")
                .args([
                    "-c",
                    &format!("printf %s '{}' | pbcopy", shell_escape(text)),
                ])
                .output()
                .await
                .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;

            self.execute_hotkey(&["cmd", "v"]).await?;

            if !backup_text.is_empty() {
                let _ = tokio::process::Command::new("sh")
                    .args([
                        "-c",
                        &format!("printf %s '{}' | pbcopy", shell_escape(&backup_text)),
                    ])
                    .output()
                    .await;
            }
            return Ok(());
        }

        #[cfg(target_os = "linux")]
        {
            let escaped = shell_escape(text);
            let copy_cmd = format!(
                "if command -v xclip >/dev/null 2>&1; then printf %s '{}' | xclip -selection clipboard; \
                 elif command -v xsel >/dev/null 2>&1; then printf %s '{}' | xsel --clipboard --input; \
                 else exit 127; fi",
                escaped, escaped
            );
            let output = tokio::process::Command::new("sh")
                .args(["-c", &copy_cmd])
                .output()
                .await
                .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!(
                    "Clipboard copy failed (need xclip or xsel for non-ASCII input): {}",
                    stderr.trim()
                ));
            }
            self.execute_hotkey(&["ctrl", "v"]).await?;
            return Ok(());
        }

        #[cfg(target_os = "windows")]
        {
            let escaped = powershell_single_quote_escape(text);
            let copy_cmd = format!("Set-Clipboard -Value '{}'", escaped);
            let output = tokio::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &copy_cmd])
                .output()
                .await
                .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Clipboard copy failed: {}", stderr.trim()));
            }
            self.execute_hotkey(&["ctrl", "v"]).await?;
            return Ok(());
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }

    async fn execute_hotkey(&self, keys: &[&str]) -> Result<(), String> {
        if keys.is_empty() {
            return Err("No keys specified".to_string());
        }

        #[cfg(target_os = "macos")]
        {
            let mut key_parts: Vec<String> = Vec::new();
            for key in keys {
                if let Some(modifier) = normalize_modifier(key) {
                    key_parts.push(format!("kd:{}", modifier));
                } else {
                    key_parts.push(format!("kd:{}", map_key(key)));
                }
            }
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
            if output.status.success() {
                return Ok(());
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Hotkey failed: {}", stderr.trim()));
        }

        #[cfg(target_os = "linux")]
        {
            let combo = keys
                .iter()
                .map(|key| match normalize_modifier(key) {
                    Some("cmd") => "super".to_string(),
                    Some(modifier) => modifier.to_string(),
                    None => map_key(key),
                })
                .collect::<Vec<_>>()
                .join("+");
            let output = tokio::process::Command::new("xdotool")
                .args(["key", "--clearmodifiers", &combo])
                .output()
                .await
                .map_err(|e| format!("Failed to execute hotkey via xdotool: {}", e))?;
            if output.status.success() {
                return Ok(());
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Hotkey failed: {}", stderr.trim()));
        }

        #[cfg(target_os = "windows")]
        {
            let combo = keys_to_send_keys(keys);
            let ps = format!(
                "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{}')",
                combo
            );
            let output = tokio::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &ps])
                .output()
                .await
                .map_err(|e| format!("Failed to execute hotkey via PowerShell: {}", e))?;
            if output.status.success() {
                return Ok(());
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Hotkey failed: {}", stderr.trim()))
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err("Unsupported platform".to_string())
        }
    }
}

async fn capture_ui_feedback() -> Option<StateSnapshot> {
    capture_state(None)
        .await
        .ok()
        .filter(|snapshot| snapshot.success)
}

fn format_feedback_output(
    action: &str,
    text: Option<&str>,
    hotkey: Option<&str>,
    method: &str,
    before: Option<&StateSnapshot>,
    after: Option<&StateSnapshot>,
) -> String {
    let mut payload = json!({
        "action": action,
        "method": method,
        "text": text,
        "hotkey": hotkey,
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
            "focusedElementAfter": after.focused_element.as_ref().map(|el| json!({
                "role": el.role,
                "title": el.title,
                "identifier": el.identifier
            })),
        });
    } else {
        payload["feedback"] = json!({
            "available": false,
            "reason": "accessibility_snapshot_unavailable"
        });
    }

    payload.to_string()
}

/// Escape a string for shell.
fn shell_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "'\\''")
}

fn powershell_single_quote_escape(text: &str) -> String {
    text.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn keys_to_send_keys(keys: &[&str]) -> String {
    let mut modifiers = String::new();
    let mut rest = Vec::new();
    for key in keys {
        match normalize_modifier(key) {
            Some("ctrl") => modifiers.push('^'),
            Some("alt") => modifiers.push('%'),
            Some("shift") => modifiers.push('+'),
            Some("cmd") => modifiers.push('^'),
            None => rest.push(send_keys_literal(key)),
            _ => {}
        }
    }
    format!("{}{}", modifiers, rest.join(""))
}

#[cfg(target_os = "windows")]
fn send_keys_literal(key: &str) -> String {
    match map_key(key).as_str() {
        "return" => "{ENTER}".to_string(),
        "escape" => "{ESC}".to_string(),
        "tab" => "{TAB}".to_string(),
        "space" => " ".to_string(),
        "left" => "{LEFT}".to_string(),
        "right" => "{RIGHT}".to_string(),
        "up" => "{UP}".to_string(),
        "down" => "{DOWN}".to_string(),
        other if other.starts_with('f') => format!("{{{}}}", other.to_uppercase()),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_non_ascii_text() {
        assert!(!is_non_ascii("hello"));
        assert!(is_non_ascii("你好"));
    }

    #[test]
    fn normalizes_modifier_keys() {
        assert_eq!(normalize_modifier("command"), Some("cmd"));
        assert_eq!(normalize_modifier("ctrl"), Some("ctrl"));
        assert_eq!(normalize_modifier("x"), None);
    }
}
