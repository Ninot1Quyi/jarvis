//! Dum-E: AI-native coding agent with comprehensive observability
//!
//! Core principles:
//! - **Harness Engineering from Day 1** — build observability alongside features
//! - **SOUL.md** — self-evolving personality manifest
//! - **Streaming-first** — tools execute as LLM generates them
//! - **Voice-native** — MiniMax TTS/ASR as first-class I/O channel

pub mod agent;
pub mod compaction;
pub mod config;
pub mod core;
pub mod harness;
pub mod llm;
pub mod memory;
pub mod message;
pub mod observability;
pub mod permissions;
pub mod soul;
pub mod tools;
pub mod voice;

// Re-exports for convenience
pub use agent::Agent;
pub use config::Config;
pub use observability::{Event, EventBus};
pub use soul::SoulManager;
pub use voice::{VoiceDialogue, VoiceProvider};

use once_cell::sync::OnceCell;
use std::path::PathBuf;
use std::sync::Arc;

/// Global event bus instance
static EVENT_BUS: OnceCell<Arc<EventBus>> = OnceCell::new();

/// Initialize the global event bus
pub fn init_event_bus(dev_mode: bool) -> Arc<EventBus> {
    init_event_bus_with_traces_dir(dev_mode, None)
}

/// Initialize the global event bus with optional custom traces directory
pub fn init_event_bus_with_traces_dir(
    dev_mode: bool,
    traces_dir: Option<PathBuf>,
) -> Arc<EventBus> {
    EVENT_BUS
        .get_or_init(|| Arc::new(EventBus::with_traces_dir(dev_mode, traces_dir)))
        .clone()
}

/// Get the global event bus
pub fn get_event_bus() -> Option<Arc<EventBus>> {
    EVENT_BUS.get().cloned()
}
