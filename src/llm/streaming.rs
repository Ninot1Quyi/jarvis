//! Streaming tool execution - Claude Code pattern
//!
//! Tools execute as LLM generates them, not after full response.
//! This enables concurrent-safe tools to run in parallel while LLM is still generating.

use crate::llm::{ChatChunk, LLMError, ToolCall};
use crate::tools::{ToolContext, ToolRegistry, ToolResult};
use futures::Stream;
use futures::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, error};

/// Tool execution status
#[derive(Debug, Clone, PartialEq)]
pub enum ToolStatus {
    Queued,
    Executing,
    Completed,
    Yielded,
    Error,
}

/// A tool being tracked for streaming execution
struct TrackedTool {
    id: String,
    name: String,
    arguments: serde_json::Value,
    status: ToolStatus,
    is_concurrency_safe: bool,
    result: Option<ToolResult>,
    error: Option<String>,
}

/// Streaming tool executor - executes tools as they arrive from LLM stream
///
/// Key features:
/// - Tools execute immediately when their complete tool_use block arrives
/// - Concurrency-safe tools run in parallel
/// - Non-concurrent tools (Bash, Edit) run with exclusive access
/// - Errors in one tool can abort sibling tools
pub struct StreamingToolExecutor {
    tools: Vec<TrackedTool>,
    tool_registry: Arc<ToolRegistry>,
    tool_context: ToolContext,
    /// For tools that are currently executing
    executing_count: usize,
    /// Track which tools are concurrency-safe
    concurrency_safe_count: usize,
}

impl StreamingToolExecutor {
    pub fn new(tool_registry: Arc<ToolRegistry>) -> Self {
        Self {
            tools: Vec::new(),
            tool_registry,
            tool_context: ToolContext::new(),
            executing_count: 0,
            concurrency_safe_count: 0,
        }
    }

    /// Add a tool to the execution queue
    pub fn add_tool(&mut self, tool_call: ToolCall, is_concurrency_safe: bool) {
        self.tools.push(TrackedTool {
            id: tool_call.id,
            name: tool_call.name,
            arguments: tool_call.arguments,
            status: ToolStatus::Queued,
            is_concurrency_safe,
            result: None,
            error: None,
        });
        self.process_queue();
    }

    /// Check if we can execute a tool
    fn can_execute(&self, is_safe: bool) -> bool {
        if self.executing_count == 0 {
            return true;
        }
        // Can run if current tool is safe and we're safe
        is_safe && self.concurrency_safe_count == self.executing_count
    }

    /// Process the queue, starting tools when concurrency allows
    fn process_queue(&mut self) {
        // First collect indices of tools to execute
        let mut to_execute: Vec<usize> = Vec::new();

        for (idx, tool) in self.tools.iter().enumerate() {
            if tool.status != ToolStatus::Queued {
                continue;
            }
            if self.can_execute(tool.is_concurrency_safe) {
                to_execute.push(idx);
            } else if !tool.is_concurrency_safe && self.executing_count > 0 {
                break;
            }
        }

        // Then execute them
        for idx in to_execute {
            self.execute_tool_by_index(idx);
        }
    }

    /// Execute a tool by index
    fn execute_tool_by_index(&mut self, idx: usize) {
        let tool = &mut self.tools[idx];
        tool.status = ToolStatus::Executing;
        if tool.is_concurrency_safe {
            self.concurrency_safe_count += 1;
        }
        self.executing_count += 1;

        let name = tool.name.clone();
        let args = tool.arguments.clone();
        let registry = self.tool_registry.clone();
        let context = self.tool_context.clone();

        // Spawn async execution
        tokio::spawn(async move {
            let result = Self::run_tool(&name, &args, &registry, &context).await;
            result
        });
    }

    async fn run_tool(
        name: &str,
        args: &serde_json::Value,
        registry: &ToolRegistry,
        context: &ToolContext,
    ) -> ToolResult {
        let tool = match registry.get(name) {
            Some(t) => t,
            None => {
                return ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("Unknown tool: {}", name)),
                };
            }
        };

        match tool.call(args, context).await {
            Ok(result) => result,
            Err(e) => ToolResult {
                success: false,
                output: String::new(),
                error: Some(e),
            },
        }
    }

    /// Get completed tool results
    pub fn take_completed(&mut self) -> Vec<(String, ToolResult)> {
        let mut results = Vec::new();
        for tool in &mut self.tools {
            if tool.status == ToolStatus::Completed {
                if let Some(result) = tool.result.take() {
                    results.push((tool.id.clone(), result));
                    tool.status = ToolStatus::Yielded;
                }
            }
        }
        results
    }

    /// Mark a tool as completed with result
    pub fn complete_tool(&mut self, id: &str, result: ToolResult) {
        for tool in &mut self.tools {
            if tool.id == id && tool.status == ToolStatus::Executing {
                tool.result = Some(result);
                tool.status = ToolStatus::Completed;
                self.executing_count = self.executing_count.saturating_sub(1);
                if tool.is_concurrency_safe {
                    self.concurrency_safe_count = self.concurrency_safe_count.saturating_sub(1);
                }
                break;
            }
        }
        self.process_queue();
    }

    /// Check if all tools are done
    pub fn is_done(&self) -> bool {
        self.tools.iter().all(|t| {
            t.status == ToolStatus::Completed
                || t.status == ToolStatus::Yielded
                || t.status == ToolStatus::Error
        })
    }

    /// Get count of pending tools
    pub fn pending_count(&self) -> usize {
        self.tools
            .iter()
            .filter(|t| t.status == ToolStatus::Queued)
            .count()
    }
}

/// Create a streaming executor that processes chunks from LLM
pub async fn run_streaming_executor(
    tool_registry: Arc<ToolRegistry>,
    chunk_stream: impl Stream<Item = Result<ChatChunk, LLMError>>,
) -> Result<Vec<(String, ToolResult)>, LLMError> {
    let mut executor = StreamingToolExecutor::new(tool_registry);
    let mut pending_tools: HashMap<String, (String, serde_json::Value)> = HashMap::new();
    let mut results = Vec::new();

    tokio::pin!(chunk_stream);

    while let Some(chunk_result) = chunk_stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                match chunk {
                    ChatChunk::ToolUse(tool_call) => {
                        // Complete tool_use block received
                        debug!(tool = %tool_call.name, id = %tool_call.id, "Tool use block complete");
                        // Determine if concurrency safe (for now assume most tools are safe)
                        let is_safe = !matches!(
                            tool_call.name.as_str(),
                            "bash" | "edit" | "write_file" | "Glob"
                        );
                        executor.add_tool(tool_call, is_safe);
                    }
                    ChatChunk::ToolInputDelta { id, delta } => {
                        // Accumulate partial JSON input
                        if let Some((_, input)) = pending_tools.get_mut(&id) {
                            // Append delta to existing input string
                            if let Some(s) = input.as_str() {
                                let new_input = serde_json::json!({
                                    "_partial": format!("{}{}", s, delta)
                                });
                                *input = new_input;
                            }
                        }
                    }
                    ChatChunk::Done => {
                        break;
                    }
                    _ => {}
                }
            }
            Err(e) => {
                error!(error = %e, "Chunk stream error");
                return Err(e);
            }
        }
    }

    // Wait for all tools to complete
    while !executor.is_done() {
        if let Some((id, result)) = executor.take_completed().pop() {
            results.push((id, result));
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }

    // Collect remaining results
    for (id, result) in executor.take_completed() {
        results.push((id, result));
    }

    Ok(results)
}
