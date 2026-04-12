//! Event Bus - core observability infrastructure
//!
//! Based on Harness Engineering principle: **Observable** — every action emits structured events
//!
//! Dual-mode storage:
//! - **dev mode**: writes all events to `~/.dum-e/traces/{session}/{trace_id}.jsonl`
//! - **prod mode**: no persistence, events only in memory

mod event;
mod storage;

pub use event::{SpanId, TraceId};
pub use storage::EventStorage;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::PathBuf;
use tokio::sync::mpsc;
use tracing::warn;
use uuid::Uuid;

/// Event component types
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Component {
    Agent,
    Llm,
    Tool,
    Memory,
    Soul,
    Voice,
}

/// Event type enumeration
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    // Agent events
    AgentStart,
    AgentStep,
    AgentComplete,
    AgentError,

    // LLM events
    LlmStart,
    LlmChunk,
    LlmComplete,
    LlmToolCall,

    // Tool events
    ToolCall,
    ToolProgress,
    ToolComplete,
    ToolError,

    // Memory events
    MemorySearch,
    MemoryStore,
    MemoryCompact,

    // Voice events
    VoiceSpeakStart,
    VoiceSpeakChunk,
    VoiceSpeakComplete,
    VoiceListenStart,
    VoiceListenComplete,
    VoiceInterrupt,

    // User events
    UserInterrupt,
    UserInput,
}

/// Event structure following Harness schema
#[derive(Clone, Debug, Serialize)]
pub struct Event {
    pub trace_id: TraceId,
    pub span_id: SpanId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_span_id: Option<SpanId>,
    pub timestamp: DateTime<Utc>,
    pub component: Component,
    pub event_type: EventType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub data: EventData,
}

impl Event {
    /// Create a new event with generated IDs
    pub fn new(component: Component, event_type: EventType, data: EventData) -> Self {
        Self {
            trace_id: TraceId::new(),
            span_id: SpanId::new(),
            parent_span_id: None,
            timestamp: Utc::now(),
            component,
            event_type,
            duration_ms: None,
            data,
        }
    }

    /// Create a new event within an existing trace.
    pub fn new_in_trace(
        trace_id: TraceId,
        component: Component,
        event_type: EventType,
        data: EventData,
    ) -> Self {
        Self {
            trace_id,
            span_id: SpanId::new(),
            parent_span_id: None,
            timestamp: Utc::now(),
            component,
            event_type,
            duration_ms: None,
            data,
        }
    }

    /// Create with parent span
    pub fn with_parent(
        component: Component,
        event_type: EventType,
        data: EventData,
        parent: &Event,
    ) -> Self {
        Self {
            trace_id: parent.trace_id.clone(),
            span_id: SpanId::new(),
            parent_span_id: Some(parent.span_id.clone()),
            timestamp: Utc::now(),
            component,
            event_type,
            duration_ms: None,
            data,
        }
    }

    /// Set duration from a start time
    pub fn with_duration(mut self, start: DateTime<Utc>) -> Self {
        self.duration_ms = Some((self.timestamp - start).num_milliseconds() as u64);
        self
    }
}

/// Event data payload
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum EventData {
    Empty,
    Message {
        message: String,
    },
    Error {
        error: String,
    },
    ToolCall {
        tool: String,
        input: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_use_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        correlation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_concurrency_safe: Option<bool>,
    },
    ToolProgress {
        tool: String,
        #[serde(skip_serializing_if = "String::is_empty")]
        output: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_use_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        correlation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        state: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_concurrency_safe: Option<bool>,
    },
    LlmChunk {
        text: String,
    },
    VoiceChunk {
        audio_size: usize,
    },
    Custom(serde_json::Value),
}

/// Event bus for publishing and subscribing to events
pub struct EventBus {
    dev_mode: bool,
    storage: EventStorage,
    subscribers: RwLock<Vec<mpsc::Sender<Event>>>,
    session_id: String,
    traces_dir: PathBuf,
}

impl EventBus {
    /// Create a new event bus
    pub fn new(dev_mode: bool) -> Self {
        Self::with_traces_dir(dev_mode, None)
    }

    /// Create a new event bus with optional custom traces directory
    pub fn with_traces_dir(dev_mode: bool, traces_dir: Option<PathBuf>) -> Self {
        let traces_dir = traces_dir
            .map(expand_tilde_path)
            .unwrap_or_else(default_traces_dir);
        let traces_dir = if dev_mode {
            ensure_writable_traces_dir(traces_dir)
        } else {
            traces_dir
        };

        Self {
            dev_mode,
            storage: EventStorage::new(dev_mode, traces_dir.clone()),
            subscribers: RwLock::new(Vec::new()),
            session_id: Uuid::new_v4().to_string()[..8].to_string(),
            traces_dir,
        }
    }

