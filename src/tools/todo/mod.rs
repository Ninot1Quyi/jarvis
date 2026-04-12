//! TodoTool - TODO list operations
//!
//! Manages a persistent TODO list stored in markdown format

use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

mod dirs {
    use std::path::PathBuf;

    pub fn data_dir() -> Option<PathBuf> {
        #[cfg(target_os = "macos")]
        {
            std::env::var_os("HOME")
                .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
        }

        #[cfg(target_os = "linux")]
        {
            std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .or_else(|| {
                    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share"))
                })
        }

        #[cfg(target_os = "windows")]
        {
            std::env::var_os("APPDATA").map(PathBuf::from)
        }
    }
}

/// A single TODO item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub status: String, // "pending" | "in_progress" | "completed"
}

impl TodoItem {
    pub fn new(content: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string()[..8].to_string(),
            content,
            status: "pending".to_string(),
        }
    }
}

/// Get the path to the TODO list file
fn get_todo_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("dum-e")
        .join("TODOLIST.md")
}

/// Get the directory containing the TODO list file, creating it if needed
async fn ensure_todo_dir() -> Result<PathBuf, String> {
    let todo_path = get_todo_path();
    if let Some(parent) = todo_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create TODO directory: {}", e))?;
    }
    Ok(todo_path)
}

/// Load TODO items from the markdown file
async fn load_todos() -> Result<Vec<TodoItem>, String> {
    let todo_path = get_todo_path();

    if !todo_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&todo_path)
        .await
        .map_err(|e| format!("Failed to read TODO file: {}", e))?;

    let mut items = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("- [") && trimmed.contains("(ID:") {
            // Parse line like: - [ ] task content (ID: xxx) or - [x] **task** (ID: xxx)
            let status = if trimmed.contains("- [x]") {
                if trimmed.contains("~~") {
                    "completed".to_string()
                } else {
                    "in_progress".to_string()
                }
            } else {
                "pending".to_string()
            };

            // Extract ID
            if let Some(id_start) = trimmed.find("(ID:") {
                let id_part = &trimmed[id_start + 4..];
                let id_end = id_part.find(')').unwrap_or(id_part.len());
                let id = id_part[..id_end].trim().to_string();

                // Extract content - remove markdown formatting
                let mut content_part = if let Some(x_pos) = trimmed.find("] ") {
                    trimmed[x_pos + 2..].to_string()
                } else {
                    trimmed.to_string()
                };

                // Remove the (ID: xxx) part
                if let Some(paren_start) = content_part.find("(ID:") {
                    content_part = content_part[..paren_start].trim().to_string();
                }

                // Remove strikethrough markers for completed items
                if content_part.starts_with("~~") && content_part.ends_with("~~") {
                    content_part = content_part[2..content_part.len() - 2].to_string();
                }

                // Remove bold markers
                content_part = content_part.replace("**", "");

                items.push(TodoItem {
                    id,
                    content: content_part,
                    status,
                });
            }
        }
    }

    Ok(items)
}

