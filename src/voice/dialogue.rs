//! Voice dialogue state machine
//!
//! Based on Harness Engineering: **Observable** — state transitions emit events
//! Based on L5 principle: **Interruptible** — user can interrupt at any time
//!
//! State flow: Idle -> Listening -> Processing -> Speaking -> (Idle | Interrupted)

use super::{InterruptHandler, VoiceError, VoiceProvider};
use crate::observability::{Component, EventBus, EventData, EventType};
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
}

/// LLM provider trait (simplified for voice)
pub trait LLMProvider: Send + Sync {
    fn chat_stream(
        &self,
        messages: &[crate::message::Message],
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, VoiceError>> + Send + '_>>;
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
        }
    }

    /// Get current state
    pub fn state(&self) -> VoiceDialogueState {
        self.state
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

    async fn on_idle(&mut self) -> Result<(), VoiceError> {
        // Wait for wake or explicit start
        // For now, just transition to listening
        self.state = VoiceDialogueState::Listening;
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

        // Transition to processing
        self.state = VoiceDialogueState::Processing;
        Ok(())
    }

    async fn on_processing(&mut self) -> Result<(), VoiceError> {
        // This is where we'd process with LLM
        // For now, just transition to speaking
        self.state = VoiceDialogueState::Speaking;
        Ok(())
    }

    async fn on_speaking(&mut self) -> Result<(), VoiceError> {
        self.emit_event(EventType::VoiceSpeakStart, EventData::Empty);

        // Check for interrupt while speaking
        let speak_handle = tokio::spawn({
            let _voice = self.voice.clone();
            async move {
                // Placeholder - in real impl, would speak actual text
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                Ok::<(), VoiceError>(())
            }
        });

        tokio::select! {
            _ = speak_handle => {
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
        let _ = self.interrupt_handler.receiver();
        // In real impl, would wait for signal
        tokio::time::sleep(tokio::time::Duration::MAX).await;
    }

    fn emit_event(&self, event_type: EventType, data: EventData) {
        if let Some(bus) = &self.event_bus {
            let _span = bus.span(Component::Voice, event_type, data);
        }
    }
}

// Re-export message type
