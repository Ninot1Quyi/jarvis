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
