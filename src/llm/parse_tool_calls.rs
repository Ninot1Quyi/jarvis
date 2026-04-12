//! Text-based tool call parser
//!
//! Parses tool calls from LLM text responses when native tool calls are not available.
//! Format: [TOOL_CALL] { "tool": "name", "args": {...} } [/TOOL_CALL]

use crate::llm::ToolCall;
use regex::Regex;

/// Parse tool calls from text content
pub fn parse_tool_calls_from_text(text: &str) -> (String, Vec<ToolCall>) {
    let _tool_calls: Vec<ToolCall> = Vec::new();
    let mut call_idx = 0;
    let mut thought = String::new();
    let mut tool_calls = Vec::new();

    // Extract thought if present
    if let Ok(thought_re) = Regex::new(r"(?i)<Thought>([\s\S]*?)</Thought>") {
        if let Some(caps) = thought_re.captures(text) {
            thought = caps
                .get(1)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default();
        }
    }

    // Parse tool call blocks: [TOOL_CALL] ... [/TOOL_CALL]
    if let Ok(tool_re) = Regex::new(r"(?i)\[TOOL_CALL\]\s*([\s\S]*?)\s*\[/TOOL_CALL\]") {
        for caps in tool_re.captures_iter(text) {
            if let Some(content) = caps.get(1) {
                let content = content.as_str().trim();
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
                    // Try to extract tool name and arguments
                    let tool_name = json
                        .get("tool")
                        .or_else(|| json.get("name"))
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    let args = json
                        .get("args")
                        .or_else(|| json.get("arguments"))
                        .cloned()
                        .unwrap_or(serde_json::json!({}));

                    if let Some(name) = tool_name {
                        tool_calls.push(ToolCall {
                            id: format!("text_call_{}", call_idx),
                            name,
                            arguments: args,
                        });
                        call_idx += 1;
                    }
                } else if let Ok(obj) =
                    serde_json::from_str::<serde_json::Value>(&format!("{{{}}}", content))
                {
                    // Try parsing as raw object
                    let tool_name = obj
                        .get("tool")
                        .or_else(|| obj.get("name"))
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    let args = obj
                        .get("args")
                        .or_else(|| obj.get("arguments"))
                        .cloned()
                        .unwrap_or(serde_json::json!({}));

                    if let Some(name) = tool_name {
                        tool_calls.push(ToolCall {
                            id: format!("text_call_{}", call_idx),
                            name,
                            arguments: args,
                        });
                        call_idx += 1;
                    }
                }
            }
        }
    }

    // If no tool calls found, check for simple JSON tool calls in text
    if tool_calls.is_empty() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(text) {
            if let Some(tool_name) = json
                .get("tool")
                .or_else(|| json.get("name"))
                .and_then(|v| v.as_str())
            {
                let args = json
                    .get("args")
                    .or_else(|| json.get("arguments"))
                    .cloned()
                    .unwrap_or(serde_json::json!({}));
                tool_calls.push(ToolCall {
                    id: format!("text_call_{}", call_idx),
                    name: tool_name.to_string(),
                    arguments: args,
                });
            }
        }
    }

    (thought, tool_calls)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_tool_call() {
        let text = r#"[TOOL_CALL]{"tool": "bash", "args": {"command": "ls" }}[/TOOL_CALL]"#;
        let (thought, calls) = parse_tool_calls_from_text(text);
        assert!(thought.is_empty());
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "bash");
    }

    #[test]
    fn test_parse_with_thought() {
        let text = r#"<Thought>I should run ls</Thought> [TOOL_CALL]{"tool": "bash", "args": {"command": "ls" }}[/TOOL_CALL]"#;
        let (thought, calls) = parse_tool_calls_from_text(text);
        assert!(thought.contains("run ls"));
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "bash");
    }
}
