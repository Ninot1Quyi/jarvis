//! web_search - Network search tool via MiniMax MCP
//!
//! Searches the web and returns results

use super::McpToolClient;
use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;

/// MiniMax web search tool
pub struct MiniMaxWebSearch {
    client: McpToolClient,
}

impl MiniMaxWebSearch {
    pub fn new() -> Self {
        Self {
            client: McpToolClient::new("web_search"),
        }
    }
}

impl Default for MiniMaxWebSearch {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for MiniMaxWebSearch {
    fn name(&self) -> &str {
        "web_search"
    }

    fn description(&self) -> &str {
        "Search the web and return results. Use this when you need current information from the internet."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query"
                }
            },
            "required": ["query"]
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
        let _query = input["query"].as_str().ok_or("Missing 'query' parameter")?;

        match self.client.execute(input).await {
            Ok(result) => {
                let content = result.content.clone();
                Ok(ToolResult {
                    success: result.success,
                    output: content,
                    error: if result.success {
                        None
                    } else {
                        Some(result.content)
                    },
                })
            }
            Err(e) => Ok(ToolResult {
                success: false,
                output: format!("Search failed: {}", e),
                error: Some(e),
            }),
        }
    }
}
