//! GrepTool - Search file contents
//!
//! Based on Claude Code's GrepTool pattern

use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use tokio::process::Command;

/// Search for patterns in files
pub struct GrepTool;

impl GrepTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GrepTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for GrepTool {
    fn name(&self) -> &str {
        "grep"
    }

    fn description(&self) -> &str {
        "Search for patterns in files. Returns matching lines with line numbers."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "The search pattern (regex supported)"
                },
                "path": {
                    "type": "string",
                    "description": "Directory or file path to search in"
                },
                "recursive": {
                    "type": "boolean",
                    "description": "Search recursively in subdirectories (default: true)"
                },
                "case_sensitive": {
                    "type": "boolean",
                    "description": "Case sensitive search (default: true)"
                },
                "file_pattern": {
                    "type": "string",
                    "description": "Only search in files matching this glob pattern (e.g., *.ts)"
                }
            },
            "required": ["pattern", "path"]
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
        let pattern = input["pattern"]
            .as_str()
            .ok_or("Missing 'pattern' parameter")?;
        let path = input["path"].as_str().ok_or("Missing 'path' parameter")?;
        let recursive = input["recursive"].as_bool().unwrap_or(true);
        let case_sensitive = input["case_sensitive"].as_bool().unwrap_or(true);
        let _file_pattern = input["file_pattern"].as_str();

        let case_flag = if case_sensitive { "" } else { "-i" };
        let recursive_flag = if recursive { "-r" } else { "" };

        // Use ripgrep if available, fallback to grep
        let pattern_for_search = if case_sensitive {
            pattern.to_string()
        } else {
            format!("(?i){}", pattern)
        };

        // Try ripgrep first
        let output = Command::new("rg")
            .args([
                "--color=never",
                "-n",
                case_flag,
                recursive_flag,
                &pattern_for_search,
                path,
            ])
            .output()
            .await;

        let output = match output {
            Ok(o) => o,
            Err(_) => {
                // Fallback to grep
                let mut cmd = vec!["grep", "-n"];
                if !case_sensitive {
                    cmd.push("-i");
                }
                if recursive {
                    cmd.push("-r");
                }
                cmd.push(pattern);
                cmd.push(path);

                let result = Command::new("grep").args(&cmd).output().await;
                match result {
                    Ok(o) => o,
                    Err(e) => {
                        return Ok(ToolResult {
                            success: false,
                            output: String::new(),
                            error: Some(format!("Failed to execute grep: {}", e)),
                        });
                    }
                }
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let _stderr = String::from_utf8_lossy(&output.stderr);

        if stdout.is_empty() {
            return Ok(ToolResult {
                success: true,
                output: format!("No matches found for '{}' in {}", pattern, path),
                error: None,
            });
        }

        let count = stdout.lines().count();

        Ok(ToolResult {
            success: true,
            output: format!("Found {} matches:\n\n{}", count, stdout),
            error: None,
        })
    }
}
