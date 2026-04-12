//! MiniMax voice module - TTS and ASR implementation
//!
//! Based on MiniMax T2A API v2: https://api.minimax.io/v1/t2a_v2

mod asr;
mod client;
mod tts;

pub use asr::MiniMaxASR;
pub use client::MiniMaxClient;
pub use tts::MiniMaxTTS;

use super::{InterruptHandler, VoiceDialogue, VoiceProvider};
use crate::config::MiniMaxConfig;
use std::sync::Arc;

/// MiniMax voice provider combining TTS and ASR
pub struct MiniMaxVoice {
    client: MiniMaxClient,
    tts: MiniMaxTTS,
    asr: MiniMaxASR,
    is_speaking: std::sync::atomic::AtomicBool,
    is_listening: std::sync::atomic::AtomicBool,
}

impl MiniMaxVoice {
    /// Create a new MiniMax voice provider
    pub fn new(config: MiniMaxConfig) -> Result<Self, crate::voice::VoiceError> {
        let client = MiniMaxClient::new(config.api_key.clone(), config.base_url.clone())?;

        let tts = MiniMaxTTS::new(client.clone(), config.tts_model.clone());
        let asr = MiniMaxASR::new(client);

        Ok(Self {
            client,
            tts,
            asr,
            is_speaking: std::sync::atomic::AtomicBool::new(false),
            is_listening: std::sync::atomic::AtomicBool::new(false),
        })
    }
}

impl VoiceProvider for MiniMaxVoice {
    async fn speak(
        &self,
        text: &str,
        params: super::SpeakParams,
    ) -> Result<super::AudioStream, super::VoiceError> {
        self.is_speaking
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let result = self.tts.speak(text, params).await;
        self.is_speaking
            .store(false, std::sync::atomic::Ordering::SeqCst);
        result
    }

    async fn speak_streaming(
        &self,
        text: &str,
        params: super::SpeakParams,
    ) -> Result<super::StreamingAudio, super::VoiceError> {
        self.is_speaking
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(self.tts.speak_streaming(text, params).await?)
    }

    fn stop_speaking(&self) {
        self.is_speaking
            .store(false, std::sync::atomic::Ordering::SeqCst);
        // In real impl, would cancel ongoing request
    }

    async fn listen(&self) -> Result<super::Transcription, super::VoiceError> {
        self.is_listening
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let result = self.asr.listen().await;
        self.is_listening
            .store(false, std::sync::atomic::Ordering::SeqCst);
        result
    }

    async fn listen_streaming(&self) -> Result<super::StreamingAudio, super::VoiceError> {
        self.is_listening
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(self.asr.listen_streaming().await?)
    }

    fn is_speaking(&self) -> bool {
        self.is_speaking.load(std::sync::atomic::Ordering::SeqCst)
    }

    fn is_listening(&self) -> bool {
        self.is_listening.load(std::sync::atomic::Ordering::SeqCst)
    }
}
