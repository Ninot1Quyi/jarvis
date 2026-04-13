//! Tools module - tool registry and execution

pub mod bash;
pub mod evolve;
pub mod file;
pub mod grep;
pub mod keyboard;
pub mod mcp;
pub mod memory;
pub mod message;
pub mod mouse;
mod registry;
pub mod sessions_send;
pub mod skill;
pub mod subagent;
pub mod system;
pub mod todo;
mod types;
pub mod ui_search;

pub use bash::BashTool;
pub use file::{EditTool, ReadTool, WriteTool};
pub use grep::GrepTool;
pub use keyboard::KeyboardTool;
pub use mcp::{McpToolClient, MiniMaxUnderstandImage, MiniMaxWebSearch};
pub use memory::{MemoryReadTool, MemorySearchTool, MemoryStatusTool};
pub use message::MessageTool;
pub use mouse::{
    DragTool, LeftDoubleTool, LeftSingleTool, MiddleClickTool, RightSingleTool, ScrollTool,
};
pub use registry::ToolRegistry;
pub use evolve::{
    CompareAgentsTool, EvolveStartNewTool, EvolveSwitchVersionTool, EvolveSelfTool,
};
pub use sessions_send::SessionsSendTool;
pub use skill::{ActivateSkillTool, ListSkillsTool, SaveSkillTool};
pub use subagent::{register_basic_tools, LaunchSubagentTool};
pub use system::{
    CallUserTool, RecordTaskTool, ScreenTool, ScreenshotTool, SetMaxStepsTool, WaitTool,
};
pub use todo::{TodoReadTool, TodoWriteTool};
pub use types::{Tool, ToolCall, ToolContext, ToolResult};
pub use ui_search::UISearchTool;
