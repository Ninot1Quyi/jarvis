//! Interrupt handling - based on L5 principle: human always in control
//!
//! Users can interrupt at any time via keyboard (Ctrl+C) or voice ("stop", "wait")

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Interrupt signal type
#[derive(Debug, Clone, Copy)]
pub enum InterruptSignal {
    Keyboard,
    VoiceStop,
    VoiceWait,
}

/// Interrupt handler - manages user interrupt signals
pub struct InterruptHandler {
    is_interrupted: Arc<AtomicBool>,
    interrupt_tx: mpsc::Sender<InterruptSignal>,
    interrupt_rx: Arc<parking_lot::Mutex<Option<mpsc::Receiver<InterruptSignal>>>>,
}

impl InterruptHandler {
    /// Create a new interrupt handler
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel(10);
        Self {
            is_interrupted: Arc::new(AtomicBool::new(false)),
            interrupt_tx: tx,
            interrupt_rx: Arc::new(parking_lot::Mutex::new(Some(rx))),
        }
    }

    /// Check if interrupt was triggered
    pub fn check(&self) -> bool {
        self.is_interrupted.load(Ordering::SeqCst)
    }

    /// Trigger an interrupt
    pub fn trigger(&self, signal: InterruptSignal) {
        self.is_interrupted.store(true, Ordering::SeqCst);
        let _ = self.interrupt_tx.try_send(signal);
    }

    /// Clear the interrupt flag
    pub fn clear(&self) {
        self.is_interrupted.store(false, Ordering::SeqCst);
    }

    /// Get a receiver for interrupt signals
    pub fn receiver(&self) -> Option<mpsc::Receiver<InterruptSignal>> {
        self.interrupt_rx.lock().take()
    }

    /// Get the interrupt sender (for forwarding)
    pub fn sender(&self) -> mpsc::Sender<InterruptSignal> {
        self.interrupt_tx.clone()
    }
}

impl Default for InterruptHandler {
    fn default() -> Self {
        Self::new()
    }
}

/// Keyboard interrupt watcher
pub struct KeyboardInterrupt {
    handler: Arc<InterruptHandler>,
}

impl KeyboardInterrupt {
    pub fn new(handler: Arc<InterruptHandler>) -> Self {
        Self { handler }
    }

    /// Check for keyboard interrupt (Ctrl+C)
    ///
    /// Call this periodically in the event loop
    pub fn check(&self) -> bool {
        // In a real implementation, this would check for Ctrl+C
        // For now, we just check the interrupt flag
        self.handler.check()
    }
}

/// Voice interrupt detector
pub struct VoiceInterrupt {
    trigger_words: Vec<String>,
}

impl VoiceInterrupt {
    pub fn new() -> Self {
        Self {
            trigger_words: vec![
                "stop".to_string(),
                "wait".to_string(),
                "cancel".to_string(),
                "hold on".to_string(),
            ],
        }
    }

    /// Check if text contains a trigger word
    pub fn contains_trigger(&self, text: &str) -> bool {
        let lower = text.to_lowercase();
        self.trigger_words.iter().any(|w| lower.contains(w))
    }
}

impl Default for VoiceInterrupt {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_interrupt_handler() {
        let handler = InterruptHandler::new();
        assert!(!handler.check());

        handler.trigger(InterruptSignal::Keyboard);
        assert!(handler.check());

        handler.clear();
        assert!(!handler.check());
    }

    #[test]
    fn test_voice_interrupt() {
        let detector = VoiceInterrupt::new();
        assert!(detector.contains_trigger("please stop what you're doing"));
        assert!(detector.contains_trigger("wait a minute"));
        assert!(!detector.contains_trigger("this is interesting"));
    }
}
