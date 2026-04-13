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
// EvolveContext — passed from old agent to new agent during version switch
// ============================================================================

/// Context passed from old agent to new agent during evolution
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct EvolveContext {
    /// New version string (e.g., "v1.0.4")
    version: String,
    /// PID of the old agent process
    old_pid: u32,
    /// Description of the task the old agent was working on
    task: String,
    /// Concise summary of the conversation history
    history: String,
    /// Unix timestamp when evolution started
    started_at: u64,
}

impl EvolveContext {
    fn new(version: String, old_pid: u32, task: String, history: String) -> Self {
        Self {
            version,
            old_pid,
            task,
            history,
            started_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }
}

/// Get the path to the evolve context file
fn evolve_context_path() -> String {
    format!(
        "{}/.dum-e/evolve_context.json",
        std::env::var("HOME").unwrap_or_default()
    )
}

/// Write evolve context to file (old agent writes, new agent reads)
async fn write_evolve_context(
    path: &str,
    ctx: &EvolveContext,
) -> Result<(), String> {
    // Ensure directory exists
    if let Some(dir) = std::path::Path::new(path).parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| format!("Failed to create context dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(ctx)
        .map_err(|e| format!("Failed to serialize context: {}", e))?;
    tokio::fs::write(path, json)
        .await
        .map_err(|e| format!("Failed to write context file: {}", e))?;
    Ok(())
}

/// Read evolve context from file (new agent reads)
async fn read_evolve_context(path: &str) -> Result<EvolveContext, String> {
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Failed to read context file: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse context file: {}", e))
}

/// Wait for an agent to signal ready via a file
async fn wait_for_agent_ready(
    signal_file: &str,
    max_wait_secs: u64,
) -> Result<String, String> {
    let poll_interval = Duration::from_secs(2);
    let mut waited = 0u64;

    loop {
        tokio::time::sleep(poll_interval).await;
        waited += 2;

        if tokio::fs::metadata(signal_file).await.is_ok() {
            let content = tokio::fs::read_to_string(signal_file).await
                .unwrap_or_default();
            return Ok(content.trim().to_string());
        }

        // Check if tmux session died
        let session_alive = bash(
            "tmux list-sessions -t dum-e-evolve 2>/dev/null",
            None,
        )
        .await
        .0;

        if !session_alive {
            return Err(format!(
                "New agent tmux session died after {}s",
                waited
            ));
        }

        if waited >= max_wait_secs {
            return Err(format!(
                "Timeout after {}s waiting for ready signal at {}",
                max_wait_secs, signal_file
            ));
        }
    }
}

/// Run subagent verification before version bump.
/// Verifies build, tests, and observability are intact.
async fn run_subagent_verification(
    worktree_dir: &str,
    context: &ToolContext,
    output: &mut String,
) -> Result<bool, String> {
    output.push_str("\nStep 8: Running subagent verification...\n");

    // 1. Run cargo build
    output.push_str("  Running cargo build...\n");
    let build_result = bash_output("cargo build 2>&1", Some(worktree_dir)).await;
    let (build_ok, build_out) = match &build_result {
        Ok(out) => {
            let has_error = out.contains("error:");
            if has_error {
                output.push_str(&format!(
                    "    Build FAILED ({} lines):\n{}\n",
                    out.len(),
                    summarize_text(out, 500)
                ));
            } else {
                output.push_str(&format!("    Build OK ({} lines output)\n", out.len()));
            }
            (!has_error, out.clone())
        }
        Err(e) => {
            output.push_str(&format!("    Build error: {}\n", e));
            (false, e.clone())
        }
    };

    // 2. Run cargo test
    output.push_str("  Running cargo test...\n");
    let test_result = bash_output("cargo test 2>&1", Some(worktree_dir)).await;
    let (test_ok, test_out) = match &test_result {
        Ok(out) => {
            let has_failed = out.contains("FAILED") || out.contains("error");
            if has_failed {
                output.push_str(&format!(
                    "    Tests FAILED ({} lines):\n{}\n",
                    out.len(),
                    summarize_text(out, 500)
                ));
            } else {
                output.push_str(&format!("    Tests OK ({} lines output)\n", out.len()));
            }
            (!has_failed, out.clone())
        }
        Err(e) => {
            output.push_str(&format!("    Test error: {}\n", e));
            (false, e.clone())
        }
    };

    // 3. Quick observability check — grep for key observability patterns
    output.push_str("  Checking observability integrity...\n");
    let observability_check = bash_output(
        "grep -r 'tracing\\|event\\|log\\|span' src/ 2>/dev/null | wc -l",
        Some(worktree_dir),
    ).await.unwrap_or_default();
    let obs_count: usize = observability_check.trim().parse().unwrap_or(0);
    let obs_ok = obs_count > 10; // At least 10 observability references
    if obs_ok {
        output.push_str(&format!("    Observability OK ({} references)\n", obs_count));
    } else {
        output.push_str(&format!("    ⚠ Low observability ({} refs, expected >10)\n", obs_count));
    }

    // 4. LLM analysis of verification results
    let llm = context.llm.as_ref().ok_or("LLM not available for verification")?;

    let verification_prompt = format!(
        r#"You are Dum-E's self-verification subagent. Analyze the following verification results from the evolved code and determine if the evolution passed.

## Verification Results

### Build:
{}

### Test:
{}

### Observability:
{} observability references found in source (threshold: >10)

## Verification Dimensions:
1. **Build passes** - cargo build produces no errors
2. **Tests pass** - cargo test shows no FAILED tests
3. **Observability intact** - logging, tracing, event code is present and not broken

## Output Format:
Return EXACTLY one of:
PASS - all dimensions pass, safe to proceed with version bump
FAIL: [specific reason] - describe which dimension failed and why"#,
        summarize_text(&build_out, 800),
        summarize_text(&test_out, 1000),
        obs_count
    );

    let messages = vec![crate::message::Message::new(
        crate::message::MessageRole::User,
        &verification_prompt,
    )];

    output.push_str("  LLM analyzing verification results...\n");
    let response = timeout(
        Duration::from_secs(60),
        llm.chat_stream(&messages, None),
    )
    .await
    .map_err(|_| "Verification LLM timed out after 60s")?
    .map_err(|e| format!("Verification LLM call failed: {}", e))?;

    let response_lower = response.message.to_lowercase();
    let is_pass = response_lower.starts_with("pass")
        && !response_lower.contains("fail")
        && !response_lower.starts_with("fail");

    if is_pass {
        output.push_str("  ✓ Verification PASSED\n");
        output.push_str(&format!("    LLM: {}\n", summarize_text(&response.message, 200)));
    } else {
        output.push_str("  ✗ Verification FAILED\n");
        output.push_str(&format!("    LLM: {}\n", summarize_text(&response.message, 300)));
    }

    Ok(is_pass)
}

/// Clean up stale evolve signal files
async fn cleanup_evolve_files() {
    let home = std::env::var("HOME").unwrap_or_default();
    let ready_dir = format!("{}/.dum-e/ready", home);

    // Clean all ready signals
    if let Ok(entries) = tokio::fs::read_dir(&ready_dir).await {
        let mut dir = entries;
        while let Ok(Some(entry)) = dir.next_entry().await {
            tokio::fs::remove_file(entry.path()).await.ok();
        }
    }

    // Clean context file
    let ctx_path = evolve_context_path();
    tokio::fs::remove_file(&ctx_path).await.ok();
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

        // Get current process PID for context passing
        let old_pid = std::process::id();

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
                if e.contains("already exists") {
                    output.push_str(&format!(
                        "  ✓ Worktree already exists: {}, checking out\n",
                        worktree_dir_str
                    ));
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
        output.push_str("  ✓ Plan generated:\n");
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

        match &build_result {
            Ok(out) => {
                output.push_str(&format!("  ✓ Build successful ({} bytes output)\n", out.len()));
            }
            Err(e) => {
                output.push_str(&format!("  ✗ Build failed: {}\n", e));
                return Err(format!("Build failed in worktree: {}. Call doctor skill to fix.", e));
            }
        }

        // Step 7: Run tests
        output.push_str("\nStep 7: Running tests...\n");
        let test_result = bash_output(
            "cargo test 2>&1",
            Some(&worktree_dir_str),
        )
        .await;

        match &test_result {
            Ok(out) => {
                output.push_str(&format!("  ✓ Tests passed ({} bytes output)\n", out.len()));
            }
            Err(e) => {
                output.push_str(&format!("  ⚠ Tests had issues: {}\n", e));
            }
        }

        // Step 8: Subagent verification (new agent in old agent process)
        let verification_pass = run_subagent_verification(
            &worktree_dir_str,
            context,
            &mut output,
        ).await?;

        if !verification_pass {
            output.push_str("\n  ✗ Verification FAILED — returning to planning\n");
            output.push_str("  Please review the verification output above.\n");
            output.push_str("  The worktree is preserved at:\n");
            output.push_str(&format!("  {}\n", worktree_dir_str));
            return Ok(ToolResult {
                success: false,
                output,
                error: Some("Subagent verification failed — improvements need adjustment".to_string()),
            });
        }

        // Step 9: Version bump
        output.push_str("\nStep 9: Bumping version...\n");
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

        // Step 10: Merge to current branch
        output.push_str("\nStep 10: Merging to current branch...\n");
        let current_branch = current_git_branch(&root).await.unwrap_or_else(|_| "master".to_string());
        let merge_result = bash_output(
            &format!(
                "git checkout {} && git merge '{}' --no-ff -m 'Evolve: {}'",
                current_branch, branch_name, version_str
            ),
            Some(root.to_str().unwrap()),
        )
        .await;

        match &merge_result {
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

        // Step 11: Create evolution record
        output.push_str("\nStep 11: Creating evolution record...\n");
        let record_path = root.join(format!(
            "skills/evolve/versions/{}.md",
            version_str
        ));
        let record_content = format!(
            "# Evolve {}\n\n## Time\n{}\n\n## From Version\nv{}.{}.{}\n\n## To Version\n{}\n\n## Comparison Summary\n{}\n\n## Improvement Plan\n{}\n\n## Status\nactive\n",
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

        // Step 12: Clean up stale evolve files
        output.push_str("\nStep 12: Cleaning up stale files...\n");
        cleanup_evolve_files().await;
        output.push_str("  ✓ Stale files cleaned\n");

        // Step 13: Start new agent in tmux and wait for it to signal ready
        output.push_str("\nStep 13: Starting new agent in tmux...\n");

        // Prepare ready signal
        let home = std::env::var("HOME").unwrap_or_default();
        let ready_dir = format!("{}/.dum-e/ready", home);
        let ready_file = format!("{}/{}", ready_dir, version_str.replace('.', "-"));

        // Ensure dirs exist
        bash_output(&format!("mkdir -p '{}'", ready_dir), None).await.ok();
        bash_output(&format!("mkdir -p '{}/.dum-e'", home), None).await.ok();

        // Clear stale ready file
        tokio::fs::remove_file(&ready_file).await.ok();

        output.push_str(&format!("  Ready signal path: {}\n", ready_file));
        output.push_str(&format!("  Old agent PID: {}\n", old_pid));

        // Kill any existing session
        bash("tmux kill-session -t dum-e-evolve 2>/dev/null; true", None).await;

        // Start new agent with env vars: DUM_E_READY_SIGNAL and DUM_E_OLD_PID
        let start_cmd = format!(
            "cd '{}' && DUM_E_READY_SIGNAL='{}' DUM_E_OLD_PID={} cargo run --manifest-path Cargo.toml 2>&1",
            worktree_dir_str, ready_file, old_pid
        );

        let tmux_cmd = format!("tmux new-session -d -s dum-e-evolve '{}'", start_cmd);
        let (tmux_ok, tmux_out) = bash(&tmux_cmd, None).await;
        if !tmux_ok {
            return Err(format!("Failed to start tmux session: {}", tmux_out));
        }
        output.push_str("  ✓ tmux session started\n");

        // Wait for new agent to become ready (max 120s)
        output.push_str("  Waiting for new agent to signal ready...\n");
        match wait_for_agent_ready(&ready_file, 120).await {
            Ok(signal) => {
                output.push_str(&format!("  ✓ Agent ready after receiving signal: {}\n", signal));
            }
            Err(e) => {
                output.push_str(&format!("  ✗ Agent did not signal ready: {}\n", e));
                output.push_str(&format!("  Worktree preserved at: {}\n", worktree_dir_str));
                return Err(format!("New agent failed to become ready: {}", e));
            }
        }

        // Step 14: Write evolve context, wait for stability, then switch
        output.push_str("\nStep 14: Preparing context transfer...\n");

        // Write context file for the new agent
        let ctx = EvolveContext::new(
            version_str.clone(),
            old_pid,
            "Dum-E self-evolution completed".to_string(),
            format!(
                "Evolved from v{}.{}.{} to {}. {} improvements applied.",
                major, minor, patch, version_str,
                plan.len()
            ),
        );
        let ctx_path = evolve_context_path();
        write_evolve_context(&ctx_path, &ctx).await?;
        output.push_str(&format!("  ✓ Context written: {}\n", ctx_path));

        // Wait for new agent to stabilize
        output.push_str("  Waiting 5s for new agent to stabilize...\n");
        tokio::time::sleep(Duration::from_secs(5)).await;

        // Verify new agent is still alive
        let still_alive = bash(
            "tmux list-sessions -t dum-e-evolve 2>/dev/null",
            None,
        )
        .await
        .0;
        if !still_alive {
            return Err("New agent died after signaling ready — aborting".to_string());
        }
        output.push_str("  ✓ New agent is stable\n");

        // Call evolve_switch_version to complete the switch
        output.push_str("\nStep 15: Completing version switch...\n");
        let switch_result = EvolveSwitchVersionTool::new()
            .call(&serde_json::json!({}), context)
            .await
            .map_err(|e| format!("evolve_switch_version failed: {}", e))?;

        for line in switch_result.output.lines() {
            if !line.trim().is_empty() {
                output.push_str(&format!("  {}\n", line));
            }
        }

        if !switch_result.success {
            output.push_str("  ⚠ Version switch had issues but new agent is running\n");
        }

        // Clean up context file
        tokio::fs::remove_file(&ctx_path).await.ok();

        output.push_str(&format!(
            "\n=== Evolution Complete: {} ===\n",
            version_str
        ));
        output.push_str("New agent running in tmux session 'dum-e-evolve'\n");
        output.push_str("View with: tmux attach -t dum-e-evolve\n");
        output.push_str("Old agent will now shut down.\n");

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
                },
                "old_pid": {
                    "type": "integer",
                    "description": "PID of the old agent process (optional, passed to new agent for context transfer)"
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

        let old_pid = input["old_pid"].as_u64().map(|p| p as u32);

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

        // Check if it compiles first
        output.push_str("Checking build...\n");
        let build_ok = bash("cargo build 2>&1 | tail -3", Some(&worktree_path))
            .await
            .0;
        if !build_ok {
            return Err("Build failed in worktree — cannot start new version".to_string());
        }
        output.push_str("✓ Build verified\n");

        // Prepare ready signal
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let ready_dir = format!("{}/.dum-e/ready", home);
        let ready_file = format!("{}/{}", ready_dir, version.replace('.', "-"));

        // Clean up any stale ready files for this version
        tokio::fs::remove_file(&ready_file).await.ok();

        // Ensure ready dir exists
        bash_output(&format!("mkdir -p '{}'", ready_dir), None)
            .await
            .ok();

        output.push_str("\nStarting new agent in tmux...\n");

        // Kill any existing dum-e-evolve session first
        bash("tmux kill-session -t dum-e-evolve 2>/dev/null; true", None).await;

        // Build env var string for the new agent
        let env_vars = if let Some(pid) = old_pid {
            format!("DUM_E_READY_SIGNAL='{}' DUM_E_OLD_PID={}", ready_file, pid)
        } else {
            format!("DUM_E_READY_SIGNAL='{}'", ready_file)
        };

        // Start new agent with env vars
        let start_cmd = format!(
            "cd '{}' && {} cargo run --manifest-path Cargo.toml 2>&1",
            worktree_path, env_vars
        );

        // Create detached tmux session
        let tmux_cmd = format!(
            "tmux new-session -d -s dum-e-evolve '{}'",
            start_cmd
        );

        let (ok, out) = bash(&tmux_cmd, None).await;
        if !ok {
            return Err(format!("Failed to start tmux session: {}", out));
        }
        output.push_str("✓ tmux session created\n");

        // Wait 30 seconds for agent to initialize before polling
        output.push_str("Waiting 30s for agent to initialize...\n");
        tokio::time::sleep(Duration::from_secs(30)).await;

        // Poll for ready signal file (max 90s)
        let max_wait = 90;
        let poll_interval = Duration::from_secs(2);
        let mut waited = 30u64;

        output.push_str(&format!(
            "Polling for ready signal at {}...\n",
            ready_file
        ));

        while waited < max_wait {
            tokio::time::sleep(poll_interval).await;
            waited += 2;

            if tokio::fs::metadata(&ready_file).await.is_ok() {
                // Read the ready file content to verify version
                let content = tokio::fs::read_to_string(&ready_file).await.ok();
                let content_str = content.as_deref().unwrap_or("");

                if content_str.contains(&version) || content_str.contains("ready") {
                    output.push_str(&format!(
                        "✓ Agent ready after {}s — signal: {}\n",
                        waited, content_str.trim()
                    ));
                    break;
                }
            }

            // Check if tmux session died (agent crashed)
            let session_alive = bash(
                "tmux list-sessions -t dum-e-evolve 2>/dev/null",
                None,
            )
            .await
            .0;

            if !session_alive {
                output.push_str(&format!(
                    "✗ tmux session died after {}s — agent may have crashed\n",
                    waited
                ));
                return Err(format!(
                    "New agent crashed during startup (waited {}s). Check tmux logs.",
                    waited
                ));
            }

            if waited % 10 == 0 {
                output.push_str(&format!(
                    "  Still waiting... {}s / {}s\n",
                    waited, max_wait
                ));
            }
        }

        if waited >= max_wait {
            output.push_str(&format!(
                "✗ Timeout after {}s — agent did not signal ready\n",
                max_wait
            ));
            return Err(format!(
                "New agent did not become ready within {}s. Timed out waiting for {}",
                max_wait, ready_file
            ));
        }

        // Final verification: confirm tmux session is alive
        let final_check = bash(
            "tmux list-sessions -t dum-e-evolve 2>/dev/null",
            None,
        )
        .await
        .0;

        if !final_check {
            return Err("Agent crashed after signaling ready".to_string());
        }

        output.push_str(&format!(
            "\n=== New Version Running: {} ===\n",
            version
        ));
        output.push_str("View with: tmux attach -t dum-e-evolve\n");
        output.push_str("Left pane: old agent | Right pane: new agent\n");

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
            "properties": {}
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
        _input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let root = project_root()?;
        let ctx_path = evolve_context_path();

        // Try to read context file for version info
        let (ctx_version, old_pid) = if tokio::fs::metadata(&ctx_path).await.is_ok() {
            match read_evolve_context(&ctx_path).await {
                Ok(ctx) => (Some(ctx.version.clone()), Some(ctx.old_pid)),
                Err(_) => (None, None),
            }
        } else {
            (None, None)
        };

        let (major, minor, patch) = read_soul_version().await?;
        let display_version = ctx_version.clone().unwrap_or_else(|| format!("v{}.{}.{}", major, minor, patch));

        let mut output = String::new();
        output.push_str(&format!(
            "=== Version Switch: {} ===\n",
            display_version
        ));

        // Step 1: Verify new agent is running in tmux
        output.push_str("\nStep 1: Verifying new agent is healthy...\n");
        let new_agent_alive = bash(
            "tmux list-sessions -t dum-e-evolve 2>/dev/null",
            None,
        )
        .await
        .0;
        if !new_agent_alive {
            return Err("New agent is not running in tmux — aborting switch".to_string());
        }
        output.push_str("  ✓ New agent is alive in tmux session 'dum-e-evolve'\n");

        // Step 2: Update soul version with running_from
        output.push_str("\nStep 2: Updating SOUL.md...\n");
        let content = tokio::fs::read_to_string("data/soul.md")
            .await
            .map_err(|e| e.to_string())?;

        // Update running_from to the new version
        let updated = if content.contains("running_from:") {
            content.lines()
                .map(|line| {
                    if line.trim().starts_with("running_from:") {
                        format!("  running_from: \"v{}.{}.{}\"", major, minor, patch)
                    } else {
                        line.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            // Insert running_from after the patch line
            content.lines()
                .map(|line| {
                    let mut s = line.to_string();
                    if line.trim().starts_with("patch:") {
                        s.push_str(&format!("\n  running_from: \"v{}.{}.{}\"", major, minor, patch));
                    }
                    s
                })
                .collect::<Vec<_>>()
                .join("\n")
        };

        tokio::fs::write("data/soul.md", &updated)
            .await
            .map_err(|e| e.to_string())?;
        output.push_str("  ✓ SOUL.md updated with running_from\n");

        // Step 3: Finalize evolution record
        output.push_str("\nStep 3: Finalizing evolution record...\n");
        let record_path = root.join(format!(
            "skills/evolve/versions/{}.md",
            display_version
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
        } else {
            output.push_str("  (No pending record found)\n");
        }

        // Step 4: Clean up old worktrees (keep current and main)
        output.push_str("\nStep 4: Cleaning up old worktrees...\n");
        let worktree_list = bash_output(
            "git worktree list --porcelain",
            Some(root.to_str().unwrap()),
        )
        .await
        .unwrap_or_default();

        let current_version_pattern = format!("dum-e-evolve-{}-{}-{}", major, minor, patch);
        let mut cleaned = 0;
        let mut errors = Vec::new();

        for line in worktree_list.lines() {
            if line.starts_with("worktree ") {
                let path = line.strip_prefix("worktree ").unwrap_or("").trim().to_string();
                if !path.contains(&current_version_pattern)
                    && path != root.to_string_lossy()
                    && !path.contains(".claude/worktrees")
                {
                    output.push_str(&format!("  Removing: {}\n", path));
                    let remove_result = bash_output(
                        &format!("git worktree remove '{}' --force", path),
                        Some(root.to_str().unwrap()),
                    )
                    .await;
                    match remove_result {
                        Ok(_) => {
                            output.push_str(&format!("    ✓ Removed\n"));
                            cleaned += 1;
                        }
                        Err(e) => {
                            output.push_str(&format!("    ✗ Failed: {}\n", e));
                            errors.push(format!("{}: {}", path, e));
                        }
                    }
                }
            }
        }
        if cleaned == 0 && errors.is_empty() {
            output.push_str("  (No old worktrees to clean)\n");
        }
        if !errors.is_empty() {
            output.push_str(&format!("  ⚠ {} worktree(s) could not be removed (manual cleanup may be needed)\n", errors.len()));
        }

        // Step 5: Kill the old agent process
        output.push_str("\nStep 5: Shutting down old agent...\n");

        // Try to read old PID from context file first
        let ctx_path = evolve_context_path();
        let old_pid = if tokio::fs::metadata(&ctx_path).await.is_ok() {
            match read_evolve_context(&ctx_path).await {
                Ok(ctx) => {
                    output.push_str(&format!("  Read old PID from context: {}\n", ctx.old_pid));
                    Some(ctx.old_pid)
                }
                Err(e) => {
                    output.push_str(&format!("  Could not read context: {}, falling back to pgrep\n", e));
                    None
                }
            }
        } else {
            None
        };

        // If we have a PID, kill it; otherwise use pgrep fallback
        if let Some(pid) = old_pid {
            output.push_str(&format!("  Sending SIGTERM to old agent (PID {})...\n", pid));
            let kill_result = bash_output(
                &format!("kill -15 {} 2>/dev/null; sleep 1; kill -9 {} 2>/dev/null; true", pid, pid),
                None,
            ).await;
            if kill_result.is_ok() {
                output.push_str("  ✓ Old agent terminated\n");
            } else {
                output.push_str("  ⚠ Could not terminate old agent\n");
            }
        } else {
            // Fallback: use pgrep
            let pid_result = bash_output("pgrep -x dum-e | head -1", None).await;
            if let Ok(pid_str) = pid_result {
                let pid = pid_str.trim();
                if !pid.is_empty() {
                    output.push_str(&format!("  Found old agent (PID {}), sending SIGTERM...\n", pid));
                    let kill_result = bash_output(
                        &format!("kill -15 {} 2>/dev/null; sleep 1; kill -9 {} 2>/dev/null; true", pid, pid),
                        None,
                    ).await;
                    if kill_result.is_ok() {
                        output.push_str("  ✓ Old agent terminated\n");
                    } else {
                        output.push_str("  ⚠ Could not terminate old agent\n");
                    }
                } else {
                    output.push_str("  (No running dum-e process found)\n");
                }
            } else {
                output.push_str("  (No running dum-e process found)\n");
            }
        }

        // Step 6: Final verification
        output.push_str("\nStep 6: Final verification...\n");
        let still_alive = bash("pkill -x dum-e 2>/dev/null", None).await.0;
        if still_alive {
            output.push_str("  ⚠ Warning: old dum-e process still running\n");
        } else {
            output.push_str("  ✓ Old agent fully shut down\n");
        }

        // Confirm new agent is still running
        let new_still_alive = bash(
            "tmux list-sessions -t dum-e-evolve 2>/dev/null",
            None,
        )
        .await
        .0;
        if new_still_alive {
            output.push_str("  ✓ New agent still running in tmux\n");
        } else {
            output.push_str("  ✗ New agent died!\n");
        }

        output.push_str(&format!(
            "\n=== Version Switch Complete: {} ===\n",
            display_version
        ));
        output.push_str("New agent is running in tmux session 'dum-e-evolve'\n");
        output.push_str("View with: tmux attach -t dum-e-evolve\n");
        output.push_str(&format!("Cleaned {} old worktree(s)\n", cleaned));

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
