//! Dum-E Integration Test Harness
//!
//! Runtime verification system - actually executes Dum-E and validates results.
//! Not just syntax/unit tests, but real end-to-end verification.

use crate::agent::Agent;
use crate::config::Config;
use crate::llm::{LLMProvider, MiniMaxLLM};
use crate::observability::{Event, EventBus};
use crate::soul::SoulManager;
use crate::tools::ToolRegistry;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use tracing::info;

/// Test scenario definition
#[derive(Debug, Clone)]
pub struct Scenario {
    pub name: String,
    pub task: String,
    pub expected_outcome: ExpectedOutcome,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone)]
pub enum ExpectedOutcome {
    /// Task should complete successfully
    Success,
    /// Task should fail with specific error pattern
    ErrorContains(String),
    /// Task should produce output containing text
    OutputContains(String),
    /// Task should complete in certain number of steps
    StepsBetween(usize, usize),
}

/// Test result
#[derive(Debug)]
pub struct TestResult {
    pub scenario: String,
    pub passed: bool,
    pub actual_steps: usize,
    pub output: String,
    pub error: Option<String>,
    pub events: Vec<Event>,
    pub duration_ms: u64,
}

impl TestResult {
    pub fn new(scenario: &str) -> Self {
        Self {
            scenario: scenario.to_string(),
            passed: false,
            actual_steps: 0,
            output: String::new(),
            error: None,
            events: Vec::new(),
            duration_ms: 0,
        }
    }

    pub fn with_steps(mut self, steps: usize) -> Self {
        self.actual_steps = steps;
        self
    }

    pub fn with_output(mut self, output: String) -> Self {
        self.output = output;
        self
    }

    pub fn with_error(mut self, error: String) -> Self {
        self.error = Some(error);
        self
    }

    pub fn with_events(mut self, events: Vec<Event>) -> Self {
        self.events = events;
        self
    }

    pub fn with_duration(mut self, duration_ms: u64) -> Self {
        self.duration_ms = duration_ms;
        self
    }

    pub fn pass(mut self) -> Self {
        self.passed = true;
        self
    }
}

/// Semantic sequence entry used by parity diffs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SequenceSummaryEntry {
    pub label: String,
    pub count: usize,
}

impl SequenceSummaryEntry {
    pub fn new(label: impl Into<String>, count: usize) -> Self {
        Self {
            label: label.into(),
            count,
        }
    }
}

impl std::fmt::Display for SequenceSummaryEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.count > 1 {
            write!(f, "{}×{}", self.label, self.count)
        } else {
            write!(f, "{}", self.label)
        }
    }
}

/// Deterministic replay frame extracted from persisted/collected events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayFrame {
    pub ordinal: usize,
    pub timestamp: DateTime<Utc>,
    pub component: String,
    pub event_type: String,
    pub detail: String,
}

/// Canonical parity scenario scaffold derived from the streaming parity test spec.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParityScenarioSpec {
    pub id: String,
    pub description: String,
    pub expected_sequence: Vec<SequenceSummaryEntry>,
}

/// Sequence diff summary for dum-e vs reference behavior.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParityComparison {
    pub passed: bool,
    pub first_mismatch_index: Option<usize>,
    pub actual_len: usize,
    pub expected_len: usize,
}

/// Structured parity report matching the test-spec reporting contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParityReport {
    pub scenario_id: String,
    pub dum_e_sequence_summary: Vec<SequenceSummaryEntry>,
    pub claude_code_sequence_summary: Vec<SequenceSummaryEntry>,
    pub diff_verdict: &'static str,
    pub first_mismatch_location: Option<usize>,
}

