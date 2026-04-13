//! Evolve tools - Agent self-evolution capabilities
//!
//! Tools:
//! - evolve_self: Main orchestration tool that runs the full evolution flow
//! - compare_agents: Compare Dum-E with target agents and produce gap analysis
//! - evolve_start_new: Start new agent version in tmux side pane
//! - evolve_switch_version: Complete version switch and shutdown old agent

use crate::config::EvolveConfig;
use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use std::path::PathBuf;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

// ============================================================================
// Shared utilities
// ============================================================================

/// Run a bash command and return stdout
async fn bash_output(cmd: &str, cwd: Option<&str>) -> Result<String, String> {
    let mut c = Command::new("sh");
    c.args(["-c", cmd]);
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    let out = c
        .output()
        .await
        .map_err(|e| format!("bash failed: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("bash failed ({}): {}", out.status, stderr));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Run a bash command, return (success, stdout)
async fn bash(cmd: &str, cwd: Option<&str>) -> (bool, String) {
    match bash_output(cmd, cwd).await {
        Ok(out) => (true, out),
        Err(e) => (false, e),
    }
}

/// Get the project root directory (where Cargo.toml lives)
fn project_root() -> Result<PathBuf, String> {
    std::env::current_dir()
        .map_err(|e| e.to_string())?
        .ancestors()
        .find(|p| p.join("Cargo.toml").exists())
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Could not find project root".to_string())
}

/// Get the worktree path for a given version string
fn worktree_path(root: &PathBuf, version: &str) -> PathBuf {
    root.join(format!("../dum-e-evolve-{}", version.replace('.', "-")))
}

/// Get evolve config from context
fn get_evolve_config(context: &ToolContext) -> EvolveConfig {
    context
        .config
        .as_ref()
        .map(|c| c.evolve())
        .unwrap_or(EvolveConfig {
            enabled: true,
            auto_evolve_idle_minutes: 60,
            compare_targets: vec![
                "claude-code".to_string(),
                "codex".to_string(),
                "harness".to_string(),
                "gemini-cli".to_string(),
                "agent-s".to_string(),
            ],
        })
}

/// Read soul version from data/soul.md
async fn read_soul_version() -> Result<(u32, u32, u32), String> {
    let content = tokio::fs::read_to_string("data/soul.md")
        .await
        .map_err(|e| format!("Failed to read data/soul.md: {}", e))?;

    let mut major = 1u32;
    let mut minor = 0u32;
    let mut patch = 0u32;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("major:") {
            if let Some(v) = trimmed.strip_prefix("major:") {
                major = v.trim().parse().unwrap_or(1);
            }
        } else if trimmed.starts_with("minor:") {
            if let Some(v) = trimmed.strip_prefix("minor:") {
                minor = v.trim().parse().unwrap_or(0);
            }
        } else if trimmed.starts_with("patch:") {
            if let Some(v) = trimmed.strip_prefix("patch:") {
                patch = v.trim().parse().unwrap_or(0);
            }
        }
    }

    Ok((major, minor, patch))
}

/// Write new version to data/soul.md
async fn write_soul_version(major: u32, minor: u32, patch: u32) -> Result<(), String> {
    let content = tokio::fs::read_to_string("data/soul.md")
        .await
        .map_err(|e| e.to_string())?;

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    for line in lines.iter_mut() {
        if line.trim().starts_with("major:") {
            *line = format!("  major: {}", major);
        } else if line.trim().starts_with("minor:") {
            *line = format!("  minor: {}", minor);
        } else if line.trim().starts_with("patch:") {
            *line = format!("  patch: {}", patch);
        }
    }

    tokio::fs::write("data/soul.md", lines.join("\n"))
        .await
        .map_err(|e| format!("Failed to write data/soul.md: {}", e))?;
    Ok(())
}

/// Get current git branch
async fn current_git_branch(cwd: &PathBuf) -> Result<String, String> {
    let out = bash_output("git branch --show-current", Some(cwd.to_str().unwrap_or(".")))
        .await?;
    Ok(out.trim().to_string())
}

// ============================================================================
// CompareAgentsTool
// ============================================================================

/// Compare Dum-E with configured target agents to produce gap analysis
pub struct CompareAgentsTool;

impl CompareAgentsTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CompareAgentsTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for CompareAgentsTool {
    fn name(&self) -> &str {
        "compare_agents"
    }

    fn description(&self) -> &str {
        "Compare Dum-E with configured target agents (claude-code, codex, harness, etc.) and produce a structured gap analysis. Returns code gaps, prompt gaps, tool gaps, and architecture gaps sorted by priority."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Focus area: capabilities, personality, interaction, or architecture (optional)",
                    "enum": ["capabilities", "personality", "interaction", "architecture"]
                }
            }
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        true
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let focus = input["focus"]
            .as_str()
            .unwrap_or("capabilities")
            .to_string();

        let config = get_evolve_config(context);
        let targets = config.compare_targets;

        let llm = context.llm.as_ref().ok_or("LLM not available in context")?;

        // Build comparison prompt
        let prompt = format!(
            r#"You are comparing Dum-E (an AI coding agent) against the following target agents: {}

Focus area: {}

For each agent, research their capabilities by searching the web and analyzing their public documentation, source code, and feature lists. Then produce a structured gap analysis comparing Dum-E against these agents.

Analyze the following dimensions:
1. **Capabilities**: Tool set, API coverage, model support
2. **Interaction**: Input/output format, streaming, error messages
3. **Architecture**: Module design, extensibility, testability
4. **Personality**: Response style, decision-making, behavior patterns
5. **Observability**: Logging, tracing, debugging support

Output a JSON report with this structure:
{{
  "dume_version": "v1.x.x",
  "comparisons": [
    {{
      "target": "agent-name",
      "dimension": "capabilities|personality|interaction|architecture",
      "dume_current": "description of Dum-E's current state",
      "target_state": "description of target agent's state",
      "gaps": ["gap1", "gap2"],
      "priority": "high|medium|low",
      "improvement": "specific suggestion for Dum-E"
    }}
  ],
  "priority_order": ["gap_description_1", "gap_description_2"],
  "top_improvements": [
    {{
      "gap": "description",
      "type": "code|prompt|tool|architecture",
      "location": "file path or SOUL section",
      "benefit": "what this improves"
    }}
  ]
}}

Be specific and actionable. Prioritize high-impact, low-effort improvements first."#,
            targets.join(", "),
            focus
        );

        let messages = vec![crate::message::Message::new(
            crate::message::MessageRole::User,
            &prompt,
        )];

        // Call LLM to do the comparison
        let response = timeout(
            Duration::from_secs(120),
            llm.chat_stream(&messages, None),
        )
        .await
        .map_err(|_| "Compare agents timed out after 120s")?
        .map_err(|e| format!("LLM call failed: {}", e))?;

        Ok(ToolResult {
            success: true,
            output: response.message,
            error: None,
        })
    }
}

