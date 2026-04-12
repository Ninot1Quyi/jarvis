//! MiniMax LLM provider using Anthropic-compatible API
//!
//! MiniMax provides an Anthropic-compatible endpoint at baseURL/anthropic
//! Supports native tool calls via the Anthropic tool_use format.
//! Supports streaming via SSE.

use crate::llm::{ChatChunk, ChatCompletion, LLMError, LLMProvider, ToolCall, ToolDefinition};
use crate::message::{Message as DumEMessage, MessageRole};
use async_trait::async_trait;
use futures::{Stream, StreamExt};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::time::Duration;
use tracing::{debug, warn};

/// MiniMax LLM provider using Anthropic API
#[derive(Clone)]
pub struct MiniMaxLLM {
    client: Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl MiniMaxLLM {
    const REQUEST_MAX_ATTEMPTS: usize = 3;
    const RETRY_BASE_DELAY_MS: u64 = 500;

    pub fn new(api_key: String, base_url: String, model: String) -> Result<Self, LLMError> {
        if api_key.is_empty() {
            return Err(LLMError::Api("API key is required".to_string()));
        }

        let (base_url, normalization_notes) = Self::normalize_base_url(base_url);
        for note in normalization_notes {
            warn!(
                base_url = %base_url,
                note = %note,
                "MiniMax base_url normalized"
            );
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .use_rustls_tls()
            .build()
            .map_err(|e| LLMError::Api(format!("Failed to create HTTP client: {}", e)))?;

        Ok(Self {
            client,
            api_key,
            base_url,
            model,
        })
    }

    fn normalize_base_url(base_url: String) -> (String, Vec<String>) {
        let mut notes = Vec::new();
        let mut normalized = base_url.trim().trim_end_matches('/').to_string();

        if normalized.is_empty() {
            normalized = "https://api.minimaxi.com".to_string();
            notes.push("base_url is empty, falling back to https://api.minimaxi.com".to_string());
            return (normalized, notes);
        }

        if let Ok(mut url) = Url::parse(&normalized) {
            let path = url.path().trim_end_matches('/');
            if path == "/anthropic" {
                url.set_path("");
                notes.push("trimmed trailing /anthropic from base_url".to_string());
            }

            normalized = url.as_str().trim_end_matches('/').to_string();
        } else {
            if normalized.ends_with("/anthropic") {
                normalized = normalized
                    .trim_end_matches("/anthropic")
                    .trim_end_matches('/')
                    .to_string();
                notes.push("trimmed trailing /anthropic from base_url".to_string());
            }
        }

        if normalized.is_empty() {
            normalized = "https://api.minimaxi.com".to_string();
            notes.push(
                "normalized base_url became empty, reset to https://api.minimaxi.com".to_string(),
            );
        }

        (normalized, notes)
    }

    fn messages_url(&self) -> String {
        format!(
            "{}/anthropic/v1/messages",
            self.base_url.trim_end_matches('/')
        )
    }

    fn to_anthropic_role(role: &MessageRole) -> &'static str {
        match role {
            MessageRole::System => "system",
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
            MessageRole::Tool => "user",
        }
    }

    fn classify_request_error(err: &reqwest::Error) -> &'static str {
        if err.is_timeout() {
            "timeout"
        } else if err.is_connect() {
            "connect"
        } else if err.is_request() {
            "request_build_or_send"
        } else if err.is_body() {
            "body"
        } else if err.is_decode() {
            "decode"
        } else {
            "unknown"
        }
    }

    fn should_retry_status(status: StatusCode) -> bool {
        matches!(
            status,
            StatusCode::TOO_MANY_REQUESTS
                | StatusCode::INTERNAL_SERVER_ERROR
                | StatusCode::BAD_GATEWAY
                | StatusCode::SERVICE_UNAVAILABLE
                | StatusCode::GATEWAY_TIMEOUT
        )
    }

    fn retry_delay(attempt: usize) -> Duration {
        let shift = (attempt.saturating_sub(1)).min(3) as u32;
        let ms = Self::RETRY_BASE_DELAY_MS.saturating_mul(1u64 << shift);
        Duration::from_millis(ms)
    }

    fn header_value(headers: &reqwest::header::HeaderMap, key: &str) -> String {
        headers
            .get(key)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string()
    }

