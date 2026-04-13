//! Dum-E: AI-native coding agent
//!
//! Entry point for the CLI application.

use async_trait::async_trait;
use clap::Parser;
use dum_e::harness::{self};
use dum_e::llm::{LLMProvider, MiniMaxLLM};
use dum_e::tools::*;
use dum_e::tui;
use dum_e::{init_event_bus_with_traces_dir, Agent, Config, SoulManager};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use tracing::{error, info};

mod logging;

/// CLI arguments for Dum-E
#[derive(clap::Parser, Debug)]
#[command(name = "dum-e")]
#[command(about = "AI-native coding agent with comprehensive observability")]
struct Args {
    /// The task to execute
    #[arg(short, long)]
    task: Option<String>,

    /// Verbose mode (enables debug logging)
    #[arg(short, long)]
    verbose: bool,

    /// Disable colored output
    #[arg(short, long)]
    no_color: bool,

    /// Model to use (defaults to config)
    #[arg(short, long)]
    model: Option<String>,

    /// Config file path
    #[arg(short, long)]
    config: Option<String>,

    /// Run integration harness (verifies actual runtime behavior)
    #[arg(long)]
    harness: bool,

    /// Use the legacy plain REPL instead of the CLI TUI
    #[arg(long)]
    plain_repl: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let use_tui = args.task.is_none() && !args.plain_repl;

    // Initialize logging
    logging::init(args.verbose, !use_tui);

    info!("Dum-E starting...");

    // Load configuration
    let config = if let Some(config_path) = &args.config {
        Config::load_from(config_path)?
    } else {
        Config::load_from("config.json").unwrap_or_default()
    };

    // Initialize event bus (dev mode by default if verbose)
    let event_bus = init_event_bus_with_traces_dir(
        args.verbose || config.observability.dev_mode,
        Some(config.observability.traces_dir.clone()),
    );
    info!("Event bus initialized");

    // Load SOUL
    let soul_path = PathBuf::from("SOUL.md");
    let mut soul_manager = SoulManager::new(soul_path);
    soul_manager.load()?;
    info!("SOUL loaded");

    // Create tool registry
    let mut registry = ToolRegistry::new();
    register_tools(&mut registry);
    info!("Registered {} tools", registry.list().len());

    // Create LLM provider (MiniMax)
    let minimax_config = config.minimax();
    let model = args.model.unwrap_or_else(|| minimax_config.model.clone());

    let llm: Arc<dyn LLMProvider> =
        match MiniMaxLLM::new(minimax_config.api_key, minimax_config.base_url, model) {
            Ok(llm) => {
                info!("MiniMax LLM initialized");
                Arc::new(llm)
            }
            Err(e) => {
                error!("Failed to initialize LLM: {}, continuing without LLM", e);
                Arc::new(NoOpLLM)
            }
        };

    // Create agent with LLM
    let mut agent = Agent::new(registry, config, soul_manager, event_bus).with_llm(llm);
    info!("Agent created");

    // Run harness if requested
    if args.harness {
        info!("Running integration harness...");
        let results = harness::run_harness().await;
        harness::print_results(&results);

        // Exit with error code if any test failed
        let passed = results.iter().filter(|r| r.passed).count();
        if passed < results.len() {
            std::process::exit(1);
        }
        return Ok(());
    }

