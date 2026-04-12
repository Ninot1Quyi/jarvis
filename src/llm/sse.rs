//! SSE streaming parser for Anthropic-compatible APIs.
//!
//! This module now uses a small state machine inspired by claude-code's
//! `content_block_start -> content_block_delta -> content_block_stop` flow.
//! We keep block-local state across incremental byte chunks so partial
//! `input_json_delta` fragments are accumulated safely and only finalized when
//! the content block stops (or when the stream is explicitly finished).

use crate::llm::{ChatChunk, LLMError, ToolCall};
use serde::Deserialize;
use std::collections::HashMap;
use tracing::debug;

/// SSE event types for Anthropic message streaming.
#[derive(Debug, Deserialize)]
pub struct SSEContentBlockDelta {
    pub index: usize,
    pub delta: SSEDelta,
}

#[derive(Debug, Deserialize)]
pub struct SSEDelta {
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub text: String,
    #[serde(rename = "thinking", default)]
    pub thinking: String,
    #[serde(rename = "partial_json")]
    #[serde(default)]
    pub partial_json: Option<String>,
    #[serde(rename = "signature", default)]
    pub signature: String,
}

#[derive(Debug, Deserialize)]
pub struct SSEContentBlockStart {
    pub index: usize,
    #[serde(rename = "content_block")]
    pub content_block: SSEContentBlock,
}

