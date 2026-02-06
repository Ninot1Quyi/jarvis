mod liquid_glass;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::{accept_async, tungstenite::Message};

const WS_PORT: u16 = 19823;

// Shared state for WebSocket writer
type WsWriter = Arc<Mutex<Option<futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<TcpStream>, Message>>>>;

#[derive(Default)]
struct AppState {
    ws_writer: WsWriter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentMessage {
    role: String,
    content: String,
    timestamp: String,
    #[serde(rename = "toolCalls")]
    tool_calls: Option<Vec<String>>,
}

// Message from UI to Agent
#[derive(Debug, Clone, Serialize, Deserialize)]
struct UiMessage {
    #[serde(rename = "type")]
    msg_type: String,  // "user_input"
    content: String,
}

// Tauri command to send message to agent
#[tauri::command]
async fn send_to_agent(state: State<'_, AppState>, content: String) -> Result<bool, String> {
    let mut writer_guard = state.ws_writer.lock().await;

    if let Some(writer) = writer_guard.as_mut() {
        let msg = UiMessage {
            msg_type: "user_input".to_string(),
            content,
        };
        let json = serde_json::to_string(&msg).map_err(|e| e.to_string())?;

        writer.send(Message::Text(json)).await.map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Err("Not connected to agent".to_string())
    }
}

async fn handle_connection(stream: TcpStream, app: AppHandle, ws_writer: WsWriter) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("WebSocket handshake failed: {}", e);
            return;
        }
    };

    let (write, mut read) = ws_stream.split();

    // Store the writer for sending messages back to agent
    {
        let mut writer_guard = ws_writer.lock().await;
        *writer_guard = Some(write);
    }

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

    // Clear the writer when disconnected
    {
        let mut writer_guard = ws_writer.lock().await;
        *writer_guard = None;
    }
}

async fn start_ws_server(app: AppHandle, ws_writer: WsWriter) {
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
        let ws_writer_clone = ws_writer.clone();
        tokio::spawn(async move {
            handle_connection(stream, app_clone, ws_writer_clone).await;
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![send_to_agent])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state: State<AppState> = app.state();
            let ws_writer = state.ws_writer.clone();

            // Apply liquid glass effect to main window
            if let Some(window) = app.get_webview_window("main") {
                liquid_glass::apply(&window);
            }

            // Start WebSocket server in background
            tauri::async_runtime::spawn(async move {
                start_ws_server(app_handle, ws_writer).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
