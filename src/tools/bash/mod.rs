//! BashTool - Execute shell commands
//!
//! Based on Claude Code's BashTool pattern

use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;

/// Execute shell commands
pub struct BashTool;

impl BashTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for BashTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for BashTool {
    fn name(&self) -> &str {
        "bash"
    }

    fn description(&self) -> &str {
        "Execute shell commands. Use for file operations, git, npm, and system tasks."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "cwd": {
                    "type": "string",
                    "description": "Working directory for the command (optional)"
                },
                "timeout": {
                    "type": "number",
                    "description": "Timeout in milliseconds (optional, default 30000)"
                }
            },
            "required": ["command"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false // Bash commands can modify state
    }

    fn is_read_only(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let command = input["command"]
            .as_str()
            .ok_or("Missing 'command' parameter")?;

        let cwd = input["cwd"].as_str();
        let _timeout_ms = input["timeout"].as_u64().unwrap_or(30000);

        let output = tokio::process::Command::new("sh")
            .args(["-c", command])
            .current_dir(cwd.unwrap_or("."))
            .output()
            .await
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let code = output.status.code().unwrap_or(-1);

        let success = output.status.success();
        let combined = if stderr.is_empty() {
            stdout.to_string()
        } else {
            format!("{}\nSTDERR:\n{}", stdout, stderr)
        };

        Ok(ToolResult {
            success,
            output: if combined.is_empty() {
                format!("Command exited with code {}", code)
            } else {
                combined
            },
            error: if success {
                None
            } else {
                Some(format!("Exit code: {}", code))
            },
        })
    }
}
