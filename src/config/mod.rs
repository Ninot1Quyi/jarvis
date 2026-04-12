//! Configuration module - loads settings from config.json
//!
//! Reuses Jarvis's config.json format with MiniMax extensions

use config::{Config as ConfigLoader, ConfigError, File};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// MiniMax API configuration
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MiniMaxConfig {
    #[serde(alias = "apiKey", default)]
    pub api_key: String,
    #[serde(alias = "baseUrl", default = "default_minimax_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_tts_model")]
    pub tts_model: String,
    #[serde(default = "default_voice_id")]
    pub default_voice_id: String,
    #[serde(default = "default_emotion")]
    pub default_emotion: String,
    #[serde(default = "default_speed")]
    pub default_speed: f32,
}

fn default_model() -> String {
    "MiniMax-M2.7-highspeed".to_string()
}

fn default_minimax_base_url() -> String {
    "https://api.minimaxi.com".to_string()
}

fn default_tts_model() -> String {
    "speech-2.8-hd".to_string()
}

fn default_voice_id() -> String {
    "male-qn-qingse".to_string()
}

fn default_emotion() -> String {
    "calm".to_string()
}

fn default_speed() -> f32 {
    1.0
}

/// LLM provider configuration
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LLMConfig {
    pub provider: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
}

/// Voice provider configuration
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VoiceConfig {
    pub provider: String,
    pub minimax: Option<MiniMaxConfig>,
    #[serde(default = "default_voice_enabled")]
    pub enabled: bool,
}

fn default_voice_enabled() -> bool {
    true
}

/// Observability configuration
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ObservabilityConfig {
    #[serde(default = "default_dev_mode")]
    pub dev_mode: bool,
    #[serde(default = "default_traces_dir")]
    pub traces_dir: PathBuf,
}

fn default_dev_mode() -> bool {
    false
}

fn default_traces_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".dum-e")
        .join("traces")
}

/// Main application configuration
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Config {
    pub minimax: Option<MiniMaxConfig>,
    pub llm: Option<LLMConfig>,
    pub voice: Option<VoiceConfig>,
    pub observability: ObservabilityConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            minimax: None,
            llm: None,
            voice: None,
            observability: ObservabilityConfig {
                dev_mode: false,
                traces_dir: default_traces_dir(),
            },
        }
    }
}

impl Config {
    /// Load configuration from config.json
    pub fn load() -> Result<Self, ConfigError> {
        Self::load_from("config.json")
    }

    /// Load configuration from a specific path
    pub fn load_from(path: impl AsRef<str>) -> Result<Self, ConfigError> {
        let builder = ConfigLoader::builder().set_default("observability.dev_mode", false)?;

        // Try to find config.json in current directory or parent directories
        let config_path = find_config_file(path.as_ref())?;

        if let Some(path) = config_path {
            builder.add_source(File::from(path.as_path()).required(false))
        } else {
            builder
        }
        .build()?
        .try_deserialize()
    }

    /// Get MiniMax config, using defaults if not specified
    pub fn minimax(&self) -> MiniMaxConfig {
        self.minimax.clone().unwrap_or(MiniMaxConfig {
            api_key: std::env::var("MINIMAX_API_KEY").unwrap_or_default(),
            base_url: default_minimax_base_url(),
            model: default_model(),
            tts_model: default_tts_model(),
            default_voice_id: default_voice_id(),
            default_emotion: default_emotion(),
            default_speed: default_speed(),
        })
    }
}

/// Find config.json by searching up the directory tree
fn find_config_file(name: &str) -> Result<Option<PathBuf>, ConfigError> {
    let mut dir = std::env::current_dir()
        .map_err(|e| ConfigError::Message(format!("Failed to get current directory: {}", e)))?;

    loop {
        let config_path = dir.join(name);
        if config_path.exists() {
            return Ok(Some(config_path));
        }

        // Stop at filesystem root
        if !dir.pop() {
            return Ok(None);
        }
    }
}

// Need dirs crate for home directory
mod dirs {
    use std::path::PathBuf;

    pub fn home_dir() -> Option<PathBuf> {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var("USERPROFILE").map(PathBuf::from).ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert!(!config.observability.dev_mode);
    }
}
