//! Subagent tool - launch task-specific sub-agents
//!
//! Inspired by Claude Code's sub-agent pattern. Supports:
//! - In-process execution with isolated async context
//! - Detached execution via tmux
//! - File-based mailbox communication

use crate::agent::Agent;
use crate::config::Config;
use crate::llm::{LLMProvider, MiniMaxLLM};
use crate::observability::EventBus;
use crate::soul::SoulManager;
use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use std::sync::Arc;
use tokio::process::Command;
use tokio::time::Duration;

/// Result from a sub-agent execution
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct SubagentResult {
    /// Unique ID of this sub-agent
    id: String,
    /// Whether the sub-agent completed successfully
    success: bool,
    /// Final output text
    output: String,
    /// Number of steps taken
    steps: usize,
    /// Duration in seconds
    duration_secs: f64,
    /// Error message if failed
    error: Option<String>,
}

/// Launch a task-specific sub-agent
pub struct LaunchSubagentTool;

impl LaunchSubagentTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LaunchSubagentTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for LaunchSubagentTool {
    fn name(&self) -> &str {
        "launch_subagent"
    }

    fn description(&self) -> &str {
        "Launch a task-specific sub-agent that works in parallel or delegated from the main agent. The sub-agent receives a task description and optional conversation context, executes it, and returns results. Supports in-process execution (fast, shares LLM connection) or detached tmux execution (isolated process, survives parent crash). Use this for parallel research, independent tasks, or delegated work that doesn't block the main agent."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Task description for the sub-agent to execute"
                },
                "mode": {
                    "type": "string",
                    "description": "Execution mode: 'in_process' (fast, same process) or 'tmux' (isolated, survives parent)",
                    "enum": ["in_process", "tmux"],
                    "default": "in_process"
                },
                "context_depth": {
                    "type": "integer",
                    "description": "How many conversation turns of context to pass (default 10)",
                    "default": 10
                },
                "wait_for_result": {
                    "type": "boolean",
                    "description": "If true, wait for the sub-agent to complete and return results. If false, launch and return immediately.",
                    "default": true
                },
                "max_wait_secs": {
                    "type": "integer",
                    "description": "Maximum time to wait for results if wait_for_result=true (default 300)",
                    "default": 300
                },
                "subagent_name": {
                    "type": "string",
                    "description": "Optional name for this sub-agent (for identification in logs)"
                }
            },
            "required": ["task"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false
    }

    fn is_read_only(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let task = input["task"]
            .as_str()
            .ok_or("Missing required field: task")?;

        let mode = input["mode"]
            .as_str()
            .unwrap_or("in_process");

        let context_depth = input["context_depth"]
            .as_u64()
            .unwrap_or(10) as usize;

        let wait_for_result = input["wait_for_result"]
            .as_bool()
            .unwrap_or(true);

        let max_wait_secs = input["max_wait_secs"]
            .as_u64()
            .unwrap_or(300);

        let subagent_name = input["subagent_name"]
            .as_str()
            .unwrap_or("subagent");

        let agent_id = format!(
            "{}-{}",
            subagent_name,
            uuid::Uuid::new_v4().to_string()[..8].to_string()
        );

        // Build context messages from history file
        let history_context = self.build_history_context(context, context_depth).await;

        let mut output = String::new();
        output.push_str(&format!("=== Launching sub-agent: {} ===\n", agent_id));
        output.push_str(&format!("Mode: {}\n", mode));
        output.push_str(&format!("Task: {}\n", task));
        output.push_str(&format!("Context depth: {} turns\n\n", context_depth));

        match mode {
            "in_process" => {
                output.push_str("Executing in-process...\n");
                let result = self.run_in_process(
                    &agent_id,
                    task,
                    &history_context,
                    context,
                    &mut output,
                )
                .await;

                if wait_for_result {
                    self.format_result(&result, &mut output);
                } else {
                    output.push_str("✓ Sub-agent launched (non-blocking mode)\n");
                    output.push_str(&format!("Agent ID: {}\n", agent_id));
                }
            }
            "tmux" => {
                output.push_str("Checking tmux availability...\n");
                let tmux_check = Command::new("sh")
                    .args(["-c", "which tmux"])
                    .output()
                    .await;

                if tmux_check.is_err() || !tmux_check.unwrap().status.success() {
                    return Err("tmux is not installed. Install tmux or use mode='in_process'".to_string());
                }

                output.push_str("✓ tmux available\n");
                let result = self
                    .run_detached(&agent_id, task, &history_context, context, max_wait_secs as usize, &mut output)
                    .await;

                if wait_for_result {
                    self.format_result(&result, &mut output);
                } else {
                    output.push_str("✓ Sub-agent launched in tmux (non-blocking mode)\n");
                    output.push_str(&format!("Agent ID: {}\n", agent_id));
                    output.push_str("View with: tmux attach -t dum-e-subagent\n");
                }
            }
            _ => {
                return Err(format!("Unknown mode: {}. Use 'in_process' or 'tmux'", mode));
            }
        }

        Ok(ToolResult {
            success: true,
            output,
            error: None,
        })
    }
}