/// Build the canonical scenario corpus scaffold for parity work.
pub fn canonical_parity_corpus() -> Vec<ParityScenarioSpec> {
    vec![
        ParityScenarioSpec {
            id: "pure_text_stream".to_string(),
            description: "Pure text stream, no tool.".to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "llm_chunk",
                "llm_complete",
                "agent_complete",
            ]),
        },
        ParityScenarioSpec {
            id: "single_tool_call".to_string(),
            description: "Single tool call with input deltas.".to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "llm_tool_call",
                "tool_call",
                "tool_complete",
                "llm_complete",
                "agent_complete",
            ]),
        },
        ParityScenarioSpec {
            id: "multi_tool_mixed_concurrency".to_string(),
            description: "Multi-tool turn with mixed concurrency-safe and exclusive tools."
                .to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "llm_tool_call",
                "tool_call",
                "tool_progress",
                "tool_complete",
                "llm_complete",
                "agent_complete",
            ]),
        },
        ParityScenarioSpec {
            id: "tool_error_no_orphan".to_string(),
            description: "Tool error must still resolve without orphaned results.".to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "llm_tool_call",
                "tool_call",
                "tool_error",
                "llm_complete",
                "agent_complete",
            ]),
        },
        ParityScenarioSpec {
            id: "fallback_mid_turn".to_string(),
            description: "Streaming fallback mid-turn without dangling tool_use.".to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "llm_chunk",
                "llm_tool_call",
                "tool_call",
                "tool_complete",
                "agent_complete",
            ]),
        },
        ParityScenarioSpec {
            id: "user_interrupt_mid_tool".to_string(),
            description: "Interrupt during tool execution emits stable terminal lifecycle."
                .to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "llm_tool_call",
                "tool_call",
                "user_interrupt",
                "tool_complete",
                "agent_complete",
            ]),
        },
        ParityScenarioSpec {
            id: "thinking_block_lifecycle".to_string(),
            description: "Thinking start/delta/end lifecycle remains deterministic.".to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "llm_chunk",
                "llm_complete",
                "agent_complete",
            ]),
        },
        ParityScenarioSpec {
            id: "voice_stream_interrupt".to_string(),
            description: "Voice-mode stream with interrupt handling.".to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "voice_speak_start",
                "voice_speak_chunk",
                "voice_interrupt",
                "agent_complete",
            ]),
        },
        ParityScenarioSpec {
            id: "cross_provider_smoke".to_string(),
            description: "Cross-provider adapter contract smoke scenario.".to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "llm_complete",
                "agent_complete",
            ]),
        },
        ParityScenarioSpec {
            id: "replay_reconstruction".to_string(),
            description: "Trace replay reconstructs scenario semantics deterministically."
                .to_string(),
            expected_sequence: semantic_sequence(&[
                "agent_start",
                "agent_step",
                "llm_start",
                "tool_call",
                "tool_complete",
                "agent_complete",
            ]),
        },
    ]
}

fn semantic_sequence(labels: &[&str]) -> Vec<SequenceSummaryEntry> {
    labels
        .iter()
        .map(|label| SequenceSummaryEntry::new(*label, 1))
        .collect()
}

/// Convert events into a compressed semantic sequence summary.
pub fn summarize_event_sequence(events: &[Event]) -> Vec<SequenceSummaryEntry> {
    let mut summary = Vec::new();

    for event in events {
        let label = event_sequence_label(event);
        match summary.last_mut() {
            Some(entry) if entry.label == label => entry.count += 1,
            _ => summary.push(SequenceSummaryEntry::new(label, 1)),
        }
    }

    summary
}

/// Rebuild a deterministic event timeline for replay/diffing.
pub fn replay_frames(events: &[Event]) -> Vec<ReplayFrame> {
    let mut ordered = events.to_vec();
    ordered.sort_by(|left, right| {
        left.timestamp
            .cmp(&right.timestamp)
            .then_with(|| format!("{:?}", left.component).cmp(&format!("{:?}", right.component)))
            .then_with(|| format!("{:?}", left.event_type).cmp(&format!("{:?}", right.event_type)))
    });

    ordered
        .into_iter()
        .enumerate()
        .map(|(idx, event)| ReplayFrame {
            ordinal: idx,
            timestamp: event.timestamp,
            component: format!("{:?}", event.component).to_lowercase(),
            event_type: event_sequence_label(&event),
            detail: event_detail(&event),
        })
        .collect()
}