#[derive(Debug, Deserialize)]
pub struct SSEContentBlockStop {
    pub index: usize,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SSEContentBlock {
    #[serde(rename = "type")]
    pub type_: String,
    pub id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
enum ContentBlockState {
    ToolUse {
        id: String,
        name: String,
        input_json: String,
    },
    Thinking {
        id: String,
        thinking: String,
        signature: String,
    },
    Text {
        text: String,
    },
    Other {
        type_name: String,
    },
}

#[derive(Debug, Default, Clone)]
struct MessageState {
    message_id: Option<String>,
    role: Option<String>,
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SSEMessageStart {
    message: SSEMessage,
}

#[derive(Debug, Deserialize)]
struct SSEMessage {
    id: Option<String>,
    role: Option<String>,
    #[serde(rename = "stop_reason")]
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SSEMessageDelta {
    delta: SSEMessageDeltaInner,
}

#[derive(Debug, Deserialize)]
struct SSEMessageDeltaInner {
    #[serde(rename = "stop_reason")]
    stop_reason: Option<String>,
}

/// Stateful incremental parser for Anthropic SSE streams.
#[derive(Debug, Default)]
pub struct SseStreamParser {
    current_event: Option<String>,
    data_lines: Vec<String>,
    partial_line: String,
    content_blocks: HashMap<usize, ContentBlockState>,
    current_message: Option<MessageState>,
}

impl SseStreamParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a raw SSE byte/string chunk and emit any newly completed chat chunks.
    pub fn push_bytes(&mut self, chunk: &str) -> Vec<Result<ChatChunk, LLMError>> {
        let mut results = Vec::new();
        self.partial_line.push_str(chunk);

        while let Some(newline_idx) = self.partial_line.find('\n') {
            let raw_line: String = self.partial_line.drain(..=newline_idx).collect();
            let line = raw_line.trim_end_matches(['\n', '\r']);
            self.process_line(line, &mut results);
        }

        results
    }

    /// Finish the stream and flush any pending event/block state.
    pub fn finish(&mut self) -> Vec<Result<ChatChunk, LLMError>> {
        let mut results = Vec::new();

        if !self.partial_line.is_empty() {
            let trailing = std::mem::take(&mut self.partial_line);
            let line = trailing.trim_end_matches('\r');
            if !line.is_empty() {
                self.process_line(line, &mut results);
            }
        }

        self.process_current_event(&mut results);
        self.finalize_all_blocks(&mut results);
        results
    }

    /// Force-close any still-open thinking blocks, returning their ids so the
    /// caller can emit synthetic `ThinkingEnd` chunks on timeout.
    pub fn force_close_thinking_blocks(&mut self) -> Vec<String> {
        let indices: Vec<usize> = self
            .content_blocks
            .iter()
            .filter_map(|(index, state)| match state {
                ContentBlockState::Thinking { .. } => Some(*index),
                _ => None,
            })
            .collect();

        let mut ids = Vec::new();
        for index in indices {
            if let Some(ContentBlockState::Thinking { id, .. }) = self.content_blocks.remove(&index)
            {
                ids.push(id);
            }
        }
        ids
    }

    fn process_line(&mut self, line: &str, results: &mut Vec<Result<ChatChunk, LLMError>>) {
        if line.is_empty() {
            self.process_current_event(results);
            return;
        }

        if let Some(event_name) = line.strip_prefix("event:") {
            if self.current_event.is_some() && !self.data_lines.is_empty() {
                self.process_current_event(results);
            }
            self.current_event = Some(event_name.trim().to_string());
            return;
        }

        if let Some(data) = line.strip_prefix("data:") {
            self.data_lines.push(data.trim_start().to_string());
        }
    }

    fn process_current_event(&mut self, results: &mut Vec<Result<ChatChunk, LLMError>>) {
        let Some(event_type) = self.current_event.take() else {
            self.data_lines.clear();
            return;
        };

        if self.data_lines.is_empty() {
            return;
        }

        let data = self.data_lines.join("\n");
        self.data_lines.clear();

        match event_type.as_str() {
            "message_start" => self.handle_message_start(&data, results),
            "content_block_start" => self.handle_content_block_start(&data, results),
            "content_block_delta" => self.handle_content_block_delta(&data, results),
            "content_block_stop" => self.handle_content_block_stop(&data, results),
            "message_delta" => self.handle_message_delta(&data, results),
            "message_stop" => {
                self.finalize_all_blocks(results);
                self.handle_message_stop(results);
            }
            _ => {}
        }
    }

    fn handle_message_start(&mut self, data: &str, results: &mut Vec<Result<ChatChunk, LLMError>>) {
        let Ok(start) = serde_json::from_str::<SSEMessageStart>(data) else {
            return;
        };
        self.current_message = Some(MessageState {
            message_id: start.message.id.clone(),
            role: start.message.role.clone(),
            stop_reason: start.message.stop_reason.clone(),
        });
        results.push(Ok(ChatChunk::MessageStart {
            message_id: start.message.id,
            role: start.message.role,
        }));
    }

    fn handle_content_block_start(
        &mut self,
        data: &str,
        results: &mut Vec<Result<ChatChunk, LLMError>>,
    ) {
        let Ok(block) = serde_json::from_str::<SSEContentBlockStart>(data) else {
            return;
        };

        match block.content_block.type_.as_str() {
            "tool_use" => {
                if let (Some(id), Some(name)) = (block.content_block.id, block.content_block.name) {
                    self.content_blocks.insert(
                        block.index,
                        ContentBlockState::ToolUse {
                            id,
                            name,
                            input_json: String::new(),
                        },
                    );
                }
            }
            "thinking" => {
                let thinking_id = block
                    .content_block
                    .id
                    .unwrap_or_else(|| format!("thinking_{}", block.index));
                self.content_blocks.insert(
                    block.index,
                    ContentBlockState::Thinking {
                        id: thinking_id.clone(),
                        thinking: String::new(),
                        signature: String::new(),
                    },
                );
                results.push(Ok(ChatChunk::ThinkingStart {
                    id: thinking_id,
                    index: block.index,
                }));
            }
            "text" => {
                self.content_blocks.insert(
                    block.index,
                    ContentBlockState::Text {
                        text: String::new(),
                    },
                );
            }
            other => {
                self.content_blocks.insert(
                    block.index,
                    ContentBlockState::Other {
                        type_name: other.to_string(),
                    },
                );
            }
        }
    }

    fn handle_content_block_delta(
        &mut self,
        data: &str,
        results: &mut Vec<Result<ChatChunk, LLMError>>,
    ) {
        let Ok(delta) = serde_json::from_str::<SSEContentBlockDelta>(data) else {
            return;
        };

        let Some(content_block) = self.content_blocks.get_mut(&delta.index) else {
            return;
        };

        match delta.delta.type_.as_str() {
            "text_delta" => {
                if !delta.delta.text.is_empty() {
                    if let ContentBlockState::Text { text } = content_block {
                        text.push_str(&delta.delta.text);
                    }
                    results.push(Ok(ChatChunk::Text(delta.delta.text)));
                }
            }
            "input_json_delta" => {
                if let Some(partial) = delta.delta.partial_json {
                    if let ContentBlockState::ToolUse { id, input_json, .. } = content_block {
                        input_json.push_str(&partial);
                        results.push(Ok(ChatChunk::ToolInputDelta {
                            id: id.clone(),
                            delta: partial,
                        }));
                    }
                }
            }
            "thinking_delta" => {
                if !delta.delta.thinking.is_empty() {
                    if let ContentBlockState::Thinking { id, thinking, .. } = content_block {
                        thinking.push_str(&delta.delta.thinking);
                        results.push(Ok(ChatChunk::ThinkingDelta {
                            id: id.clone(),
                            delta: delta.delta.thinking,
                        }));
                    }
                }
            }
            "signature_delta" => {
                if let ContentBlockState::Thinking { signature, .. } = content_block {
                    signature.push_str(&delta.delta.signature);
                }
            }
            _ => {}
        }
    }

    fn handle_content_block_stop(
        &mut self,
        data: &str,
        results: &mut Vec<Result<ChatChunk, LLMError>>,
    ) {
        let Ok(stop) = serde_json::from_str::<SSEContentBlockStop>(data) else {
            return;
        };
        self.finalize_block(stop.index, results);
    }

    fn handle_message_delta(&mut self, data: &str, results: &mut Vec<Result<ChatChunk, LLMError>>) {
        let Ok(delta) = serde_json::from_str::<SSEMessageDelta>(data) else {
            return;
        };
        if let Some(message) = self.current_message.as_mut() {
            message.stop_reason = delta.delta.stop_reason.clone();
        }
        results.push(Ok(ChatChunk::MessageDelta {
            stop_reason: delta.delta.stop_reason,
        }));
    }

    fn handle_message_stop(&mut self, results: &mut Vec<Result<ChatChunk, LLMError>>) {
        let stop_reason = self
            .current_message
            .as_ref()
            .and_then(|message| message.stop_reason.clone());
        results.push(Ok(ChatChunk::MessageStop { stop_reason }));
        self.current_message = None;
    }

    fn finalize_all_blocks(&mut self, results: &mut Vec<Result<ChatChunk, LLMError>>) {
        let mut indices: Vec<usize> = self.content_blocks.keys().copied().collect();
        indices.sort_unstable();
        for index in indices {
            self.finalize_block(index, results);
        }
    }

    fn finalize_block(&mut self, index: usize, results: &mut Vec<Result<ChatChunk, LLMError>>) {
        let Some(block) = self.content_blocks.remove(&index) else {
            return;
        };

        match block {
            ContentBlockState::ToolUse {
                id,
                name,
                input_json,
            } => {
                results.push(build_tool_use_chunk(id, name, input_json));
            }
            ContentBlockState::Thinking { id, .. } => {
                results.push(Ok(ChatChunk::ThinkingEnd { id }));
            }
            ContentBlockState::Text { .. } => {}
            ContentBlockState::Other { type_name } => {
                debug!(
                    "ignoring unsupported content block type at stop: {}",
                    type_name
                );
            }
        }
    }
}

/// Parse an SSE body and flush any trailing unterminated event.
pub fn parse_sse_stream(body: &str) -> Vec<Result<ChatChunk, LLMError>> {
    let mut parser = SseStreamParser::new();
    let mut results = parser.push_bytes(body);
    results.extend(parser.finish());
    results
}

/// Parse only fully terminated SSE events from a body.
pub fn parse_sse_stream_incremental(body: &str) -> Vec<Result<ChatChunk, LLMError>> {
    let mut parser = SseStreamParser::new();
    parser.push_bytes(body)
}

fn build_tool_use_chunk(
    id: String,
    name: String,
    input_json: String,
) -> Result<ChatChunk, LLMError> {
    let arguments = if input_json.trim().is_empty() {
        serde_json::json!({})
    } else {
        parse_tool_input_json(&name, &input_json)?
    };

    Ok(ChatChunk::ToolUse(ToolCall {
        id,
        name,
        arguments,
    }))
}

fn parse_tool_input_json(tool_name: &str, raw_input: &str) -> Result<serde_json::Value, LLMError> {
    match serde_json::from_str::<serde_json::Value>(raw_input) {
        Ok(parsed) => Ok(parsed),
        Err(parse_error) => {
            if let Some(repaired) = repair_truncated_json(raw_input) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&repaired) {
                    debug!(
                        "repaired truncated tool input JSON for {}: raw_len={} repaired_len={}",
                        tool_name,
                        raw_input.len(),
                        repaired.len()
                    );
                    return Ok(parsed);
                }
            }

            Err(LLMError::Model(format!(
                "Failed to parse tool input JSON for {}: {}",
                tool_name, parse_error
            )))
        }
    }
}

fn repair_truncated_json(raw_input: &str) -> Option<String> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Some("{}".to_string());
    }

    if !trimmed.starts_with('{') && !trimmed.starts_with('[') {
        return None;
    }

    let mut repaired = trimmed.to_string();
    let mut quote_count = 0usize;
    let mut escaped = false;
    for ch in repaired.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            quote_count += 1;
        }
    }

    if quote_count % 2 == 1 {
        repaired.push('"');
    }

    let open_braces = repaired.chars().filter(|c| *c == '{').count();
    let close_braces = repaired.chars().filter(|c| *c == '}').count();
    if open_braces > close_braces {
        repaired.push_str(&"}".repeat(open_braces - close_braces));
    }

    let open_brackets = repaired.chars().filter(|c| *c == '[').count();
    let close_brackets = repaired.chars().filter(|c| *c == ']').count();
    if open_brackets > close_brackets {
        repaired.push_str(&"]".repeat(open_brackets - close_brackets));
    }

    Some(repaired)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sse_text() {
        let sse_data = "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"text\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\nevent: content_block_stop\ndata: {\"index\":0}\n\nevent: message_stop\ndata: {}\n";
        let chunks = parse_sse_stream(sse_data);
        assert!(chunks.iter().any(|c| matches!(c, Ok(ChatChunk::Text(_)))));
    }

    #[test]
    fn test_parse_sse_tool_use() {
        let sse_data = "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"bash\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\\\"ls\\\"}\"}}\n\nevent: content_block_stop\ndata: {\"index\":0}\n";
        let chunks = parse_sse_stream(sse_data);
        assert!(chunks
            .iter()
            .any(|c| matches!(c, Ok(ChatChunk::ToolUse(call)) if call.name == "bash")));
    }

    #[test]
    fn test_parse_sse_tool_input_delta() {
        let sse_data = "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"bash\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"ls\\\"}\"}}\n\nevent: content_block_stop\ndata: {\"index\":0}\n";
        let chunks = parse_sse_stream(sse_data);
        let delta_count = chunks
            .iter()
            .filter(|c| matches!(c, Ok(ChatChunk::ToolInputDelta { .. })))
            .count();
        assert_eq!(delta_count, 2);
    }

    #[test]
    fn test_incremental_parser_does_not_flush_trailing_partial_event() {
        let mut parser = SseStreamParser::new();
        let partial_sse = "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"bash\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\": \\\"ls -\"}}";
        let chunks = parser.push_bytes(partial_sse);

        assert!(chunks
            .iter()
            .all(|chunk| !matches!(chunk, Ok(ChatChunk::ToolUse(_)))));
    }

    #[test]
    fn test_parse_sse_tool_use_repairs_truncated_json() {
        let sse_data = "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"bash\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\": \\\"ls -\"}}\n\nevent: content_block_stop\ndata: {\"index\":0}\n";
        let chunks = parse_sse_stream(sse_data);

        let tool_call = chunks
            .into_iter()
            .find_map(|chunk| match chunk {
                Ok(ChatChunk::ToolUse(call)) => Some(call),
                _ => None,
            })
            .expect("expected repaired tool_use chunk");

        assert_eq!(tool_call.name, "bash");
        assert_eq!(tool_call.arguments["command"], "ls -");
    }

    #[test]
    fn test_stateful_incremental_parser_accumulates_tool_input_across_chunks() {
        let mut parser = SseStreamParser::new();

        let first = parser.push_bytes(
            "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"bash\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\"}}\n\n",
        );
        assert!(first
            .iter()
            .any(|chunk| matches!(chunk, Ok(ChatChunk::ToolInputDelta { .. }))));
        assert!(first
            .iter()
            .all(|chunk| !matches!(chunk, Ok(ChatChunk::ToolUse(_)))));

        let second = parser.push_bytes(
            "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"pwd\\\"}\"}}\n\nevent: content_block_stop\ndata: {\"index\":0}\n\n",
        );
        let tool_call = second
            .into_iter()
            .find_map(|chunk| match chunk {
                Ok(ChatChunk::ToolUse(call)) => Some(call),
                _ => None,
            })
            .expect("expected finalized tool use");

        assert_eq!(tool_call.arguments["command"], "pwd");
    }

    #[test]
    fn test_force_close_thinking_blocks() {
        let mut parser = SseStreamParser::new();
        let _ = parser.push_bytes(
            "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"thinking\",\"id\":\"thinking_0\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hello\"}}\n\n",
        );

        let ids = parser.force_close_thinking_blocks();
        assert_eq!(ids, vec!["thinking_0".to_string()]);
    }

    #[test]
    fn test_message_lifecycle_chunks_are_emitted() {
        let sse_data = "event: message_start\ndata: {\"message\":{\"id\":\"msg_1\",\"role\":\"assistant\",\"stop_reason\":null}}\n\nevent: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"text\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\nevent: content_block_stop\ndata: {\"index\":0}\n\nevent: message_delta\ndata: {\"delta\":{\"stop_reason\":\"end_turn\"}}\n\nevent: message_stop\ndata: {}\n";
        let chunks = parse_sse_stream(sse_data);

        assert!(chunks.iter().any(|chunk| matches!(
            chunk,
            Ok(ChatChunk::MessageStart {
                message_id: Some(id),
                role: Some(role)
            }) if id == "msg_1" && role == "assistant"
        )));
        assert!(chunks.iter().any(|chunk| matches!(
            chunk,
            Ok(ChatChunk::MessageDelta {
                stop_reason: Some(reason)
            }) if reason == "end_turn"
        )));
        assert!(chunks.iter().any(|chunk| matches!(
            chunk,
            Ok(ChatChunk::MessageStop {
                stop_reason: Some(reason)
            }) if reason == "end_turn"
        )));
    }
}