impl LaunchSubagentTool {
    /// Build conversation context from history file
    async fn build_history_context(
        &self,
        context: &ToolContext,
        depth: usize,
    ) -> String {
        let history_path = if let Some(ref path) = context.history_file {
            Some(path.clone())
        } else {
            std::env::var("DUM_E_HISTORY_FILE").ok()
        };

        let Some(path) = history_path else {
            return String::new();
        };

        let content = match tokio::fs::read_to_string(path).await {
            Ok(c) => c,
            Err(_) => return String::new(),
        };

        // Parse the JSON and extract last N turns
        if let Ok(messages) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(arr) = messages.as_array() {
                let start = arr.len().saturating_sub(depth);
                let relevant: Vec<_> = arr[start..].iter().map(|m| {
                    let blocks = m.get("blocks").and_then(|b| b.as_array());
                    let mut lines = Vec::new();
                    if let Some(blocks) = blocks {
                        for block in blocks {
                            let bt = block.get("block_type").and_then(|b| b.as_str()).unwrap_or("");
                            let text = block.get("text").and_then(|t| t.as_str()).unwrap_or("");
                            let tool = block.get("tool_name").and_then(|t| t.as_str()).unwrap_or("");
                            match bt {
                                "user" => lines.push(format!("[User]: {}", text)),
                                "assistant" => lines.push(format!("[Dum-E]: {}", text)),
                                "tool_call" => lines.push(format!("[Tool]: {}", tool)),
                                "tool_result" => lines.push(format!("[Result]: {}", truncate(text, 200))),
                                "thinking" => {}
                                _ => {}
                            }
                        }
                    }
                    lines.join("\n")
                }).collect();
                return relevant.join("\n");
            }
        }