/// Compare actual dum-e sequence with a reference sequence.
pub fn compare_sequence_summaries(
    actual: &[SequenceSummaryEntry],
    expected: &[SequenceSummaryEntry],
) -> ParityComparison {
    let max_len = actual.len().max(expected.len());
    let first_mismatch_index = (0..max_len).find(|idx| actual.get(*idx) != expected.get(*idx));

    ParityComparison {
        passed: first_mismatch_index.is_none(),
        first_mismatch_index,
        actual_len: actual.len(),
        expected_len: expected.len(),
    }
}

/// Build a parity report for a finished scenario run.
pub fn build_parity_report(
    scenario_id: impl Into<String>,
    events: &[Event],
    reference_sequence: &[SequenceSummaryEntry],
) -> ParityReport {
    let actual = summarize_event_sequence(events);
    let comparison = compare_sequence_summaries(&actual, reference_sequence);

    ParityReport {
        scenario_id: scenario_id.into(),
        dum_e_sequence_summary: actual,
        claude_code_sequence_summary: reference_sequence.to_vec(),
        diff_verdict: if comparison.passed { "PASS" } else { "FAIL" },
        first_mismatch_location: comparison.first_mismatch_index,
    }
}

fn event_sequence_label(event: &Event) -> String {
    use crate::observability::EventType;

    match &event.event_type {
        EventType::AgentStart => "agent_start",
        EventType::AgentStep => "agent_step",
        EventType::AgentComplete => "agent_complete",
        EventType::AgentError => "agent_error",
        EventType::LlmStart => "llm_start",
        EventType::LlmChunk => "llm_chunk",
        EventType::LlmComplete => "llm_complete",
        EventType::LlmToolCall => "llm_tool_call",
        EventType::ToolCall => "tool_call",
        EventType::ToolProgress => "tool_progress",
        EventType::ToolComplete => "tool_complete",
        EventType::ToolError => "tool_error",
        EventType::MemorySearch => "memory_search",
        EventType::MemoryStore => "memory_store",
        EventType::MemoryCompact => "memory_compact",
        EventType::VoiceSpeakStart => "voice_speak_start",
        EventType::VoiceSpeakChunk => "voice_speak_chunk",
        EventType::VoiceSpeakComplete => "voice_speak_complete",
        EventType::VoiceListenStart => "voice_listen_start",
        EventType::VoiceListenComplete => "voice_listen_complete",
        EventType::VoiceInterrupt => "voice_interrupt",
        EventType::UserInterrupt => "user_interrupt",
        EventType::UserInput => "user_input",
    }
    .to_string()
}

fn event_detail(event: &Event) -> String {
    use crate::observability::EventData;

    match &event.data {
        EventData::Empty => String::new(),
        EventData::Message { message } => message.clone(),
        EventData::Error { error } => error.clone(),
        EventData::ToolCall { tool, input } => format!("{} {}", tool, input),
        EventData::ToolProgress { tool, output } => format!("{} {}", tool, output),
        EventData::LlmChunk { text } => text.clone(),
        EventData::VoiceChunk { audio_size } => format!("audio_size={}", audio_size),
        EventData::Custom(value) => value.to_string(),
    }
}

/// Integration test harness for Dum-E
pub struct Harness {
    event_bus: Arc<EventBus>,
    scenarios: Vec<Scenario>,
}

impl Harness {
    pub fn new(dev_mode: bool) -> Self {
        Self {
            event_bus: Arc::new(EventBus::new(dev_mode)),
            scenarios: Vec::new(),
        }
    }

    /// Add a test scenario
    pub fn scenario(mut self, scenario: Scenario) -> Self {
        self.scenarios.push(scenario);
        self
    }

    /// Run all scenarios and collect results
    pub async fn run_all(&self) -> Vec<TestResult> {
        let mut results = Vec::new();
        for scenario in &self.scenarios {
            let result = self.run_scenario(scenario).await;
            results.push(result);
        }
        results
    }

