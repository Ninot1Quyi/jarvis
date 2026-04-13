//! MiniMax MCP tools - web_search and understand_image
//!
//! These are MCP protocol tools that wrap the MiniMax Token Plan MCP server.
//! Implements the MCP JSON-RPC protocol over stdin/stdout.

mod understand_image;
mod web_search;

pub use understand_image::MiniMaxUnderstandImage;
pub use web_search::MiniMaxWebSearch;

use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// MCP JSON-RPC request
#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

/// MCP JSON-RPC response
#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: u64,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<Value>,
}

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

/// Global MCP server process, shared across all tool calls.
/// Initialized lazily on first use and reused for subsequent calls.
static MCP_SERVER: std::sync::OnceLock<Arc<Mutex<Option<McpServer>>>> = std::sync::OnceLock::new();

/// MCP server process handle
struct McpServer {
    child: Child,
    next_id: u64,
}

impl McpServer {
    /// Start the MCP server process and initialize it
    async fn start() -> Result<Self, String> {
        let mut child = Command::new("uvx")
            .args(["minimax-coding-plan-mcp", "-y"])
            .env("MINIMAX_API_KEY", std::env::var("MINIMAX_API_KEY").unwrap_or_default())
            .env(
                "MINIMAX_API_HOST",
                std::env::var("MINIMAX_API_HOST")
                    .unwrap_or_else(|_| "https://api.minimaxi.com".to_string()),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    format!(
                        "uvx not found. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh"
                    )
                } else {
                    format!("Failed to start MCP server: {}", e)
                }
            })?;

        let stdin = child.stdin.take().ok_or("Failed to take stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to take stdout")?;

        let mut server = Self { child, next_id: 1 };

        // Initialize the MCP connection
        server
            .send_request("initialize", Some(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "dum-e",
                    "version": "0.1.0"
                }
            })))
            .await?;

        // Send initialized notification (no response expected)
        let _ = server
            .send_request_no_response("notifications/initialized", None)
            .await;

        Ok(server)
    }

    /// Send a JSON-RPC request and wait for response
    async fn send_request(&mut self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;

        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: method.to_string(),
            params,
        };

        let req_str = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        let line = format!("{req_str}\n");

        let stdin = self.child.stdin.as_mut().ok_or("stdin closed")?;
        stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;

        let stdout = self.child.stdout.as_mut().ok_or("stdout closed")?;
        let mut reader = BufReader::new(stdout);
        let mut response_line = String::new();
        reader.read_line(&mut response_line).await.map_err(|e| e.to_string())?;

        let response: JsonRpcResponse =
            serde_json::from_str(&response_line).map_err(|e| format!("Invalid JSON-RPC response: {}: {}", e, &response_line))?;

        if let Some(error) = response.error {
            return Err(format!("MCP error: {}", error));
        }

        response
            .result
            .ok_or_else(|| "No result in JSON-RPC response".to_string())
    }

    /// Send a JSON-RPC notification (no response expected)
    async fn send_request_no_response(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id: self.next_id,
            method: method.to_string(),
            params,
        };
        self.next_id += 1;

        let req_str = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        let line = format!("{req_str}\n");

        let stdin = self.child.stdin.as_mut().ok_or("stdin closed")?;
        stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Call an MCP tool by name with arguments
    async fn call_tool(
        &mut self,
        tool_name: &str,
        arguments: &serde_json::Value,
    ) -> Result<McpToolResult, String> {
        let result = self
            .send_request(
                "tools/call",
                Some(json!({
                    "name": tool_name,
                    "arguments": arguments
                })),
            )
            .await?;

        // Parse tool call result
        // MCP returns: { content: [{ type: "text", text: "..." }], ... }
        let content = result.get("content").ok_or("No content in tool result")?;
        let content_arr = content.as_array().ok_or("Content is not an array")?;

        let mut text_parts = Vec::new();
        for item in content_arr {
            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                text_parts.push(text.to_string());
            }
        }

        let text = text_parts.join("\n");
        Ok(McpToolResult::success(text))
    }
}

impl Drop for McpServer {
    fn drop(&mut self) {
        // Try to gracefully kill the child process
        let _ = self.child.start_kill();
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

    /// Execute an MCP tool via the MiniMax Token Plan MCP server.
    ///
    /// Starts the MCP server on first call and reuses the same process for
    /// subsequent calls. The server is shared globally across all tool invocations.
    pub async fn execute(&self, arguments: &serde_json::Value) -> Result<McpToolResult, String> {
        // Lazily start (or get existing) MCP server
        let server_arc = MCP_SERVER.get_or_init(|| Arc::new(Mutex::new(None)));
        let mut guard = server_arc.lock().await;

        if guard.is_none() {
            match McpServer::start().await {
                Ok(server) => {
                    *guard = Some(server);
                }
                Err(e) => {
                    return Err(format!(
                        "Failed to start MiniMax MCP server: {}\n\
                         Install uvx: curl -LsSf https://astral.sh/uv/install.sh | sh\n\
                         Then run: uvx minimax-coding-plan-mcp -y",
                        e
                    ));
                }
            }
        }

        let server = guard.as_mut().ok_or("MCP server not initialized")?;
        server.call_tool(&self.tool_name, arguments).await
    }
}