        String::new()
    }

    /// Run sub-agent in-process (same async context)
    async fn run_in_process(
        &self,
        agent_id: &str,
        task: &str,
        history_context: &str,
        context: &ToolContext,
        output: &mut String,
    ) -> SubagentResult {
        let start = std::time::Instant::now();

        let config = context
            .config
            .as_ref()
            .cloned()
            .unwrap_or_else(Config::default);

        let minimax_config = config.minimax();
        let llm: Arc<dyn LLMProvider> = match MiniMaxLLM::new(
            minimax_config.api_key.clone(),
            minimax_config.base_url.clone(),
            minimax_config.model.clone(),
        ) {
            Ok(llm) => Arc::new(llm),
            Err(_) => {
                return SubagentResult {
                    id: agent_id.to_string(),
                    success: false,
                    output: String::new(),
                    steps: 0,
                    duration_secs: start.elapsed().as_secs_f64(),
                    error: Some("Failed to initialize LLM".to_string()),
                };
            }
        };

        output.push_str("  Initializing in-process agent...\n");

        let tool_registry = crate::tools::ToolRegistry::new();
        // Note: We can't call register_tools() here since it's in main.rs,
        // so we register minimal tools inline
        let mut reg = tool_registry;
        register_basic_tools(&mut reg);

        let soul_path = std::path::PathBuf::from("data/soul.md");
        let mut soul_manager = SoulManager::new(soul_path);
        let _ = soul_manager.load();

        let event_bus = Arc::new(EventBus::new(false));

        let mut agent = Agent::new(reg, config, soul_manager, event_bus).with_llm(llm);

        // Inject history context into agent
        agent.load_evolve_context();

        // Build task with context
        let full_task = if !history_context.is_empty() {
            format!(
                "{}\n\n### Conversation Context:\n{}\n\n### Task:\n{}",
                "You are a sub-agent of Dum-E, executing a delegated task.",
                history_context,
                task
            )
        } else {
            format!(
                "{}\n\n### Task:\n{}",
                "You are a sub-agent of Dum-E, executing a delegated task.",
                task
            )
        };

        output.push_str("  Running agent...\n");
        match agent.run(&full_task).await {
            Ok(result) => {
                let duration = start.elapsed().as_secs_f64();
                output.push_str(&format!(
                    "  ✓ Completed in {} steps ({:.1}s)\n",
                    result.steps, duration
                ));

                SubagentResult {
                    id: agent_id.to_string(),
                    success: result.success,
                    output: result.output,
                    steps: result.steps,
                    duration_secs: duration,
                    error: None,
                }
            }
            Err(e) => {
                let duration = start.elapsed().as_secs_f64();
                output.push_str(&format!("  ✗ Failed: {}\n", e));

                SubagentResult {
                    id: agent_id.to_string(),
                    success: false,
                    output: String::new(),
                    steps: 0,
                    duration_secs: duration,
                    error: Some(e),
                }
            }
        }
    }

    /// Run sub-agent in detached tmux process
    async fn run_detached(
        &self,
        agent_id: &str,
        task: &str,
        history_context: &str,
        _context: &ToolContext,
        max_wait: usize,
        output: &mut String,
    ) -> SubagentResult {
        let start = std::time::Instant::now();

        let home = std::env::var("HOME").unwrap_or_default();
        let mailbox_dir = format!("{}/.dum-e/subagent-mailboxes", home);
        let result_file = format!("{}/{}.result.json", mailbox_dir, agent_id);
        let task_file = format!("{}/{}.task.json", mailbox_dir, agent_id);

        // Ensure directory exists
        tokio::fs::create_dir_all(&mailbox_dir).await.ok();

        // Write task file
        let task_json = serde_json::json!({
            "id": agent_id,
            "task": task,
            "history_context": history_context,
            "config_env": {
                "MINIMAX_API_KEY": std::env::var("MINIMAX_API_KEY").ok(),
                "DUM_E_CONFIG": std::env::var("DUM_E_CONFIG").ok(),
            },
            "result_file": result_file,
        });

        if let Err(e) = tokio::fs::write(&task_file, task_json.to_string()).await {
            return SubagentResult {
                id: agent_id.to_string(),
                success: false,
                output: String::new(),
                steps: 0,
                duration_secs: start.elapsed().as_secs_f64(),
                error: Some(format!("Failed to write task file: {}", e)),
            };
        }

        output.push_str(&format!("  Task file: {}\n", task_file));
        output.push_str(&format!("  Result file: {}\n", result_file));

        // Kill any existing session
        let _ = Command::new("sh")
            .args(["-c", "tmux kill-session -t dum-e-subagent 2>/dev/null; true"])
            .output()
            .await;

        // Find project root
        let project_root = std::env::current_dir()
            .ok()
            .and_then(|p| {
                p.ancestors().find(|a| a.join("Cargo.toml").exists()).map(|a| a.to_path_buf())
            })
            .unwrap_or_else(|| std::path::PathBuf::from("."));

        // Build command to run sub-agent with task file
        let subagent_cmd = format!(
            "cd '{}' && cargo run --quiet -- --task-file '{}' 2>&1",
            project_root.display(),
            task_file
        );

        // Start in tmux
        let tmux_cmd = format!("tmux new-session -d -s dum-e-subagent '{}'", subagent_cmd);
        let tmux_result = Command::new("sh")
            .args(["-c", &tmux_cmd])
            .output()
            .await;

        if tmux_result.is_err() || !tmux_result.as_ref().unwrap().status.success() {
            let err = tmux_result
                .as_ref()
                .err()
                .map(|e| e.to_string())
                .unwrap_or_else(|| "tmux failed".to_string());
            return SubagentResult {
                id: agent_id.to_string(),
                success: false,
                output: String::new(),
                steps: 0,
                duration_secs: start.elapsed().as_secs_f64(),
                error: Some(format!("Failed to start tmux: {}", err)),
            };
        }

        output.push_str("  ✓ tmux session started\n");
        output.push_str("  Waiting for result...\n");

        // Poll for result file
        let poll_interval = Duration::from_secs(5);
        let max_wait_duration = Duration::from_secs(max_wait as u64);
        let deadline = tokio::time::Instant::now() + max_wait_duration;

        loop {
            tokio::time::sleep(poll_interval).await;

            if tokio::fs::metadata(&result_file).await.is_ok() {
                let content = tokio::fs::read_to_string(&result_file).await
                    .map_err(|e| format!("Read error: {}", e));

                if let Ok(json_str) = content {
                    if let Ok(result) = serde_json::from_str::<SubagentResult>(&json_str) {
                        output.push_str(&format!(
                            "  ✓ Result received ({:.1}s)\n",
                            start.elapsed().as_secs_f64()
                        ));
                        // Clean up
                        tokio::fs::remove_file(&result_file).await.ok();
                        tokio::fs::remove_file(&task_file).await.ok();
                        return result;
                    }
                }
            }

            if tokio::time::Instant::now() >= deadline {
                let duration = start.elapsed().as_secs_f64();
                output.push_str(&format!("  ⚠ Timeout after {:.1}s\n", duration));
                return SubagentResult {
                    id: agent_id.to_string(),
                    success: false,
                    output: String::new(),
                    steps: 0,
                    duration_secs: duration,
                    error: Some(format!("Timeout after {}s", max_wait)),
                };
            }
        }
    }

    /// Format sub-agent result for output
    fn format_result(&self, result: &SubagentResult, output: &mut String) {
        if result.success {
            output.push_str(&format!(
                "\n✓ Sub-agent {} completed\n",
                result.id
            ));
            output.push_str(&format!("  Steps: {}\n", result.steps));
            output.push_str(&format!(
                "  Duration: {:.1}s\n",
                result.duration_secs
            ));
            if !result.output.is_empty() {
                output.push_str(&format!("  Output: {}\n", truncate(&result.output, 500)));
            }
        } else {
            output.push_str(&format!(
                "\n✗ Sub-agent {} failed\n",
                result.id
            ));
            if let Some(ref err) = result.error {
                output.push_str(&format!("  Error: {}\n", err));
            }
        }
    }
}

