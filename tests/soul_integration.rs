//! SOUL Integration Tests

use dum_e::soul::{parser::CapabilityLevel, Habit, Soul, ToolWeights};

#[test]
fn test_soul_default_has_empty_state() {
    let soul = Soul::default();
    assert!(soul.capabilities.skills.is_empty());
    assert!(soul.preferences.preferences.is_empty());
    assert!(soul.habits.habits.is_empty());
}

#[test]
fn test_soul_parse_minimal() {
    let yaml = r#"
personality:
  traits: []
capabilities:
  skills: {}
preferences: {}
habits: {}
goals:
  items: []
"#;

    let soul: Soul = serde_yaml::from_str(yaml).unwrap();
    assert!(soul.capabilities.skills.is_empty());
}

#[test]
fn test_soul_parse_with_skills() {
    let yaml = r#"
personality:
  traits: []
capabilities:
  skills:
    bash: expert
    typescript: proficient
    rust: learning
preferences: {}
habits: {}
goals:
  items: []
"#;

    let soul: Soul = serde_yaml::from_str(yaml).unwrap();
    assert_eq!(soul.capabilities.skills.len(), 3);
    assert_eq!(
        soul.capabilities.skills.get("bash"),
        Some(&CapabilityLevel::Expert)
    );
    assert_eq!(
        soul.capabilities.skills.get("rust"),
        Some(&CapabilityLevel::Learning)
    );
}

#[test]
fn test_soul_parse_with_preferences() {
    let yaml = r#"
personality:
  traits: []
capabilities:
  skills: {}
preferences:
  voice_speed: 1.0
  voice_emotion: calm
  preferred_tool: cli
habits: {}
goals:
  items: []
"#;

    let soul: Soul = serde_yaml::from_str(yaml).unwrap();
    assert_eq!(
        soul.preferences
            .preferences
            .get("voice_speed")
            .and_then(|v| v.as_f64()),
        Some(1.0)
    );
    assert_eq!(
        soul.preferences
            .preferences
            .get("preferred_tool")
            .and_then(|v| v.as_str()),
        Some("cli")
    );
}

#[test]
fn test_habit_success_rate_calculation() {
    let habit = Habit {
        tool: "test".to_string(),
        approach: "testing".to_string(),
        success_count: 8,
        failure_count: 2,
    };

    assert!((habit.success_rate() - 0.8).abs() < 0.01);
}

#[test]
fn test_habit_success_rate_zero_attempts() {
    let habit = Habit {
        tool: "test".to_string(),
        approach: "testing".to_string(),
        success_count: 0,
        failure_count: 0,
    };

    assert_eq!(habit.success_rate(), 0.5);
}

#[test]
fn test_tool_weights_default() {
    let weights = ToolWeights::default();
    assert!((weights.quality - 0.4).abs() < 0.001);
    assert!((weights.efficiency - 0.3).abs() < 0.001);
    assert!((weights.preference - 0.2).abs() < 0.001);
    assert!((weights.habit - 0.1).abs() < 0.001);
}
