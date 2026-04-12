//! CLI-first TUI for Dum-E.
//!
//! This is intentionally dependency-light and ANSI-driven so we can ship a
//! useful streaming terminal UI without introducing a full TUI dependency yet.

use crate::agent::AgentResult;
use crate::get_event_bus;
use crate::observability::{Component, Event, EventData, EventType};
use crate::Agent;
use std::collections::{BTreeMap, VecDeque};
use std::io::{stdout, Write};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, Mutex};

const MAX_LOG_LINES: usize = 18;
const MAX_TOOL_LINES: usize = 8;

#[derive(Default)]
struct ToolView {
    state: String,
    detail: String,
}

#[derive(Default)]
struct TuiState {
    mode: String,
    status: String,
    current_task: Option<String>,
    logs: VecDeque<String>,
    thinking: String,
    transcript: String,
    tools: BTreeMap<String, ToolView>,
}

impl TuiState {
    fn new() -> Self {
        Self {
            mode: "TUI".to_string(),
            status: "idle".to_string(),
            current_task: None,
            logs: VecDeque::new(),
            thinking: String::new(),
            transcript: String::new(),
            tools: BTreeMap::new(),
        }
    }

    fn push_log(&mut self, line: impl Into<String>) {
        self.logs.push_back(line.into());
        while self.logs.len() > MAX_LOG_LINES {
            self.logs.pop_front();
        }
    }

    fn begin_task(&mut self, task: &str) {
        self.status = "running".to_string();
        self.current_task = Some(task.to_string());
        self.thinking.clear();
        self.transcript.clear();
        self.tools.clear();
        self.push_log(format!("▶ {}", task));
    }

    fn complete_task(&mut self, result: &AgentResult) {
        self.status = "idle".to_string();
        self.current_task = None;
        self.push_log(format!("✓ completed in {} step(s)", result.steps));
    }

    fn fail_task(&mut self, error: &str) {
        self.status = "idle".to_string();
        self.current_task = None;
        self.push_log(format!("✗ {}", error));
    }

    fn apply_event(&mut self, event: Event) {
        match (event.component, event.event_type, event.data) {
            (Component::Agent, EventType::AgentStart, EventData::Message { message }) => {
                self.push_log(message);
            }
            (Component::Agent, EventType::AgentStep, EventData::Message { message }) => {
                self.push_log(message);
            }
            (Component::Agent, EventType::AgentComplete, EventData::Message { message }) => {
                self.push_log(message);
            }
            (Component::Agent, EventType::AgentError, EventData::Error { error }) => {
                self.push_log(format!("agent error: {}", error));
            }
            (Component::Llm, EventType::LlmStart, EventData::Message { message }) => {
                self.push_log(message);
            }
            (Component::Llm, EventType::LlmChunk, EventData::LlmChunk { text }) => {
                self.transcript.push_str(&text);
            }
            (Component::Llm, EventType::LlmComplete, EventData::Message { message }) => {
                self.push_log(message);
            }
            (
                Component::Llm,
                EventType::LlmToolCall,
                EventData::ToolCall {
                    tool, tool_use_id, ..
                },
            ) => {
                let key = tool_use_id.unwrap_or(tool.clone());
                self.tools.entry(key).or_default().state = format!("llm→{}", tool);
            }
            (
                Component::Tool,
                EventType::ToolCall,
                EventData::ToolCall {
                    tool, tool_use_id, ..
                },
            ) => {
                let key = tool_use_id.unwrap_or(tool.clone());
                let view = self.tools.entry(key).or_default();
                view.state = format!("queued: {}", tool);
            }
            (
                Component::Tool,
                EventType::ToolProgress | EventType::ToolComplete,
                EventData::ToolProgress {
                    tool,
                    output,
                    tool_use_id,
                    state,
                    ..
                },
            ) => {
                let key = tool_use_id.unwrap_or(tool.clone());
                let view = self.tools.entry(key).or_default();
                view.state = state.unwrap_or_else(|| tool.clone());
                view.detail = output;
            }
            (Component::Tool, EventType::ToolError, EventData::Error { error }) => {
                self.push_log(format!("tool error: {}", error));
            }
            (Component::Llm, _, EventData::Custom(value)) => {
                let kind = value
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                match kind {
                    "thinking_start" => {
                        self.thinking.clear();
                    }
                    "thinking_delta" => {
                        if let Some(delta) = value.get("delta").and_then(|v| v.as_str()) {
                            self.thinking.push_str(delta);
                        }
                    }
                    "thinking_end" => {}
                    "tool_input_delta" => {
                        if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
                            let detail = value
                                .get("delta")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let view = self.tools.entry(id.to_string()).or_default();
                            if view.state.is_empty() {
                                view.state = "building-input".to_string();
                            }
                            view.detail.push_str(&detail);
                        }
                    }
                    _ => {}
                }
            }
            (Component::Voice, EventType::VoiceSpeakStart, _) => {
                self.push_log("voice speak start");
            }
            (Component::Voice, EventType::VoiceSpeakComplete, _) => {
                self.push_log("voice speak complete");
            }
            _ => {}
        }
    }
}