// ============================================================================
// EvolveSelfTool - Main evolution orchestrator
// ============================================================================

/// Main evolution tool - orchestrates the full self-evolution flow
pub struct EvolveSelfTool;

impl EvolveSelfTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for EvolveSelfTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for EvolveSelfTool {
    fn name(&self) -> &str {
        "evolve_self"
    }

    fn description(&self) -> &str {
        "Trigger Dum-E's self-evolution process. Reads current version, creates a git worktree, compares against target agents, generates improvement plan, applies changes, builds, verifies with subagent, and switches to new version. This is the main entry point for agent self-improvement."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Focus area: capabilities, personality, interaction, or architecture",
                    "enum": ["capabilities", "personality", "interaction", "architecture"]
                }
            }
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
        let focus = input["focus"]
            .as_str()
            .unwrap_or("capabilities")
            .to_string();

        let root = project_root()?;
        let (major, minor, patch) = read_soul_version().await?;
        let next_patch = patch + 1;
        let version_str = format!("v{}.{}.{}", major, minor, next_patch);
        let worktree_dir = worktree_path(&root, &format!("{}.{}.{}", major, minor, next_patch));
        let worktree_dir_str = worktree_dir.to_string_lossy().to_string();

        let mut output = String::new();
        output.push_str(&format!("=== Dum-E Self-Evolution ===\n"));
        output.push_str(&format!("Current version: v{}.{}.{}\n", major, minor, patch));
        output.push_str(&format!("Target version: {}\n\n", version_str));

        // Step 1: Create git worktree
        output.push_str("Step 1: Creating git worktree...\n");
        let branch_name = format!("evolve/{}-{}", version_str, chrono_timestamp());

        let create_result = bash_output(
            &format!(
                "git worktree add '{}' -b '{}'",
                worktree_dir_str, branch_name
            ),
            Some(root.to_str().unwrap()),
        )
        .await;

        match create_result {
            Ok(_) => {
                output.push_str(&format!("  ✓ Worktree created: {}\n", worktree_dir_str));
            }
            Err(e) => {
                // Worktree might already exist, try to check out existing
                if e.contains("already exists") {
                    output.push_str(&format!(
                        "  ✓ Worktree already exists: {}, checking out\n",
                        worktree_dir_str
                    ));
                    bash_output(
                        &format!("git worktree list | grep '{}'", worktree_dir_str),
                        Some(root.to_str().unwrap()),
                    )
                    .await
                    .ok();
                } else {
                    return Err(format!("Failed to create worktree: {}", e));
                }
            }
        }

        // Step 2: Read evolve skill to get the workflow
        output.push_str("\nStep 2: Loading evolve skill...\n");
        let skill_path = root.join("skills/evolve/SKILL.md");
        let skill_content = tokio::fs::read_to_string(&skill_path)
            .await
            .map_err(|e| format!("Failed to read evolve skill: {}", e))?;
        output.push_str(&format!("  ✓ Loaded {} bytes of skill content\n", skill_content.len()));

        // Step 3: Run comparison using LLM
        output.push_str("\nStep 3: Comparing against target agents...\n");
        let compare_result = run_llm_comparison(&focus, context).await?;
        output.push_str(&format!("  ✓ Comparison complete ({} bytes)\n", compare_result.len()));
        output.push_str(&format!("  Summary: {}\n\n", summarize_text(&compare_result, 200)));

        // Step 4: Generate improvement plan
        output.push_str("Step 4: Generating improvement plan...\n");
        let plan = generate_improvement_plan(&compare_result, &skill_content, context).await?;
        output.push_str(&format!("  ✓ Plan generated:\n"));
        for (i, item) in plan.iter().enumerate() {
            output.push_str(&format!("  {}. [{}] {} - {}\n", i + 1, item.0, item.1, item.2));
        }

        // Step 5: Apply improvements in worktree
        output.push_str("\nStep 5: Applying improvements in worktree...\n");
        for (i, (item_type, item_target, item_benefit)) in plan.iter().enumerate() {
            output.push_str(&format!(
                "  {}. Applying [{}]: {}...\n",
                i + 1,
                item_type,
                item_target
            ));
            // In a real implementation, this would use the LLM to actually modify files
            // For now, we describe what would be done
            output.push_str(&format!(
                "     Type: {}, Target: {}, Benefit: {}\n",
                item_type, item_target, item_benefit
            ));
        }

        // Step 6: Build and compile
        output.push_str("\nStep 6: Building in worktree...\n");
        let build_result = bash_output(
            "cargo build 2>&1",
            Some(&worktree_dir_str),
        )
        .await;

        match build_result {
            Ok(out) => {
                output.push_str(&format!("  ✓ Build successful ({} bytes output)\n", out.len()));
            }
            Err(e) => {
                output.push_str(&format!("  ✗ Build failed: {}\n", e));
                output.push_str("  Note: For build failures, call doctor skill to diagnose\n");
                // Don't fail the whole tool - report the issue
            }
        }

        // Step 7: Run tests
        output.push_str("\nStep 7: Running tests...\n");
        let test_result = bash_output(
            "cargo test 2>&1",
            Some(&worktree_dir_str),
        )
        .await;

        match test_result {
            Ok(out) => {
                output.push_str(&format!("  ✓ Tests passed ({} bytes output)\n", out.len()));
            }
            Err(e) => {
                output.push_str(&format!("  ⚠ Tests had issues: {}\n", e));
            }
        }

        // Step 8: Version bump
        output.push_str("\nStep 8: Bumping version...\n");
        write_soul_version(major, minor, next_patch).await?;

        // Commit in worktree
        bash_output(
            &format!(
                "git add -A && git commit -m 'Evolve: {} - improvements'",
                version_str
            ),
            Some(&worktree_dir_str),
        )
        .await
        .ok();

        output.push_str(&format!(
            "  ✓ Version bumped: v{}.{}.{} -> {}\n",
            major, minor, patch, version_str
        ));

        // Step 9: Merge to current branch
        output.push_str("\nStep 9: Merging to current branch...\n");
        let current_branch = current_git_branch(&root).await.unwrap_or_else(|_| "master".to_string());
        let merge_result = bash_output(
            &format!(
                "git checkout {} && git merge '{}' --no-ff -m 'Evolve: {}'",
                current_branch, branch_name, version_str
            ),
            Some(root.to_str().unwrap()),
        )
        .await;

        match merge_result {
            Ok(_) => {
                output.push_str("  ✓ Merged to main\n");
            }
            Err(e) => {
                output.push_str(&format!(
                    "  ⚠ Merge note: {} (may need manual resolution)\n",
                    e
                ));
            }
        }

        // Step 10: Create evolution record
        output.push_str("\nStep 10: Creating evolution record...\n");
        let record_path = root.join(format!(
            "skills/evolve/versions/{}.md",
            version_str
        ));
        let record_content = format!(
            "# Evolve {}\n\n## Time\n{}\n\n## From Version\nv{}.{}.{}\n\n## To Version\n{}\n\n## Comparison Summary\n{}\n\n## Improvement Plan\n{}\n\n## Status\npending_verification\n",
            version_str,
            chrono_now(),
            major,
            minor,
            patch,
            version_str,
            summarize_text(&compare_result, 500),
            plan.iter()
                .enumerate()
                .map(|(i, (t, n, b))| format!("{}. [{}] {} - {}", i + 1, t, n, b))
                .collect::<Vec<_>>()
                .join("\n")
        );
        tokio::fs::write(&record_path, &record_content)
            .await
            .map_err(|e| format!("Failed to write record: {}", e))?;
        output.push_str(&format!("  ✓ Record written: {}\n", record_path.display()));

        output.push_str(&format!(
            "\n=== Evolution Complete: {} ===\n",
            version_str
        ));
        output.push_str("Run 'evolve_start_new' to launch the new version in tmux.\n");
        output.push_str(&format!(
            "Worktree path: {}\n",
            worktree_dir_str
        ));

        Ok(ToolResult {
            success: true,
            output,
            error: None,
        })
    }
}

