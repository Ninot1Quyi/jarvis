//! Voice dialogue state machine
//!
//! Based on Harness Engineering: **Observable** — state transitions emit events
//! Based on L5 principle: **Interruptible** — user can interrupt at any time
//!
//! State flow: Idle -> Listening -> Processing -> Speaking -> (Idle | Interrupted)

use super::{AudioStream, InterruptHandler, SpeakParams, VoiceError, VoiceProvider};
use crate::message::{Message, MessageRole};
use crate::observability::{Component, Event, EventBus, EventData, EventType};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

/// Voice dialogue state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceDialogueState {
    Idle,
    Listening,
    Processing,
    Speaking,
    Interrupted,
}

impl Default for VoiceDialogueState {
    fn default() -> Self {
        Self::Idle
    }
}

/// Voice dialogue manager
pub struct VoiceDialogue {
    state: VoiceDialogueState,
    voice: Arc<dyn VoiceProvider>,
    llm: Arc<dyn LLMProvider>,
    event_bus: Option<Arc<EventBus>>,
    interrupt_handler: Arc<InterruptHandler>,
    pending_user_text: Option<String>,
    pending_response_text: Option<String>,
}

/// LLM provider trait (simplified for voice)
pub trait LLMProvider: Send + Sync {
    fn chat_stream(
        &self,
        messages: &[crate::message::Message],
    ) -> Pin<Box<dyn Future<Output = Result<String, VoiceError>> + Send + '_>>;
}

struct AgentVoiceLLM {
    inner: Arc<dyn crate::llm::LLMProvider>,
}

impl LLMProvider for AgentVoiceLLM {
    fn chat_stream(
        &self,
        messages: &[crate::message::Message],
    ) -> Pin<Box<dyn Future<Output = Result<String, VoiceError>> + Send + '_>> {
        let inner = self.inner.clone();
        let messages = messages.to_vec();
        Box::pin(async move {
            inner
                .chat_stream(&messages, None)
                .await
                .map(|response| response.message)
                .map_err(|err| VoiceError::Api(format!("voice llm request failed: {}", err)))
        })
    }
}

impl VoiceDialogue {
    /// Create a new voice dialogue manager
    pub fn new(
        voice: Arc<dyn VoiceProvider>,
        llm: Arc<dyn LLMProvider>,
        event_bus: Option<Arc<EventBus>>,
        interrupt_handler: Arc<InterruptHandler>,
    ) -> Self {
        Self {
            state: VoiceDialogueState::Idle,
            voice,
            llm,
            event_bus,
            interrupt_handler,
            pending_user_text: None,
            pending_response_text: None,
        }
    }

    /// Create a voice dialogue using the main agent LLM provider.
    pub fn new_with_agent_llm(
        voice: Arc<dyn VoiceProvider>,
        llm: Arc<dyn crate::llm::LLMProvider>,
        event_bus: Option<Arc<EventBus>>,
        interrupt_handler: Arc<InterruptHandler>,
    ) -> Self {
        Self::new(
            voice,
            Arc::new(AgentVoiceLLM { inner: llm }),
            event_bus,
            interrupt_handler,
        )
    }

    /// Get current state
    pub fn state(&self) -> VoiceDialogueState {
        self.state
    }

    /// Seed a transcript so the dialogue can run without microphone input.
    pub fn seed_transcript(&mut self, text: impl Into<String>) {
        self.pending_user_text = Some(text.into());
    }

    /// Run the voice dialogue loop
    pub async fn run(&mut self) -> Result<(), VoiceError> {
        loop {
            match self.state {
                VoiceDialogueState::Idle => {
                    self.on_idle().await?;
                }
                VoiceDialogueState::Listening => {
                    self.on_listening().await?;
                }
                VoiceDialogueState::Processing => {
                    self.on_processing().await?;
                }
                VoiceDialogueState::Speaking => {
                    self.on_speaking().await?;
                }
                VoiceDialogueState::Interrupted => {
                    self.on_interrupted().await?;
                }
            }

            // Check for interrupt
            if self.interrupt_handler.check() {
                if self.state != VoiceDialogueState::Idle {
                    self.emit_event(EventType::VoiceInterrupt, EventData::Empty);
                    self.state = VoiceDialogueState::Interrupted;
                }
            }
        }
    }

