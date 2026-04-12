//! SOUL parser - parses SOUL.md YAML format

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Personality traits
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SoulPersonality {
    pub traits: Vec<String>,
}

impl Default for SoulPersonality {
    fn default() -> Self {
        Self { traits: vec![] }
    }
}

/// Capability level
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityLevel {
    Expert,
    Proficient,
    Learning,
    Basic,
}

impl Default for CapabilityLevel {
    fn default() -> Self {
        Self::Basic
    }
}

/// Capabilities map
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SoulCapabilities {
    pub skills: HashMap<String, CapabilityLevel>,
}

impl Default for SoulCapabilities {
    fn default() -> Self {
        Self {
            skills: HashMap::new(),
        }
    }
}

/// User preferences
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SoulPreferences {
    #[serde(flatten)]
    pub preferences: HashMap<String, serde_json::Value>,
}

impl Default for SoulPreferences {
    fn default() -> Self {
        Self {
            preferences: HashMap::new(),
        }
    }
}

/// Habits
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SoulHabits {
    #[serde(flatten)]
    pub habits: HashMap<String, crate::soul::Habit>,
}

impl Default for SoulHabits {
    fn default() -> Self {
        Self {
            habits: HashMap::new(),
        }
    }
}

/// Goals
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SoulGoals {
    pub items: Vec<crate::soul::Goal>,
}

impl Default for SoulGoals {
    fn default() -> Self {
        Self { items: vec![] }
    }
}

/// Complete SOUL document structure
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Soul {
    pub personality: SoulPersonality,
    pub capabilities: SoulCapabilities,
    pub preferences: SoulPreferences,
    pub habits: SoulHabits,
    pub goals: SoulGoals,
    #[serde(default)]
    pub tool_weights: crate::soul::ToolWeights,
    #[serde(default)]
    pub memory_weights: crate::soul::MemoryWeights,
    #[serde(default)]
    pub voice_preferences: crate::soul::VoicePreferences,
}

impl Default for Soul {
    fn default() -> Self {
        Self {
            personality: SoulPersonality::default(),
            capabilities: SoulCapabilities::default(),
            preferences: SoulPreferences::default(),
            habits: SoulHabits::default(),
            goals: SoulGoals::default(),
            tool_weights: crate::soul::ToolWeights::default(),
            memory_weights: crate::soul::MemoryWeights::default(),
            voice_preferences: crate::soul::VoicePreferences::default(),
        }
    }
}
