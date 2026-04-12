//! Agent module - ReAct loop implementation
//!
//! Based on Harness Engineering: **Observable** — every step emits events

mod state;

use crate::config::Config;
use crate::llm::{parse_tool_calls_from_text, LLMProvider, ToolCall, ToolDefinition};
use crate::message::{Message, MessageRole};
use crate::observability::{Component, Event, EventBus, EventData, EventType};
use crate::soul::SoulManager;
use crate::tools::{ToolContext, ToolRegistry, ToolResult};
pub use state::AgentState;
use futures::FutureExt;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::task::JoinSet;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Agent result after task execution
#[derive(Debug)]
pub struct AgentResult {
    pub success: bool,
    pub steps: usize,
    pub output: String,
}

/// Agent - main AI agent with ReAct loop
pub struct Agent {
    tool_registry: Arc<ToolRegistry>,
    config: Config,
    soul_manager: SoulManager,
    event_bus: Arc<EventBus>,
    llm: Option<Arc<dyn LLMProvider>>,
}

#[derive(Debug)]
struct QueuedTool {
    call: ToolCall,
    is_concurrency_safe: bool,
}

#[derive(Debug)]
struct CompletedTool {
    call: ToolCall,
    result: ToolResult,
}

/// Claude Code-like streaming tool executor:
/// - ToolUse arrives during model stream -> enqueue immediately
/// - concurrency-safe tools can run in parallel
/// - non-concurrent tools run exclusively
struct StreamingToolExecutor {
    registry: Arc<ToolRegistry>,
    queue: VecDeque<QueuedTool>,
    running: HashMap<String, bool>, // tool_use_id -> is_concurrency_safe
    join_set: JoinSet<CompletedTool>,
    executing_count: usize,
    concurrency_safe_count: usize,
}

impl StreamingToolExecutor {
    fn new(registry: Arc<ToolRegistry>) -> Self {
        Self {
            registry,
            queue: VecDeque::new(),
            running: HashMap::new(),
            join_set: JoinSet::new(),
            executing_count: 0,
            concurrency_safe_count: 0,
        }
    }

    fn enqueue(&mut self, call: ToolCall, is_concurrency_safe: bool) {
        self.queue.push_back(QueuedTool {
            call,
            is_concurrency_safe,
        });
        self.process_queue();
    }

    fn has_running(&self) -> bool {
        !self.running.is_empty()
    }

    fn has_queued(&self) -> bool {
        !self.queue.is_empty()
    }

    fn can_execute(&self, is_concurrency_safe: bool) -> bool {
        if self.executing_count == 0 {
            return true;
        }
        is_concurrency_safe && self.concurrency_safe_count == self.executing_count
    }

    fn process_queue(&mut self) {
        loop {
            let Some(next) = self.queue.front() else {
                break;
            };
            if !self.can_execute(next.is_concurrency_safe) {
                break;
            }
            let queued = match self.queue.pop_front() {
                Some(q) => q,
                None => break,
            };
            self.start_tool(queued);
        }
    }

    fn start_tool(&mut self, queued: QueuedTool) {
        let id = queued.call.id.clone();
        self.executing_count += 1;
        if queued.is_concurrency_safe {
            self.concurrency_safe_count += 1;
        }
        self.running.insert(id, queued.is_concurrency_safe);

        let registry = self.registry.clone();
        self.join_set
            .spawn(async move { run_tool_call(registry, queued.call).await });
    }

    async fn wait_next(&mut self) -> Option<CompletedTool> {
        let joined = self.join_set.join_next().await?;
        match joined {
            Ok(done) => {
                self.mark_completed(&done.call.id);
                self.process_queue();
                Some(done)
            }
            Err(e) => {
                error!(error = %e, "Tool task join error");
                // Keep internal counters monotonic even on join failure.
                self.executing_count = self.executing_count.saturating_sub(1);
                self.concurrency_safe_count = self.concurrency_safe_count.saturating_sub(1);
                self.process_queue();
                None
            }
        }
    }