    /// Run a single voice turn and return once the state comes back to idle.
    pub async fn run_once(&mut self) -> Result<(), VoiceError> {
        loop {
            match self.state {
                VoiceDialogueState::Idle => {
                    if self.pending_user_text.is_none() && self.pending_response_text.is_none() {
                        self.on_idle().await?;
                    } else if self.pending_response_text.is_some() {
                        self.state = VoiceDialogueState::Speaking;
                    } else {
                        self.state = VoiceDialogueState::Processing;
                    }
                }
                VoiceDialogueState::Listening => self.on_listening().await?,
                VoiceDialogueState::Processing => self.on_processing().await?,
                VoiceDialogueState::Speaking => self.on_speaking().await?,
                VoiceDialogueState::Interrupted => self.on_interrupted().await?,
            }

            if self.state == VoiceDialogueState::Idle
                && self.pending_user_text.is_none()
                && self.pending_response_text.is_none()
            {
                return Ok(());
            }
        }
    }

    async fn on_idle(&mut self) -> Result<(), VoiceError> {
        self.state = if self.pending_user_text.is_some() {
            VoiceDialogueState::Processing
        } else {
            VoiceDialogueState::Listening
        };
        Ok(())
    }

    async fn on_listening(&mut self) -> Result<(), VoiceError> {
        self.emit_event(EventType::VoiceListenStart, EventData::Empty);

        // Listen for user speech
        let transcription = self.voice.listen().await?;

        self.emit_event(
            EventType::VoiceListenComplete,
            EventData::Message {
                message: transcription.text.clone(),
            },
        );

        self.pending_user_text = Some(transcription.text);
        self.state = VoiceDialogueState::Processing;
        Ok(())
    }

    async fn on_processing(&mut self) -> Result<(), VoiceError> {
        let user_text = self.pending_user_text.take().unwrap_or_default();
        if user_text.trim().is_empty() {
            self.state = VoiceDialogueState::Idle;
            return Ok(());
        }

        let response = self
            .llm
            .chat_stream(&[Message::new(MessageRole::User, &user_text)])
            .await?;
        self.emit_llm_chunk(&response);
        self.pending_response_text = Some(response);
        self.state = VoiceDialogueState::Speaking;
        Ok(())
    }

    async fn on_speaking(&mut self) -> Result<(), VoiceError> {
        let response = self.pending_response_text.take().unwrap_or_default();
        if response.trim().is_empty() {
            self.state = VoiceDialogueState::Idle;
            return Ok(());
        }

        self.emit_event(EventType::VoiceSpeakStart, EventData::Empty);

        let speak_handle = tokio::spawn({
            let voice = self.voice.clone();
            let response = response.clone();
            async move { voice.speak(&response, SpeakParams::default()).await }
        });

        tokio::select! {
            result = speak_handle => {
                let audio = result.map_err(|err| VoiceError::Device(format!("voice speak task failed: {}", err)))??;
                self.emit_voice_audio_chunk(&audio);
                self.emit_event(EventType::VoiceSpeakComplete, EventData::Empty);
                self.state = VoiceDialogueState::Idle;
            }
            _ = self.wait_for_interrupt() => {
                self.voice.stop_speaking();
                self.emit_event(EventType::VoiceInterrupt, EventData::Empty);
                self.state = VoiceDialogueState::Interrupted;
            }
        }

        Ok(())
    }

