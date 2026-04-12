//! SessionsSendTool - Send task to another agent for delegation
//!
//! This tool enables inter-agent communication and task delegation.

use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;

/// Send a task to another agent for delegation
pub struct SessionsSendTool;

impl SessionsSendTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SessionsSendTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for SessionsSendTool {
    fn name(&self) -> &str {
        "sessions_send"
    }

    fn description(&self) -> &str {
        "Send a task to another agent for delegation. Use when a task needs to be handled by a different agent."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "agentId": {
                    "type": "string",
                    "description": "Target agent ID to delegate the task to"
                },
                "task": {
                    "type": "string",
                    "description": "Task description for the target agent"
                },
                "context": {
                    "type": "string",
                    "description": "Additional context to pass to the target agent (optional)"
                },
                "waitForResult": {
                    "type": "boolean",
                    "description": "Wait for result from target agent (default: true)"
                },
                "timeout": {
                    "type": "number",
                    "description": "Timeout in seconds (default: 60)"
                }
            },
            "required": ["agentId", "task"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true // Read-only delegation request
    }

    fn is_read_only(&self) -> bool {
        true
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let agent_id = input["agentId"]
            .as_str()
            .ok_or("Missing 'agentId' parameter")?;

        let task = input["task"].as_str().ok_or("Missing 'task' parameter")?;

        let context = input["context"].as_str().unwrap_or("");
        let wait_for_result = input["waitForResult"].as_bool().unwrap_or(true);
        let timeout = input["timeout"].as_u64().unwrap_or(60) as u32;

        // Placeholder implementation - returns success with delegation info
        let output = serde_json::json!({
            "delegated": true,
            "agentId": agent_id,
            "task": task,
            "context": context,
            "waitForResult": wait_for_result,
            "timeout": timeout,
            "message": "Task delegated successfully (placeholder implementation)"
        })
        .to_string();

        Ok(ToolResult {
            success: true,
            output,
            error: None,
        })
    }
}
