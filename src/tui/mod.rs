//! CLI-first TUI for Dum-E.
//!
//! This is intentionally dependency-light and ANSI-driven so we can ship a
//! useful streaming terminal UI without introducing a full TUI dependency yet.

use crate::agent::AgentResult;
use crate::get_event_bus;
use crate::observability::{Component, Event, EventData, EventType};
use crate::Agent;
use std::collections::BTreeMap;
use std::io::{stdout, Write};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, Mutex};

const MAX_TOOL_LINES: usize = 8;
const DEFAULT_COLUMNS: usize = 100;
const DEFAULT_ROWS: usize = 32;

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
    summary: String,
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
            summary: "ready".to_string(),
            thinking: String::new(),
            transcript: String::new(),
            tools: BTreeMap::new(),
        }
    }

    fn set_summary(&mut self, line: impl Into<String>) {
        self.summary = line.into();
    }

    fn begin_task(&mut self, task: &str) {
        self.status = "running".to_string();
        self.current_task = Some(task.to_string());
        self.thinking.clear();
        self.transcript.clear();
        self.tools.clear();
        self.set_summary(format!("▶ {}", task));
    }

    fn complete_task(&mut self, result: &AgentResult) {
        self.status = "idle".to_string();
        self.current_task = None;
        self.set_summary(format!("✓ completed in {} step(s)", result.steps));
    }

    fn fail_task(&mut self, error: &str) {
        self.status = "idle".to_string();
        self.current_task = None;
        self.set_summary(format!("✗ {}", error));
    }

    fn apply_event(&mut self, event: Event) {
        match (event.component, event.event_type, event.data) {
            (Component::Agent, EventType::AgentStart, EventData::Message { message }) => {
                self.set_summary(message);
            }
            (Component::Agent, EventType::AgentStep, EventData::Message { message }) => {
                self.set_summary(message);
            }
            (Component::Agent, EventType::AgentComplete, EventData::Message { message }) => {
                self.set_summary(message);
            }
            (Component::Agent, EventType::AgentError, EventData::Error { error }) => {
                self.set_summary(format!("agent error: {}", error));
            }
            (Component::Llm, EventType::LlmStart, EventData::Message { message }) => {
                self.set_summary(message);
            }
            (Component::Llm, EventType::LlmChunk, EventData::LlmChunk { text }) => {
                self.transcript.push_str(&text);
            }
            (Component::Llm, EventType::LlmComplete, EventData::Message { message }) => {
                self.set_summary(message);
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
                self.set_summary(format!("tool error: {}", error));
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
                self.set_summary("voice speak start");
            }
            (Component::Voice, EventType::VoiceSpeakComplete, _) => {
                self.set_summary("voice speak complete");
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
    let (columns, rows) = terminal_dimensions();
    let divider = "─".repeat(columns.saturating_sub(2).max(10));
    let thinking_rows = rows.clamp(24, 50) / 5;
    let tools_rows = rows.clamp(24, 50) / 4;
    let transcript_rows = rows.saturating_sub(thinking_rows + tools_rows + 12).max(6);

    write!(out, "\x1b[2J\x1b[H")?;

    writeln!(
        out,
        "╭{}╮",
        "─".repeat(columns.saturating_sub(2).max(10))
    )?;
    writeln!(
        out,
        "│ {:<width$}│",
        format!(
            "Dum-E CLI TUI  {}  {}",
            status_badge(&state.status),
            truncate(&state.summary, columns.saturating_sub(28))
        ),
        width = columns.saturating_sub(3).max(10)
    )?;
    writeln!(
        out,
        "│ {:<width$}│",
        format!(
            "mode: {}   task: {}",
            state.mode,
            state.current_task.as_deref().unwrap_or("(idle)")
        ),
        width = columns.saturating_sub(3).max(10)
    )?;
    writeln!(out, "╰{}╯", "─".repeat(columns.saturating_sub(2).max(10)))?;
    writeln!(out)?;

    render_section(
        &mut out,
        "Thinking",
        &tail_wrapped(
            if state.thinking.is_empty() {
                "(none)"
            } else {
                state.thinking.as_str()
            },
            columns,
            thinking_rows.max(4),
        ),
        &divider,
    )?;

    let tool_lines = if state.tools.is_empty() {
        vec!["(no tool activity)".to_string()]
    } else {
        state
            .tools
            .iter()
            .take(MAX_TOOL_LINES)
            .flat_map(|(tool_id, view)| {
                let mut lines = vec![format!(
                    "{} {}",
                    tool_state_badge(&view.state),
                    truncate(&format!("{} [{}]", tool_id, view.state), columns.saturating_sub(6))
                )];
                if !view.detail.is_empty() {
                    lines.extend(
                        tail_wrapped(&view.detail, columns.saturating_sub(2), 2)
                            .into_iter()
                            .map(|line| format!("  {}", line)),
                    );
                }
                lines
            })
            .collect::<Vec<_>>()
    };
    render_section(&mut out, "Tools", &tool_lines, &divider)?;

    render_section(
        &mut out,
        "Transcript",
        &tail_wrapped(
            if state.transcript.is_empty() {
                "(no assistant output yet)"
            } else {
                state.transcript.as_str()
            },
            columns,
            transcript_rows,
        ),
        &divider,
    )?;

    writeln!(
        out,
        "{}",
        dim("Type a task and press Enter. Type `exit` to quit. Use --plain-repl for legacy mode.")
    )?;
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

fn terminal_dimensions() -> (usize, usize) {
    let columns = std::env::var("COLUMNS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value >= 40)
        .unwrap_or(DEFAULT_COLUMNS);
    let rows = std::env::var("LINES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value >= 20)
        .unwrap_or(DEFAULT_ROWS);
    (columns, rows)
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

fn tail_wrapped(input: &str, width: usize, max_lines: usize) -> Vec<String> {
    let wrapped = wrap_text(input, width.saturating_sub(2));
    let start = wrapped.len().saturating_sub(max_lines);
    wrapped[start..].to_vec()
}

fn render_section(
    out: &mut impl Write,
    title: &str,
    lines: &[String],
    divider: &str,
) -> std::io::Result<()> {
    writeln!(out, "{} {}", accent("■"), title)?;
    for line in lines {
        writeln!(out, "{}", line)?;
    }
    writeln!(out, "{}", divider)?;
    Ok(())
}

fn accent(text: &str) -> String {
    format!("\x1b[36m{}\x1b[0m", text)
}

fn dim(text: &str) -> String {
    format!("\x1b[2m{}\x1b[0m", text)
}

fn status_badge(status: &str) -> String {
    match status {
        "running" => "\x1b[33m● running\x1b[0m".to_string(),
        "idle" => "\x1b[32m● idle\x1b[0m".to_string(),
        other => format!("● {}", other),
    }
}

fn tool_state_badge(state: &str) -> String {
    if state.contains("error") {
        "\x1b[31m●\x1b[0m".to_string()
    } else if state.contains("completed") {
        "\x1b[32m●\x1b[0m".to_string()
    } else if state.contains("queued") || state.contains("executing") || state.contains("building") {
        "\x1b[33m●\x1b[0m".to_string()
    } else {
        "•".to_string()
    }
}

pub async fn run_tui(agent: Agent) -> Result<(), Box<dyn std::error::Error>> {
    std::env::set_var("DUME_SUPPRESS_DEV_EVENT_STDERR", "1");
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