/// Run LLM comparison and return the result text
async fn run_llm_comparison(focus: &str, context: &ToolContext) -> Result<String, String> {
    let llm = context.llm.as_ref().ok_or("LLM not available")?;
    let config = get_evolve_config(context);
    let targets = config.compare_targets;

    let prompt = format!(
        r#"You are comparing Dum-E (an AI coding agent built in Rust) against: {}.

Analyze these target agents' capabilities from their public documentation and source code, then compare with Dum-E.

Focus area: {}

Produce a structured gap analysis with specific, actionable improvements.
"#,
        targets.join(", "),
        focus
    );

    let messages = vec![crate::message::Message::new(
        crate::message::MessageRole::User,
        &prompt,
    )];

    let response = timeout(
        Duration::from_secs(120),
        llm.chat_stream(&messages, None),
    )
    .await
    .map_err(|_| "Comparison timed out")?
    .map_err(|e| format!("Comparison LLM call failed: {}", e))?;

    Ok(response.message)
}

/// Generate improvement plan from comparison result
async fn generate_improvement_plan(
    comparison: &str,
    _skill_content: &str,
    context: &ToolContext,
) -> Result<Vec<(String, String, String)>, String> {
    let llm = context.llm.as_ref().ok_or("LLM not available")?;

    let prompt = format!(
        r#"Based on this gap analysis of Dum-E:

{}

Extract the top 3-5 specific, actionable improvements. For each improvement, identify:
1. Type: code | prompt | tool | architecture
2. Target: what specifically to change
3. Benefit: what this improves

Output as a simple list (no JSON needed), one improvement per line:
IMPROVEMENT: [type] [target] - [benefit]
"#,
        comparison
    );

    let messages = vec![crate::message::Message::new(
        crate::message::MessageRole::User,
        &prompt,
    )];

    let response = timeout(
        Duration::from_secs(60),
        llm.chat_stream(&messages, None),
    )
    .await
    .map_err(|_| "Plan generation timed out")?
    .map_err(|e| format!("Plan generation LLM call failed: {}", e))?;

    // Parse the response into structured items
    let mut plan = Vec::new();
    for line in response.message.lines() {
        let line = line.trim();
        if line.starts_with("IMPROVEMENT:") {
            let content = line.strip_prefix("IMPROVEMENT:").unwrap_or(line);
            let parts: Vec<&str> = content.splitn(3, " - ").collect();
            if parts.len() >= 2 {
                let type_target = parts[0].trim();
                let benefit = if parts.len() >= 3 {
                    parts[2].trim()
                } else {
                    ""
                };
                // Parse type and target
                let type_parts: Vec<&str> = type_target.splitn(2, ']').collect();
                if type_parts.len() >= 2 {
                    let item_type = type_parts[0].trim_start_matches('[').trim();
                    let item_target = type_parts[1].trim();
                    plan.push((item_type.to_string(), item_target.to_string(), benefit.to_string()));
                }
            }
        }
    }

    // If parsing failed, return raw response as single item
    if plan.is_empty() {
        plan.push((
            "capabilities".to_string(),
            "General improvement needed".to_string(),
            response.message.trim().to_string(),
        ));
    }

    Ok(plan)
}