    /// Run a single scenario
    pub async fn run_scenario(&self, scenario: &Scenario) -> TestResult {
        info!("Running scenario: {}", scenario.name);
        let start = std::time::Instant::now();

        // Load config
        let config = Config::load_from("config.json").unwrap_or_default();

        // Create a new event bus for this run
        let event_bus = Arc::new(EventBus::new(true));
        let mut rx = event_bus.subscribe();

        // Collect events in background task
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();

        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                events_clone.lock().unwrap().push(event);
            }
        });

        // Create agent with LLM
        let mut agent = self.create_agent(event_bus.clone(), &config);

        // Execute task
        let agent_result = tokio::time::timeout(
            std::time::Duration::from_secs(scenario.timeout_secs),
            agent.run(&scenario.task),
        )
        .await;

        let duration_ms = start.elapsed().as_millis() as u64;
        let events = events.lock().unwrap().clone();

        // Evaluate result
        let mut result = TestResult::new(&scenario.name)
            .with_duration(duration_ms)
            .with_events(events);

        match agent_result {
            Ok(Ok(agent_res)) => {
                result = result
                    .with_steps(agent_res.steps)
                    .with_output(agent_res.output.clone());

                result = match &scenario.expected_outcome {
                    ExpectedOutcome::Success => {
                        if agent_res.success {
                            result.pass()
                        } else {
                            result.with_error("Agent reported failure".to_string())
                        }
                    }
                    ExpectedOutcome::OutputContains(text) => {
                        if agent_res.output.contains(text) {
                            result.pass()
                        } else {
                            result.with_error(format!(
                                "Output '{}' does not contain '{}'",
                                agent_res.output, text
                            ))
                        }
                    }
                    ExpectedOutcome::StepsBetween(min, max) => {
                        if agent_res.steps >= *min && agent_res.steps <= *max {
                            result.pass()
                        } else {
                            result.with_error(format!(
                                "Steps {} not in range [{}, {}]",
                                agent_res.steps, min, max
                            ))
                        }
                    }
                    ExpectedOutcome::ErrorContains(_) => {
                        result.with_error("Expected error but got success".to_string())
                    }
                };
            }
            Ok(Err(e)) => {
                result = result.with_error(e.clone());
                if let ExpectedOutcome::ErrorContains(pattern) = &scenario.expected_outcome {
                    if e.contains(pattern) {
                        result = result.pass();
                    }
                }
            }
            Err(_) => {
                result = result.with_error("Timeout".to_string());
            }
        }

        result
    }

    /// Create agent with all tools registered
    fn create_agent(&self, event_bus: Arc<EventBus>, config: &Config) -> Agent {
        let soul_path = PathBuf::from("SOUL.md");
        let mut soul_manager = SoulManager::new(soul_path);
        let _ = soul_manager.load();

        let mut registry = ToolRegistry::new();
        self.register_all_tools(&mut registry);

        // Create LLM provider
        let minimax_config = config.minimax();
        let llm: Arc<dyn LLMProvider> = match MiniMaxLLM::new(
            minimax_config.api_key,
            minimax_config.base_url,
            minimax_config.model,
        ) {
            Ok(llm) => Arc::new(llm),
            Err(_) => Arc::new(NoOpLLM),
        };

        Agent::new(registry, config.clone(), soul_manager, event_bus).with_llm(llm)
    }

    /// Register all tools for testing
    fn register_all_tools(&self, registry: &mut ToolRegistry) {
        registry.register(crate::tools::ReadTool::new());
        registry.register(crate::tools::WriteTool::new());
        registry.register(crate::tools::EditTool::new());
        registry.register(crate::tools::BashTool::new());
        registry.register(crate::tools::GrepTool::new());
        registry.register(crate::tools::LeftSingleTool::new());
        registry.register(crate::tools::LeftDoubleTool::new());
        registry.register(crate::tools::RightSingleTool::new());
        registry.register(crate::tools::MiddleClickTool::new());
        registry.register(crate::tools::DragTool::new());
        registry.register(crate::tools::ScrollTool::new());
        registry.register(crate::tools::KeyboardTool::new());
        registry.register(crate::tools::ScreenshotTool::new());
        registry.register(crate::tools::WaitTool::new());
        registry.register(crate::tools::CallUserTool::new());
        registry.register(crate::tools::RecordTaskTool::new());
        registry.register(crate::tools::ScreenTool::new());
        registry.register(crate::tools::SetMaxStepsTool::new());
        registry.register(crate::tools::TodoReadTool::new());
        registry.register(crate::tools::TodoWriteTool::new());
        registry.register(crate::tools::UISearchTool::new());

        // Memory tool
        let db = crate::memory::MemoryDB::new(":memory:").unwrap();
        registry.register(crate::tools::MemorySearchTool::new(Arc::new(db)));
    }
}