/// Save TODO items to the markdown file
async fn save_todos(items: &[TodoItem]) -> Result<(), String> {
    let todo_path = ensure_todo_dir().await?;

    let in_progress: Vec<&TodoItem> = items.iter().filter(|i| i.status == "in_progress").collect();
    let pending: Vec<&TodoItem> = items.iter().filter(|i| i.status == "pending").collect();
    let completed: Vec<&TodoItem> = items.iter().filter(|i| i.status == "completed").collect();

    let timestamp = chrono_now();

    let mut content = String::new();
    content.push_str("# TODO LIST\n\n");

    content.push_str("## In Progress\n");
    if in_progress.is_empty() {
        content.push_str("- (none)\n");
    } else {
        for item in &in_progress {
            content.push_str(&format!("- [x] **{}** (ID: {})\n", item.content, item.id));
        }
    }
    content.push('\n');

    content.push_str("## Pending\n");
    if pending.is_empty() {
        content.push_str("- (none)\n");
    } else {
        for item in &pending {
            content.push_str(&format!("- [ ] {} (ID: {})\n", item.content, item.id));
        }
    }
    content.push('\n');

    content.push_str("## Completed\n");
    if completed.is_empty() {
        content.push_str("- (none)\n");
    } else {
        for item in &completed {
            content.push_str(&format!("- [x] ~~{}~~ (ID: {})\n", item.content, item.id));
        }
    }
    content.push('\n');

    content.push_str("---\n");
    content.push_str(&format!("*Last updated: {}*\n", timestamp));

    let mut file = fs::File::create(&todo_path)
        .await
        .map_err(|e| format!("Failed to create TODO file: {}", e))?;

    file.write_all(content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write TODO file: {}", e))?;

    Ok(())
}

/// Get current timestamp in ISO 8601 format
fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Simple ISO 8601 format without external dependencies
    // Format: 2026-04-10T00:00:00Z
    let days_since_epoch = secs / 86400;
    let mut year = 1970;
    let mut remaining_days = days_since_epoch as i64;

    // Simple year calculation (not perfect but close enough for TODO timestamps)
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let is_leap = is_leap_year(year);
    let days_in_months: &[i64] = if is_leap {
        &[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        &[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for days_in_month in days_in_months.iter() {
        if remaining_days < *days_in_month {
            break;
        }
        remaining_days -= *days_in_month;
        month += 1;
    }

    let day = remaining_days + 1;
    let hours = (secs % 86400) / 3600;
    let minutes = (secs % 3600) / 60;
    let seconds = secs % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Read TODO list tool
pub struct TodoReadTool;

impl TodoReadTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for TodoReadTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for TodoReadTool {
    fn name(&self) -> &str {
        "todo_read"
    }

    fn description(&self) -> &str {
        "Read the current TODO list"
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
        let todo_path = get_todo_path();

        if !todo_path.exists() {
            return Ok(ToolResult {
                success: true,
                output: "TODO list is empty. No items yet.".to_string(),
                error: None,
            });
        }

        let content = fs::read_to_string(&todo_path)
            .await
            .map_err(|e| format!("Failed to read TODO file: {}", e))?;

        let items = load_todos().await?;
        let total = items.len();
        let completed = items.iter().filter(|i| i.status == "completed").count();
        let in_progress = items.iter().filter(|i| i.status == "in_progress").count();
        let pending = items.iter().filter(|i| i.status == "pending").count();

        let summary = format!(
            "TODO List ({} total: {} completed, {} in progress, {} pending)\n\n{}",
            total, completed, in_progress, pending, content
        );

        Ok(ToolResult {
            success: true,
            output: summary,
            error: None,
        })
    }
}

/// Write TODO list tool
pub struct TodoWriteTool;

impl TodoWriteTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for TodoWriteTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for TodoWriteTool {
    fn name(&self) -> &str {
        "todo_write"
    }

    fn description(&self) -> &str {
        "Create or update TODO list. Actions: add, update, delete, mark_in_progress, mark_completed"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Action to perform: add, update, delete, mark_in_progress, mark_completed, clear_completed"
                },
                "id": {
                    "type": "string",
                    "description": "Task ID (required for update, delete, mark_in_progress, mark_completed)"
                },
                "content": {
                    "type": "string",
                    "description": "Task content (required for add and update actions)"
                }
            },
            "required": ["action"]
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

        let mut items = load_todos().await?;

        match action {
            "add" => {
                let content = input["content"]
                    .as_str()
                    .ok_or("Missing 'content' parameter for add action")?;

                // Check if there's already an in_progress task
                let has_in_progress = items.iter().any(|i| i.status == "in_progress");

                let mut new_item = TodoItem::new(content.to_string());
                let item_id = new_item.id.clone();
                let item_content = new_item.content.clone();
                if !has_in_progress {
                    new_item.status = "in_progress".to_string();
                }

                items.push(new_item);
                save_todos(&items).await?;

                Ok(ToolResult {
                    success: true,
                    output: format!("Added TODO: {} (ID: {})", item_content, item_id),
                    error: None,
                })
            }

            "update" => {
                let id = input["id"]
                    .as_str()
                    .ok_or("Missing 'id' parameter for update action")?;
                let content = input["content"]
                    .as_str()
                    .ok_or("Missing 'content' parameter for update action")?;

                let item = items.iter_mut().find(|i| i.id == id);
                match item {
                    Some(item) => {
                        item.content = content.to_string();
                        save_todos(&items).await?;
                        Ok(ToolResult {
                            success: true,
                            output: format!("Updated TODO {}: {}", id, content),
                            error: None,
                        })
                    }
                    None => Ok(ToolResult {
                        success: false,
                        output: String::new(),
                        error: Some(format!("TODO not found: {}", id)),
                    }),
                }
            }

            "delete" => {
                let id = input["id"]
                    .as_str()
                    .ok_or("Missing 'id' parameter for delete action")?;

                let initial_len = items.len();
                items.retain(|i| i.id != id);

                if items.len() == initial_len {
                    return Ok(ToolResult {
                        success: false,
                        output: String::new(),
                        error: Some(format!("TODO not found: {}", id)),
                    });
                }

                save_todos(&items).await?;
                Ok(ToolResult {
                    success: true,
                    output: format!("Deleted TODO: {}", id),
                    error: None,
                })
            }

            "mark_in_progress" => {
                let id = input["id"]
                    .as_str()
                    .ok_or("Missing 'id' parameter for mark_in_progress action")?;

                // First, set all items to pending (only one can be in_progress)
                for item in items.iter_mut() {
                    if item.status == "in_progress" {
                        item.status = "pending".to_string();
                    }
                }

                let item = items.iter_mut().find(|i| i.id == id);
                match item {
                    Some(item) => {
                        item.status = "in_progress".to_string();
                        save_todos(&items).await?;
                        Ok(ToolResult {
                            success: true,
                            output: format!("Marked TODO as in progress: {}", id),
                            error: None,
                        })
                    }
                    None => Ok(ToolResult {
                        success: false,
                        output: String::new(),
                        error: Some(format!("TODO not found: {}", id)),
                    }),
                }
            }

            "mark_completed" => {
                let id = input["id"]
                    .as_str()
                    .ok_or("Missing 'id' parameter for mark_completed action")?;

                let item = items.iter_mut().find(|i| i.id == id);
                match item {
                    Some(item) => {
                        item.status = "completed".to_string();
                        save_todos(&items).await?;
                        Ok(ToolResult {
                            success: true,
                            output: format!("Marked TODO as completed: {}", id),
                            error: None,
                        })
                    }
                    None => Ok(ToolResult {
                        success: false,
                        output: String::new(),
                        error: Some(format!("TODO not found: {}", id)),
                    }),
                }
            }

            "clear_completed" => {
                let initial_len = items.len();
                items.retain(|i| i.status != "completed");
                let removed = initial_len - items.len();

                save_todos(&items).await?;
                Ok(ToolResult {
                    success: true,
                    output: format!("Cleared {} completed TODO(s)", removed),
                    error: None,
                })
            }

            _ => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Unknown action: {}. Use: add, update, delete, mark_in_progress, mark_completed, clear_completed", action)),
            }),
        }
    }
}