struct TerminalGuard;

impl TerminalGuard {
    fn enter() -> std::io::Result<Self> {
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

fn render(state: &TuiState) -> std::io::Result<()> {
    let mut out = stdout();
    write!(out, "\x1b[2J\x1b[H")?;

    writeln!(out, "Dum-E CLI TUI")?;
    writeln!(out, "mode: {} | status: {}", state.mode, state.status)?;
    writeln!(
        out,
        "task: {}",
        state.current_task.as_deref().unwrap_or("(idle)")
    )?;
    writeln!(out, "{}", "─".repeat(80))?;

    writeln!(out, "Thinking:")?;
    writeln!(
        out,
        "{}",
        if state.thinking.is_empty() {
            "(none)"
        } else {
            state.thinking.as_str()
        }
    )?;
    writeln!(out, "{}", "─".repeat(80))?;

    writeln!(out, "Transcript:")?;
    writeln!(
        out,
        "{}",
        if state.transcript.is_empty() {
            "(no assistant output yet)"
        } else {
            state.transcript.as_str()
        }
    )?;
    writeln!(out, "{}", "─".repeat(80))?;

    writeln!(out, "Tools:")?;
    if state.tools.is_empty() {
        writeln!(out, "(no tool activity)")?;
    } else {
        for (tool_id, view) in state.tools.iter().take(MAX_TOOL_LINES) {
            writeln!(out, "- {} [{}]", tool_id, view.state)?;
            if !view.detail.is_empty() {
                writeln!(out, "  {}", truncate(&view.detail, 120))?;
            }
        }
    }
    writeln!(out, "{}", "─".repeat(80))?;

    writeln!(out, "Log:")?;
    for line in &state.logs {
        writeln!(out, "{}", line)?;
    }
    writeln!(out, "{}", "─".repeat(80))?;
    writeln!(out, "Input a task and press Enter. Type `exit` to quit.")?;
    out.flush()
}

fn truncate(input: &str, limit: usize) -> String {
    let mut chars = input.chars();
    let head: String = chars.by_ref().take(limit).collect();
    if chars.next().is_some() {
        format!("{}...", head)
    } else {
        head
    }
}

pub async fn run_tui(agent: Agent) -> Result<(), Box<dyn std::error::Error>> {
    let _terminal = TerminalGuard::enter()?;
    let event_bus = get_event_bus().ok_or("event bus not initialized")?;
    let mut events = event_bus.subscribe();
    let agent = Arc::new(Mutex::new(agent));
    let (result_tx, mut result_rx) = mpsc::unbounded_channel::<Result<AgentResult, String>>();
    let mut state = TuiState::new();
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();
    let mut running = false;

    render(&state)?;

    loop {
        tokio::select! {
            maybe_event = events.recv() => {
                if let Some(event) = maybe_event {
                    state.apply_event(event);
                    render(&state)?;
                }
            }
            maybe_result = result_rx.recv() => {
                if let Some(result) = maybe_result {
                    match result {
                        Ok(agent_result) => state.complete_task(&agent_result),
                        Err(error) => state.fail_task(&error),
                    }
                    running = false;
                    render(&state)?;
                }
            }
            maybe_line = lines.next_line(), if !running => {
                let line = maybe_line?;
                let Some(line) = line else { break; };
                let input = line.trim();
                if input.is_empty() {
                    continue;
                }
                if input.eq_ignore_ascii_case("exit") || input.eq_ignore_ascii_case("quit") {
                    break;
                }

                state.begin_task(input);
                render(&state)?;
                running = true;

                let agent = Arc::clone(&agent);
                let result_tx = result_tx.clone();
                let task = input.to_string();
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
    fn state_tracks_tool_lifecycle_and_thinking() {
        let mut state = TuiState::new();
        state.apply_event(Event::new_in_trace(
            TraceId::from_str("trace-1"),
            Component::Llm,
            EventType::LlmChunk,
            EventData::LlmChunk {
                text: "hello".to_string(),
            },
        ));
        state.apply_event(Event::new_in_trace(
            TraceId::from_str("trace-1"),
            Component::Tool,
            EventType::ToolProgress,
            EventData::ToolProgress {
                tool: "bash".to_string(),
                output: "done".to_string(),
                tool_use_id: Some("tool-1".to_string()),
                correlation_id: Some("tool-1".to_string()),
                state: Some("completed".to_string()),
                is_concurrency_safe: Some(false),
            },
        ));
        state.apply_event(Event::new_in_trace(
            TraceId::from_str("trace-1"),
            Component::Llm,
            EventType::LlmChunk,
            EventData::Custom(serde_json::json!({
                "kind": "thinking_delta",
                "delta": "ponder"
            })),
        ));

        assert_eq!(state.transcript, "hello");
        assert_eq!(state.thinking, "ponder");
        assert_eq!(state.tools.get("tool-1").unwrap().state, "completed");
    }
}