    fn request_error_hint(err: &reqwest::Error) -> Option<&'static str> {
        let msg = err.to_string().to_lowercase();
        if msg.contains("dns")
            || msg.contains("failed to lookup address information")
            || msg.contains("name or service not known")
            || msg.contains("nodename nor servname provided")
        {
            return Some(
                "DNS resolution failed; check base_url and DNS/network. Recommended MiniMax base_url: https://api.minimaxi.com",
            );
        }
        if err.is_timeout() {
            return Some("request timed out; check network latency and upstream availability");
        }
        if err.is_connect() {
            return Some("connection failed; check base_url host reachability and TLS/network");
        }
        None
    }

    async fn send_with_retry<T: Serialize + ?Sized>(
        &self,
        url: &str,
        request: &T,
        mode: &str,
    ) -> Result<reqwest::Response, LLMError> {
        let mut last_error: Option<String> = None;

        for attempt in 1..=Self::REQUEST_MAX_ATTEMPTS {
            debug!(
                mode = mode,
                attempt = attempt,
                max_attempts = Self::REQUEST_MAX_ATTEMPTS,
                url = url,
                "MiniMax request attempt started"
            );

            let send_result = self
                .client
                .post(url)
                .header("x-api-key", &self.api_key)
                .header("Content-Type", "application/json")
                .header("anthropic-version", "2023-06-01")
                .json(request)
                .send()
                .await;

            match send_result {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        if attempt > 1 {
                            debug!(
                                mode = mode,
                                attempt = attempt,
                                status = %status,
                                "MiniMax request succeeded after retry"
                            );
                        }
                        return Ok(response);
                    }

                    let headers = response.headers().clone();
                    let minimax_request_id = Self::header_value(&headers, "minimax-request-id");
                    let trace_id = Self::header_value(&headers, "trace-id");
                    let body = response.text().await.unwrap_or_default();
                    let body_preview = if body.len() > 400 {
                        format!("{}...", &body[..400])
                    } else {
                        body.clone()
                    };

                    if Self::should_retry_status(status) && attempt < Self::REQUEST_MAX_ATTEMPTS {
                        last_error = Some(format!(
                            "retryable HTTP status {} on attempt {}/{} (request_id={}, trace_id={})",
                            status,
                            attempt,
                            Self::REQUEST_MAX_ATTEMPTS,
                            minimax_request_id,
                            trace_id
                        ));
                        let delay = Self::retry_delay(attempt);
                        debug!(
                            mode = mode,
                            attempt = attempt,
                            status = %status,
                            delay_ms = delay.as_millis(),
                            request_id = %minimax_request_id,
                            trace_id = %trace_id,
                            "MiniMax request got retryable status, backing off"
                        );
                        tokio::time::sleep(delay).await;
                        continue;
                    }

                    if let Ok(error_response) =
                        serde_json::from_str::<AnthropicErrorResponse>(&body)
                    {
                        return Err(LLMError::Api(format!(
                            "MiniMax error {}: {} (status={} request_id={} trace_id={} attempt={}/{})",
                            error_response.error_type,
                            error_response.error.message,
                            status,
                            minimax_request_id,
                            trace_id,
                            attempt,
                            Self::REQUEST_MAX_ATTEMPTS
                        )));
                    }

                    return Err(LLMError::Api(format!(
                        "API error {} (request_id={} trace_id={} attempt={}/{}): {}",
                        status,
                        minimax_request_id,
                        trace_id,
                        attempt,
                        Self::REQUEST_MAX_ATTEMPTS,
                        body_preview
                    )));
                }
                Err(e) => {
                    let kind = Self::classify_request_error(&e);
                    let hint = Self::request_error_hint(&e);
                    let err_msg = format!(
                        "Request failed [kind={} attempt={}/{} mode={}]: {}{}",
                        kind,
                        attempt,
                        Self::REQUEST_MAX_ATTEMPTS,
                        mode,
                        e,
                        hint.map(|h| format!(" | hint: {}", h)).unwrap_or_default()
                    );
                    last_error = Some(err_msg.clone());

                    if attempt < Self::REQUEST_MAX_ATTEMPTS {
                        let delay = Self::retry_delay(attempt);
                        debug!(
                            mode = mode,
                            attempt = attempt,
                            kind = kind,
                            delay_ms = delay.as_millis(),
                            error = %e,
                            "MiniMax request send failed, backing off"
                        );
                        tokio::time::sleep(delay).await;
                        continue;
                    }

                    return Err(LLMError::Api(err_msg));
                }
            }
        }

        Err(LLMError::Api(last_error.unwrap_or_else(|| {
            "Request failed: exhausted retries with unknown error".to_string()
        })))
    }
}

