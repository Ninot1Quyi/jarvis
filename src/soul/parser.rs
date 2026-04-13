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

/// Soul version information
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SoulVersion {
    #[serde(default = "default_version")]
    pub major: u32,
    #[serde(default)]
    pub minor: u32,
    #[serde(default)]
    pub patch: u32,
    #[serde(default)]
    pub running_from: Option<String>,
}

fn default_version() -> u32 {
    1
}

impl Default for SoulVersion {
    fn default() -> Self {
        Self {
            major: 1,
            minor: 0,
            patch: 0,
            running_from: None,
        }
    }
}

impl SoulVersion {
    /// Bump the patch version (e.g., 1.0.0 -> 1.0.1)
    pub fn bump_patch(&mut self) {
        self.patch += 1;
    }

    /// Bump the minor version (e.g., 1.0.0 -> 1.1.0)
    pub fn bump_minor(&mut self) {
        self.minor += 1;
        self.patch = 0;
    }

    /// Bump the major version (e.g., 1.0.0 -> 2.0.0)
    pub fn bump_major(&mut self) {
        self.major += 1;
        self.minor = 0;
        self.patch = 0;
    }

    /// Format version string like "v1.2.3"
    pub fn version_string(&self) -> String {
        format!("v{}.{}.{}", self.major, self.minor, self.patch)
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
    #[serde(default)]
    pub version: SoulVersion,
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
            version: SoulVersion::default(),
        }
    }
}
