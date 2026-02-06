//! Linux Liquid Glass Implementation
//!
//! Linux vibrancy depends on the compositor (KWin, Mutter, Picom, etc.)
//! The transparent window setting should work with compositors that support it.
//! TODO: Investigate compositor-specific APIs

use tauri::WebviewWindow;

/// Apply vibrancy effect on Linux
pub fn apply_effect(_window: &WebviewWindow) {
    // TODO: Implement Linux vibrancy
    //
    // Linux doesn't have a unified API for window vibrancy.
    // Options to explore:
    // - KDE/KWin: KWindowEffects
    // - GNOME/Mutter: Limited support
    // - Picom/Compton: Shader-based blur
    //
    // For now, rely on:
    // 1. transparent: true in tauri.conf.json
    // 2. Compositor settings (user must enable blur in their compositor)
    eprintln!("[liquid_glass] Linux implementation relies on compositor settings");
}

/// Remove the vibrancy effect from the window
pub fn remove_effect(_window: &WebviewWindow) {
    // TODO: Implement removal
    eprintln!("[liquid_glass] Linux remove_effect not yet implemented");
}
