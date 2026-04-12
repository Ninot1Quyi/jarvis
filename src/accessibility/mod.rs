//! Accessibility and UI state observation helpers.
//!
//! This is a Rust-side migration of the most important Jarvis concepts:
//! query/search, full UI state snapshots, and post-action state diffs.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccessibilityElement {
    pub role: String,
    #[serde(default)]
    pub raw_role: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    pub center: [i32; 2],
    pub bounds: [i32; 4],
    #[serde(default)]
    pub interactive: bool,
    #[serde(default)]
    pub similarity: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessibilityQueryResult {
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(rename = "elementAtPoint", default)]
    pub element_at_point: Option<AccessibilityElement>,
    #[serde(rename = "nearbyElements", default)]
    pub nearby_elements: Vec<AccessibilityElement>,
    #[serde(rename = "queryX", default)]
    pub query_x: i32,
    #[serde(rename = "queryY", default)]
    pub query_y: i32,
    #[serde(rename = "queryTimeMs", default)]
    pub query_time_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessibilitySearchResult {
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub results: Vec<AccessibilityElement>,
    #[serde(rename = "searchKeyword", default)]
    pub search_keyword: String,
    #[serde(rename = "queryTimeMs", default)]
    pub query_time_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SnapshotElement {
    pub role: String,
    #[serde(default)]
    pub subrole: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub identifier: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub focused: Option<bool>,
    #[serde(default)]
    pub selected: Option<bool>,
    #[serde(default)]
    pub expanded: Option<bool>,
    #[serde(default)]
    pub disclosing: Option<bool>,
    #[serde(default)]
    pub busy: Option<bool>,
    #[serde(default)]
    pub selected_text: Option<String>,
    #[serde(default)]
    pub selected_text_range: Option<Vec<i32>>,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SnapshotWindow {
    #[serde(default)]
    pub title: Option<String>,
    pub role: String,
    #[serde(default)]
    pub subrole: Option<String>,
    #[serde(rename = "isMain", default)]
    pub is_main: bool,
    #[serde(rename = "isMinimized", default)]
    pub is_minimized: bool,
    #[serde(rename = "isFocused", default)]
    pub is_focused: bool,
    #[serde(default)]
    pub modal: Option<bool>,
    #[serde(default)]
    pub identifier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SnapshotApplication {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(rename = "bundleIdentifier", default)]
    pub bundle_identifier: Option<String>,
    #[serde(rename = "isFrontmost", default)]
    pub is_frontmost: bool,
    #[serde(rename = "isHidden", default)]
    pub is_hidden: bool,
    pub pid: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
    pub timestamp: f64,
    #[serde(rename = "focusedApplication", default)]
    pub focused_application: Option<SnapshotApplication>,
    #[serde(rename = "focusedWindow", default)]
    pub focused_window: Option<SnapshotWindow>,
    #[serde(rename = "focusedElement", default)]
    pub focused_element: Option<SnapshotElement>,
    #[serde(rename = "elementAtPoint", default)]
    pub element_at_point: Option<SnapshotElement>,
    #[serde(default)]
    pub windows: Vec<SnapshotWindow>,
    #[serde(rename = "queryTimeMs", default)]
    pub query_time_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateDiff {
    #[serde(rename = "timeDeltaMs")]
    pub time_delta_ms: f64,
    #[serde(rename = "applicationChanged")]
    pub application_changed: bool,
    #[serde(rename = "windowFocusChanged")]
    pub window_focus_changed: bool,
    #[serde(rename = "focusChanged")]
    pub focus_changed: bool,
    #[serde(rename = "clickedElementChanged")]
    pub clicked_element_changed: bool,
    #[serde(rename = "busyStateChanged")]
    pub busy_state_changed: bool,
    pub summary: Vec<String>,
}

pub async fn is_accessibility_available() -> bool {
    match std::env::consts::OS {
        "macos" => locate_ax_query_binary().is_some(),
        "linux" => locate_linux_accessibility_script().is_some(),
        "windows" => locate_windows_accessibility_script().is_some(),
        _ => false,
    }
}

pub async fn query_nearby_elements(
    x: i32,
    y: i32,
    max_elements: usize,
    max_distance: usize,
    include_non_interactive: bool,
) -> Result<AccessibilityQueryResult, String> {
    let mut args = vec![
        "--x".to_string(),
        x.to_string(),
        "--y".to_string(),
        y.to_string(),
        "--count".to_string(),
        max_elements.to_string(),
        "--distance".to_string(),
        max_distance.to_string(),
    ];
    if include_non_interactive {
        args.push("--include-non-interactive".to_string());
    }

    let stdout = run_ax_query(&args).await?;
    serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse accessibility query response: {}", e))
}

pub async fn search_ui_elements(
    keyword: &str,
    max_results: usize,
) -> Result<AccessibilitySearchResult, String> {
    let args = vec![
        "--search".to_string(),
        keyword.to_string(),
        "--count".to_string(),
        max_results.to_string(),
    ];
    let stdout = run_ax_query(&args).await?;
    serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse accessibility search response: {}", e))
}

pub async fn capture_state(query_position: Option<(i32, i32)>) -> Result<StateSnapshot, String> {
    let mut args = vec!["--snapshot".to_string()];
    if let Some((x, y)) = query_position {
        args.extend([
            "--x".to_string(),
            x.to_string(),
            "--y".to_string(),
            y.to_string(),
        ]);
    }
    let stdout = run_ax_query(&args).await?;
    serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse accessibility snapshot: {}", e))
}

pub fn diff_state(before: &StateSnapshot, after: &StateSnapshot) -> StateDiff {
    let mut summary = Vec::new();

    let application_changed = before
        .focused_application
        .as_ref()
        .and_then(|a| a.bundle_identifier.clone())
        != after
            .focused_application
            .as_ref()
            .and_then(|a| a.bundle_identifier.clone());
    if application_changed {
        summary.push(format!(
            "App changed: {} → {}",
            before
                .focused_application
                .as_ref()
                .and_then(|app| app.title.clone())
                .unwrap_or_else(|| "none".to_string()),
            after
                .focused_application
                .as_ref()
                .and_then(|app| app.title.clone())
                .unwrap_or_else(|| "none".to_string())
        ));
    }

    let window_focus_changed = before.focused_window.as_ref().and_then(|w| w.title.clone())
        != after.focused_window.as_ref().and_then(|w| w.title.clone())
        || before
            .focused_window
            .as_ref()
            .and_then(|w| w.identifier.clone())
            != after
                .focused_window
                .as_ref()
                .and_then(|w| w.identifier.clone());
    if window_focus_changed && !application_changed {
        summary.push(format!(
            "Window focus: {} → {}",
            before
                .focused_window
                .as_ref()
                .and_then(|window| window.title.clone())
                .unwrap_or_else(|| "none".to_string()),
            after
                .focused_window
                .as_ref()
                .and_then(|window| window.title.clone())
                .unwrap_or_else(|| "none".to_string())
        ));
    }

    let focus_changed = before.focused_element != after.focused_element;
    if focus_changed {
        let before_desc = describe_element(before.focused_element.as_ref());
        let after_desc = describe_element(after.focused_element.as_ref());
        if before_desc != after_desc {
            summary.push(format!("Focus: {} → {}", before_desc, after_desc));
        }
    }

    let clicked_element_changed = before.element_at_point != after.element_at_point;
    if clicked_element_changed {
        let before_desc = describe_element(before.element_at_point.as_ref());
        let after_desc = describe_element(after.element_at_point.as_ref());
        if before_desc != after_desc {
            summary.push(format!(
                "Element at click: {} → {}",
                before_desc, after_desc
            ));
        }
    }

    let busy_state_changed = before
        .focused_element
        .as_ref()
        .and_then(|el| el.busy)
        .unwrap_or(false)
        != after
            .focused_element
            .as_ref()
            .and_then(|el| el.busy)
            .unwrap_or(false);
    if busy_state_changed {
        summary.push(
            if after
                .focused_element
                .as_ref()
                .and_then(|el| el.busy)
                .unwrap_or(false)
            {
                "Loading started".to_string()
            } else {
                "Loading finished".to_string()
            },
        );
    }

    if summary.is_empty() {
        summary.push("No significant UI changes detected".to_string());
    }

    StateDiff {
        time_delta_ms: after.timestamp - before.timestamp,
        application_changed,
        window_focus_changed,
        focus_changed,
        clicked_element_changed,
        busy_state_changed,
        summary,
    }
}

fn describe_element(element: Option<&SnapshotElement>) -> String {
    match element {
        Some(element) => {
            let role = element.role.clone();
            let title = element
                .title
                .clone()
                .unwrap_or_else(|| "(untitled)".to_string());
            format!("[{}] {}", role, title)
        }
        None => "none".to_string(),
    }
}

fn locate_ax_query_binary() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("DUME_AX_QUERY_BIN").map(PathBuf::from) {
        if custom.exists() {
            return Some(custom);
        }
    }

    let candidates = [
        PathBuf::from("native/macos/ax-query/.build/release/ax-query"),
        PathBuf::from("native/macos/ax-query/.build/arm64-apple-macosx/release/ax-query"),
        PathBuf::from("../jarvis/native/macos/ax-query/.build/release/ax-query"),
        PathBuf::from("../jarvis/native/macos/ax-query/.build/arm64-apple-macosx/release/ax-query"),
        PathBuf::from(
            "/Users/Ninot/NinotQuyi/jarvis/native/macos/ax-query/.build/release/ax-query",
        ),
        PathBuf::from(
            "/Users/Ninot/NinotQuyi/jarvis/native/macos/ax-query/.build/arm64-apple-macosx/release/ax-query",
        ),
    ];

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn locate_linux_accessibility_script() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("DUME_ATSPI_QUERY_BIN").map(PathBuf::from) {
        if custom.exists() {
            return Some(custom);
        }
    }

    let candidates = [
        PathBuf::from("native/linux/atspi-query.py"),
        PathBuf::from("../jarvis/native/linux/atspi-query.py"),
        PathBuf::from("/Users/Ninot/NinotQuyi/jarvis/native/linux/atspi-query.py"),
    ];

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn locate_windows_accessibility_script() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("DUME_UIA_QUERY_BIN").map(PathBuf::from) {
        if custom.exists() {
            return Some(custom);
        }
    }

    let candidates = [
        PathBuf::from("native/windows/uia-query.ps1"),
        PathBuf::from("../jarvis/native/windows/uia-query.ps1"),
        PathBuf::from("/Users/Ninot/NinotQuyi/jarvis/native/windows/uia-query.ps1"),
    ];

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn convert_args_for_linux_script(args: &[String]) -> Vec<String> {
    if args.iter().any(|arg| arg == "--snapshot") {
        let mut converted = vec!["state".to_string()];
        append_xy_args(args, &mut converted);
        converted
    } else if let Some(search_idx) = args.iter().position(|arg| arg == "--search") {
        let keyword = args.get(search_idx + 1).cloned().unwrap_or_default();
        vec!["search".to_string(), keyword]
    } else {
        let mut converted = vec!["query".to_string()];
        append_xy_args(args, &mut converted);
        converted
    }
}

fn append_xy_args(source_args: &[String], out: &mut Vec<String>) {
    if let Some(x_idx) = source_args.iter().position(|arg| arg == "--x") {
        if let Some(x) = source_args.get(x_idx + 1) {
            out.push(x.clone());
        }
    }
    if let Some(y_idx) = source_args.iter().position(|arg| arg == "--y") {
        if let Some(y) = source_args.get(y_idx + 1) {
            out.push(y.clone());
        }
    }
}

async fn run_ax_query(args: &[String]) -> Result<String, String> {
    let output = match std::env::consts::OS {
        "macos" => {
            let binary = locate_ax_query_binary().ok_or_else(|| {
                "Accessibility query binary not found. Build native/macos/ax-query or set DUME_AX_QUERY_BIN."
                    .to_string()
            })?;

            tokio::process::Command::new(&binary)
                .args(args)
                .output()
                .await
                .map_err(|e| {
                    format!(
                        "Failed to run accessibility query binary {}: {}",
                        display_path(&binary),
                        e
                    )
                })?
        }
        "linux" => {
            let script = locate_linux_accessibility_script().ok_or_else(|| {
                "Linux accessibility script not found. Set DUME_ATSPI_QUERY_BIN or vendor native/linux/atspi-query.py."
                    .to_string()
            })?;

            tokio::process::Command::new("python3")
                .arg(&script)
                .args(convert_args_for_linux_script(args))
                .output()
                .await
                .map_err(|e| {
                    format!(
                        "Failed to run Linux accessibility script {}: {}",
                        display_path(&script),
                        e
                    )
                })?
        }
        "windows" => {
            let script = locate_windows_accessibility_script().ok_or_else(|| {
                "Windows accessibility script not found. Set DUME_UIA_QUERY_BIN or vendor native/windows/uia-query.ps1."
                    .to_string()
            })?;

            tokio::process::Command::new("powershell")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script)
                .args(args)
                .output()
                .await
                .map_err(|e| {
                    format!(
                        "Failed to run Windows accessibility script {}: {}",
                        display_path(&script),
                        e
                    )
                })?
        }
        other => {
            return Err(format!(
                "Accessibility query is not wired for current platform: {}",
                other
            ));
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        return Ok(stdout);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "Accessibility query failed ({}): {}{}",
        output.status,
        stdout,
        if stderr.is_empty() {
            String::new()
        } else {
            format!(" {}", stderr)
        }
    ))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_snapshot(
        app: Option<&str>,
        window: Option<&str>,
        focused_title: Option<&str>,
        clicked_title: Option<&str>,
        busy: Option<bool>,
        timestamp: f64,
    ) -> StateSnapshot {
        StateSnapshot {
            success: true,
            error: None,
            timestamp,
            focused_application: app.map(|title| SnapshotApplication {
                title: Some(title.to_string()),
                bundle_identifier: Some(format!("bundle.{}", title)),
                is_frontmost: true,
                is_hidden: false,
                pid: 1,
            }),
            focused_window: window.map(|title| SnapshotWindow {
                title: Some(title.to_string()),
                role: "window".to_string(),
                subrole: None,
                is_main: true,
                is_minimized: false,
                is_focused: true,
                modal: None,
                identifier: Some(title.to_string()),
            }),
            focused_element: focused_title.map(|title| SnapshotElement {
                role: "button".to_string(),
                subrole: None,
                title: Some(title.to_string()),
                description: None,
                value: None,
                identifier: Some(title.to_string()),
                enabled: Some(true),
                focused: Some(true),
                selected: Some(false),
                expanded: Some(false),
                disclosing: Some(false),
                busy,
                selected_text: None,
                selected_text_range: None,
                x: None,
                y: None,
                width: None,
                height: None,
            }),
            element_at_point: clicked_title.map(|title| SnapshotElement {
                role: "button".to_string(),
                subrole: None,
                title: Some(title.to_string()),
                description: None,
                value: None,
                identifier: Some(title.to_string()),
                enabled: Some(true),
                focused: Some(false),
                selected: Some(false),
                expanded: Some(false),
                disclosing: Some(false),
                busy: None,
                selected_text: None,
                selected_text_range: None,
                x: None,
                y: None,
                width: None,
                height: None,
            }),
            windows: vec![],
            query_time_ms: 1.0,
        }
    }

    #[test]
    fn diff_state_reports_click_focus_and_busy_changes() {
        let before = sample_snapshot(
            Some("Finder"),
            Some("Window A"),
            Some("Open"),
            Some("Open"),
            Some(false),
            1_000.0,
        );
        let after = sample_snapshot(
            Some("Finder"),
            Some("Window B"),
            Some("Save"),
            Some("Save"),
            Some(true),
            1_250.0,
        );

        let diff = diff_state(&before, &after);
        assert_eq!(diff.time_delta_ms, 250.0);
        assert!(diff.window_focus_changed);
        assert!(diff.focus_changed);
        assert!(diff.clicked_element_changed);
        assert!(diff.busy_state_changed);
        assert!(diff
            .summary
            .iter()
            .any(|line| line.contains("Window focus")));
        assert!(diff
            .summary
            .iter()
            .any(|line| line.contains("Element at click")));
    }
}
