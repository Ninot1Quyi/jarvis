//! MiniMax TTS (Text-to-Audio) implementation
//!
//! Based on MiniMax T2A API v2
//! Endpoint: POST https://api.minimax.io/v1/t2a_v2

use super::MiniMaxClient;
use crate::voice::{
    AudioChunk, AudioStream, SpeakParams, StreamingAudio, VoiceEmotion, VoiceError,
};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use tokio::sync::mpsc;

/// MiniMax T2A request
#[derive(Debug, Serialize)]
pub struct T2ARequest {
    pub model: String,
    pub text: String,
    #[serde(default)]
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_options: Option<T2AStreamOption>,
    pub voice_setting: VoiceSetting,
    pub audio_setting: AudioSetting,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle_enable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_format: Option<String>,
}

/// Stream options for TTS
#[derive(Debug, Serialize)]
pub struct T2AStreamOption {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_aggregated_audio: Option<bool>,
}

/// Voice settings
#[derive(Debug, Serialize)]
pub struct VoiceSetting {
    pub voice_id: String,
    #[serde(default = "default_speed")]
    pub speed: f32,
    #[serde(default = "default_vol")]
    pub vol: f32,
    #[serde(default)]
    pub pitch: i32,
    #[serde(default)]
    pub emotion: String,
}

fn default_speed() -> f32 {
    1.0
}
fn default_vol() -> f32 {
    1.0
}

/// Audio settings
#[derive(Debug, Serialize)]
pub struct AudioSetting {
    #[serde(default = "default_sample_rate")]
    pub sample_rate: u32,
    #[serde(default = "default_bitrate")]
    pub bitrate: u32,
    #[serde(default = "default_format")]
    pub format: String,
    #[serde(default = "default_channel")]
    pub channel: u32,
}

fn default_sample_rate() -> u32 {
    32000
}
fn default_bitrate() -> u32 {
    128000
}
fn default_format() -> String {
    "mp3".to_string()
}
fn default_channel() -> u32 {
    1
}

/// MiniMax T2A response
#[derive(Debug, Deserialize)]
pub struct T2AResponse {
    pub data: Option<T2AResponseData>,
    pub trace_id: String,
    #[serde(default)]
    pub base_resp: BaseResp,
}

/// T2A response data
#[derive(Debug, Deserialize)]
pub struct T2AResponseData {
    pub audio: Option<String>, // hex encoded audio
    #[serde(default)]
    pub subtitle_file: Option<String>,
    pub status: u32, // 1: generating, 2: done
}

/// Base response
#[derive(Debug, Deserialize)]
pub struct BaseResp {
    pub status_code: i32,
    #[serde(default)]
    pub status_msg: String,
}

/// Streaming T2A chunk
#[derive(Debug, Deserialize)]
pub struct T2AStreamChunk {
    pub data: Option<T2AResponseData>,
    pub trace_id: String,
    #[serde(default)]
    pub base_resp: BaseResp,
}

/// MiniMax TTS implementation
pub struct MiniMaxTTS {
    client: MiniMaxClient,
    model: String,
}

impl MiniMaxTTS {
    pub fn new(client: MiniMaxClient, model: String) -> Self {
        Self { client, model }
    }

    /// Synthesize speech (blocking)
    pub async fn speak(&self, text: &str, params: SpeakParams) -> Result<AudioStream, VoiceError> {
        let request = T2ARequest {
            model: self.model.clone(),
            text: text.to_string(),
            stream: false,
            stream_options: None,
            voice_setting: VoiceSetting {
                voice_id: params.voice_id,
                speed: params.speed,
                vol: params.volume,
                pitch: params.pitch,
                emotion: params.emotion.to_string(),
            },
            audio_setting: AudioSetting::default(),
            subtitle_enable: None,
            output_format: Some("hex".to_string()),
        };

        let response = self.client.post("/v1/t2a_v2", &request).await?;

        let result: T2AResponse = response
            .json()
            .await
            .map_err(|e| VoiceError::Api(format!("Failed to parse response: {}", e)))?;

        if result.base_resp.status_code != 0 {
            return Err(VoiceError::Api(format!(
                "T2A API error: {} - {}",
                result.base_resp.status_code, result.base_resp.status_msg
            )));
        }

        let data = result
            .data
            .ok_or_else(|| VoiceError::Api("No audio data in response".to_string()))?;

        let audio_hex = data
            .audio
            .ok_or_else(|| VoiceError::Api("No audio in response data".to_string()))?;

        let audio_bytes = hex::decode(&audio_hex)
            .map_err(|e| VoiceError::Api(format!("Failed to decode audio hex: {}", e)))?;

        Ok(AudioStream {
            chunks: vec![audio_bytes.clone()],
            total_size: audio_bytes.len(),
        })
    }

    /// Synthesize speech with streaming audio output
    pub async fn speak_streaming(
        &self,
        text: &str,
        params: SpeakParams,
    ) -> Result<StreamingAudio, VoiceError> {
        let request = T2ARequest {
            model: self.model.clone(),
            text: text.to_string(),
            stream: true,
            stream_options: Some(T2AStreamOption {
                exclude_aggregated_audio: Some(false),
            }),
            voice_setting: VoiceSetting {
                voice_id: params.voice_id,
                speed: params.speed,
                vol: params.volume,
                pitch: params.pitch,
                emotion: params.emotion.to_string(),
            },
            audio_setting: AudioSetting::default(),
            subtitle_enable: None,
            output_format: Some("hex".to_string()),
        };

        let response = self.client.post("/v1/t2a_v2", &request).await?;

        // For streaming, we need to handle SSE
        let (tx, rx) = mpsc::channel(100);

        // Spawn task to read streaming response
        tokio::spawn(async move {
            // In a real implementation, we would read the SSE stream
            // and send chunks as they arrive
            // For now, just close the channel
            let _ = tx;
        });

        Ok(StreamingAudio { receiver: rx })
    }
}
