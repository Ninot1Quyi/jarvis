//! FileTool - File operations: read, write, edit
//!
//! Based on Claude Code's FileTool pattern

use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Read file contents
pub struct ReadTool;

impl ReadTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ReadTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for ReadTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "Read and display the contents of a file"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute path to the file to read"
                },
                "offset": {
                    "type": "number",
                    "description": "Line number to start reading from (1-indexed, optional)"
                },
                "limit": {
                    "type": "number",
                    "description": "Number of lines to read (optional)"
                }
            },
            "required": ["file_path"]
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
        let file_path = input["file_path"]
            .as_str()
            .ok_or("Missing 'file_path' parameter")?;

        let offset = input["offset"].as_u64().map(|v| v as usize);
        let limit = input["limit"].as_u64().map(|v| v as usize);

        let path = Path::new(file_path);
        if !path.exists() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("File does not exist: {}", file_path)),
            });
        }

        if !path.is_file() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Path is not a file: {}", file_path)),
            });
        }

        let file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
        let reader = BufReader::new(file);

        let lines: Vec<String> = reader.lines().map(|l| l.unwrap_or_default()).collect();

        let total_lines = lines.len();
        let start_line = offset.unwrap_or(1);
        let end_line = if let Some(limit) = limit {
            std::cmp::min(start_line + limit - 1, total_lines)
        } else {
            total_lines
        };

        let display_lines: Vec<String> = lines
            .into_iter()
            .skip(start_line - 1)
            .take(limit.unwrap_or(usize::MAX))
            .enumerate()
            .map(|(i, line)| format!("{:5}→{}", start_line + i, line))
            .collect();

        let content = display_lines.join("\n");

        Ok(ToolResult {
            success: true,
            output: format!(
                "File: {}\nLines: {}-{} of {}\n\n{}",
                file_path, start_line, end_line, total_lines, content
            ),
            error: None,
        })
    }
}

/// Write file contents
pub struct WriteTool;

impl WriteTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WriteTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for WriteTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn description(&self) -> &str {
        "Write or overwrite content to a file. Creates parent directories if needed."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute path to the file"
                },
                "content": {
                    "type": "string",
                    "description": "Content to write to the file"
                }
            },
            "required": ["file_path", "content"]
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
        let file_path = input["file_path"]
            .as_str()
            .ok_or("Missing 'file_path' parameter")?;
        let content = input["content"]
            .as_str()
            .ok_or("Missing 'content' parameter")?;

        let path = Path::new(file_path);

        // Create parent directories if they don't exist
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directories: {}", e))?;
        }

        fs::write(path, content).map_err(|e| format!("Failed to write file: {}", e))?;

        Ok(ToolResult {
            success: true,
            output: format!("Successfully wrote to {}", file_path),
            error: None,
        })
    }
}

/// Edit file contents (search and replace)
pub struct EditTool;

impl EditTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for EditTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for EditTool {
    fn name(&self) -> &str {
        "edit_file"
    }

    fn description(&self) -> &str {
        "Edit file contents using search and replace. Use sed-style replacement."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute path to the file"
                },
                "search": {
                    "type": "string",
                    "description": "Text to search for"
                },
                "replace": {
                    "type": "string",
                    "description": "Text to replace with"
                }
            },
            "required": ["file_path", "search", "replace"]
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
        let file_path = input["file_path"]
            .as_str()
            .ok_or("Missing 'file_path' parameter")?;
        let search = input["search"]
            .as_str()
            .ok_or("Missing 'search' parameter")?;
        let replace = input["replace"]
            .as_str()
            .ok_or("Missing 'replace' parameter")?;

        let path = Path::new(file_path);
        if !path.exists() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("File does not exist: {}", file_path)),
            });
        }

        let content =
            fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

        if !content.contains(search) {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Search string not found: {}", search)),
            });
        }

        let new_content = content.replace(search, replace);

        fs::write(path, &new_content).map_err(|e| format!("Failed to write file: {}", e))?;

        Ok(ToolResult {
            success: true,
            output: format!("Successfully edited {}", file_path),
            error: None,
        })
    }
}
