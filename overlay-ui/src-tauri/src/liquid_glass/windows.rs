//! Windows Liquid Glass Implementation
//!
//! Uses Acrylic/Mica effects via window-vibrancy crate.

use tauri::WebviewWindow;

/// Apply Acrylic effect on Windows
/// 
/// Uses transparent Acrylic for true glass effect.
/// Note: Acrylic requires Windows 10 version 1803 or later.
pub fn apply_effect(window: &WebviewWindow) {
    use window_vibrancy::apply_acrylic;

    // Use Acrylic with very subtle dark tint
    // RGB: 20, 20, 20 with 60 opacity (~75% transparent)
    // This creates a true glass effect showing desktop behind
    if let Err(e) = apply_acrylic(window, Some((20, 20, 20, 60))) {
        eprintln!("Failed to apply Acrylic effect: {}", e);
    }
}

/// Remove the vibrancy effect from the window
/// 
/// Note: window-vibrancy doesn't provide a remove function,
/// so this is a no-op for now.
pub fn remove_effect(_window: &WebviewWindow) {
    // window-vibrancy doesn't provide a remove function
}