#[async_trait]
impl LLMProvider for MiniMaxLLM {
    async fn chat_stream(
        &self,
        messages: &[DumEMessage],
        tools: Option<&[ToolDefinition]>,
    ) -> Result<ChatCompletion, LLMError> {
        // Build Anthropic-format messages
        let mut anthropic_messages: Vec<AnthropicMessage> = Vec::new();

        for m in messages.iter() {
            if m.role == MessageRole::System {
                continue; // System message handled separately
            }

            if m.role == MessageRole::Tool {
                // Tool results need special formatting
                // Content should be the actual result as a string
                let tool_use_id = m.tool_use_id.as_deref().unwrap_or("unknown");
                let content = serde_json::json!([
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": m.content
                    }
                ]);
                anthropic_messages.push(AnthropicMessage {
                    role: "user".to_string(),
                    content,
                });
            } else {
                // For assistant messages, use stored content_blocks if available
                // This preserves tool_use blocks for multi-turn tool calling
                let content = if let Some(ref blocks) = m.content_blocks {
                    blocks.clone()
                } else {
                    serde_json::json!([{"type": "text", "text": m.content}])
                };
                anthropic_messages.push(AnthropicMessage {
                    role: Self::to_anthropic_role(&m.role).to_string(),
                    content,
                });
            }
        }

        // Get system message
        let system = messages
            .iter()
            .find(|m| m.role == MessageRole::System)
            .map(|m| m.content.clone());

        // Convert tools to Anthropic format
        let anthropic_tools: Option<Vec<AnthropicTool>> = tools.map(|tools| {
            tools
                .iter()
                .map(|t| AnthropicTool {
                    name: t.name.clone(),
                    description: t.description.clone(),
                    input_schema: t.input_schema.clone(),
                })
                .collect()
        });

        let request = AnthropicChatRequest {
            model: self.model.clone(),
            max_tokens: 16384,
            system,
            messages: anthropic_messages,
            tools: anthropic_tools,
            thinking: Some(AnthropicThinking {
                type_: "thinking".to_string(),
                budget_tokens: 128,
            }),
        };

        // Use Anthropic endpoint: baseUrl/anthropic/v1/messages
        let url = self.messages_url();

        debug!("Calling MiniMax Anthropic API: {}", url);

        let response = self.send_with_retry(&url, &request, "chat").await?;
        let body = response.text().await.unwrap_or_default();

        // Parse Anthropic response
        let chat_response: AnthropicChatResponse = serde_json::from_str(&body).map_err(|e| {
            LLMError::Api(format!("Failed to parse response: {} - body: {}", e, body))
        })?;

        // Extract text and tool calls
        let mut text_parts = Vec::new();
        let mut tool_calls = Vec::new();

        // Store content blocks reference for later use
        let content_blocks_raw = &chat_response.content;

        for block in content_blocks_raw.iter() {
            match block {
                AnthropicContentBlock::Text { text } => {
                    text_parts.push(text.clone());
                }
                AnthropicContentBlock::ToolUse { id, name, input } => {
                    tool_calls.push(ToolCall {
                        id: id.clone(),
                        name: name.clone(),
                        arguments: input.clone(),
                    });
                }
                AnthropicContentBlock::Thinking { .. } => {
                    // Skip thinking blocks
                }
            }
        }

        let message = text_parts.join("\n");

        // Store the raw content blocks for passing back to MiniMax in subsequent requests
        let content_blocks: serde_json::Value = serde_json::json!(
            content_blocks_raw.iter().map(|block| {
                match block {
                    AnthropicContentBlock::Text { text } => {
                        serde_json::json!({"type": "text", "text": text})
                    }
                    AnthropicContentBlock::ToolUse { id, name, input } => {
                        serde_json::json!({"type": "tool_use", "id": id, "name": name, "input": input})
                    }
                    AnthropicContentBlock::Thinking { thinking, signature } => {
                        serde_json::json!({"type": "thinking", "thinking": thinking, "signature": signature})
                    }
                }
            }).collect::<Vec<_>>()
        );