    /// Get session ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Publish an event
    pub fn publish(&self, event: Event) {
        // Store if in dev mode
        if self.dev_mode {
            let trace_file = self
                .traces_dir
                .join(&self.session_id)
                .join(format!("{}.jsonl", event.trace_id));
            self.storage.store(&event, &trace_file);

            if let Ok(line) = serde_json::to_string(&event) {
                eprintln!("[DEV_EVENT] {}", line);
            } else {
                eprintln!(
                    "[DEV_EVENT] component={:?} type={:?}",
                    event.component, event.event_type
                );
            }
        }

        // Notify subscribers
        for sender in self.subscribers.read().iter() {
            let _ = sender.try_send(event.clone());
        }
    }

    /// Subscribe to events
    pub fn subscribe(&self) -> mpsc::Receiver<Event> {
        let (tx, rx) = mpsc::channel(1000);
        self.subscribers.write().push(tx);
        rx
    }

    /// Create a span for tracing
    pub fn span(
        &self,
        component: Component,
        event_type: EventType,
        data: EventData,
    ) -> SpanGuard<'_> {
        let event = Event::new(component, event_type, data);
        self.publish(event.clone());
        SpanGuard {
            event_bus: self,
            event,
            start: chrono::Utc::now(),
        }
    }

    /// Check if dev mode is enabled
    pub fn is_dev_mode(&self) -> bool {
        self.dev_mode
    }
}

fn default_traces_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".dum-e")
        .join("traces")
}

fn expand_tilde_path(path: PathBuf) -> PathBuf {
    let Some(raw) = path.to_str() else {
        return path;
    };
    if raw == "~" {
        return dirs::home_dir().unwrap_or(path);
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    path
}

fn ensure_writable_traces_dir(path: PathBuf) -> PathBuf {
    if fs::create_dir_all(&path).is_ok() && can_write_to_dir(&path) {
        return path;
    }

    let fallback = std::env::temp_dir().join("dum-e").join("traces");
    if fs::create_dir_all(&fallback).is_ok() && can_write_to_dir(&fallback) {
        warn!(
            preferred = %path.display(),
            fallback = %fallback.display(),
            "Preferred traces_dir is not writable, using temp directory fallback"
        );
        return fallback;
    }

    path
}

fn can_write_to_dir(dir: &PathBuf) -> bool {
    let probe = dir.join(format!(".trace-write-probe-{}", Uuid::new_v4()));
    match OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(probe);
            true
        }
        Err(_) => false,
    }
}

/// Guard that automatically records duration when dropped
pub struct SpanGuard<'a> {
    event_bus: &'a EventBus,
    event: Event,
    start: DateTime<Utc>,
}

impl<'a> SpanGuard<'a> {
    /// Add child data to the span
    pub fn event(&self, event_type: EventType, data: EventData) {
        let child = Event::with_parent(self.event.component, event_type, data, &self.event);
        self.event_bus.publish(child);
    }
}

impl Drop for SpanGuard<'_> {
    fn drop(&mut self) {
        let event = self.event.clone().with_duration(self.start);
        self.event_bus.publish(event);
    }
}

// Need dirs crate
mod dirs {
    use std::path::PathBuf;

    pub fn home_dir() -> Option<PathBuf> {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var("USERPROFILE").map(PathBuf::from).ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_creation() {
        let event = Event::new(
            Component::Agent,
            EventType::AgentStart,
            EventData::Message {
                message: "test".to_string(),
            },
        );
        assert!(!event.trace_id.is_empty());
        assert!(!event.span_id.is_empty());
    }

    #[tokio::test]
    async fn test_event_bus_dev_mode() {
        let bus = EventBus::new(true);
        let span = bus.span(Component::Agent, EventType::AgentStart, EventData::Empty);
        drop(span); // Should record duration

        let mut rx = bus.subscribe();
        let event = Event::new(
            Component::Llm,
            EventType::LlmChunk,
            EventData::LlmChunk {
                text: "hello".to_string(),
            },
        );
        bus.publish(event);

        let received = rx.recv().await.unwrap();
        assert_eq!(received.component, Component::Llm);
    }

    #[test]
    fn test_tool_progress_serialization_with_correlation_fields() {
        let data = EventData::ToolProgress {
            tool: "bash".to_string(),
            output: "queued".to_string(),
            tool_use_id: Some("toolu_123".to_string()),
            correlation_id: Some("toolu_123".to_string()),
            state: Some("queued".to_string()),
            is_concurrency_safe: Some(false),
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"tool_use_id\":\"toolu_123\""));
        assert!(json.contains("\"correlation_id\":\"toolu_123\""));
        assert!(json.contains("\"state\":\"queued\""));
    }
}
