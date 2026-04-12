//! SOUL evolver - evolves SOUL.md based on agent experiences

use super::{parser::CapabilityLevel, Goal, Habit, Soul};
use serde::{Deserialize, Serialize};

/// A lesson learned by the agent
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SoulLesson {
    /// User preference was expressed
    Preference {
        key: String,
        value: serde_json::Value,
    },

    /// A habit was observed
    Habit {
        tool: String,
        approach: String,
        success: bool,
    },

    /// A capability level changed
    Capability { tool: String, level: String },

    /// A goal was completed
    GoalCompleted { description: String },

    /// A new goal was added
    GoalAdded { description: String },

    /// Voice preference was expressed
    VoicePreference {
        speed: Option<f32>,
        emotion: Option<String>,
        voice_id: Option<String>,
    },
}

/// SOUL evolver - processes lessons and updates SOUL
pub struct SoulEvolver;

impl SoulEvolver {
    /// Process a lesson and apply it to SOUL
    pub fn evolve(soul: &mut Soul, lesson: &SoulLesson) {
        match lesson {
            SoulLesson::Preference { key, value } => {
                soul.preferences
                    .preferences
                    .insert(key.clone(), value.clone());
            }
            SoulLesson::Habit {
                tool,
                approach,
                success,
            } => {
                let habit = soul
                    .habits
                    .habits
                    .entry(tool.clone())
                    .or_insert_with(|| Habit {
                        tool: tool.clone(),
                        approach: approach.clone(),
                        success_count: 0,
                        failure_count: 0,
                    });

                if *success {
                    habit.success_count += 1;
                } else {
                    habit.failure_count += 1;
                }
            }
            SoulLesson::Capability { tool, level } => {
                let lvl = match level.as_str() {
                    "expert" => CapabilityLevel::Expert,
                    "proficient" => CapabilityLevel::Proficient,
                    "learning" => CapabilityLevel::Learning,
                    _ => CapabilityLevel::Basic,
                };
                soul.capabilities.skills.insert(tool.clone(), lvl);
            }
            SoulLesson::GoalCompleted { description } => {
                for goal in &mut soul.goals.items {
                    if goal.description == *description {
                        goal.completed = true;
                        break;
                    }
                }
            }
            SoulLesson::GoalAdded { description } => {
                soul.goals.items.push(Goal {
                    description: description.clone(),
                    created_at: chrono::Utc::now(),
                    completed: false,
                });
            }
            SoulLesson::VoicePreference {
                speed,
                emotion,
                voice_id,
            } => {
                if let Some(s) = speed {
                    soul.voice_preferences.speed = *s;
                }
                if let Some(e) = emotion {
                    soul.voice_preferences.emotion = e.clone();
                }
                if let Some(v) = voice_id {
                    soul.voice_preferences.voice_id = v.clone();
                }
            }
        }
    }

    /// Evolve multiple lessons at once
    pub fn evolve_all(soul: &mut Soul, lessons: &[SoulLesson]) {
        for lesson in lessons {
            Self::evolve(soul, lesson);
        }
    }

    /// Extract lessons from agent behavior
    pub fn extract_lessons_from_result(
        tool_used: &str,
        approach: &str,
        success: bool,
        output_length: usize,
    ) -> Vec<SoulLesson> {
        let mut lessons = vec![SoulLesson::Habit {
            tool: tool_used.to_string(),
            approach: approach.to_string(),
            success,
        }];

        // If output was very long, agent is being verbose - might need to adjust
        if output_length > 10000 {
            lessons.push(SoulLesson::Preference {
                key: "verbosity".to_string(),
                value: serde_json::json!("terse"),
            });
        }

        lessons
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_evolve_preference() {
        let mut soul = Soul::default();
        let lesson = SoulLesson::Preference {
            key: "theme".to_string(),
            value: serde_json::json!("dark"),
        };

        SoulEvolver::evolve(&mut soul, &lesson);
        assert_eq!(
            soul.preferences.preferences.get("theme").unwrap(),
            &serde_json::json!("dark")
        );
    }

    #[test]
    fn test_evolve_habit() {
        let mut soul = Soul::default();
        let lesson = SoulLesson::Habit {
            tool: "bash".to_string(),
            approach: "git commit".to_string(),
            success: true,
        };

        SoulEvolver::evolve(&mut soul, &lesson);
        let habit = soul.habits.habits.get("bash").unwrap();
        assert_eq!(habit.success_count, 1);
        assert_eq!(habit.failure_count, 0);
    }
}
