//! VoiceProvider trait - pluggable voice interface

use super::{AudioStream, StreamingAudio, Transcription, VoiceError};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Voice emotion types (MiniMax TTS emotions)
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VoiceEmotion {
    Happy,
    Sad,
    Angry,
    Fearful,
    Disgusted,
    Surprised,
    Calm,
    Fluent,
    Whisper,
}

impl Default for VoiceEmotion {
    fn default() -> Self {
        Self::Calm
    }
}

impl std::fmt::Display for VoiceEmotion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VoiceEmotion::Happy => write!(f, "happy"),
            VoiceEmotion::Sad => write!(f, "sad"),
            VoiceEmotion::Angry => write!(f, "angry"),
            VoiceEmotion::Fearful => write!(f, "fearful"),
            VoiceEmotion::Disgusted => write!(f, "disgusted"),
            VoiceEmotion::Surprised => write!(f, "surprised"),
            VoiceEmotion::Calm => write!(f, "calm"),
            VoiceEmotion::Fluent => write!(f, "fluent"),
            VoiceEmotion::Whisper => write!(f, "whisper"),
        }
    }
}

/// Parameters for TTS speech synthesis
#[derive(Clone, Debug)]
pub struct SpeakParams {
    pub voice_id: String,
    pub speed: f32,
    pub pitch: i32,
    pub volume: f32,
    pub emotion: VoiceEmotion,
}

impl Default for SpeakParams {
    fn default() -> Self {
        Self {
            voice_id: "male-qn-qingse".to_string(),
            speed: 1.0,
            pitch: 0,
            volume: 1.0,
            emotion: VoiceEmotion::Calm,
        }
    }
}

/// Voice provider trait - pluggable TTS/STT engine
///
/// Implement this trait to add a new voice engine (MiniMax, ElevenLabs, Azure, etc.)
#[async_trait]
pub trait VoiceProvider: Send + Sync {
    /// Synthesize speech from text (blocking)
    async fn speak(&self, text: &str, params: SpeakParams) -> Result<AudioStream, VoiceError>;

    /// Synthesize speech with streaming audio output
    async fn speak_streaming(
        &self,
        text: &str,
        params: SpeakParams,
    ) -> Result<StreamingAudio, VoiceError>;

    /// Stop current speech output
    fn stop_speaking(&self);

    /// Convert speech to text
    async fn listen(&self) -> Result<Transcription, VoiceError>;

    /// Listen with streaming transcription
    async fn listen_streaming(&self) -> Result<StreamingAudio, VoiceError>;

    /// Check if currently speaking
    fn is_speaking(&self) -> bool;

    /// Check if currently listening
    fn is_listening(&self) -> bool;
}

/// Voice provider factory
pub struct VoiceProviderFactory;

impl VoiceProviderFactory {
    /// Create a voice provider from config
    #[cfg(feature = "minimax")]
    pub fn create(
        provider: &str,
        config: &crate::config::MiniMaxConfig,
    ) -> Result<Box<dyn VoiceProvider>, VoiceError> {
        match provider {
            "minimax" => Ok(Box::new(
                super::minimax::MiniMaxVoice::new(config.clone())
                    .map_err(|e| VoiceError::Api(e.to_string()))?,
            )),
            _ => Err(VoiceError::NotSupported(format!(
                "Unknown provider: {}",
                provider
            ))),
        }
    }

    /// Create a mock provider for testing
    pub fn create_mock() -> Box<dyn VoiceProvider> {
        Box::new(super::MockVoiceProvider {
            is_speaking: false,
            is_listening: false,
        })
    }
}
