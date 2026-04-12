//! Message layer - conversation message types

/// A conversation message
#[derive(Debug, Clone)]
pub struct Message {
    pub role: MessageRole,
    pub content: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// For Tool messages: the tool_use_id from the original tool call this is a result for
    pub tool_use_id: Option<String>,
    /// For Assistant messages: stores the full content blocks (including tool_use) as JSON
    /// This is needed to pass back to MiniMax for multi-turn tool calls
    pub content_blocks: Option<serde_json::Value>,
}

/// Message role
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

impl Message {
    pub fn new(role: MessageRole, content: &str) -> Self {
        Self {
            role,
            content: content.to_string(),
            timestamp: chrono::Utc::now(),
            tool_use_id: None,
            content_blocks: None,
        }
    }

    /// Create a Tool message with a specific tool_use_id
    pub fn new_tool(tool_use_id: &str, content: &str) -> Self {
        Self {
            role: MessageRole::Tool,
            content: content.to_string(),
            timestamp: chrono::Utc::now(),
            tool_use_id: Some(tool_use_id.to_string()),
            content_blocks: None,
        }
    }

    /// Create an Assistant message with content blocks (for preserving tool_use blocks)
    pub fn new_assistant_with_blocks(content: &str, content_blocks: serde_json::Value) -> Self {
        Self {
            role: MessageRole::Assistant,
            content: content.to_string(),
            timestamp: chrono::Utc::now(),
            tool_use_id: None,
            content_blocks: Some(content_blocks),
        }
    }
}