    // Execute task or run REPL
    if let Some(task) = args.task {
        info!("Executing task: {}", task);
        match agent.run(&task).await {
            Ok(result) => {
                info!("Task completed: {:?}", result);
                println!("\nTask completed successfully!");
                println!("Steps: {}", result.steps);
                println!("Success: {}", result.success);
            }
            Err(e) => {
                error!("Task failed: {}", e);
                eprintln!("Error: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        if args.plain_repl {
            info!("Starting plain REPL...");
            run_repl(agent).await?;
        } else {
            info!("Starting CLI TUI...");
            tui::run_tui(agent).await?;
        }
    }

    info!("Dum-E shutting down");
    Ok(())
}

/// Register all available tools
fn register_tools(registry: &mut ToolRegistry) {
    // File tools
    registry.register(ReadTool::new());
    registry.register(WriteTool::new());
    registry.register(EditTool::new());

    // Bash tool
    registry.register(BashTool::new());

    // Search tools
    registry.register(GrepTool::new());

    // Mouse tools
    registry.register(LeftSingleTool::new());
    registry.register(LeftDoubleTool::new());
    registry.register(RightSingleTool::new());
    registry.register(MiddleClickTool::new());
    registry.register(DragTool::new());
    registry.register(ScrollTool::new());

    // Keyboard tools
    registry.register(KeyboardTool::new());

    // System tools
    registry.register(ScreenshotTool::new());
    registry.register(WaitTool::new());
    registry.register(CallUserTool::new());
    registry.register(RecordTaskTool::new());
    registry.register(ScreenTool::new());
    registry.register(SetMaxStepsTool::new());

    // TODO tools
    registry.register(TodoReadTool::new());
    registry.register(TodoWriteTool::new());

    // UI search tools
    registry.register(UISearchTool::new());

    // Memory tools
    let db = dum_e::memory::MemoryDB::new("/tmp/dum-e-memory.db")
        .map(|db| Arc::new(db))
        .unwrap_or_else(|_| Arc::new(dum_e::memory::MemoryDB::new(":memory:").unwrap()));
    registry.register(MemorySearchTool::new(db));

    // MCP tools (MiniMax)
    registry.register(MiniMaxWebSearch::new());
    registry.register(MiniMaxUnderstandImage::new());

    // Skill tools
    registry.register(ActivateSkillTool::new());
    registry.register(ListSkillsTool::new());
    registry.register(SaveSkillTool::new());

    // Evolve tools
    registry.register(EvolveSelfTool::new());
    registry.register(CompareAgentsTool::new());
    registry.register(EvolveStartNewTool::new());
    registry.register(EvolveSwitchVersionTool::new());
}

/// No-op LLM for when no API key is available
struct NoOpLLM;

#[async_trait]
impl LLMProvider for NoOpLLM {
    async fn chat_stream(
        &self,
        _messages: &[dum_e::message::Message],
        _tools: Option<&[dum_e::llm::ToolDefinition]>,
    ) -> Result<dum_e::llm::ChatCompletion, dum_e::llm::LLMError> {
        Ok(dum_e::llm::ChatCompletion {
            message: "No LLM configured. Set MINIMAX_API_KEY or provide api_key in config.json"
                .to_string(),
            tool_calls: vec![],
            content_blocks: None,
        })
    }

    fn chat_streaming(
        &self,
        _messages: &[dum_e::message::Message],
        _tools: Option<&[dum_e::llm::ToolDefinition]>,
    ) -> Pin<
        Box<
            dyn futures::Stream<Item = Result<dum_e::llm::ChatChunk, dum_e::llm::LLMError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(futures::stream::once(async {
            Ok(dum_e::llm::ChatChunk::Done)
        }))
    }

    fn supports_tools(&self) -> bool {
        false
    }
}

/// Run interactive REPL
async fn run_repl(mut agent: Agent) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::{self, Write};

    println!("Dum-E REPL (type 'exit' or 'quit' to stop)");
    println!("-------------------------------------------");

    loop {
        print!("> ");
        io::stdout().flush()?;

        let mut input = String::new();
        match io::stdin().read_line(&mut input) {
            Ok(0) => break, // EOF
            Ok(_) => {}
            Err(e) => {
                error!("Read error: {}", e);
                break;
            }
        }

        let input = input.trim();
        if input.is_empty() {
            continue;
        }

        if input == "exit" || input == "quit" {
            println!("Goodbye!");
            break;
        }

        if input == "help" {
            println!("Commands:");
            println!("  help     - Show this help");
            println!("  exit/quit - Exit the REPL");
            println!("  [task]   - Execute a task");
            continue;
        }

        match agent.run(input).await {
            Ok(result) => {
                println!("\nCompleted in {} steps", result.steps);
            }
            Err(e) => {
                error!("Error: {}", e);
            }
        }
        println!();
    }

    Ok(())
}