fn truncate(s: &str, limit: usize) -> String {
    if s.len() <= limit {
        return s.to_string();
    }
    format!("{}...", &s[..limit])
}

// ============================================================================
// Basic tool registration for in-process sub-agents
// (avoids circular dependency on main.rs register_tools)
// ============================================================================

use crate::tools::{
    bash::BashTool,
    file::{EditTool, ReadTool, WriteTool},
    grep::GrepTool,
    keyboard::KeyboardTool,
    mouse::{
        DragTool, LeftDoubleTool, LeftSingleTool, MiddleClickTool, RightSingleTool, ScrollTool,
    },
    skill::{ActivateSkillTool, ListSkillsTool, SaveSkillTool},
    system::{
        CallUserTool, RecordTaskTool, ScreenTool, ScreenshotTool, SetMaxStepsTool, WaitTool,
    },
    todo::{TodoReadTool, TodoWriteTool},
    ui_search::UISearchTool,
};

/// Register the basic tool set for sub-agents
pub fn register_basic_tools(registry: &mut crate::tools::ToolRegistry) {
    registry.register(ReadTool::new());
    registry.register(WriteTool::new());
    registry.register(EditTool::new());
    registry.register(BashTool::new());
    registry.register(GrepTool::new());
    registry.register(LeftSingleTool::new());
    registry.register(LeftDoubleTool::new());
    registry.register(RightSingleTool::new());
    registry.register(MiddleClickTool::new());
    registry.register(DragTool::new());
    registry.register(ScrollTool::new());
    registry.register(KeyboardTool::new());
    registry.register(ScreenshotTool::new());
    registry.register(WaitTool::new());
    registry.register(CallUserTool::new());
    registry.register(RecordTaskTool::new());
    registry.register(ScreenTool::new());
    registry.register(SetMaxStepsTool::new());
    registry.register(TodoReadTool::new());
    registry.register(TodoWriteTool::new());
    registry.register(UISearchTool::new());
    registry.register(ActivateSkillTool::new());
    registry.register(ListSkillsTool::new());
    registry.register(SaveSkillTool::new());
}
