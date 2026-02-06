//! Windows Liquid Glass Implementation
//!
//! Uses Acrylic/Mica effects via window-vibrancy crate.

use tauri::WebviewWindow;

/// Apply Acrylic/Mica effect on Windows
/// 
/// Note: Mica is only available on Windows 11. Acrylic works on Windows 10+.
/// Both effects require proper window configuration:
/// - transparent: true in tauri.conf.json
/// - decorations: false (to allow custom titlebar)
pub fn apply_effect(window: &WebviewWindow) {
    use window_vibrancy::{apply_mica, apply_acrylic};

    // Try Mica first (Windows 11), fall back to Acrylic (Windows 10)
    // Mica with dark mode (Some(true))
    if apply_mica(window, Some(true)).is_err() {
        // Acrylic with dark tint (18, 18, 18) at 70% opacity (180)
        // This provides a consistent dark glass effect
        if let Err(e) = apply_acrylic(window, Some((18, 18, 18, 180))) {
            eprintln!("Failed to apply Acrylic effect: {}", e);
        }
    }
}

/// Remove the vibrancy effect from the window
/// 
/// Note: window-vibrancy doesn't provide a remove function,
/// so this is a no-op for now.
pub fn remove_effect(_window: &WebviewWindow) {
    // window-vibrancy doesn't provide a remove function
}