    fn mark_completed(&mut self, id: &str) {
        if let Some(is_safe) = self.running.remove(id) {
            self.executing_count = self.executing_count.saturating_sub(1);
            if is_safe {
                self.concurrency_safe_count = self.concurrency_safe_count.saturating_sub(1);
            }
        }
    }
}

async fn run_tool_call(registry: Arc<ToolRegistry>, call: ToolCall) -> CompletedTool {
    let call_clone = call.clone();
    let result = std::panic::AssertUnwindSafe(async {
        let tool = match registry.get(&call.name) {
            Some(t) => t,
            None => {
                return ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("Unknown tool: {}", call.name)),
                };
            }
        };

        let context = ToolContext::new();
        match tool.call(&call.arguments, &context).await {
            Ok(result) => result,
            Err(e) => ToolResult {
                success: false,
                output: String::new(),
                error: Some(e),
            },
        }
    })
    .catch_unwind()
    .await
    .unwrap_or_else(|_| ToolResult {
        success: false,
        output: String::new(),
        error: Some("Tool execution panicked".to_string()),
    });

    CompletedTool {
        call: call_clone,
        result,
    }
}

impl Agent {
    /// Create a new Agent
    pub fn new(
        tool_registry: ToolRegistry,
        config: Config,
        soul_manager: SoulManager,
        event_bus: Arc<EventBus>,
    ) -> Self {
        Self {
            tool_registry: Arc::new(tool_registry),
            config,
            soul_manager,
            event_bus,
            llm: None,
        }
    }

    /// Set the LLM provider
    pub fn with_llm(mut self, llm: Arc<dyn LLMProvider>) -> Self {
        self.llm = Some(llm);
        self
    }

