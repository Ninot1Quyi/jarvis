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
    use window_vibrancy::apply_acrylic;

    // Use Acrylic with dark tint for consistent dark theme
    // RGB: 30, 30, 30 (dark gray) with 128 opacity (~50% transparent)
    // This ensures background stays dark regardless of Windows theme
    if let Err(e) = apply_acrylic(window, Some((30, 30, 30, 128))) {
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
