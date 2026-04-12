//! MiniMax MCP tools - web_search and understand_image
//!
//! These are MCP protocol tools that wrap the MiniMax Token Plan MCP server

mod understand_image;
mod web_search;

pub use understand_image::MiniMaxUnderstandImage;
pub use web_search::MiniMaxWebSearch;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// MCP tool result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub success: bool,
    pub content: String,
    pub metadata: HashMap<String, serde_json::Value>,
}

impl McpToolResult {
    pub fn success(content: impl Into<String>) -> Self {
        Self {
            success: true,
            content: content.into(),
            metadata: HashMap::new(),
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            content: message.into(),
            metadata: HashMap::new(),
        }
    }
}

/// MiniMax MCP client for tool execution
pub struct McpToolClient {
    tool_name: String,
}

impl McpToolClient {
    pub fn new(tool_name: impl Into<String>) -> Self {
        Self {
            tool_name: tool_name.into(),
        }
    }

    /// Execute an MCP tool via the MiniMax Token Plan MCP server
    ///
    /// This tool requires the MiniMax MCP server to be running:
    /// ```bash
    /// uvx minimax-coding-plan-mcp -y
    /// ```
    pub async fn execute(&self, _arguments: &serde_json::Value) -> Result<McpToolResult, String> {
        // In real implementation, this would:
        // 1. Use std::process::Command to spawn the MCP server
        // 2. Send JSON-RPC requests via stdin/stdout
        // 3. Parse responses

        Err(format!(
            "Tool '{}' requires MiniMax MCP server. \
             Please ensure 'minimax-coding-plan-mcp' is installed and running. \
             Install with: uvx minimax-coding-plan-mcp -y",
            self.tool_name
        ))
    }
}
