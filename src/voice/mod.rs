//! Voice module - MiniMax TTS/ASR as first-class I/O channel
//!
//! Based on Harness Engineering: **Observable** — voice events emit to EventBus
//! Based on L5 principle: **Interruptible** — user can interrupt at any time
//!
//! Pluggable architecture: VoiceProvider trait allows swapping MiniMax for other engines

mod dialogue;
mod interrupt;
mod provider;

#[cfg(feature = "minimax")]
pub mod minimax;

pub use dialogue::VoiceDialogue;
pub use interrupt::{InterruptHandler, InterruptSignal};
pub use provider::{SpeakParams, VoiceEmotion, VoiceProvider};

use async_trait::async_trait;

/// Audio stream from TTS
pub struct AudioStream {
    pub chunks: Vec<Vec<u8>>,
    pub total_size: usize,
}

/// Transcription from ASR
#[derive(Debug, Clone)]
pub struct Transcription {
    pub text: String,
    pub confidence: f32,
}

/// Streaming audio chunks
pub struct StreamingAudio {
    pub receiver: tokio::sync::mpsc::Receiver<Result<AudioChunk, VoiceError>>,
}

impl StreamingAudio {
    pub async fn next(&mut self) -> Option<Result<AudioChunk, VoiceError>> {
        self.receiver.recv().await
    }
}

/// An audio chunk from streaming TTS
pub struct AudioChunk {
    pub data: Vec<u8>,
    pub is_final: bool,
}

/// Voice error types
#[derive(Debug, thiserror::Error)]
pub enum VoiceError {
    #[error("API error: {0}")]
    Api(String),

    #[error("Audio device error: {0}")]
    Device(String),

    #[error("Interrupted")]
    Interrupted,

    #[error("Not supported: {0}")]
    NotSupported(String),
}

/// Mock voice provider for testing
pub struct MockVoiceProvider {
    pub is_speaking: bool,
    pub is_listening: bool,
}

#[async_trait]
impl VoiceProvider for MockVoiceProvider {
    async fn speak(&self, _text: &str, _params: SpeakParams) -> Result<AudioStream, VoiceError> {
        Ok(AudioStream {
            chunks: vec![vec![0u8; 1000]],
            total_size: 1000,
        })
    }

    async fn speak_streaming(
        &self,
        _text: &str,
        _params: SpeakParams,
    ) -> Result<StreamingAudio, VoiceError> {
        unimplemented!()
    }

    fn stop_speaking(&self) {}

    async fn listen(&self) -> Result<Transcription, VoiceError> {
        Ok(Transcription {
            text: "hello".to_string(),
            confidence: 0.9,
        })
    }

    async fn listen_streaming(&self) -> Result<StreamingAudio, VoiceError> {
        unimplemented!()
    }

    fn is_speaking(&self) -> bool {
        self.is_speaking
    }

    fn is_listening(&self) -> bool {
        self.is_listening
    }
}
