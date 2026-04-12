use async_trait::async_trait;
use dum_e::llm::{ChatChunk, ChatCompletion, LLMError, LLMProvider, ToolCall as LlmToolCall};
use dum_e::message::Message;
use dum_e::observability::{Component, EventData, EventType};
use dum_e::tools::{Tool, ToolContext, ToolRegistry, ToolResult};
use dum_e::{Agent, Config, EventBus, SoulManager};
use futures::Stream;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct SequencedLlm {
    calls: Mutex<usize>,
}

impl SequencedLlm {
    fn new() -> Self {
        Self {
            calls: Mutex::new(0),
        }
    }
}

#[async_trait]
impl LLMProvider for SequencedLlm {
    async fn chat_stream(
        &self,
        _messages: &[Message],
        _tools: Option<&[dum_e::llm::ToolDefinition]>,
    ) -> Result<ChatCompletion, LLMError> {
        let mut calls = self.calls.lock().unwrap();
        *calls += 1;
        match *calls {
            1 => Ok(ChatCompletion {
                message: "Using a tool".to_string(),
                tool_calls: vec![LlmToolCall {
                    id: "toolu_1".to_string(),
                    name: "mock_tool".to_string(),
                    arguments: serde_json::json!({"value": "hello"}),
                }],
                content_blocks: None,
            }),
            _ => Ok(ChatCompletion {
                message: "done".to_string(),
                tool_calls: vec![],
                content_blocks: None,
            }),
        }
    }

    fn chat_streaming(
        &self,
        _messages: &[Message],
        _tools: Option<&[dum_e::llm::ToolDefinition]>,
    ) -> Pin<Box<dyn Stream<Item = Result<ChatChunk, LLMError>> + Send + '_>> {
        Box::pin(futures::stream::once(async { Ok(ChatChunk::Done) }))
    }

    fn supports_tools(&self) -> bool {
        true
    }
}

struct MockTool;

#[async_trait]
impl Tool for MockTool {
    fn name(&self) -> &str {
        "mock_tool"
    }

    fn description(&self) -> &str {
        "mock tool"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "value": { "type": "string" }
            }
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        Ok(ToolResult {
            success: true,
            output: format!(
                "echo:{}",
                input.get("value").and_then(|v| v.as_str()).unwrap_or_default()
            ),
            error: None,
        })
    }
}

#[tokio::test]
async fn tool_lifecycle_events_include_correlation_ids() {
    let event_bus = Arc::new(EventBus::new(false));
    let mut rx = event_bus.subscribe();

    let mut registry = ToolRegistry::new();
    registry.register(MockTool);

    let soul_path = tempfile::NamedTempFile::new().unwrap().into_temp_path();
    let mut soul_manager = SoulManager::new(soul_path.to_path_buf());
    soul_manager.load().unwrap();

    let llm = Arc::new(SequencedLlm::new());
    let mut agent = Agent::new(registry, Config::default(), soul_manager, event_bus).with_llm(llm);

    let result = agent.run("use the tool then finish").await.unwrap();
    assert!(result.success);

    tokio::time::sleep(Duration::from_millis(20)).await;
    let mut events = Vec::new();
    while let Ok(event) = rx.try_recv() {
        events.push(event);
    }

    let tool_call_seen = events.iter().any(|event| {
        matches!(
            (&event.component, &event.event_type, &event.data),
            (
                Component::Tool,
                EventType::ToolCall,
                EventData::ToolCall {
                    tool,
                    tool_use_id: Some(tool_use_id),
                    correlation_id: Some(correlation_id),
                    is_concurrency_safe: Some(true),
                    ..
                }
            ) if tool == "mock_tool" && tool_use_id == "toolu_1" && correlation_id == "toolu_1"
        )
    });
    assert!(tool_call_seen, "expected tool call event with correlation fields");

    let mut lifecycle_states = events
        .iter()
        .filter_map(|event| match (&event.component, &event.event_type, &event.data) {
            (
                Component::Tool,
                EventType::ToolProgress,
                EventData::ToolProgress {
                    tool,
                    tool_use_id: Some(tool_use_id),
                    correlation_id: Some(correlation_id),
                    state: Some(state),
                    is_concurrency_safe: Some(true),
                    ..
                },
            ) if tool == "mock_tool" && tool_use_id == "toolu_1" && correlation_id == "toolu_1" => {
                Some(state.clone())
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    lifecycle_states.sort();

    assert!(lifecycle_states.contains(&"queued".to_string()));
    assert!(lifecycle_states.contains(&"executing".to_string()));
    assert!(lifecycle_states.contains(&"completed".to_string()));
}
