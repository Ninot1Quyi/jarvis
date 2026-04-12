//! SOUL module - self-evolving personality manifest
//!
//! Based on Harness Engineering: **Documented** — not just what, but why and how it fails
//!
//! SOUL.md is NOT a static prompt — it's a living document evolved through experience

pub mod evolver;
mod loader;
pub mod parser;

pub use evolver::SoulEvolver;
pub use loader::SoulLoader;
pub use parser::{Soul, SoulCapabilities, SoulGoals, SoulHabits, SoulPersonality, SoulPreferences};

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// User preferences learned over time
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UserPreference {
    pub key: String,
    pub value: serde_json::Value,
}

/// A habit the agent has developed
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Habit {
    pub tool: String,
    pub approach: String,
    pub success_count: u32,
    pub failure_count: u32,
}

impl Habit {
    pub fn success_rate(&self) -> f32 {
        let total = self.success_count + self.failure_count;
        if total == 0 {
            return 0.5; // Neutral if no data
        }
        self.success_count as f32 / total as f32
    }
}

/// A goal the agent is working towards
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Goal {
    pub description: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub completed: bool,
}

/// Tool weights for multi-dimensional selection
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolWeights {
    pub quality: f32,
    pub efficiency: f32,
    pub preference: f32,
    pub habit: f32,
}

impl Default for ToolWeights {
    fn default() -> Self {
        Self {
            quality: 0.4,
            efficiency: 0.3,
            preference: 0.2,
            habit: 0.1,
        }
    }
}

/// Memory weights for hybrid search
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemoryWeights {
    pub vector: f32,
    pub bm25: f32,
}

impl Default for MemoryWeights {
    fn default() -> Self {
        Self {
            vector: 0.7,
            bm25: 0.3,
        }
    }
}

/// Voice preferences
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VoicePreferences {
    pub speed: f32,
    pub emotion: String,
    pub voice_id: String,
}

impl Default for VoicePreferences {
    fn default() -> Self {
        Self {
            speed: 1.0,
            emotion: "calm".to_string(),
            voice_id: "male-qn-qingse".to_string(),
        }
    }
}

/// SOUL manager - loads, persists, and evolves SOUL.md
pub struct SoulManager {
    path: PathBuf,
    soul: Soul,
    dirty: bool,
}

impl SoulManager {
    /// Create a new SOUL manager
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            soul: Soul::default(),
            dirty: false,
        }
    }

    /// Load SOUL from disk
    pub fn load(&mut self) -> std::io::Result<()> {
        if self.path.exists() {
            let content = std::fs::read_to_string(&self.path)?;
            self.soul = serde_yaml::from_str(&content)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        }
        Ok(())
    }

    /// Save SOUL to disk
    pub fn save(&self) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_yaml::to_string(&self.soul)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(&self.path, content)
    }

    /// Get the current SOUL
    pub fn soul(&self) -> &Soul {
        &self.soul
    }

    /// Update a preference
    pub fn update_preference(&mut self, key: String, value: serde_json::Value) {
        self.soul.preferences.preferences.insert(key, value);
        self.dirty = true;
    }

    /// Update a habit
    pub fn update_habit(&mut self, tool: String, approach: String, success: bool) {
        let tool_key = tool.clone();
        let habit = self
            .soul
            .habits
            .habits
            .entry(tool_key)
            .or_insert_with(|| Habit {
                tool,
                approach,
                success_count: 0,
                failure_count: 0,
            });

        if success {
            habit.success_count += 1;
        } else {
            habit.failure_count += 1;
        }
        self.dirty = true;
    }

    /// Check if SOUL needs saving
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Mark as saved
    pub fn mark_saved(&mut self) {
        self.dirty = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_habit_success_rate() {
        let habit = Habit {
            tool: "bash".to_string(),
            approach: "git commit".to_string(),
            success_count: 8,
            failure_count: 2,
        };
        assert!((habit.success_rate() - 0.8).abs() < 0.001);
    }

    #[test]
    fn test_default_soul() {
        let soul = Soul::default();
        assert!(soul.capabilities.skills.is_empty());
        assert!(soul.preferences.preferences.is_empty());
    }
}
