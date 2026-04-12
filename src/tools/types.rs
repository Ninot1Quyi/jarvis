//! Tool type definitions

use async_trait::async_trait;

/// Tool definition
#[async_trait]
pub trait Tool: Send + Sync {
    /// Get tool name
    fn name(&self) -> &str;

    /// Get tool description
    fn description(&self) -> &str;

    /// Get input schema
    fn input_schema(&self) -> serde_json::Value;

    /// Check if tool is concurrency-safe
    fn is_concurrency_safe(&self) -> bool {
        false
    }

    /// Check if tool is read-only
    fn is_read_only(&self) -> bool {
        false
    }

    /// Execute the tool
    async fn call(
        &self,
        input: &serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, String>;
}

/// Context for tool execution
#[derive(Debug, Clone, Default)]
pub struct ToolContext {
    pub session_id: String,
    pub trace_id: Option<String>,
}

impl ToolContext {
    pub fn new() -> Self {
        Self {
            session_id: uuid::Uuid::new_v4().to_string(),
            trace_id: None,
        }
    }
}

/// A tool call request
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

/// Result from a tool execution
#[derive(Debug)]
pub struct ToolResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}
