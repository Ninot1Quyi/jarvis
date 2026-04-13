//! CLI-first TUI for Dum-E.
//!
//! Claude Code-inspired message-oriented terminal UI.
//! Features:
//! - Linear message flow (user/assistant alternating)
//! - Markdown text rendering
//! - Tool calls shown inline with results
//! - Bottom input prompt

use crate::agent::AgentResult;
use crate::config::EvolveConfig;
use crate::get_event_bus;
use crate::observability::{Component, Event, EventData, EventType};
use crate::Agent;
use std::collections::VecDeque;
use std::io::{stdout, Write};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{interval, Duration};

const DEFAULT_COLUMNS: usize = 100;
const MAX_MESSAGES: usize = 100;

#[derive(Debug, Clone)]
enum MessageBlock {
    /// User message text
    UserText(String),
    /// Assistant message text (Markdown supported)
    AssistantText(String),
    /// Assistant thinking (shown separately when verbose)
    AssistantThinking(String),
    /// Tool call: (tool_name, params_summary)
    ToolCall {
        name: String,
        params: String,
        tool_use_id: Option<String>,
    },
    /// Tool result
    ToolResult {
        tool_name: String,
        output: String,
        is_error: bool,
    },
}

struct Message {
    blocks: Vec<MessageBlock>,
}

impl Default for Message {
    fn default() -> Self {
        Self { blocks: Vec::new() }
    }
}

struct TuiState {
    messages: VecDeque<Message>,
    current_message: Message,
    streaming_text: String,
    streaming_tool_call: Option<(String, String, Option<String>)>,
    is_running: bool,
    model_name: Option<String>,
    /// Last user activity timestamp (for auto-evolve)
    last_activity: Instant,
    /// Evolve configuration
    evolve_config: Option<EvolveConfig>,
    /// Whether auto-evolve has been triggered this session
    auto_evolve_triggered: bool,
}

impl TuiState {
    fn new(evolve_config: Option<EvolveConfig>) -> Self {
        Self {
            messages: VecDeque::new(),
            current_message: Message::default(),
            streaming_text: String::new(),
            streaming_tool_call: None,
            is_running: false,
            model_name: None,
            last_activity: Instant::now(),
            evolve_config,
            auto_evolve_triggered: false,
        }
    }

    fn reset_idle_timer(&mut self) {
        self.last_activity = Instant::now();
    }

    fn check_auto_evolve(&self) -> bool {
        let Some(ref config) = self.evolve_config else { return false; };
        if !config.enabled || self.auto_evolve_triggered {
            return false;
        }
        let idle_secs = self.last_activity.elapsed().as_secs();
        idle_secs >= config.auto_evolve_idle_minutes as u64 * 60
    }

    fn push_message(&mut self) {
        if !self.current_message.blocks.is_empty() {
            if self.messages.len() >= MAX_MESSAGES {
                self.messages.pop_front();
            }
            self.messages.push_back(std::mem::take(&mut self.current_message));
            self.current_message = Message::default();
        }
    }

