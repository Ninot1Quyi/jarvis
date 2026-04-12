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
