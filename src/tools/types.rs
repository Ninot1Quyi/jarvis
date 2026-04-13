//! Tool type definitions

use crate::llm::LLMProvider;
use async_trait::async_trait;
use std::sync::Arc;

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
#[derive(Clone, Default)]
pub struct ToolContext {
    pub session_id: String,
    pub trace_id: Option<String>,
    /// LLM provider, if available (passed by Agent for tools that need it)
    pub llm: Option<Arc<dyn LLMProvider>>,
    /// Config, if available
    pub config: Option<crate::config::Config>,
    /// Soul version, if available
    pub soul_version: Option<String>,
    /// Path to conversation history file (written by TUI before tool execution)
    pub history_file: Option<String>,
}

impl ToolContext {
    pub fn new() -> Self {
        Self {
            session_id: uuid::Uuid::new_v4().to_string(),
            trace_id: None,
            llm: None,
            config: None,
            soul_version: None,
            history_file: None,
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
