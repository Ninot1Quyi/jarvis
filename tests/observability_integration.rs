//! Observability Integration Tests

use dum_e::observability::EventData;

#[test]
fn test_event_data_message_serialization() {
    let data = EventData::Message {
        message: "test message".to_string(),
    };
    let json = serde_json::to_string(&data).unwrap();
    assert!(json.contains("test message"));
}

#[test]
fn test_event_data_error_serialization() {
    let data = EventData::Error {
        error: "error occurred".to_string(),
    };
    let json = serde_json::to_string(&data).unwrap();
    assert!(json.contains("error occurred"));
}

#[test]
fn test_event_data_tool_call() {
    let data = EventData::ToolCall {
        tool: "bash".to_string(),
        input: serde_json::json!({"cmd": "ls"}),
    };
    let json = serde_json::to_string(&data).unwrap();
    assert!(json.contains("bash"));
}

#[test]
fn test_trace_id_creation() {
    let trace = dum_e::observability::TraceId::new();
    let s = trace.as_str();
    assert!(!s.is_empty());
    assert!(s.len() >= 8);
}

#[test]
fn test_span_id_creation() {
    let span = dum_e::observability::SpanId::new();
    let s = span.as_str();
    assert!(!s.is_empty());
}

#[test]
fn test_trace_id_display() {
    let trace = dum_e::observability::TraceId::new();
    let s = format!("{}", trace);
    assert!(!s.is_empty());
}
