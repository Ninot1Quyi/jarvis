//! Liquid Glass Effect Module
//!
//! Provides native transparent vibrancy effects across platforms.
//! - macOS: NSVisualEffectView
//! - Windows: Acrylic/Mica (TODO)
//! - Linux: Compositor-based (TODO)

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

use tauri::WebviewWindow;

/// Apply liquid glass effect to a window.
/// This creates a native transparent vibrancy background that shows
/// content behind the window with blur/refraction effects.
pub fn apply(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::apply_effect(window);

    #[cfg(target_os = "windows")]
    windows::apply_effect(window);

    #[cfg(target_os = "linux")]
    linux::apply_effect(window);
}

/// Remove liquid glass effect from a window.
#[allow(dead_code)]
pub fn remove(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::remove_effect(window);

    #[cfg(target_os = "windows")]
    windows::remove_effect(window);

    #[cfg(target_os = "linux")]
    linux::remove_effect(window);
}