/// Run the harness with built-in scenarios
pub async fn run_harness() -> Vec<TestResult> {
    let harness = Harness::new(true)
        // Core functionality tests
        .scenario(Scenario {
            name: "hello_greeting".to_string(),
            task: "Say hello briefly and then say done".to_string(),
            expected_outcome: ExpectedOutcome::Success,
            timeout_secs: 60,
        })
        .scenario(Scenario {
            name: "simple_qa".to_string(),
            task: "Answer: 2+2=?. Just give the answer and say done".to_string(),
            expected_outcome: ExpectedOutcome::Success, // Just verify it completes
            timeout_secs: 60,
        })
        .scenario(Scenario {
            name: "math_multiplication".to_string(),
            task: "What is 7 times 8? Give the answer and say done".to_string(),
            expected_outcome: ExpectedOutcome::Success,
            timeout_secs: 60,
        })
        // Tool-related tests
        .scenario(Scenario {
            name: "read_hostname".to_string(),
            task: "Try to read /etc/hostname. Say done when finished.".to_string(),
            expected_outcome: ExpectedOutcome::Success,
            timeout_secs: 60,
        })
        .scenario(Scenario {
            name: "list_home_directory".to_string(),
            task:
                "List files in your home directory using bash ls command. Say done when finished."
                    .to_string(),
            expected_outcome: ExpectedOutcome::Success,
            timeout_secs: 90,
        });

    harness.run_all().await
}

/// No-op LLM for harness when MiniMax fails to initialize
struct NoOpLLM;

#[async_trait]
impl LLMProvider for NoOpLLM {
    async fn chat_stream(
        &self,
        _messages: &[crate::message::Message],
        _tools: Option<&[crate::llm::ToolDefinition]>,
    ) -> Result<crate::llm::ChatCompletion, crate::llm::LLMError> {
        Ok(crate::llm::ChatCompletion {
            message: "No LLM configured".to_string(),
            tool_calls: vec![],
            content_blocks: None,
        })
    }

    fn chat_streaming(
        &self,
        _messages: &[crate::message::Message],
        _tools: Option<&[crate::llm::ToolDefinition]>,
    ) -> Pin<
        Box<
            dyn futures::Stream<Item = Result<crate::llm::ChatChunk, crate::llm::LLMError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(futures::stream::once(async {
            Ok(crate::llm::ChatChunk::Done)
        }))
    }

    fn supports_tools(&self) -> bool {
        false
    }
}

/// Print harness results
pub fn print_results(results: &[TestResult]) {
    println!("\n═══════════════════════════════════════════════════");
    println!("           Dum-E Harness Results");
    println!("═══════════════════════════════════════════════════\n");

    let passed = results.iter().filter(|r| r.passed).count();
    let total = results.len();

    for result in results {
        let status = if result.passed {
            "✓ PASS"
        } else {
            "✗ FAIL"
        };
        let icon = if result.passed { "✓" } else { "✗" };

        println!("{} {} - {}", icon, status, result.scenario);
        println!("  Steps: {}", result.actual_steps);
        if !result.output.is_empty() {
            let truncated = if result.output.len() > 100 {
                format!("{}...", &result.output[..100])
            } else {
                result.output.clone()
            };
            println!("  Output: {}", truncated);
        }
        if let Some(ref err) = result.error {
            println!("  Error: {}", err);
        }
        println!("  Duration: {}ms", result.duration_ms);
        println!("  Events: {}", result.events.len());
        println!();
    }

    println!("───────────────────────────────────────────────────");
    println!("Results: {}/{} passed", passed, total);
    println!("═══════════════════════════════════════════════════\n");
}