    async fn on_interrupted(&mut self) -> Result<(), VoiceError> {
        // Save context for potential resume
        self.emit_event(
            EventType::UserInterrupt,
            EventData::Message {
                message: "Voice dialogue interrupted".to_string(),
            },
        );

        // Clear interrupt and return to idle
        self.interrupt_handler.clear();
        self.state = VoiceDialogueState::Idle;
        Ok(())
    }

    async fn wait_for_interrupt(&self) {
        while !self.interrupt_handler.check() {
            tokio::time::sleep(tokio::time::Duration::from_millis(25)).await;
        }
    }

    fn emit_event(&self, event_type: EventType, data: EventData) {
        if let Some(bus) = &self.event_bus {
            let _span = bus.span(Component::Voice, event_type, data);
        }
    }

    fn emit_llm_chunk(&self, text: &str) {
        if let Some(bus) = &self.event_bus {
            bus.publish(Event::new(
                Component::Llm,
                EventType::LlmChunk,
                EventData::LlmChunk {
                    text: text.to_string(),
                },
            ));
        }
    }

    fn emit_voice_audio_chunk(&self, audio: &AudioStream) {
        self.emit_event(
            EventType::VoiceSpeakChunk,
            EventData::VoiceChunk {
                audio_size: audio.total_size,
            },
        );
    }
}

// Re-export message type

#[cfg(test)]
mod tests {
    use super::*;
    use crate::observability::EventType;
    use async_trait::async_trait;

    struct FakeVoiceProvider;

    #[async_trait]
    impl VoiceProvider for FakeVoiceProvider {
        async fn speak(&self, text: &str, _params: SpeakParams) -> Result<AudioStream, VoiceError> {
            Ok(AudioStream {
                chunks: vec![text.as_bytes().to_vec()],
                total_size: text.len(),
            })
        }

        async fn speak_streaming(
            &self,
            _text: &str,
            _params: SpeakParams,
        ) -> Result<super::super::StreamingAudio, VoiceError> {
            Err(VoiceError::NotSupported("unused in test".to_string()))
        }

        fn stop_speaking(&self) {}

        async fn listen(&self) -> Result<super::super::Transcription, VoiceError> {
            Err(VoiceError::NotSupported(
                "listen should be bypassed in test".to_string(),
            ))
        }

        async fn listen_streaming(&self) -> Result<super::super::StreamingAudio, VoiceError> {
            Err(VoiceError::NotSupported("unused in test".to_string()))
        }

        fn is_speaking(&self) -> bool {
            false
        }

        fn is_listening(&self) -> bool {
            false
        }
    }

    struct FakeLLM;

    impl LLMProvider for FakeLLM {
        fn chat_stream(
            &self,
            _messages: &[crate::message::Message],
        ) -> Pin<Box<dyn Future<Output = Result<String, VoiceError>> + Send + '_>> {
            Box::pin(async { Ok("voice response".to_string()) })
        }
    }

    #[tokio::test]
    async fn run_once_processes_seeded_transcript_and_emits_voice_events() {
        let bus = Arc::new(EventBus::new(false));
        let mut rx = bus.subscribe();
        let mut dialogue = VoiceDialogue::new(
            Arc::new(FakeVoiceProvider),
            Arc::new(FakeLLM),
            Some(bus),
            Arc::new(InterruptHandler::new()),
        );
        dialogue.seed_transcript("hello");

        dialogue.run_once().await.unwrap();

        let mut event_types = Vec::new();
        while let Ok(event) = rx.try_recv() {
            event_types.push(event.event_type);
        }

        assert_eq!(dialogue.state(), VoiceDialogueState::Idle);
        assert!(event_types
            .iter()
            .any(|ty| matches!(ty, EventType::LlmChunk)));
        assert!(event_types
            .iter()
            .any(|ty| matches!(ty, EventType::VoiceSpeakStart)));
        assert!(event_types
            .iter()
            .any(|ty| matches!(ty, EventType::VoiceSpeakComplete)));
    }
}
