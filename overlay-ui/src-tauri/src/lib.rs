mod liquid_glass;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;

const WS_PORT: u16 = 19823;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentMessage {
    role: String,
    content: String,
    timestamp: String,
    #[serde(rename = "toolCalls")]
    tool_calls: Option<Vec<String>>,
}

async fn handle_connection(stream: TcpStream, app: AppHandle) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("WebSocket handshake failed: {}", e);
            return;
        }
    };

    let (_, mut read) = ws_stream.split();

    // Notify UI that agent connected
    let _ = app.emit("agent-status", "Agent connected");

    while let Some(msg) = read.next().await {
        match msg {
            Ok(msg) => {
                if msg.is_text() {
                    let text = msg.to_text().unwrap_or("");
                    match serde_json::from_str::<AgentMessage>(text) {
                        Ok(agent_msg) => {
                            let _ = app.emit("agent-message", agent_msg);
                        }
                        Err(e) => {
                            eprintln!("Failed to parse message: {}", e);
                            let _ = app.emit("agent-error", format!("Parse error: {}", e));
                        }
                    }
                } else if msg.is_close() {
                    let _ = app.emit("agent-status", "Agent disconnected");
                    break;
                }
            }
            Err(e) => {
                eprintln!("WebSocket error: {}", e);
                let _ = app.emit("agent-error", format!("Connection error: {}", e));
                break;
            }
        }
    }
}

async fn start_ws_server(app: AppHandle) {
    let addr: SocketAddr = format!("127.0.0.1:{}", WS_PORT).parse().unwrap();

    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind WebSocket server: {}", e);
            let _ = app.emit("agent-error", format!("Failed to start server: {}", e));
            return;
        }
    };

    println!("WebSocket server listening on ws://{}", addr);
    let _ = app.emit("agent-status", format!("Listening on port {}", WS_PORT));

    while let Ok((stream, _)) = listener.accept().await {
        let app_clone = app.clone();
        tokio::spawn(async move {
            handle_connection(stream, app_clone).await;
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Apply liquid glass effect to main window
            if let Some(window) = app.get_webview_window("main") {
                liquid_glass::apply(&window);
            }

            // Start WebSocket server in background
            tauri::async_runtime::spawn(async move {
                start_ws_server(app_handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
