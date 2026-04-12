//! UISearchTool - Search UI elements using accessibility APIs
//!
//! Searches for UI elements using macOS accessibility APIs via AppleScript.

use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// UI element discovered via accessibility API
#[derive(Debug, Serialize, Deserialize)]
struct UIElement {
    /// Accessibility role (AXButton, AXTextField, etc.)
    role: String,
    /// Element title or description
    title: String,
    /// Current value (for text fields, checkboxes, etc.)
    value: String,
    /// Normalized X coordinate (0-1000)
    x: f64,
    /// Normalized Y coordinate (0-1000)
    y: f64,
    /// Normalized width
    width: f64,
    /// Normalized height
    height: f64,
}

impl UIElement {
    /// Create from AppleScript result line
    fn from_applescript_line(line: &str) -> Option<Self> {
        // Expected format from AppleScript:
        // "AXButton, title:\"OK\", value:\"\", x:100, y:200, w:50, h:30"
        let mut role = String::new();
        let mut title = String::new();
        let mut value = String::new();
        let mut x = 0.0;
        let mut y = 0.0;
        let mut width = 0.0;
        let mut height = 0.0;

        // Parse comma-separated key:value pairs
        for part in line.split(", ") {
            let part = part.trim();
            if let Some(pos) = part.find(":") {
                let key = part[..pos].trim();
                let val = part[pos + 1..].trim();
                let val = val.trim_matches('"').trim_matches('\'');

                match key {
                    "role" | "AXRole" => role = val.to_string(),
                    "title" | "AXTitle" => title = val.to_string(),
                    "value" | "AXValue" => value = val.to_string(),
                    "x" | "AXX" => x = val.parse().unwrap_or(0.0),
                    "y" | "AXY" => y = val.parse().unwrap_or(0.0),
                    "w" | "AXWidth" => width = val.parse().unwrap_or(0.0),
                    "h" | "AXHeight" => height = val.parse().unwrap_or(0.0),
                    _ => {}
                }
            }
        }

        if role.is_empty() {
            return None;
        }

        // Normalize coordinates to 0-1000 range (assuming typical display resolution)
        let norm_x = (x + width / 2.0) / 10.0;
        let norm_y = (y + height / 2.0) / 10.0;

        Some(Self {
            role,
            title,
            value,
            x: norm_x,
            y: norm_y,
            width: width / 10.0,
            height: height / 10.0,
        })
    }
}

/// Search for UI elements using accessibility APIs
pub struct UISearchTool;

impl UISearchTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for UISearchTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for UISearchTool {
    fn name(&self) -> &str {
        "ui_search"
    }

    fn description(&self) -> &str {
        "Search for UI elements using accessibility APIs. Returns matching elements with coordinates."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["find_element", "locate"],
                    "description": "Action to perform: find_element (search by keyword) or locate (find specific element)"
                },
                "keyword": {
                    "type": "string",
                    "description": "Keyword to search for in element titles/roles (for find_element)"
                },
                "role": {
                    "type": "string",
                    "description": "Filter by element role (e.g., AXButton, AXTextField, AXStaticText)"
                },
                "app": {
                    "type": "string",
                    "description": "Application name to search in (optional, searches all if not specified)"
                }
            },
            "required": ["action"]
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
        let action = input["action"]
            .as_str()
            .ok_or("Missing 'action' parameter")?;

        match action {
            "find_element" => self.find_element(input).await,
            "locate" => self.locate(input).await,
            _ => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "Unknown action: {}. Use 'find_element' or 'locate'.",
                    action
                )),
            }),
        }
    }
}

