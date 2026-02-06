//! macOS Liquid Glass Implementation
//!
//! Uses window-vibrancy crate for native vibrancy effect.
//! Note: NSGlassEffectView (macOS 26+) does not have a `state` property,
//! so we use NSVisualEffectView with state=Active for proper background updates.

use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
use cocoa::appkit::NSColor;

/// Apply vibrancy effect with state=Active to ensure background updates
/// even when window is not focused.
///
/// Note: We use NSVisualEffectView instead of NSGlassEffectView because
/// NSGlassEffectView (macOS 26+) does not support the `state` property
/// needed to keep the background updating when the window loses focus.
pub fn apply_effect(window: &WebviewWindow) {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

    // Set window properties FIRST (before applying vibrancy)
    set_window_appearance_active(window);

    // Ensure window is fully transparent
    set_window_transparent(window);

    // Use NSVisualEffectView with state=Active
    // This ensures the background updates even when window is not focused
    // UnderWindowBackground is the most transparent material
    let result = apply_vibrancy(
        window,
        NSVisualEffectMaterial::UnderWindowBackground, // Most transparent
        Some(NSVisualEffectState::Active), // KEY: Always active, never dims
        Some(12.0),                         // Corner radius
    );

    match result {
        Ok(_) => {
            println!("[liquid_glass] Applied vibrancy with state=Active");
        }
        Err(e) => {
            eprintln!("[liquid_glass] Vibrancy failed: {:?}", e);
        }
    }
}

/// Set window background to completely transparent
#[cfg(target_os = "macos")]
fn set_window_transparent(window: &WebviewWindow) {
    use cocoa::base::{id, nil};
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        if let Ok(ns_window_ptr) = window.ns_window() {
            let ns_window: id = ns_window_ptr as id;

            // Set window background to clear color
            let _: () = msg_send![ns_window, setBackgroundColor: NSColor::clearColor(nil)];

            // Set opaque to false for full transparency
            let _: () = msg_send![ns_window, setOpaque: false];

            // Remove any window shadow
            let _: () = msg_send![ns_window, setHasShadow: false];

            println!("[liquid_glass] Set window to fully transparent");
        }
    }
}

/// Set window to appear active even when unfocused
#[cfg(target_os = "macos")]
fn set_window_appearance_active(window: &WebviewWindow) {
    use cocoa::base::id;
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        if let Ok(ns_window_ptr) = window.ns_window() {
            let ns_window: id = ns_window_ptr as id;

            // Keep window from hiding when another app activates
            let _: () = msg_send![ns_window, setHidesOnDeactivate: false];

            // Set window level to floating to stay on top
            let _: () = msg_send![ns_window, setLevel: 3_i64]; // NSFloatingWindowLevel

            // Set collection behavior
            // NSWindowCollectionBehaviorCanJoinAllSpaces = 1 << 0
            // NSWindowCollectionBehaviorStationary = 1 << 4
            // NSWindowCollectionBehaviorIgnoresCycle = 1 << 6
            let behavior: u64 = (1 << 0) | (1 << 4) | (1 << 6);
            let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

            println!("[liquid_glass] Set window properties for background updates");
        }
    }
}

/// Remove the vibrancy effect from the window
pub fn remove_effect(window: &WebviewWindow) {
    use window_vibrancy::clear_vibrancy;

    let _ = clear_vibrancy(window);
}
