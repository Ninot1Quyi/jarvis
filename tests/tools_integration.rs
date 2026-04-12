//! Tools Integration Tests

use async_trait::async_trait;
use dum_e::tools::{Tool, ToolContext, ToolResult};

// Mock tool for testing
struct MockTool {
    name: String,
    description: String,
    should_fail: bool,
}

impl MockTool {
    fn new(name: &str, description: &str, should_fail: bool) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            should_fail,
        }
    }
}

#[async_trait]
impl Tool for MockTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "input": { "type": "string" }
            }
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        true
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        if self.should_fail {
            Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Mock failure".to_string()),
            })
        } else {
            let input_text = input
                .get("input")
                .and_then(|v| v.as_str())
                .unwrap_or("default");
            Ok(ToolResult {
                success: true,
                output: format!("Processed: {}", input_text),
                error: None,
            })
        }
    }
}

#[tokio::test]
async fn test_mock_tool_success() {
    let tool = MockTool::new("test_tool", "A test tool", false);
    let context = ToolContext::new();

    let input = serde_json::json!({"input": "hello"});
    let result = tool.call(&input, &context).await.unwrap();

    assert!(result.success);
    assert_eq!(result.output, "Processed: hello");
    assert!(result.error.is_none());
}

#[tokio::test]
async fn test_mock_tool_failure() {
    let tool = MockTool::new("failing_tool", "A failing tool", true);
    let context = ToolContext::new();

    let input = serde_json::json!({"input": "test"});
    let result = tool.call(&input, &context).await.unwrap();

    assert!(!result.success);
    assert!(result.error.is_some());
}

#[test]
fn test_tool_schema_generation() {
    let tool = MockTool::new("schema_test", "Test schema", false);

    let schema = tool.input_schema();
    assert_eq!(schema["type"], "object");
    assert!(schema["properties"].get("input").is_some());
}

#[test]
fn test_tool_name_and_description() {
    let tool = MockTool::new("my_tool", "My tool description", false);

    assert_eq!(tool.name(), "my_tool");
    assert_eq!(tool.description(), "My tool description");
}

#[test]
fn test_tool_concurrency_flags() {
    let tool = MockTool::new("test", "Test", false);

    assert!(tool.is_concurrency_safe());
    assert!(tool.is_read_only());
}

#[tokio::test]
async fn test_tool_context_creation() {
    let context = ToolContext::new();

    assert!(!context.session_id.is_empty());
    assert!(context.trace_id.is_none());
}

#[tokio::test]
async fn test_tool_call_without_required_input() {
    let tool = MockTool::new("test", "Test", false);
    let context = ToolContext::new();

    // Empty input should use default
    let input = serde_json::json!({});
    let result = tool.call(&input, &context).await.unwrap();

    assert!(result.success);
    assert_eq!(result.output, "Processed: default");
}

#[test]
fn test_tool_registry_mock() {
    // This tests the concept of tool registry
    let tools: Vec<Box<dyn Tool>> = vec![
        Box::new(MockTool::new("tool1", "First tool", false)),
        Box::new(MockTool::new("tool2", "Second tool", false)),
    ];

    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0].name(), "tool1");
    assert_eq!(tools[1].name(), "tool2");
}

#[tokio::test]
async fn test_multiple_tool_calls() {
    let tool = MockTool::new("multi", "Multi test", false);
    let context = ToolContext::new();

    let inputs = vec![
        serde_json::json!({"input": "first"}),
        serde_json::json!({"input": "second"}),
        serde_json::json!({"input": "third"}),
    ];

    for input in inputs {
        let result = tool.call(&input, &context).await.unwrap();
        assert!(result.success);
    }
}
