//! Agent state management

/// Agent state machine states
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentState {
    Idle,
    Observing,
    Thinking,
    Acting,
    WaitingForPermission,
    Completed,
    Error,
}

impl Default for AgentState {
    fn default() -> Self {
        Self::Idle
    }
}