    fn apply_event(&mut self, event: Event) {
        match (event.component, event.event_type, event.data) {
            (Component::Llm, EventType::LlmStart, EventData::Message { message }) => {
                self.model_name = Some(message.clone());
            }
            (Component::Llm, EventType::LlmChunk, EventData::LlmChunk { text }) => {
                self.streaming_text.push_str(&text);
            }
            // Tool calls push pending text, then store tool call info
            (
                Component::Llm,
                EventType::LlmToolCall,
                EventData::ToolCall {
                    tool,
                    tool_use_id,
                    input,
                    ..
                },
            ) => {
                // Push any pending text first
                if !self.streaming_text.is_empty() {
                    self.current_message.blocks.push(MessageBlock::AssistantText(std::mem::take(&mut self.streaming_text)));
                }
                let params = Self::format_tool_params(&input);
                self.streaming_tool_call = Some((tool.clone(), params, tool_use_id));
            }
            // LlmComplete with Message data: push any remaining text
            (Component::Llm, EventType::LlmComplete, EventData::Message { message }) => {
                if !self.streaming_text.is_empty() {
                    self.current_message.blocks.push(MessageBlock::AssistantText(std::mem::take(&mut self.streaming_text)));
                } else if !message.is_empty() {
                    // Fallback to message from data if streaming buffer empty
                    self.current_message.blocks.push(MessageBlock::AssistantText(message.clone()));
                }
            }
            // LlmComplete with Custom data: handle thinking_end
            (
                Component::Llm,
                EventType::LlmComplete,
                EventData::Custom(value),
            ) => {
                // Check for thinking blocks
                if let Some(kind) = value.get("kind").and_then(|v| v.as_str()) {
                    match kind {
                        "thinking_end" => {
                            if !self.streaming_text.is_empty() {
                                self.current_message.blocks.push(MessageBlock::AssistantThinking(std::mem::take(&mut self.streaming_text)));
                            }
                        }
                        _ => {}
                    }
                }
            }
            // LlmComplete with empty data: just push pending text
            (Component::Llm, EventType::LlmComplete, _) => {
                if !self.streaming_text.is_empty() {
                    self.current_message.blocks.push(MessageBlock::AssistantText(std::mem::take(&mut self.streaming_text)));
                }
            }
            // Custom events: handle thinking deltas and tool input streaming
            (
                Component::Llm,
                _,
                EventData::Custom(value),
            ) => {
                let kind = value.get("kind").and_then(|v| v.as_str()).unwrap_or_default();
                match kind {
                    "thinking_start" => {
                        self.streaming_text.clear();
                    }
                    "thinking_delta" => {
                        if let Some(delta) = value.get("delta").and_then(|v| v.as_str()) {
                            self.streaming_text.push_str(delta);
                        }
                    }
                    "tool_input_delta" => {
                        if let Some(_id) = value.get("id").and_then(|v| v.as_str()) {
                            let delta = value.get("delta").and_then(|v| v.as_str()).unwrap_or_default();
                            if let Some((_name, params, _)) = &mut self.streaming_tool_call {
                                if params.is_empty() {
                                    *params = delta.to_string();
                                } else {
                                    params.push_str(delta);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            (
                Component::Tool,
                EventType::ToolCall,
                EventData::ToolCall {
                    tool,
                    tool_use_id,
                    input,
                    ..
                },
            ) => {
                // Finalize streaming tool call if matches
                if let Some((name, params, uid)) = self.streaming_tool_call.take() {
                    if name == tool {
                        self.current_message.blocks.push(MessageBlock::ToolCall {
                            name,
                            params,
                            tool_use_id: uid.or(tool_use_id),
                        });
                    }
                } else {
                    let params = Self::format_tool_params(&input);
                    self.current_message.blocks.push(MessageBlock::ToolCall {
                        name: tool,
                        params,
                        tool_use_id,
                    });
                }
            }
            (
                Component::Tool,
                EventType::ToolProgress | EventType::ToolComplete,
                EventData::ToolProgress {
                    tool,
                    output,
                    state,
                    is_concurrency_safe: _,
                    ..
                },
            ) => {
                let is_error = state
                    .as_ref()
                    .map(|s| s.contains("error") || s.contains("failed"))
                    .unwrap_or(false);
                let display_output = if output.len() > 500 {
                    format!("{}... (truncated)", &output[..500])
                } else {
                    output
                };
                // Show abbreviated output in the same block or as result
                if let Some(last_block) = self.current_message.blocks.last_mut() {
                    if let MessageBlock::ToolCall { name, params, .. } = last_block {
                        if name == &tool {
                            // Append truncated output to params for visibility
                            if !display_output.trim().is_empty() {
                                *params = format!("{}\n→ {}", params, truncate(&display_output, 100));
                            }
                            return;
                        }
                    }
                }
                self.current_message.blocks.push(MessageBlock::ToolResult {
                    tool_name: tool,
                    output: display_output,
                    is_error,
                });
            }
            (Component::Tool, EventType::ToolError, EventData::Error { error }) => {
                self.current_message.blocks.push(MessageBlock::ToolResult {
                    tool_name: "error".to_string(),
                    output: error.clone(),
                    is_error: true,
                });
            }
            _ => {}
        }
    }

    fn format_tool_params(input: &serde_json::Value) -> String {
        match input {
            serde_json::Value::Object(map) => {
                let pairs: Vec<String> = map
                    .iter()
                    .take(5)
                    .map(|(k, v)| format!("{}={}", k, truncate(&v.to_string(), 50)))
                    .collect();
                pairs.join(", ")
            }
            _ => truncate(&input.to_string(), 100),
        }
    }
}

struct TerminalGuard;

impl TerminalGuard {
    fn enter() -> std::io::Result<Self> {
        // Enter alternate screen buffer and hide cursor
        print!("\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l");
        stdout().flush()?;
        Ok(Self)
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = write!(stdout(), "\x1b[?25h\x1b[?1049l");
        let _ = stdout().flush();
    }
}

fn truncate(s: &str, limit: usize) -> String {
    let mut chars = s.chars();
    let head: String = chars.by_ref().take(limit).collect();
    if chars.next().is_some() {
        format!("{}…", head)
    } else {
        head
    }
}

fn wrap_text(input: &str, width: usize) -> Vec<String> {
    let width = width.max(10);
    let mut lines = Vec::new();
    for raw_line in input.lines() {
        if raw_line.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut current = String::new();
        for word in raw_line.split_whitespace() {
            let candidate = if current.is_empty() {
                word.to_string()
            } else {
                format!("{} {}", current, word)
            };
            if candidate.chars().count() > width && !current.is_empty() {
                lines.push(current);
                current = word.to_string();
            } else {
                current = candidate;
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn render(state: &TuiState) -> std::io::Result<()> {
    let mut out = stdout();
    let (columns, rows) = terminal_dimensions();

    // Clear screen and move cursor to top
    write!(out, "\x1b[2J\x1b[H")?;

    // === Header ===
    let header_text = if let Some(model) = &state.model_name {
        format!("Dum-E  •  {}", model)
    } else {
        "Dum-E".to_string()
    };
    let status = if state.is_running { "● running" } else { "○ idle" };
    
    writeln!(out, "{}", style(&header_text, "bold"))?;
    writeln!(out, "{}  {}", status, style(&"─".repeat(columns.saturating_sub(20).max(1)), "dim"))?;
    writeln!(out)?;

    // === Message List ===
    let content_height = rows.saturating_sub(8).max(10);
    let visible_messages: Vec<_> = state.messages.iter().rev().take(content_height).collect();
    let has_more = state.messages.len() > visible_messages.len();

    if has_more {
        writeln!(out, "{} previous messages", style("...", "dim"))?;
    }

    for msg in visible_messages.iter().rev() {
        render_message(msg, columns, &mut out)?;
    }

    // Render current streaming message
    if !state.current_message.blocks.is_empty() || !state.streaming_text.is_empty() || state.streaming_tool_call.is_some() {
        render_current_message(state, columns, &mut out)?;
    }

    // === Input Prompt ===
    writeln!(out)?;
    writeln!(out, "{}", "─".repeat(columns.saturating_sub(2).max(1)))?;
    if state.is_running {
        writeln!(out, "{}  ", style("waiting for response...", "dim"))?;
    }
    write!(out, "{} ", style("›", "cyan"))?;
    out.flush()
}

fn render_message(msg: &Message, columns: usize, out: &mut impl Write) -> std::io::Result<()> {
    for block in &msg.blocks {
        match block {
            MessageBlock::UserText(text) => {
                writeln!(out, "{}  {}", style("●", "magenta"), style("You", "bold"))?;
                for line in wrap_text(text, columns.saturating_sub(4)) {
                    writeln!(out, "    {}", line)?;
                }
                writeln!(out)?;
            }
            MessageBlock::AssistantText(text) => {
                writeln!(out, "{}  {}", style("●", "cyan"), style("Dum-E", "bold"))?;
                for line in wrap_text(text, columns.saturating_sub(4)) {
                    writeln!(out, "    {}", line)?;
                }
                writeln!(out)?;
            }
            MessageBlock::AssistantThinking(text) => {
                // Show thinking in dim color, collapsed by default
                let preview = truncate(text, 100).replace('\n', " ");
                writeln!(out, "    {} {}", style("◦ Thinking:", "dim"), style(&preview, "dim"))?;
            }
            MessageBlock::ToolCall { name, params, .. } => {
                writeln!(out, "    {} {}({})", style("◆", "yellow"), style(name, "bold"), params)?;
            }
            MessageBlock::ToolResult { tool_name, output, is_error } => {
                let color = if *is_error { "red" } else { "green" };
                let prefix = if *is_error { "✗" } else { "✓" };
                writeln!(out, "      {} {} {}", style(prefix, color), style(tool_name, "dim"), truncate(output, columns.saturating_sub(20)))?;
            }
        }
    }
    Ok(())
}

fn render_current_message(state: &TuiState, columns: usize, out: &mut impl Write) -> std::io::Result<()> {
    let msg = &state.current_message;
    
    for block in &msg.blocks {
        match block {
            MessageBlock::AssistantText(text) => {
                writeln!(out, "{}  {}", style("●", "cyan"), style("Dum-E", "bold"))?;
                for line in wrap_text(text, columns.saturating_sub(4)) {
                    writeln!(out, "    {}", line)?;
                }
            }
            MessageBlock::ToolCall { name, params, .. } => {
                writeln!(out, "    {} {}({})", style("◆", "yellow"), style(name, "bold"), params)?;
            }
            MessageBlock::ToolResult { tool_name, output, is_error } => {
                let color = if *is_error { "red" } else { "green" };
                let prefix = if *is_error { "✗" } else { "✓" };
                writeln!(out, "      {} {} {}", style(prefix, color), style(tool_name, "dim"), truncate(output, columns.saturating_sub(20)))?;
            }
            _ => {}
        }
    }

    // Show streaming text
    if !state.streaming_text.is_empty() {
        // Check if we have pending thinking
        if let Some((name, _, _)) = &state.streaming_tool_call {
            if name == "thinking" || name == "extended_thinking" {
                writeln!(out, "    {} {}", style("◦", "dim"), style(&truncate(&state.streaming_text, 100), "dim"))?;
            }
        } else {
            // Regular streaming text
            if msg.blocks.is_empty() {
                writeln!(out, "{}  {}", style("●", "cyan"), style("Dum-E", "bold"))?;
            }
            let cursor = style("▊", "cyan").to_string();
            writeln!(out, "    {}{}", truncate(&state.streaming_text, columns.saturating_sub(10)), cursor)?;
        }
    }

    // Show streaming tool call
    if let Some((name, params, _)) = &state.streaming_tool_call {
        if name != "thinking" && name != "extended_thinking" {
            writeln!(out, "    {} {}({}) {}", style("◆", "yellow"), style(name, "bold"), params, style("…", "dim"))?;
        }
    }

    writeln!(out)?;
    Ok(())
}

fn style<'a>(text: &'a str, _style: &'a str) -> impl std::fmt::Display + 'a {
    ColoredText { text, style: _style }
}

struct ColoredText<'a> {
    text: &'a str,
    style: &'a str,
}

impl std::fmt::Display for ColoredText<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.style {
            "bold" => write!(f, "\x1b[1m{}\x1b[0m", self.text),
            "dim" => write!(f, "\x1b[2m{}\x1b[0m", self.text),
            "cyan" => write!(f, "\x1b[36m{}\x1b[0m", self.text),
            "magenta" => write!(f, "\x1b[35m{}\x1b[0m", self.text),
            "yellow" => write!(f, "\x1b[33m{}\x1b[0m", self.text),
            "green" => write!(f, "\x1b[32m{}\x1b[0m", self.text),
            "red" => write!(f, "\x1b[31m{}\x1b[0m", self.text),
            _ => write!(f, "{}", self.text),
        }
    }
}

fn terminal_dimensions() -> (usize, usize) {
    let columns = std::env::var("COLUMNS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value >= 40)
        .unwrap_or(DEFAULT_COLUMNS);
    let rows = std::env::var("LINES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value >= 10)
        .unwrap_or(24);
    (columns, rows)
}

pub async fn run_tui(agent: Agent) -> Result<(), Box<dyn std::error::Error>> {
    std::env::set_var("DUME_SUPPRESS_DEV_EVENT_STDERR", "1");
    let _terminal = TerminalGuard::enter()?;
    let event_bus = get_event_bus().ok_or("event bus not initialized")?;
    let mut events = event_bus.subscribe();
    let agent = Arc::new(Mutex::new(agent));
    let (result_tx, mut result_rx) = mpsc::unbounded_channel::<Result<AgentResult, String>>();

    // Extract evolve config from agent (passed through a method we'll add)
    // For now, read from config file
    let evolve_config = crate::Config::load()
        .ok()
        .map(|c| c.evolve());

    let mut state = TuiState::new(evolve_config);
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    render(&state)?;

    // Periodic ticker for idle check (every 30 seconds)
    let mut idle_checker = interval(Duration::from_secs(30));

    loop {
        tokio::select! {
            // Periodic idle check (every 30 seconds)
            _ = idle_checker.tick(), if !state.is_running => {
                if state.check_auto_evolve() && !state.auto_evolve_triggered {
                    state.auto_evolve_triggered = true;
                    let input = "evolve_self".to_string();
                    state.messages.push_back(Message {
                        blocks: vec![MessageBlock::UserText(
                            "[AUTO] Triggering self-evolution after idle timeout".to_string()
                        )],
                    });
                    state.is_running = true;
                    render(&state)?;

                    let agent = Arc::clone(&agent);
                    let result_tx = result_tx.clone();
                    tokio::spawn(async move {
                        let mut guard = agent.lock().await;
                        let result = guard.run(&input).await;
                        let _ = result_tx.send(result);
                    });
                }
            }
            maybe_event = events.recv() => {
                if let Some(event) = maybe_event {
                    state.apply_event(event);
                    render(&state)?;
                }
            }
            maybe_result = result_rx.recv() => {
                if let Some(result) = maybe_result {
                    state.push_message(); // Finalize any pending message
                    state.is_running = false;
                    match result {
                        Ok(agent_result) => {
                            // Push the final response
                            state.current_message.blocks.push(MessageBlock::AssistantText(
                                if agent_result.success {
                                    format!("✓ Completed in {} step(s)", agent_result.steps)
                                } else {
                                    format!("✗ Task ended in {} step(s)", agent_result.steps)
                                }
                            ));
                            state.push_message();
                        }
                        Err(error) => {
                            state.current_message.blocks.push(MessageBlock::AssistantText(format!("Error: {}", error)));
                            state.push_message();
                        }
                    }
                    render(&state)?;
                }
            }
            maybe_line = lines.next_line(), if !state.is_running => {
                let line = maybe_line?;
                let Some(line) = line else { break; };
                let input = line.trim().to_string();
                if input.is_empty() {
                    continue;
                }
                if input == "exit" || input == "quit" {
                    break;
                }

                // Reset idle timer on user activity
                state.reset_idle_timer();

                // Add user message
                state.messages.push_back(Message {
                    blocks: vec![MessageBlock::UserText(input.clone())],
                });
                state.is_running = true;
                render(&state)?;

                let agent = Arc::clone(&agent);
                let result_tx = result_tx.clone();
                let task = input;
                tokio::spawn(async move {
                    let mut guard = agent.lock().await;
                    let result = guard.run(&task).await;
                    let _ = result_tx.send(result);
                });
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::observability::{Event, EventData, EventType, TraceId};

    #[test]
    fn state_tracks_messages_and_tool_calls() {
        let mut state = TuiState::new(None);
        
        // First event: LLM generates some text
        state.apply_event(Event::new_in_trace(
            TraceId::from_str("trace-1"),
            Component::Llm,
            EventType::LlmChunk,
            EventData::LlmChunk {
                text: "I'll help you".to_string(),
            },
        ));
        assert_eq!(state.streaming_text, "I'll help you", "streaming_text should be set after LlmChunk");
        
        // Second event: LLM calls a tool
        state.apply_event(Event::new_in_trace(
            TraceId::from_str("trace-1"),
            Component::Llm,
            EventType::LlmToolCall,
            EventData::ToolCall {
                tool: "bash".to_string(),
                tool_use_id: Some("tool-1".to_string()),
                input: serde_json::json!({"command": "ls"}),
                correlation_id: None,
                is_concurrency_safe: None,
            },
        ));
        
        // Third event: Tool execution starts (this adds the ToolCall to blocks)
        state.apply_event(Event::new_in_trace(
            TraceId::from_str("trace-1"),
            Component::Tool,
            EventType::ToolCall,
            EventData::ToolCall {
                tool: "bash".to_string(),
                tool_use_id: Some("tool-1".to_string()),
                input: serde_json::json!({"command": "ls"}),
                correlation_id: None,
                is_concurrency_safe: None,
            },
        ));
        
        // Fourth event: Tool completes
        state.apply_event(Event::new_in_trace(
            TraceId::from_str("trace-1"),
            Component::Tool,
            EventType::ToolComplete,
            EventData::ToolProgress {
                tool: "bash".to_string(),
                output: "file1.txt\nfile2.txt".to_string(),
                tool_use_id: Some("tool-1".to_string()),
                correlation_id: None,
                state: Some("completed".to_string()),
                is_concurrency_safe: Some(false),
            },
        ));
        
        // Check that tool call was rendered inline with result
        let msg = &state.current_message;
        // After LlmToolCall: text is pushed, then tool call is stored in streaming_tool_call
        // After ToolCall (Component::Tool): the tool call is added to blocks
        // After ToolComplete: the tool result is added
        // So we should have: [AssistantText("I'll help you"), ToolCall(bash), ToolResult(bash)]
        assert!(msg.blocks.len() >= 2, "Should have at least 2 blocks");
        let has_assistant_text = msg.blocks.iter().any(|b| matches!(b, MessageBlock::AssistantText(_)));
        let has_tool_call = msg.blocks.iter().any(|b| matches!(b, MessageBlock::ToolCall { name, .. } if name == "bash"));
        assert!(has_assistant_text, "Should have assistant text from LlmChunk");
        assert!(has_tool_call, "Should have a bash tool call");
    }
}

