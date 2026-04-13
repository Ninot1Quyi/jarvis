//! Agent module - ReAct loop implementation
//!
//! Based on Harness Engineering: **Observable** — every step emits events

mod state;

use crate::config::Config;
use crate::llm::{parse_tool_calls_from_text, ChatChunk, LLMProvider, ToolCall, ToolDefinition};
use crate::message::{Message, MessageRole};
use crate::observability::{Component, Event, EventBus, EventData, EventType, TraceId};
use crate::skills;
use crate::soul::SoulManager;
use crate::tools::{ToolContext, ToolRegistry, ToolResult};
use futures::{FutureExt, StreamExt};
pub use state::AgentState;
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
    current_trace_id: Option<TraceId>,
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

#[derive(Debug)]
struct StartedTool {
    id: String,
    name: String,
    is_concurrency_safe: bool,
}

/// Claude Code-like streaming tool executor:
/// - ToolUse arrives during model stream -> enqueue immediately
/// - concurrency-safe tools can run in parallel
/// - non-concurrent tools run exclusively
struct StreamingToolExecutor {
    registry: Arc<ToolRegistry>,
    llm: Option<Arc<dyn LLMProvider>>,
    config: Config,
    queue: VecDeque<QueuedTool>,
    running: HashMap<String, bool>, // tool_use_id -> is_concurrency_safe
    join_set: JoinSet<CompletedTool>,
    started: Vec<StartedTool>,
    executing_count: usize,
    concurrency_safe_count: usize,
}