impl UISearchTool {
    /// Find UI elements matching a keyword
    async fn find_element(&self, input: &serde_json::Value) -> Result<ToolResult, String> {
        let keyword = input["keyword"]
            .as_str()
            .ok_or("Missing 'keyword' parameter")?;
        let role_filter = input["role"].as_str();
        let app = input["app"].as_str();

        let elements = self.query_accessibility(keyword, role_filter, app).await?;

        if elements.is_empty() {
            return Ok(ToolResult {
                success: true,
                output: format!("No UI elements found matching '{}'", keyword),
                error: None,
            });
        }

        let output = elements
            .iter()
            .map(|e| {
                format!(
                    "[{}] {} | title:\"{}\" | value:\"{}\" | coords:({:.1}, {:.1})",
                    e.role, e.title, e.title, e.value, e.x, e.y
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        Ok(ToolResult {
            success: true,
            output: format!("Found {} elements:\n\n{}", elements.len(), output),
            error: None,
        })
    }

    /// Locate a specific UI element for interaction
    async fn locate(&self, input: &serde_json::Value) -> Result<ToolResult, String> {
        // For locate, we need more specific targeting - use role + position info
        let keyword = input["keyword"].as_str().unwrap_or("");
        let role_filter = input["role"].as_str();
        let app = input["app"].as_str();

        let elements = self.query_accessibility(keyword, role_filter, app).await?;

        if elements.is_empty() {
            return Ok(ToolResult {
                success: true,
                output: "No elements found".to_string(),
                error: None,
            });
        }

        // Return the first matching element with full coordinates for interaction
        let e = &elements[0];

        // Output in a format ready for interaction
        let output = serde_json::json!({
            "role": e.role,
            "title": e.title,
            "value": e.value,
            "position": {
                "x": e.x,
                "y": e.y,
                "width": e.width,
                "height": e.height,
                "center_x": e.x,
                "center_y": e.y
            },
            "normalized_coords": format!("({:.1}, {:.1})", e.x, e.y)
        })
        .to_string();

        Ok(ToolResult {
            success: true,
            output,
            error: None,
        })
    }

    /// Query accessibility API for UI elements
    async fn query_accessibility(
        &self,
        keyword: &str,
        role_filter: Option<&str>,
        app: Option<&str>,
    ) -> Result<Vec<UIElement>, String> {
        // Build AppleScript to query accessibility
        let script = if let Some(app_name) = app {
            format!(
                r#"tell application "{}"
                    get every UI element whose title contains "{}" or value contains "{}"
                end tell"#,
                app_name, keyword, keyword
            )
        } else {
            format!(
                r#"tell application "System Events"
                    get every UI element whose title contains "{}" or value contains "{}"
                end tell"#,
                keyword, keyword
            )
        };

        let output = tokio::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .await
            .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        if stdout.trim().is_empty() || stdout.contains("error") {
            // Fallback: try to get all elements and filter
            return self.get_all_elements(role_filter).await;
        }

        let elements: Vec<UIElement> = stdout
            .lines()
            .filter_map(|line| UIElement::from_applescript_line(line))
            .filter(|e| {
                // Apply role filter if specified
                if let Some(rf) = role_filter {
                    e.role.contains(rf)
                } else {
                    true
                }
            })
            .filter(|e| {
                // Filter by keyword in title or value
                e.title.to_lowercase().contains(&keyword.to_lowercase())
                    || e.value.to_lowercase().contains(&keyword.to_lowercase())
            })
            .collect();

        Ok(elements)
    }

    /// Get all UI elements (fallback for broader search)
    async fn get_all_elements(&self, role_filter: Option<&str>) -> Result<Vec<UIElement>, String> {
        let script = r#"tell application "System Events"
            get properties of every UI element
        end tell"#;

        let output = tokio::process::Command::new("osascript")
            .args(["-e", script])
            .output()
            .await
            .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        let elements: Vec<UIElement> = stdout
            .lines()
            .filter_map(|line| UIElement::from_applescript_line(line))
            .filter(|e| {
                if let Some(rf) = role_filter {
                    e.role.contains(rf)
                } else {
                    true
                }
            })
            .collect();

        Ok(elements)
    }
}