        Ok(ChatCompletion {
            message,
            tool_calls,
            content_blocks: Some(content_blocks),
        })
    }

    fn supports_tools(&self) -> bool {
        true
    }

    fn chat_streaming(
        &self,
        messages: &[DumEMessage],
        tools: Option<&[ToolDefinition]>,
    ) -> Pin<Box<dyn Stream<Item = Result<ChatChunk, LLMError>> + Send + '_>> {
        use crate::llm::sse::parse_sse_stream;

        let messages = messages.to_vec();
        let tools = tools.map(|t| t.to_vec());
        let this = self.clone();

        Box::pin(async_stream::stream! {
            // Build messages
            let mut anthropic_messages: Vec<AnthropicMessage> = Vec::new();

            for m in messages.iter() {
                if m.role == MessageRole::System {
                    continue;
                }

                if m.role == MessageRole::Tool {
                    let tool_use_id = m.tool_use_id.as_deref().unwrap_or("unknown");
                    let content = serde_json::json!([
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": m.content
                        }
                    ]);
                    anthropic_messages.push(AnthropicMessage {
                        role: "user".to_string(),
                        content,
                    });
                } else {
                    let content = if let Some(ref blocks) = m.content_blocks {
                        blocks.clone()
                    } else {
                        serde_json::json!([{"type": "text", "text": m.content}])
                    };
                    anthropic_messages.push(AnthropicMessage {
                        role: Self::to_anthropic_role(&m.role).to_string(),
                        content,
                    });
                }
            }

            let system = messages
                .iter()
                .find(|m| m.role == MessageRole::System)
                .map(|m| m.content.clone());

            let anthropic_tools: Option<Vec<AnthropicTool>> = tools.as_ref().map(|tools| {
                tools
                    .iter()
                    .map(|t| AnthropicTool {
                        name: t.name.clone(),
                        description: t.description.clone(),
                        input_schema: t.input_schema.clone(),
                    })
                    .collect()
            });

            let request = AnthropicStreamingRequest {
                model: this.model.clone(),
                max_tokens: 100000,
                stream: true,
                system,
                messages: anthropic_messages,
                tools: anthropic_tools,
                thinking: None,
            };

            let url = this.messages_url();

            let response = match this.send_with_retry(&url, &request, "stream").await {
                Ok(r) => r,
                Err(e) => {
                    yield Err(e);
                    return;
                }
            };

            // Consume HTTP body as a true stream and parse incrementally.
            let mut raw_sse = String::new();
            let mut emitted_count = 0usize;
            let byte_stream = response.bytes_stream();
            let mut stream = byte_stream.fuse();
            // Track thinking blocks: index -> (id, last_activity_instant)
            let mut thinking_active: std::collections::HashMap<usize, (String, std::time::Instant)> =
                std::collections::HashMap::new();
            let thinking_start_time: std::time::Instant;
            const THINKING_TIMEOUT_SECS: u64 = 120;
            let mut thinking_timeout_fired = false;

            // Wait for first chunk to arrive.
            let first_bytes = match stream.next().await {
                Some(Ok(bytes)) => bytes,
                Some(Err(e)) => {
                    yield Err(LLMError::Api(format!("SSE stream read failed: {}", e)));
                    return;
                }
                None => {
                    yield Ok(ChatChunk::Done);
                    return;
                }
            };
            thinking_start_time = std::time::Instant::now();
            let chunk_str = String::from_utf8_lossy(&first_bytes);
            debug!("First HTTP chunk received, len={}", first_bytes.len());
            raw_sse.push_str(&chunk_str);
            let parsed = parse_sse_stream(&raw_sse);
            let parsed_len = parsed.len();

            if parsed_len > emitted_count {
                let new_chunks: Vec<_> = parsed.into_iter().skip(emitted_count).collect();
                for chunk in new_chunks {
                    match &chunk {
                        Ok(ChatChunk::ThinkingStart { id, index }) => {
                            thinking_active.insert(*index, (id.clone(), std::time::Instant::now()));
                            debug!("thinking block started: id={} index={}", id, index);
                        }
                        Ok(ChatChunk::ThinkingDelta { id, .. }) => {
                            for (_, (tid, instant)) in thinking_active.iter_mut() {
                                if *tid == *id {
                                    *instant = std::time::Instant::now();
                                    break;
                                }
                            }
                        }
                        Ok(ChatChunk::ThinkingEnd { id }) => {
                            thinking_active.retain(|_, (tid, _)| tid != id);
                        }
                        _ => {}
                    }
                    debug!("SSE yield: {:?}", chunk);
                    yield chunk;
                }
                emitted_count = parsed_len;
            }

            // Process remaining chunks. Use tokio::time::timeout to periodically wake up
            // and check if thinking has exceeded its timeout.
            let mut tick = tokio::time::interval(Duration::from_secs(5));
            // Drop the first immediate tick.
            tick.tick().await;
            // Flag set to true when the stream has ended (fuse returns None).
            let mut stream_ended = false;
            while !stream_ended {
                tokio::select! {
                    biased;
                    // Stream branch: when data arrives, process it immediately.
                    Some(bytes_result) = stream.next() => {
                        let bytes = match bytes_result {
                            Ok(bytes) => bytes,
                            Err(e) => {
                                yield Err(LLMError::Api(format!("SSE stream read failed: {}", e)));
                                return;
                            }
                        };

                        let chunk_str = String::from_utf8_lossy(&bytes);
                        debug!("HTTP chunk received, len={}", bytes.len());
                        raw_sse.push_str(&chunk_str);
                        let parsed = parse_sse_stream(&raw_sse);
                        let parsed_len = parsed.len();
                        debug!("SSE parse result: len={} emitted={}", parsed_len, emitted_count);

                        if parsed_len > emitted_count {
                            let new_chunks: Vec<_> = parsed.into_iter().skip(emitted_count).collect();
                            for chunk in new_chunks {
                                match &chunk {
                                    Ok(ChatChunk::ThinkingStart { id, index }) => {
                                        thinking_active.insert(*index, (id.clone(), std::time::Instant::now()));
                                        debug!("thinking block started: id={} index={}", id, index);
                                    }
                                    Ok(ChatChunk::ThinkingDelta { id, .. }) => {
                                        for (_, (tid, instant)) in thinking_active.iter_mut() {
                                            if *tid == *id {
                                                *instant = std::time::Instant::now();
                                                break;
                                            }
                                        }
                                    }
                                    Ok(ChatChunk::ThinkingEnd { id }) => {
                                        thinking_active.retain(|_, (tid, _)| tid != id);
                                    }
                                    _ => {}
                                }
                                debug!("SSE yield: {:?}", chunk);
                                yield chunk;
                            }
                            emitted_count = parsed_len;
                        }
                    }

                    // Timer branch: check thinking timeout periodically, and exit when stream ended.
                    _ = tick.tick() => {
                        // Periodic check: has thinking exceeded its timeout?
                        let elapsed = thinking_start_time.elapsed().as_secs();
                        debug!(
                            "thinking timeout check: thinking_timeout_fired={} thinking_active.len={} elapsed={}s",
                            thinking_timeout_fired,
                            thinking_active.len(),
                            elapsed
                        );
                        if !thinking_timeout_fired && !thinking_active.is_empty() && elapsed >= THINKING_TIMEOUT_SECS {
                            debug!(
                                "thinking timeout ({}) reached, flushing {} active thinking blocks",
                                THINKING_TIMEOUT_SECS,
                                thinking_active.len()
                            );
                            for (_, (id, _)) in thinking_active.drain() {
                                debug!("emitting ThinkingEnd for id={}", id);
                                yield Ok(ChatChunk::ThinkingEnd { id });
                            }
                            thinking_timeout_fired = true;
                            // Flush any accumulated chunks from SSE parser.
                            let residual = parse_sse_stream(&raw_sse);
                            for chunk in residual.into_iter().skip(emitted_count) {
                                debug!("SSE yield (post-timeout): {:?}", chunk);
                                yield chunk;
                                emitted_count += 1;
                            }
                        }
                    }
                };
                // After the select, check if the stream has ended by polling it.
                // We do this outside the select to avoid the None pattern issue.
                if stream.next().await.is_none() {
                    stream_ended = true;
                }
            }

            // Flush any residual parsed events from the final buffer.
            let parsed = parse_sse_stream(&raw_sse);
            if parsed.len() > emitted_count {
                for chunk in parsed.into_iter().skip(emitted_count) {
                    debug!("SSE final chunk: {:?}", chunk);
                    yield chunk;
                }
            }
            yield Ok(ChatChunk::Done);
        })
    }
}