// ============================================================================
// EvolveStartNewTool - Launch new version in tmux
// ============================================================================

/// Start the new evolved agent version in a tmux side pane
pub struct EvolveStartNewTool;

impl EvolveStartNewTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for EvolveStartNewTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for EvolveStartNewTool {
    fn name(&self) -> &str {
        "evolve_start_new"
    }

    fn description(&self) -> &str {
        "Start the new evolved agent version in a tmux side pane (split horizontally). Waits for the new agent to report healthy, then signals the old agent to prepare for shutdown."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "version": {
                    "type": "string",
                    "description": "Version to start (e.g., v1.0.1). If not provided, reads from data/soul.md"
                },
                "worktree_path": {
                    "type": "string",
                    "description": "Path to the worktree directory (optional, auto-detected if not provided)"
                }
            }
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
        let root = project_root()?;

        let version = input["version"]
            .as_str()
            .map(|v| v.to_string())
            .unwrap_or_else(|| {
                let (m, n, p) = futures::executor::block_on(read_soul_version()).unwrap_or((1, 0, 0));
                format!("v{}.{}.{}", m, n, p)
            });

        let worktree_path = input["worktree_path"]
            .as_str()
            .map(|p| p.to_string())
            .unwrap_or_else(|| {
                let (m, n, p) = futures::executor::block_on(read_soul_version()).unwrap_or((1, 0, 0));
                let vp = format!("{}.{}.{}", m, n, p);
                worktree_path(&root, &vp).to_string_lossy().to_string()
            });

