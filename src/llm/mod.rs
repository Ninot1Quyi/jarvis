//! LLM provider trait definition and implementations

mod minimax;
mod parse_tool_calls;
pub mod sse;
mod streaming;

pub use minimax::MiniMaxLLM;
pub use parse_tool_calls::parse_tool_calls_from_text;
pub use streaming::StreamingToolExecutor;

use crate::message::Message;
use async_trait::async_trait;
use futures::Stream;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

/// Chat message
#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Chat completion result
#[derive(Debug)]
pub struct ChatCompletion {
    pub message: String,
    pub tool_calls: Vec<ToolCall>,
    /// Full content blocks from the response (including tool_use blocks)
    /// This is needed to pass back to MiniMax for multi-turn tool calls
    pub content_blocks: Option<serde_json::Value>,
}

/// A tool call from LLM
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

/// Tool definition for LLM
#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Streaming chunk from LLM
#[derive(Debug)]
pub enum ChatChunk {
    /// Text chunk received
    Text(String),
    /// A complete tool_use block received (with id, name, and full input)
    ToolUse(ToolCall),
    /// Progress/incremental tool input (partial JSON)
    ToolInputDelta { id: String, delta: String },
    /// Thinking block started
    ThinkingStart { id: String, index: usize },
    /// Thinking block content delta
    ThinkingDelta { id: String, delta: String },
    /// Thinking block ended (timeout or completion)
    ThinkingEnd { id: String },
    /// Stream completed
    Done,
}

/// Provider abort behavior contract for unfinished tool calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderAbortStrategy {
    NativeCancel,
    SyntheticToolResult,
}

/// Provider fallback behavior contract when streaming degrades mid-turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderFallbackStrategy {
    ResumeStream,
    SyntheticToolResult,
}

/// Declared provider capability contract used by higher layers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub supports_streaming: bool,
    pub supports_tools: bool,
    pub supports_tool_input_deltas: bool,
    pub supports_thinking: bool,
    pub abort_strategy: ProviderAbortStrategy,
    pub fallback_strategy: ProviderFallbackStrategy,
}

impl ProviderCapabilities {
    pub const fn minimax() -> Self {
        Self {
            supports_streaming: true,
            supports_tools: true,
            supports_tool_input_deltas: true,
            supports_thinking: true,
            abort_strategy: ProviderAbortStrategy::SyntheticToolResult,
            fallback_strategy: ProviderFallbackStrategy::SyntheticToolResult,
        }
    }

    pub const fn conservative(supports_tools: bool) -> Self {
        Self {
            supports_streaming: true,
            supports_tools,
            supports_tool_input_deltas: false,
            supports_thinking: false,
            abort_strategy: ProviderAbortStrategy::SyntheticToolResult,
            fallback_strategy: ProviderFallbackStrategy::SyntheticToolResult,
        }
    }
}

/// Why a synthetic tool result was generated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyntheticToolResultReason {
    Abort,
    Fallback,
}

impl SyntheticToolResultReason {
    fn label(self) -> &'static str {
        match self {
            Self::Abort => "abort",
            Self::Fallback => "fallback",
        }
    }
}

/// Build a deterministic synthetic tool_result message for unresolved tool_use blocks.
pub fn synthetic_tool_result_message(
    provider_name: &str,
    tool_use_id: &str,
    tool_name: &str,
    reason: SyntheticToolResultReason,
    detail: &str,
) -> Message {
    let detail = detail.trim();
    let detail = if detail.is_empty() {
        "provider terminated the tool before completion"
    } else {
        detail
    };

    Message::new_tool(
        tool_use_id,
        &format!(
            "ERROR: synthetic tool_result emitted after provider={} {} for tool={} detail={}",
            provider_name,
            reason.label(),
            tool_name,
            detail
        ),
    )
}

/// LLM provider trait
#[async_trait]
pub trait LLMProvider: Send + Sync {
    /// Send a chat message and get a streaming response
    /// tools: Optional tool definitions for native tool calling
    async fn chat_stream(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
    ) -> Result<ChatCompletion, LLMError>;

    /// Stream chat response - yields chunks as they arrive
    fn chat_streaming(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
    ) -> Pin<Box<dyn Stream<Item = Result<ChatChunk, LLMError>> + Send + '_>>;

    /// Check if the provider supports tool calls
    fn supports_tools(&self) -> bool;

    /// Provider identity for observability and compatibility routing.
    fn provider_name(&self) -> &'static str {
        "unknown"
    }

    /// Declared capability contract for provider-specific fallback/abort handling.
    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities::conservative(self.supports_tools())
    }
}

/// LLM error types
#[derive(Debug, thiserror::Error)]
pub enum LLMError {
    #[error("API error: {0}")]
    Api(String),

    #[error("Model error: {0}")]
    Model(String),

    #[error("Context length exceeded")]
    ContextLengthExceeded,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::MessageRole;

    struct DummyProvider;

    #[async_trait]
    impl LLMProvider for DummyProvider {
        async fn chat_stream(
            &self,
            _messages: &[Message],
            _tools: Option<&[ToolDefinition]>,
        ) -> Result<ChatCompletion, LLMError> {
            Ok(ChatCompletion {
                message: String::new(),
                tool_calls: vec![],
                content_blocks: None,
            })
        }

        fn chat_streaming(
            &self,
            _messages: &[Message],
            _tools: Option<&[ToolDefinition]>,
        ) -> Pin<Box<dyn Stream<Item = Result<ChatChunk, LLMError>> + Send + '_>> {
            Box::pin(futures::stream::empty())
        }

        fn supports_tools(&self) -> bool {
            false
        }
    }

    #[test]
    fn default_provider_contract_is_conservative() {
        let provider = DummyProvider;
        assert_eq!(provider.provider_name(), "unknown");
        assert_eq!(
            provider.capabilities(),
            ProviderCapabilities::conservative(false)
        );
    }

    #[test]
    fn synthetic_tool_result_preserves_tool_use_id_and_reason() {
        let message = synthetic_tool_result_message(
            "minimax",
            "toolu_123",
            "bash",
            SyntheticToolResultReason::Fallback,
            "stream downgraded",
        );

        assert_eq!(message.role, MessageRole::Tool);
        assert_eq!(message.tool_use_id.as_deref(), Some("toolu_123"));
        assert!(message.content.contains("provider=minimax"));
        assert!(message.content.contains("fallback"));
        assert!(message.content.contains("tool=bash"));
    }
}