#[derive(Debug, Serialize)]
struct AnthropicChatRequest {
    model: String,
    max_tokens: usize,
    system: Option<String>,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<AnthropicTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<AnthropicThinking>,
}

#[derive(Debug, Clone, Serialize)]
struct AnthropicThinking {
    #[serde(rename = "type")]
    type_: String,
    #[serde(rename = "budget_tokens")]
    budget_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct AnthropicTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct AnthropicChatResponse {
    id: String,
    #[serde(rename = "type")]
    response_type: String,
    role: String,
    content: Vec<AnthropicContentBlock>,
    #[serde(rename = "stop_reason")]
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum AnthropicContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "thinking")]
    Thinking { thinking: String, signature: String },
}

#[derive(Debug, Deserialize)]
struct AnthropicErrorResponse {
    #[serde(rename = "type")]
    error_type: String,
    error: AnthropicErrorDetail,
}

#[derive(Debug, Deserialize)]
struct AnthropicErrorDetail {
    #[serde(rename = "type")]
    error_type: String,
    message: String,
}

// SSE Streaming types
#[derive(Debug, Serialize)]
struct AnthropicStreamingRequest {
    model: String,
    max_tokens: usize,
    stream: bool,
    system: Option<String>,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<AnthropicTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<AnthropicThinking>,
}