    /// Run the agent with a task
    pub async fn run(&mut self, task: &str) -> Result<AgentResult, String> {
        let session_id = Uuid::new_v4().to_string();
        let _trace_id = Uuid::new_v4().to_string();

        info!(session_id = %session_id, task = %task, "Agent.run started");

        // Emit task start event
        let event = Event::new(
            Component::Agent,
            EventType::AgentStart,
            EventData::Message {
                message: format!("Task started: {}", task),
            },
        );
        self.event_bus.publish(event);

        // Build messages for LLM
        let mut messages = self.build_messages(task);

        let mut steps = 0;
        let max_steps = 50;

        // Check if we have an LLM provider
        let llm = match &self.llm {
            Some(llm) => llm.clone(),
            None => {
                warn!("No LLM provider configured, using placeholder loop");
                return self.run_placeholder(task).await;
            }
        };

        while steps < max_steps {
            steps += 1;
            debug!(step = steps, "Agent step");

            // Emit step event
            let step_event = Event::new(
                Component::Agent,
                EventType::AgentStep,
                EventData::Message {
                    message: format!("Step {} started", steps),
                },
            );
            self.event_bus.publish(step_event);

            // Build tool definitions from registry
            let tools: Vec<ToolDefinition> = self
                .tool_registry
                .list()
                .iter()
                .filter_map(|name| self.tool_registry.get(name))
                .map(|tool| ToolDefinition {
                    name: tool.name().to_string(),
                    description: tool.description().to_string(),
                    input_schema: tool.input_schema(),
                })
                .collect();

            let tools_ref = if tools.is_empty() {
                None
            } else {
                Some(tools.as_slice())
            };
            self.event_bus.publish(Event::new(
                Component::Llm,
                EventType::LlmStart,
                EventData::Message {
                    message: format!(
                        "Step {} LLM request with {} messages and {} tools",
                        steps,
                        messages.len(),
                        tools.len()
                    ),
                },
            ));
            self.dev_log(
                "LLM_START",
                &format!(
                    "step={} messages={} tools={}",
                    steps,
                    messages.len(),
                    tools.len()
                ),
            );

            // Print to stderr that LLM is responding (user sees this in real-time)
            eprint!("\n[LUM] ");

            // Use non-streaming for better response time with MiniMax (avoids
            // extended thinking streaming delays). Tool calls are processed
            // after the full response is received.
            let full_text: String;
            let assistant_blocks: Vec<serde_json::Value>;
            let tool_calls: Vec<ToolCall>;

            match llm.chat_stream(&messages, tools_ref).await {
                Ok(response) => {
                    full_text = response.message;
                    tool_calls = response.tool_calls;
                    assistant_blocks = tool_calls
                        .iter()
                        .map(|tc| {
                            serde_json::json!({
                                "type": "tool_use",
                                "id": tc.id,
                                "name": tc.name,
                                "input": tc.arguments,
                            })
                        })
                        .collect();
                }
                Err(e) => {
                    error!(error = %e, "LLM chat error");
                    self.event_bus.publish(Event::new(
                        Component::Agent,
                        EventType::AgentError,
                        EventData::Error {
                            error: format!("LLM chat error: {}", e),
                        },
                    ));
                    return Err(format!("LLM chat error: {}", e));
                }
            };

            // Publish LLM complete event.
            self.event_bus.publish(Event::new(
                Component::Llm,
                EventType::LlmComplete,
                EventData::Message {
                    message: format!(
                        "LLM complete: {} chars, {} tool call(s)",
                        full_text.chars().count(),
                        tool_calls.len()
                    ),
                },
            ));
            self.dev_log(
                "LLM_DONE",
                &format!(
                    "chars={} tool_calls={}",
                    full_text.chars().count(),
                    tool_calls.len()
                ),
            );

            // Enqueue and execute tool calls.
            let mut tool_call_order: Vec<String> = Vec::new();
            let mut completed_tools_by_id: HashMap<String, CompletedTool> = HashMap::new();
            let mut streaming_tool_executor =
                StreamingToolExecutor::new(self.tool_registry.clone());

            if !tool_calls.is_empty() {
                for tc in &tool_calls {
                    self.event_bus.publish(Event::new(
                        Component::Llm,
                        EventType::LlmToolCall,
                        EventData::ToolCall {
                            tool: tc.name.clone(),
                            input: tc.arguments.clone(),
                        },
                    ));
                    self.dev_log(
                        "LLM_TOOL_CALL",
                        &format!("id={} name={} args={}", tc.id, tc.name, tc.arguments),
                    );
                    self.event_bus.publish(Event::new(
                        Component::Tool,
                        EventType::ToolCall,
                        EventData::ToolCall {
                            tool: tc.name.clone(),
                            input: tc.arguments.clone(),
                        },
                    ));
                    let is_concurrency_safe = self.is_tool_concurrency_safe(&tc.name);
                    self.dev_log(
                        "TOOL_CALL",
                        &format!(
                            "queued id={} name={} concurrency_safe={}",
                            tc.id, tc.name, is_concurrency_safe
                        ),
                    );
                    tool_call_order.push(tc.id.clone());
                    streaming_tool_executor.enqueue(tc.clone(), is_concurrency_safe);
                }
            }

            // Add assistant message to history, preserving tool_use blocks.
            let assistant_message = if assistant_blocks.is_empty() {
                Message::new(MessageRole::Assistant, &full_text)
            } else {
                Message::new_assistant_with_blocks(
                    &full_text,
                    serde_json::Value::Array(assistant_blocks),
                )
            };
            messages.push(assistant_message);

            // Fallback parser for models that emit text-based tool calls.
            if tool_call_order.is_empty() {
                let (_, parsed_calls) = parse_tool_calls_from_text(&full_text);
                if !parsed_calls.is_empty() {
                    self.dev_log(
                        "LLM_TOOL_CALL",
                        &format!("parsed {} text tool call(s)", parsed_calls.len()),
                    );

                    let mut parsed_executor =
                        StreamingToolExecutor::new(self.tool_registry.clone());
                    for tool_call in parsed_calls {
                        self.event_bus.publish(Event::new(
                            Component::Tool,
                            EventType::ToolCall,
                            EventData::ToolCall {
                                tool: tool_call.name.clone(),
                                input: tool_call.arguments.clone(),
                            },
                        ));
                        let is_concurrency_safe = self.is_tool_concurrency_safe(&tool_call.name);
                        self.dev_log(
                            "TOOL_CALL",
                            &format!(
                                "queued id={} name={} concurrency_safe={} (parsed)",
                                tool_call.id, tool_call.name, is_concurrency_safe
                            ),
                        );
                        tool_call_order.push(tool_call.id.clone());
                        parsed_executor.enqueue(tool_call, is_concurrency_safe);
                    }

                    while parsed_executor.has_running() || parsed_executor.has_queued() {
                        if !parsed_executor.has_running() {
                            parsed_executor.process_queue();
                            if !parsed_executor.has_running() {
                                break;
                            }
                        }
                        if let Some(completed) = parsed_executor.wait_next().await {
                            self.record_tool_completion(&completed);
                            completed_tools_by_id.insert(completed.call.id.clone(), completed);
                        }
                    }
                }
            }

            // Drain tool executions.
            while streaming_tool_executor.has_running() || streaming_tool_executor.has_queued() {
                if !streaming_tool_executor.has_running() {
                    streaming_tool_executor.process_queue();
                    if !streaming_tool_executor.has_running() {
                        break;
                    }
                }
                if let Some(completed) = streaming_tool_executor.wait_next().await {
                    self.record_tool_completion(&completed);
                    completed_tools_by_id.insert(completed.call.id.clone(), completed);
                }
            }

            // Flush completed tool results in tool-call arrival order.
            if !tool_call_order.is_empty() {
                for tool_id in tool_call_order {
                    let Some(completed) = completed_tools_by_id.remove(&tool_id) else {
                        messages.push(Message::new_tool(&tool_id, "ERROR: missing tool result"));
                        continue;
                    };
                    let tool_msg = Self::tool_result_to_message(&completed.result);
                    messages.push(Message::new_tool(&completed.call.id, &tool_msg));
                }
            } else if self.is_task_complete(&full_text, steps) {
                info!(steps = steps, "Task completed");
                break;
            } else {
                messages.push(Message::new(MessageRole::User, "Continue."));
            }
        }

        // Emit task complete event
        let event = Event::new(
            Component::Agent,
            EventType::AgentComplete,
            EventData::Message {
                message: format!("Task completed in {} steps", steps),
            },
        );
        self.event_bus.publish(event);

        info!(session_id = %session_id, steps = steps, "Agent.run completed");

        // Get final response
        let final_output = messages
            .iter()
            .rev()
            .find(|m| m.role == MessageRole::Assistant)
            .map(|m| m.content.clone())
            .unwrap_or_else(|| format!("Executed task in {} steps", steps));

        Ok(AgentResult {
            success: true,
            steps,
            output: final_output,
        })
    }

