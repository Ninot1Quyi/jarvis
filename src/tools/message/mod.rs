//! MessageTool - Send messages via different channels (tui, gui, mail)
//!
//! Provides message sending functionality across multiple channels.

use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use std::process::Command;

/// Simple percent encoding for mailto URLs
fn percent_encode(s: &str) -> String {
    let mut result = String::new();
    for c in s.chars() {
        match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => result.push(c),
            ' ' => result.push_str("%20"),
            _ => {
                for byte in c.to_string().bytes() {
                    result.push_str(&format!("%{:02X}", byte));
                }
            }
        }
    }
    result
}

/// Message channel types
#[derive(Debug, Clone)]
pub enum MessageChannel {
    Tui,
    Gui,
    Mail,
}

impl MessageChannel {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "tui" => Some(MessageChannel::Tui),
            "gui" => Some(MessageChannel::Gui),
            "mail" => Some(MessageChannel::Mail),
            _ => None,
        }
    }
}

/// Message action types
#[derive(Debug, Clone)]
pub enum MessageAction {
    Send,
    Reply,
}

impl MessageAction {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "send" => Some(MessageAction::Send),
            "reply" => Some(MessageAction::Reply),
            _ => None,
        }
    }
}

/// Send messages via different channels (tui, gui, mail)
pub struct MessageTool;

impl MessageTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MessageTool {
    fn default() -> Self {
        Self::new()
    }
}

impl MessageTool {
    /// Send message via TUI channel (stdout)
    fn send_tui(&self, message: &str) -> Result<ToolResult, String> {
        println!("{}", message);
        Ok(ToolResult {
            success: true,
            output: message.to_string(),
            error: None,
        })
    }

    /// Send message via GUI channel (placeholder for IPC to Electron)
    fn send_gui(&self, _message: &str) -> Result<ToolResult, String> {
        // TODO: Implement IPC to Electron overlay
        Ok(ToolResult {
            success: true,
            output: "GUI message sent (placeholder - IPC not implemented)".to_string(),
            error: None,
        })
    }

    /// Send message via email using mailto URL scheme
    fn send_mail(
        &self,
        to: &str,
        title: &str,
        message: &str,
        _attachments: &[String],
    ) -> Result<ToolResult, String> {
        // Build mailto URL with proper percent encoding
        let subject = percent_encode(title);
        let body = percent_encode(message);
        let mailto_url = format!("mailto:{}?subject={}&body={}", to, subject, body);

        // Try to open with xdg-open on Linux, open on macOS
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("open")
                .arg(&mailto_url)
                .output()
                .map_err(|e| format!("Failed to open mail client: {}", e))?;

            if output.status.success() {
                Ok(ToolResult {
                    success: true,
                    output: format!("Opened mail client for: {}", to),
                    error: None,
                })
            } else {
                Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some("Failed to open mail client".to_string()),
                })
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let output = Command::new("xdg-open")
                .arg(&mailto_url)
                .output()
                .map_err(|e| format!("Failed to open mail client: {}", e))?;

            if output.status.success() {
                Ok(ToolResult {
                    success: true,
                    output: format!("Opened mail client for: {}", to),
                    error: None,
                })
            } else {
                Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some("Failed to open mail client".to_string()),
                })
            }
        }
    }
}

#[async_trait]
impl Tool for MessageTool {
    fn name(&self) -> &str {
        "message"
    }

    fn description(&self) -> &str {
        "Send messages via different channels (tui, gui, mail)"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["send", "reply"],
                    "description": "The message action (send or reply)"
                },
                "channel": {
                    "type": "string",
                    "enum": ["tui", "gui", "mail"],
                    "description": "The channel to send the message through"
                },
                "to": {
                    "type": "string",
                    "description": "Recipient email address (for mail channel)"
                },
                "title": {
                    "type": "string",
                    "description": "Email subject (for mail channel)"
                },
                "message": {
                    "type": "string",
                    "description": "The message content to send"
                },
                "attachments": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "File paths to attach (for mail channel)"
                }
            },
            "required": ["action", "channel", "message"]
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
        let action_str = input["action"]
            .as_str()
            .ok_or("Missing 'action' parameter")?;
        let action =
            MessageAction::from_str(action_str).ok_or(format!("Invalid action: {}", action_str))?;

        let channel_str = input["channel"]
            .as_str()
            .ok_or("Missing 'channel' parameter")?;
        let channel = MessageChannel::from_str(channel_str)
            .ok_or(format!("Invalid channel: {}", channel_str))?;

        let message = input["message"]
            .as_str()
            .ok_or("Missing 'message' parameter")?;

        match action {
            MessageAction::Send | MessageAction::Reply => match channel {
                MessageChannel::Tui => self.send_tui(message),
                MessageChannel::Gui => self.send_gui(message),
                MessageChannel::Mail => {
                    let to = input["to"].as_str().unwrap_or("");
                    let title = input["title"].as_str().unwrap_or("");
                    let attachments: Vec<String> = input["attachments"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    self.send_mail(to, title, message, &attachments)
                }
            },
        }
    }
}
