//! SSE streaming parser for Anthropic-compatible APIs
//!
//! Provides common SSE parsing logic for providers that use the Anthropic
//! message streaming protocol (content_block_delta, content_block_start, content_block_stop, etc.)

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

#[derive(Debug, Deserialize)]
pub struct SSEContentBlock {
    #[serde(rename = "type")]
    pub type_: String,
    pub id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
struct ToolAccumulator {
    id: String,
    name: String,
    input_json: String,
}

/// Parse an SSE body and return a vector of chat chunks.
pub fn parse_sse_stream(body: &str) -> Vec<Result<ChatChunk, LLMError>> {
    let mut current_event: Option<String> = None;
    let mut data_lines: Vec<String> = Vec::new();
    let mut results: Vec<Result<ChatChunk, LLMError>> = Vec::new();
    let mut tools_by_index: HashMap<usize, ToolAccumulator> = HashMap::new();
    let mut thinking_by_index: HashMap<usize, String> = HashMap::new();

    for raw_line in body.lines() {
        let line = raw_line.trim_end_matches('\r');

        if line.is_empty() {
            process_event(
                current_event.take(),
                &mut data_lines,
                &mut tools_by_index,
                &mut thinking_by_index,
                &mut results,
            );
            continue;
        }

        if let Some(event_name) = line.strip_prefix("event:") {
            // Process pending event before starting a new one.
            // This handles SSE servers that send multiple events without blank lines
            // (e.g. content_block_start followed immediately by content_block_delta).
            if current_event.is_some() && !data_lines.is_empty() {
                debug!(
                    "process_pending: event={:?} data_lines={}",
                    current_event,
                    data_lines.len()
                );
                process_event(
                    current_event.take(),
                    &mut data_lines,
                    &mut tools_by_index,
                    &mut thinking_by_index,
                    &mut results,
                );
                debug!("process_pending done, results.len={}", results.len());
            }
            current_event = Some(event_name.trim().to_string());
            continue;
        }

        if let Some(data) = line.strip_prefix("data:") {
            data_lines.push(data.trim_start().to_string());
            continue;
        }
    }

    // Handle streams that don't end with a blank separator.
    process_event(
        current_event.take(),
        &mut data_lines,
        &mut tools_by_index,
        &mut thinking_by_index,
        &mut results,
    );

    results
}

fn process_event(
    event: Option<String>,
    data_lines: &mut Vec<String>,
    tools_by_index: &mut HashMap<usize, ToolAccumulator>,
    thinking_by_index: &mut HashMap<usize, String>,
    results: &mut Vec<Result<ChatChunk, LLMError>>,
) {
    let Some(event_type) = event else {
        data_lines.clear();
        return;
    };

    if data_lines.is_empty() {
        return;
    }

    let data = data_lines.join("\n");
    data_lines.clear();

    match event_type.as_str() {
        "content_block_start" => {
            if let Ok(block) = serde_json::from_str::<SSEContentBlockStart>(&data) {
                match block.content_block.type_.as_str() {
                    "tool_use" => {
                        if let (Some(id), Some(name)) =
                            (block.content_block.id, block.content_block.name)
                        {
                            tools_by_index.insert(
                                block.index,
                                ToolAccumulator {
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
                        thinking_by_index.insert(block.index, thinking_id.clone());
                        let chunk = Ok(ChatChunk::ThinkingStart {
                            id: thinking_id.clone(),
                            index: block.index,
                        });
                        debug!(
                            "sse push ThinkingStart id={} index={}",
                            thinking_id, block.index
                        );
                        results.push(chunk);
                    }
                    _ => {}
                }
            }
        }
        "content_block_delta" => {
            if let Ok(delta) = serde_json::from_str::<SSEContentBlockDelta>(&data) {
                match delta.delta.type_.as_str() {
                    "text_delta" => {
                        if !delta.delta.text.is_empty() {
                            results.push(Ok(ChatChunk::Text(delta.delta.text)));
                        }
                    }
                    "input_json_delta" => {
                        if let Some(partial) = delta.delta.partial_json {
                            if let Some(tool) = tools_by_index.get_mut(&delta.index) {
                                tool.input_json.push_str(&partial);
                                results.push(Ok(ChatChunk::ToolInputDelta {
                                    id: tool.id.clone(),
                                    delta: partial,
                                }));
                            }
                        }
                    }
                    "thinking_delta" => {
                        if !delta.delta.thinking.is_empty() {
                            let id = thinking_by_index
                                .get(&delta.index)
                                .cloned()
                                .unwrap_or_else(|| format!("thinking_{}", delta.index));
                            debug!(
                                "process thinking_delta: id={} text={}",
                                id, delta.delta.thinking
                            );
                            let chunk = Ok(ChatChunk::ThinkingDelta {
                                id: id.clone(),
                                delta: delta.delta.thinking.clone(),
                            });
                            debug!(
                                "sse push ThinkingDelta id={} text={}",
                                id, delta.delta.thinking
                            );
                            results.push(chunk);
                        }
                    }
                    "signature_delta" => {
                        // Signature marks the end of a thinking block's thinking content.
                        // The thinking_by_index entry is removed when content_block_stop arrives.
                    }
                    _ => {}
                }
            }
        }
        "content_block_stop" => {
            if let Ok(stop) = serde_json::from_str::<SSEContentBlockStop>(&data) {
                if let Some(tool) = tools_by_index.remove(&stop.index) {
                    results.push(build_tool_use_chunk(tool));
                }
                if let Some(id) = thinking_by_index.remove(&stop.index) {
                    results.push(Ok(ChatChunk::ThinkingEnd { id }));
                }
            }
        }
        // Compatibility fallback for providers that only finalize on message_stop.
        "message_stop" => {
            let mut indices: Vec<usize> = tools_by_index.keys().copied().collect();
            indices.sort_unstable();
            for index in indices {
                if let Some(tool) = tools_by_index.remove(&index) {
                    results.push(build_tool_use_chunk(tool));
                }
            }
            for (_, id) in thinking_by_index.drain() {
                results.push(Ok(ChatChunk::ThinkingEnd { id }));
            }
        }
        _ => {}
    }
}

fn build_tool_use_chunk(tool: ToolAccumulator) -> Result<ChatChunk, LLMError> {
    let arguments = if tool.input_json.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str::<serde_json::Value>(&tool.input_json).map_err(|e| {
            LLMError::Model(format!(
                "Failed to parse tool input JSON for {}: {}",
                tool.name, e
            ))
        })?
    };

    Ok(ChatChunk::ToolUse(ToolCall {
        id: tool.id,
        name: tool.name,
        arguments,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sse_text() {
        let sse_data = "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\nevent: message_stop\ndata: {}\n";
        let chunks = parse_sse_stream(sse_data);
        assert!(chunks.iter().any(|c| matches!(c, Ok(ChatChunk::Text(_)))));
    }

    #[test]
    fn test_parse_sse_tool_use() {
        let sse_data = "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"bash\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\\\"ls\\\"}\"}}\n\nevent: content_block_stop\ndata: {\"index\":0}\n";
        let chunks = parse_sse_stream(sse_data);
        assert!(chunks
            .iter()
            .any(|c| matches!(c, Ok(ChatChunk::ToolUse(_)))));
    }

    #[test]
    fn test_parse_sse_tool_input_delta() {
        let sse_data = "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"bash\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\"}}\n\nevent: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"ls\\\"}\"}}\n";
        let chunks = parse_sse_stream(sse_data);
        assert!(
            chunks
                .iter()
                .filter(|c| matches!(c, Ok(ChatChunk::ToolInputDelta { .. })))
                .count()
                >= 2
        );
    }
}
