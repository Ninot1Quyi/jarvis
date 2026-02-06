//! Windows Liquid Glass Implementation
//!
//! Uses Acrylic/Mica effects via window-vibrancy crate.

use tauri::WebviewWindow;

/// Apply Acrylic/Mica effect on Windows
pub fn apply_effect(window: &WebviewWindow) {
    use window_vibrancy::{apply_mica, apply_acrylic};

    // Try Mica first (Windows 11), fall back to Acrylic (Windows 10)
    if apply_mica(window, Some(true)).is_err() {
        // Acrylic with dark tint
        let _ = apply_acrylic(window, Some((18, 18, 18, 180)));
    }
}

/// Remove the vibrancy effect from the window
pub fn remove_effect(_window: &WebviewWindow) {
    // window-vibrancy doesn't provide a remove function
}