    /// Placeholder loop when no LLM is configured
    async fn run_placeholder(&mut self, task: &str) -> Result<AgentResult, String> {
        let mut steps = 0;
        let max_steps = 1;

        while steps < max_steps {
            steps += 1;
            debug!(step = steps, "Placeholder step");
        }

        Ok(AgentResult {
            success: true,
            steps,
            output: format!("Placeholder executed: {}", task),
        })
    }

    /// Build messages for LLM
    fn build_messages(&self, task: &str) -> Vec<Message> {
        let mut messages = vec![];

        // System prompt
        let system_prompt = self.get_system_prompt();
        messages.push(Message::new(MessageRole::System, &system_prompt));

        // User task
        messages.push(Message::new(MessageRole::User, task));

        messages
    }

    /// Get system prompt with tool definitions
    fn get_system_prompt(&self) -> String {
        let mut prompt = String::from(
            "You are Dum-E, an AI coding assistant. You help users complete coding tasks.\n\n",
        );

        prompt.push_str("Available tools:\n\n");

        for tool_name in self.tool_registry.list() {
            if let Some(tool) = self.tool_registry.get(tool_name) {
                prompt.push_str(&format!("- {}: {}\n", tool.name(), tool.description()));
            }
        }

        prompt.push_str("\nWhen you have completed the task, respond with 'done' or 'finished'.\n");

        prompt
    }