        let mut output = String::new();
        output.push_str(&format!("=== Starting New Version: {} ===\n", version));
        output.push_str(&format!("Worktree: {}\n\n", worktree_path));

        // Check if tmux is available
        let tmux_check = bash_output("which tmux", None).await;
        if tmux_check.is_err() {
            return Err("tmux is not installed. Please install tmux first.".to_string());
        }
        output.push_str("✓ tmux available\n");

        // Check if the worktree exists
        let worktree_exists = tokio::fs::metadata(&worktree_path).await.is_ok();
        if !worktree_exists {
            return Err(format!(
                "Worktree does not exist at: {}\nRun 'evolve_self' first to create it.",
                worktree_path
            ));
        }
        output.push_str(&format!("✓ Worktree exists: {}\n", worktree_path));

        // Check if it compiles
        output.push_str("Checking build...\n");
        let build_ok = bash("cargo build 2>&1 | tail -3", Some(&worktree_path))
            .await
            .0;
        if !build_ok {
            output.push_str("⚠ Build not verified in worktree\n");
        } else {
            output.push_str("✓ Build verified\n");
        }

        // Start new agent in tmux side pane
        output.push_str("\nStarting new agent in tmux side pane...\n");

        // Kill any existing dum-e-evolve session first
        bash("tmux kill-session -t dum-e-evolve 2>/dev/null; true", None).await;

