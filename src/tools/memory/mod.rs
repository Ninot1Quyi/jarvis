//! Memory search tools

use crate::memory::MemoryDB;
use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use std::sync::Arc;

/// Memory search tool
pub struct MemorySearchTool {
    db: Arc<MemoryDB>,
}

impl MemorySearchTool {
    pub fn new(db: Arc<MemoryDB>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl Tool for MemorySearchTool {
    fn name(&self) -> &str {
        "memory_search"
    }

    fn description(&self) -> &str {
        "Search memory entries using BM25 text search"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query text"
                },
                "limit": {
                    "type": "number",
                    "description": "Maximum number of results (default: 10)",
                    "default": 10
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
        let query = input["query"]
            .as_str()
            .ok_or_else(|| "Missing 'query' parameter".to_string())?;
        let limit = input["limit"].as_u64().unwrap_or(10) as usize;

        match self.db.search_bm25(query, limit).await {
            Ok(results) => {
                if results.is_empty() {
                    return Ok(ToolResult {
                        success: true,
                        output: "No results found".to_string(),
                        error: None,
                    });
                }

                let output = results
                    .iter()
                    .enumerate()
                    .map(|(i, r)| {
                        format!(
                            "[{}] {} (path: {}, chunk: {})\n  {}\n",
                            i + 1,
                            r.id,
                            r.path,
                            r.chunk_index,
                            r.content
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");

                Ok(ToolResult {
                    success: true,
                    output: format!("Found {} results:\n\n{}", results.len(), output),
                    error: None,
                })
            }
            Err(e) => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Search failed: {}", e)),
            }),
        }
    }
}

/// Memory read tool - read content from a stored file
pub struct MemoryReadTool {
    db: Arc<MemoryDB>,
}

impl MemoryReadTool {
    pub fn new(db: Arc<MemoryDB>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl Tool for MemoryReadTool {
    fn name(&self) -> &str {
        "memory_read"
    }

    fn description(&self) -> &str {
        "Read the content of a file stored in memory"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path to read from memory"
                }
            },
            "required": ["path"]
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
        let path = input["path"]
            .as_str()
            .ok_or_else(|| "Missing 'path' parameter".to_string())?;

        match self.db.get_file(path).await {
            Ok(Some(content)) => Ok(ToolResult {
                success: true,
                output: content,
                error: None,
            }),
            Ok(None) => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("File not found in memory: {}", path)),
            }),
            Err(e) => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Failed to read file: {}", e)),
            }),
        }
    }
}

/// Memory status tool
pub struct MemoryStatusTool {
    db: Arc<MemoryDB>,
}

impl MemoryStatusTool {
    pub fn new(db: Arc<MemoryDB>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl Tool for MemoryStatusTool {
    fn name(&self) -> &str {
        "memory_status"
    }

    fn description(&self) -> &str {
        "Get memory database status"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
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
        match self.db.status().await {
            Ok(status) => Ok(ToolResult {
                success: true,
                output: format!(
                    "Memory Status:\n  Chunks: {}\n  Files: {}",
                    status.chunk_count, status.file_count
                ),
                error: None,
            }),
            Err(e) => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Status check failed: {}", e)),
            }),
        }
    }
}