    fn is_tool_concurrency_safe(&self, name: &str) -> bool {
        self.tool_registry
            .get(name)
            .map(|tool| tool.is_concurrency_safe())
            .unwrap_or(false)
    }

    fn record_tool_completion(&self, completed: &CompletedTool) {
        let output_preview = Self::preview(&completed.result.output);
        if completed.result.success {
            self.event_bus.publish(Event::new(
                Component::Tool,
                EventType::ToolComplete,
                EventData::ToolProgress {
                    tool: completed.call.name.clone(),
                    output: output_preview.clone(),
                },
            ));
            self.dev_log(
                "TOOL_RESULT",
                &format!(
                    "id={} name={} success=true output={}",
                    completed.call.id, completed.call.name, output_preview
                ),
            );
        } else {
            let error_text = completed
                .result
                .error
                .clone()
                .unwrap_or_else(|| "unknown tool error".to_string());
            self.event_bus.publish(Event::new(
                Component::Tool,
                EventType::ToolError,
                EventData::Error {
                    error: format!("{}: {}", completed.call.name, error_text),
                },
            ));
            self.dev_log(
                "TOOL_RESULT",
                &format!(
                    "id={} name={} success=false error={}",
                    completed.call.id, completed.call.name, error_text
                ),
            );
        }
    }

    fn tool_result_to_message(result: &ToolResult) -> String {
        if result.success {
            if result.output.is_empty() {
                "ok".to_string()
            } else {
                result.output.clone()
            }
        } else {
            format!(
                "ERROR: {}",
                result
                    .error
                    .clone()
                    .unwrap_or_else(|| "tool execution failed".to_string())
            )
        }
    }

    /// Determine if the task is complete based on response and step count
    fn is_task_complete(&self, response: &str, steps: usize) -> bool {
        let response_lower = response.to_lowercase();

        // Explicit completion indicators
        if response_lower.contains("done")
            || response_lower.contains("finished")
            || response_lower.contains("complete")
            || response_lower.contains("that's all")
            || response_lower.contains("no more")
        {
            return true;
        }

        // Safety: if we've been looping too long without tool calls, assume we're stuck
        if steps >= 15 {
            return true;
        }

        false
    }

    fn append_text_block(blocks: &mut Vec<serde_json::Value>, text: &str) {
        if text.is_empty() {
            return;
        }

        if let Some(last) = blocks.last_mut() {
            if last.get("type").and_then(|v| v.as_str()) == Some("text") {
                if let Some(existing) = last.get("text").and_then(|v| v.as_str()) {
                    let merged = format!("{}{}", existing, text);
                    if let Some(slot) = last.get_mut("text") {
                        *slot = serde_json::Value::String(merged);
                        return;
                    }
                }
            }
        }

        blocks.push(serde_json::json!({
            "type": "text",
            "text": text,
        }));
    }

    fn preview(text: &str) -> String {
        const LIMIT: usize = 400;
        let mut iter = text.chars();
        let preview: String = iter.by_ref().take(LIMIT).collect();
        if iter.next().is_some() {
            format!("{}...", preview)
        } else {
            preview
        }
    }

    fn dev_log(&self, stage: &str, msg: &str) {
        if self.event_bus.is_dev_mode() {
            eprintln!("[DEV][{}] {}", stage, msg);
        }
    }

    /// List available tools
    pub fn list_tools(&self) -> Vec<&str> {
        self.tool_registry.list()
    }
}

impl Default for Agent {
    fn default() -> Self {
        let config = Config::default();
        let soul_path = std::path::PathBuf::from("SOUL.md");
        let mut soul_manager = SoulManager::new(soul_path);
        let _ = soul_manager.load();
        Self::new(
            ToolRegistry::new(),
            config,
            soul_manager,
            Arc::new(EventBus::new(true)),
        )
    }
}