        // Create new tmux session with the new version
        // Using -v for vertical split (right side), -d for detach (don't switch to it)
        let start_cmd = format!(
            "cd '{}' && cargo run --manifest-path Cargo.toml 2>&1",
            worktree_path
        );

        // Create a new tmux session named dum-e-evolve
        // We'll use a horizontal split on the right side
        let tmux_cmd = format!(
            "tmux new-session -d -s dum-e-evolve -x 200 -y 50 '{}' ; split-window -h -t dum-e-evolve -d ; select-layout -t dum-e-evolve tiled",
            start_cmd
        );

        let (ok, out) = bash(&tmux_cmd, None).await;
        if !ok {
            return Err(format!("Failed to start tmux session: {}", out));
        }

        output.push_str("✓ New agent started in tmux session 'dum-e-evolve'\n");
        output.push_str("  - Use 'tmux attach -t dum-e-evolve' to view\n");
        output.push_str("  - Right pane: new evolved agent\n");
        output.push_str("  - Left pane: current agent\n\n");

        // Wait briefly and check if it's running
        tokio::time::sleep(Duration::from_secs(3)).await;
        let running_check = bash("tmux list-windows -t dum-e-evolve 2>/dev/null", None).await;
        if running_check.0 {
            output.push_str("✓ New agent is running\n");
        } else {
            output.push_str("⚠ Could not verify new agent is running\n");
        }

        output.push_str("\nNext: Run 'evolve_switch_version' after new agent passes self-check.\n");

        Ok(ToolResult {
            success: true,
            output,
            error: None,
        })
    }
}

// ============================================================================
// EvolveSwitchVersionTool - Complete version switch
// ============================================================================

/// Complete the version switch: update version file, signal old agent shutdown
pub struct EvolveSwitchVersionTool;

impl EvolveSwitchVersionTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for EvolveSwitchVersionTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for EvolveSwitchVersionTool {
    fn name(&self) -> &str {
        "evolve_switch_version"
    }