impl StreamingToolExecutor {
    fn new(registry: Arc<ToolRegistry>, llm: Option<Arc<dyn LLMProvider>>, config: Config) -> Self {
        Self {
            registry,
            llm,
            config,
            queue: VecDeque::new(),
            running: HashMap::new(),
            join_set: JoinSet::new(),
            started: Vec::new(),
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

    fn take_started(&mut self) -> Vec<StartedTool> {
        std::mem::take(&mut self.started)
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
        let name = queued.call.name.clone();
        let is_concurrency_safe = queued.is_concurrency_safe;
        self.executing_count += 1;
        if is_concurrency_safe {
            self.concurrency_safe_count += 1;
        }
        self.running.insert(id.clone(), is_concurrency_safe);
        self.started.push(StartedTool {
            id,
            name,
            is_concurrency_safe,
        });

        let registry = self.registry.clone();
        let llm = self.llm.clone();
        let config = self.config.clone();
        self.join_set
            .spawn(async move { run_tool_call(registry, llm, config, queued.call).await });
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

async fn run_tool_call(
    registry: Arc<ToolRegistry>,
    llm: Option<Arc<dyn LLMProvider>>,
    config: Config,
    call: ToolCall,
) -> CompletedTool {
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

        let mut context = ToolContext::new();
        context.llm = llm;
        context.config = Some(config.clone());
        // Read soul version if available
        if let Ok(soul_content) = tokio::fs::read_to_string("data/soul.md").await {
            for line in soul_content.lines() {
                if line.trim().starts_with("major:") {
                    if let Some(v) = line.trim().strip_prefix("major:") {
                        context.soul_version = Some(v.trim().to_string());
                    }
                }
            }
        }
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
            current_trace_id: None,
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
        let trace_id = TraceId::new();
        self.current_trace_id = Some(trace_id.clone());

        info!(session_id = %session_id, task = %task, "Agent.run started");

        // Emit task start event
        let event = Event::new_in_trace(
            trace_id.clone(),
            Component::Agent,
            EventType::AgentStart,
            EventData::Message {
                message: format!("Task started: {}", task),
            },
        );
        self.event_bus.publish(event);

        // Build messages for LLM
        let mut messages = self.build_messages(task);

        // Inject matching skills into the last message (system prompt)
        if let Some(sys_msg) = messages.first_mut() {
            let matched_skills = skills::find_matching_skills(task);
            if !matched_skills.is_empty() {
                sys_msg.content.push_str(&matched_skills);
            }
        }

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
            let step_event = Event::new_in_trace(
                trace_id.clone(),
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
            self.event_bus.publish(Event::new_in_trace(
                trace_id.clone(),
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

            // Stream assistant output and queue tools as soon as tool_use blocks arrive.
            let mut full_text = String::new();
            let mut assistant_blocks: Vec<serde_json::Value> = Vec::new();
            let mut tool_call_order: Vec<String> = Vec::new();
            let mut completed_tools_by_id: HashMap<String, CompletedTool> = HashMap::new();
            let mut streaming_tool_executor =
                StreamingToolExecutor::new(self.tool_registry.clone(), Some(llm.clone()), self.config.clone());
            let mut stream = llm.chat_streaming(&messages, tools_ref);
            let mut stream_done = false;
            let mut thinking_visible = false;

            while !stream_done
                || streaming_tool_executor.has_running()
                || streaming_tool_executor.has_queued()
            {
                tokio::select! {
                    chunk = stream.next(), if !stream_done => {
                        match chunk {
                            Some(Ok(ChatChunk::MessageStart { message_id, role })) => {
                                self.dev_log(
                                    "LLM_MESSAGE_START",
                                    &format!(
                                        "message_id={} role={}",
                                        message_id.as_deref().unwrap_or("<none>"),
                                        role.as_deref().unwrap_or("<none>")
                                    ),
                                );
                            }
                            Some(Ok(ChatChunk::Text(text))) => {
                                eprint!("{}", text);
                                full_text.push_str(&text);
                                Self::append_text_block(&mut assistant_blocks, &text);
                                self.event_bus.publish(Event::new_in_trace(
                                    trace_id.clone(),
                                    Component::Llm,
                                    EventType::LlmChunk,
                                    EventData::LlmChunk { text: text.clone() },
                                ));
                                self.dev_log("LLM_CHUNK", &format!("text={}", Self::preview(&text)));
                            }
                            Some(Ok(ChatChunk::ToolUse(tool_call))) => {
                                let is_concurrency_safe =
                                    self.is_tool_concurrency_safe(&tool_call.name);
                                self.event_bus.publish(Event::new_in_trace(
                                    trace_id.clone(),
                                    Component::Llm,
                                    EventType::LlmToolCall,
                                    EventData::ToolCall {
                                        tool: tool_call.name.clone(),
                                        input: tool_call.arguments.clone(),
                                        tool_use_id: Some(tool_call.id.clone()),
                                        correlation_id: Some(tool_call.id.clone()),
                                        is_concurrency_safe: Some(is_concurrency_safe),
                                    },
                                ));
                                self.dev_log(
                                    "LLM_TOOL_CALL",
                                    &format!(
                                        "id={} name={} args={}",
                                        tool_call.id, tool_call.name, tool_call.arguments
                                    ),
                                );
                                self.event_bus.publish(Event::new_in_trace(
                                    trace_id.clone(),
                                    Component::Tool,
                                    EventType::ToolCall,
                                    EventData::ToolCall {
                                        tool: tool_call.name.clone(),
                                        input: tool_call.arguments.clone(),
                                        tool_use_id: Some(tool_call.id.clone()),
                                        correlation_id: Some(tool_call.id.clone()),
                                        is_concurrency_safe: Some(is_concurrency_safe),
                                    },
                                ));
                                assistant_blocks.push(serde_json::json!({
                                    "type": "tool_use",
                                    "id": tool_call.id.clone(),
                                    "name": tool_call.name.clone(),
                                    "input": tool_call.arguments.clone(),
                                }));
                                self.dev_log(
                                    "TOOL_CALL",
                                    &format!(
                                        "queued id={} name={} concurrency_safe={}",
                                        tool_call.id, tool_call.name, is_concurrency_safe
                                    ),
                                );
                                self.record_tool_lifecycle(
                                    &tool_call.id,
                                    &tool_call.name,
                                    "queued",
                                    is_concurrency_safe,
                                    Some("queued"),
                                    None,
                                );
                                tool_call_order.push(tool_call.id.clone());
                                streaming_tool_executor.enqueue(tool_call, is_concurrency_safe);
                                self.record_started_tools(streaming_tool_executor.take_started());
                            }
                            Some(Ok(ChatChunk::ToolInputDelta { id, delta })) => {
                                self.dev_log(
                                    "LLM_TOOL_INPUT_DELTA",
                                    &format!("id={} delta={}", id, Self::preview(&delta)),
                                );
                            }
                            Some(Ok(ChatChunk::ThinkingStart { id, index })) => {
                                if !thinking_visible {
                                    eprint!("\n[THINK] ");
                                    thinking_visible = true;
                                }
                                self.dev_log("LLM_THINKING_START", &format!("id={} index={}", id, index));
                            }
                            Some(Ok(ChatChunk::ThinkingDelta { id, delta })) => {
                                if !thinking_visible {
                                    eprint!("\n[THINK] ");
                                    thinking_visible = true;
                                }
                                eprint!("{}", delta);
                                self.dev_log(
                                    "LLM_THINKING_DELTA",
                                    &format!("id={} delta={}", id, Self::preview(&delta)),
                                );
                            }
                            Some(Ok(ChatChunk::ThinkingEnd { id })) => {
                                if thinking_visible {
                                    eprint!("\n[LUM] ");
                                    thinking_visible = false;
                                }
                                self.dev_log("LLM_THINKING_END", &format!("id={}", id));
                            }
                            Some(Ok(ChatChunk::MessageDelta { stop_reason })) => {
                                self.dev_log(
                                    "LLM_MESSAGE_DELTA",
                                    &format!(
                                        "stop_reason={}",
                                        stop_reason.as_deref().unwrap_or("<none>")
                                    ),
                                );
                            }
                            Some(Ok(ChatChunk::MessageStop { stop_reason })) => {
                                self.dev_log(
                                    "LLM_MESSAGE_STOP",
                                    &format!(
                                        "stop_reason={}",
                                        stop_reason.as_deref().unwrap_or("<none>")
                                    ),
                                );
                            }
                            Some(Ok(ChatChunk::Done)) | None => {
                                if thinking_visible {
                                    eprint!("\n[LUM] ");
                                    thinking_visible = false;
                                }
                                stream_done = true;
                            }
                            Some(Err(e)) => {
                                error!(error = %e, "LLM chat error");
                                self.event_bus.publish(Event::new_in_trace(
                                    trace_id.clone(),
                                    Component::Agent,
                                    EventType::AgentError,
                                    EventData::Error {
                                        error: format!("LLM chat error: {}", e),
                                    },
                                ));
                                self.current_trace_id = None;
                                return Err(format!("LLM chat error: {}", e));
                            }
                        }
                    }
                    completed = streaming_tool_executor.wait_next(), if streaming_tool_executor.has_running() => {
                        if let Some(completed) = completed {
                            self.record_started_tools(streaming_tool_executor.take_started());
                            self.record_tool_completion(&completed);
                            completed_tools_by_id.insert(completed.call.id.clone(), completed);
                        }
                    }
                }
            }

            self.record_started_tools(streaming_tool_executor.take_started());

            // Publish LLM complete event.
            self.event_bus.publish(Event::new_in_trace(
                trace_id.clone(),
                Component::Llm,
                EventType::LlmComplete,
                EventData::Message {
                    message: format!(
                        "LLM complete: {} chars, {} tool call(s)",
                        full_text.chars().count(),
                        tool_call_order.len()
                    ),
                },
            ));
            self.dev_log(
                "LLM_DONE",
                &format!(
                    "chars={} tool_calls={}",
                    full_text.chars().count(),
                    tool_call_order.len()
                ),
            );

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
                        StreamingToolExecutor::new(self.tool_registry.clone(), Some(llm.clone()), self.config.clone());
                    for tool_call in parsed_calls {
                        let is_concurrency_safe = self.is_tool_concurrency_safe(&tool_call.name);
                        self.publish_observability_event(
                            Component::Tool,
                            EventType::ToolCall,
                            EventData::ToolCall {
                                tool: tool_call.name.clone(),
                                input: tool_call.arguments.clone(),
                                tool_use_id: Some(tool_call.id.clone()),
                                correlation_id: Some(tool_call.id.clone()),
                                is_concurrency_safe: Some(is_concurrency_safe),
                            },
                        );
                        self.dev_log(
                            "TOOL_CALL",
                            &format!(
                                "queued id={} name={} concurrency_safe={} (parsed)",
                                tool_call.id, tool_call.name, is_concurrency_safe
                            ),
                        );
                        tool_call_order.push(tool_call.id.clone());
                        self.record_tool_lifecycle(
                            &tool_call.id,
                            &tool_call.name,
                            "queued",
                            is_concurrency_safe,
                            Some("queued (parsed)"),
                            None,
                        );
                        parsed_executor.enqueue(tool_call, is_concurrency_safe);
                        self.record_started_tools(parsed_executor.take_started());
                    }

                    while parsed_executor.has_running() || parsed_executor.has_queued() {
                        if !parsed_executor.has_running() {
                            parsed_executor.process_queue();
                            if !parsed_executor.has_running() {
                                break;
                            }
                        }
                        if let Some(completed) = parsed_executor.wait_next().await {
                            self.record_started_tools(parsed_executor.take_started());
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
                    self.record_started_tools(streaming_tool_executor.take_started());
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
        let event = Event::new_in_trace(
            trace_id.clone(),
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

        self.current_trace_id = None;

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

        prompt.push_str(
            "\nDo not claim that external side effects succeeded (opening apps, saving files, showing UI changes, clicking anything) unless a tool result explicitly confirmed it.\n",
        );
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
            self.record_tool_lifecycle(
                &completed.call.id,
                &completed.call.name,
                "completed",
                self.is_tool_concurrency_safe(&completed.call.name),
                Some(output_preview.as_str()),
                None,
            );
            self.publish_observability_event(
                Component::Tool,
                EventType::ToolComplete,
                EventData::ToolProgress {
                    tool: completed.call.name.clone(),
                    output: output_preview.clone(),
                    tool_use_id: Some(completed.call.id.clone()),
                    correlation_id: Some(completed.call.id.clone()),
                    state: Some("completed".to_string()),
                    is_concurrency_safe: Some(self.is_tool_concurrency_safe(&completed.call.name)),
                },
            );
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
            self.record_tool_lifecycle(
                &completed.call.id,
                &completed.call.name,
                "error",
                self.is_tool_concurrency_safe(&completed.call.name),
                None,
                Some(error_text.as_str()),
            );
            self.publish_observability_event(
                Component::Tool,
                EventType::ToolError,
                EventData::Error {
                    error: format!("{}: {}", completed.call.name, error_text),
                },
            );
            self.dev_log(
                "TOOL_RESULT",
                &format!(
                    "id={} name={} success=false error={}",
                    completed.call.id, completed.call.name, error_text
                ),
            );
        }
    }

    fn record_started_tools(&self, started_tools: Vec<StartedTool>) {
        for started in started_tools {
            self.record_tool_lifecycle(
                &started.id,
                &started.name,
                "executing",
                started.is_concurrency_safe,
                Some("executing"),
                None,
            );
        }
    }

    fn record_tool_lifecycle(
        &self,
        tool_use_id: &str,
        tool: &str,
        state: &str,
        is_concurrency_safe: bool,
        output: Option<&str>,
        error: Option<&str>,
    ) {
        let mut output_text = output.unwrap_or_default().to_string();
        if let Some(error_text) = error {
            if !output_text.is_empty() {
                output_text.push_str(" | ");
            }
            output_text.push_str(error_text);
        }
        self.publish_observability_event(
            Component::Tool,
            EventType::ToolProgress,
            EventData::ToolProgress {
                tool: tool.to_string(),
                output: output_text,
                tool_use_id: Some(tool_use_id.to_string()),
                correlation_id: Some(tool_use_id.to_string()),
                state: Some(state.to_string()),
                is_concurrency_safe: Some(is_concurrency_safe),
            },
        );
    }

    fn publish_observability_event(
        &self,
        component: Component,
        event_type: EventType,
        data: EventData,
    ) {
        let event = if let Some(trace_id) = self.current_trace_id.clone() {
            Event::new_in_trace(trace_id, component, event_type, data)
        } else {
            Event::new(component, event_type, data)
        };
        self.event_bus.publish(event);
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

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use futures::stream;
    use std::pin::Pin;
    use std::sync::Mutex;
    use std::time::Duration;

    struct FakeTool {
        name: &'static str,
        delay_ms: u64,
    }

    #[async_trait]
    impl crate::tools::Tool for FakeTool {
        fn name(&self) -> &str {
            self.name
        }

        fn description(&self) -> &str {
            "fake test tool"
        }

        fn input_schema(&self) -> serde_json::Value {
            serde_json::json!({})
        }

        fn is_concurrency_safe(&self) -> bool {
            true
        }

        async fn call(
            &self,
            _input: &serde_json::Value,
            _context: &ToolContext,
        ) -> Result<ToolResult, String> {
            tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;
            Ok(ToolResult {
                success: true,
                output: format!("{}-ok", self.name),
                error: None,
            })
        }
    }

    struct FakeLLM {
        streams: Mutex<Vec<Vec<Result<ChatChunk, crate::llm::LLMError>>>>,
        requests: Mutex<Vec<Vec<Message>>>,
    }

    impl FakeLLM {
        fn new(streams: Vec<Vec<Result<ChatChunk, crate::llm::LLMError>>>) -> Self {
            Self {
                streams: Mutex::new(streams),
                requests: Mutex::new(Vec::new()),
            }
        }

        fn recorded_requests(&self) -> Vec<Vec<Message>> {
            self.requests.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl LLMProvider for FakeLLM {
        async fn chat_stream(
            &self,
            _messages: &[Message],
            _tools: Option<&[ToolDefinition]>,
        ) -> Result<crate::llm::ChatCompletion, crate::llm::LLMError> {
            panic!("chat_stream should not be used in streaming agent path");
        }

        fn chat_streaming(
            &self,
            messages: &[Message],
            _tools: Option<&[ToolDefinition]>,
        ) -> Pin<Box<dyn futures::Stream<Item = Result<ChatChunk, crate::llm::LLMError>> + Send + '_>>
        {
            self.requests.lock().unwrap().push(messages.to_vec());
            let response = self.streams.lock().unwrap().remove(0);
            Box::pin(stream::iter(response))
        }

        fn supports_tools(&self) -> bool {
            true
        }
    }

    fn test_agent(llm: Arc<dyn LLMProvider>, registry: ToolRegistry) -> Agent {
        Agent::new(
            registry,
            Config::default(),
            SoulManager::new(std::path::PathBuf::from("SOUL.md")),
            Arc::new(EventBus::new(false)),
        )
        .with_llm(llm)
    }

    #[tokio::test]
    async fn agent_uses_chat_streaming_for_text_only_turns() {
        let llm = Arc::new(FakeLLM::new(vec![vec![
            Ok(ChatChunk::Text("streamed done".to_string())),
            Ok(ChatChunk::Done),
        ]]));

        let result = test_agent(llm.clone(), ToolRegistry::new())
            .run("say done")
            .await
            .expect("agent run should succeed");

        assert_eq!(result.steps, 1);
        assert_eq!(result.output, "streamed done");
        assert_eq!(llm.recorded_requests().len(), 1);
    }

    #[tokio::test]
    async fn agent_flushes_tool_results_in_tool_use_arrival_order() {
        let llm = Arc::new(FakeLLM::new(vec![
            vec![
                Ok(ChatChunk::Text("working ".to_string())),
                Ok(ChatChunk::ToolUse(ToolCall {
                    id: "tool-1".to_string(),
                    name: "slow_tool".to_string(),
                    arguments: serde_json::json!({}),
                })),
                Ok(ChatChunk::ToolUse(ToolCall {
                    id: "tool-2".to_string(),
                    name: "fast_tool".to_string(),
                    arguments: serde_json::json!({}),
                })),
                Ok(ChatChunk::Done),
            ],
            vec![Ok(ChatChunk::Text("done".to_string())), Ok(ChatChunk::Done)],
        ]));

        let mut registry = ToolRegistry::new();
        registry.register(FakeTool {
            name: "slow_tool",
            delay_ms: 40,
        });
        registry.register(FakeTool {
            name: "fast_tool",
            delay_ms: 1,
        });

        let result = test_agent(llm.clone(), registry)
            .run("run tools")
            .await
            .expect("agent run should succeed");

        assert_eq!(result.output, "done");

        let requests = llm.recorded_requests();
        assert_eq!(requests.len(), 2);

        let second_turn = &requests[1];
        let tool_messages: Vec<&Message> = second_turn
            .iter()
            .filter(|message| message.role == MessageRole::Tool)
            .collect();

        assert_eq!(tool_messages.len(), 2);
        assert_eq!(tool_messages[0].tool_use_id.as_deref(), Some("tool-1"));
        assert_eq!(tool_messages[1].tool_use_id.as_deref(), Some("tool-2"));
        assert_eq!(tool_messages[0].content, "slow_tool-ok");
        assert_eq!(tool_messages[1].content, "fast_tool-ok");
    }
}
