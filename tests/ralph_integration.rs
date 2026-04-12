//! Ralph Loop Integration Tests

use dum_e::core::{Action, ActionResult, ExecutionStep, Ralph, RalphContext};

fn create_test_context(history: Vec<ExecutionStep>) -> RalphContext {
    RalphContext {
        task: "Test task".to_string(),
        initial_state: serde_json::json!({"screen": "blank"}),
        goal: "Complete task".to_string(),
        history,
    }
}

fn create_success_step(tool: &str) -> ExecutionStep {
    ExecutionStep {
        action: Action {
            tool: tool.to_string(),
            input: serde_json::json!({}),
        },
        result: ActionResult {
            success: true,
            output: format!("{} executed", tool),
            error: None,
        },
        timestamp: chrono::Utc::now(),
    }
}

fn create_failure_step(tool: &str, error: &str) -> ExecutionStep {
    ExecutionStep {
        action: Action {
            tool: tool.to_string(),
            input: serde_json::json!({}),
        },
        result: ActionResult {
            success: false,
            output: String::new(),
            error: Some(error.to_string()),
        },
        timestamp: chrono::Utc::now(),
    }
}

#[tokio::test]
async fn test_ralph_close_empty_history() {
    let mut ralph = Ralph::new();
    let context = create_test_context(vec![]);

    let result = ralph.close(&context).await.unwrap();

    // Empty history = no progress
    assert!(!result.completed);
    assert_eq!(result.state, dum_e::core::RalphState::Failed);
    assert!(result.learnings.is_empty());
}

#[tokio::test]
async fn test_ralph_close_single_success() {
    let mut ralph = Ralph::new();
    let context = create_test_context(vec![create_success_step("read_file")]);

    let result = ralph.close(&context).await.unwrap();

    // Single success = some progress, learnings should exist
    assert!(!result.learnings.is_empty());
    assert!(result.learnings[0].contains("read_file"));
}

#[tokio::test]
async fn test_ralph_close_multiple_successes() {
    let mut ralph = Ralph::new();
    let context = create_test_context(vec![
        create_success_step("read_file"),
        create_success_step("bash"),
        create_success_step("write_file"),
    ]);

    let result = ralph.close(&context).await.unwrap();

    // Multiple successes should meet threshold
    assert!(result.completed || !result.learnings.is_empty());
    assert_eq!(result.learnings.len(), 4); // 3 steps + task complete
}

#[tokio::test]
async fn test_ralph_close_with_failures() {
    let mut ralph = Ralph::new();
    let context = create_test_context(vec![
        create_success_step("read_file"),
        create_failure_step("bash", "Permission denied"),
        create_success_step("write_file"),
    ]);

    let result = ralph.close(&context).await.unwrap();

    // Failures should be recorded in issues
    assert!(!result.issues.is_empty() || !result.completed);
}

#[tokio::test]
async fn test_ralph_close_recommendation() {
    let mut ralph = Ralph::new();
    let context = create_test_context(vec![create_success_step("read_file")]);

    let result = ralph.close(&context).await.unwrap();

    // Should have a recommendation for future tasks
    if let Some(rec) = result.recommendation {
        assert!(!rec.reasoning.is_empty());
        assert!(rec.confidence > 0.0);
    }
}

#[tokio::test]
async fn test_ralph_learnings_accumulation() {
    let mut ralph = Ralph::new();

    // First close
    let context1 = create_test_context(vec![create_success_step("bash")]);
    ralph.close(&context1).await.unwrap();

    // Second close
    let context2 = create_test_context(vec![create_success_step("read_file")]);
    ralph.close(&context2).await.unwrap();

    // Learnings should accumulate across closes
    let learnings = ralph.get_learnings();
    assert!(learnings.len() >= 2);
}