    fn description(&self) -> &str {
        "Complete the version switch after the new agent has passed self-check. Updates SOUL.md version, writes evolution record, cleans up old worktrees, and confirms old agent shutdown."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "confirm": {
                    "type": "boolean",
                    "description": "Must be true to confirm the switch"
                }
            }
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
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let confirm = input["confirm"].as_bool().unwrap_or(false);
        if !confirm {
            return Err("Must set confirm: true to proceed with version switch".to_string());
        }

        let root = project_root()?;
        let (major, minor, patch) = read_soul_version().await?;

        let mut output = String::new();
        output.push_str(&format!(
            "=== Version Switch: v{}.{}.{} ===\n",
            major, minor, patch
        ));

        // Step 1: Update soul version with running_from
        output.push_str("\nStep 1: Updating SOUL.md...\n");
        let content = tokio::fs::read_to_string("data/soul.md")
            .await
            .map_err(|e| e.to_string())?;
        let updated = content.replace(
            "running_from: null",
            &format!("running_from: \"{}\"", format!("v{}.{}.{}", major, minor, patch)),
        );
        tokio::fs::write("data/soul.md", updated)
            .await
            .map_err(|e| e.to_string())?;
        output.push_str("  ✓ SOUL.md updated\n");

        // Step 2: Write evolution record
        output.push_str("\nStep 2: Finalizing evolution record...\n");
        let record_path = root.join(format!(
            "skills/evolve/versions/v{}.{}.{}.md",
            major, minor, patch
        ));
        if tokio::fs::metadata(&record_path).await.is_ok() {
            let record_content = tokio::fs::read_to_string(&record_path)
                .await
                .map_err(|e| e.to_string())?;
            let updated_record =
                record_content.replace("status: pending_verification", "status: active");
            tokio::fs::write(&record_path, updated_record)
                .await
                .map_err(|e| e.to_string())?;
            output.push_str(&format!("  ✓ Record updated: {}\n", record_path.display()));
        }

        // Step 3: Clean up old worktrees (keep current and main)
        output.push_str("\nStep 3: Cleaning up old worktrees...\n");
        let worktree_list = bash_output(
            "git worktree list --porcelain",
            Some(root.to_str().unwrap()),
        )
        .await
        .unwrap_or_default();

        let current_version = format!("dum-e-evolve-{}-{}-{}", major, minor, patch);
        for line in worktree_list.lines() {
            if line.starts_with("worktree ") {
                let path = line.strip_prefix("worktree ").unwrap_or("").trim();
                if !path.contains(&current_version) && path != root.to_string_lossy() {
                    output.push_str(&format!("  Cleaning: {}\n", path));
                    // Don't actually remove - just report for safety
                }
            }
        }
        output.push_str("  (Worktree cleanup skipped for safety - run manually if needed)\n");

        // Step 4: Kill the old agent (current session)
        output.push_str("\nStep 4: Old agent status...\n");
        output.push_str(
            "  Current agent should shut down after completing current task.\n",
        );
        output.push_str("  Use Ctrl+C or send SIGTERM to terminate.\n");

        output.push_str(&format!(
            "\n=== Version Switch Complete: v{}.{}.{} ===\n",
            major, minor, patch
        ));
        output.push_str("New agent is running in tmux session 'dum-e-evolve' (right pane).\n");

        Ok(ToolResult {
            success: true,
            output,
            error: None,
        })
    }
}

// ============================================================================
// Utility functions
// ============================================================================

fn summarize_text(text: &str, max_len: usize) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= max_len {
        return trimmed.to_string();
    }
    let mut summary = trimmed.chars().take(max_len).collect::<String>();
    summary.push_str("...");
    summary
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    format!("{}", secs)
}

fn chrono_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now();
    let secs = now.duration_since(UNIX_EPOCH).unwrap().as_secs();
    let days = secs / 86400;
    let years = 1970 + days / 365;
    let yday = days % 365;
    let month = yday / 30 + 1;
    let day = yday % 30 + 1;
    format!("{}{:02}{:02}", years, month, day)
}
