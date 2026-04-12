//! Act - 执行阶段，执行推荐的动作
//!
//! 基于 Harness Engineering: 通过工具系统执行，保持可观测性

use super::{Action, ActionResult, RalphError};
use crate::observability::{Component, EventBus, EventData, EventType};

/// Actor - 执行动作
pub struct Actor {
    /// 事件总线 (用于观测)
    event_bus: Option<std::sync::Arc<EventBus>>,
}

impl Actor {
    pub fn new() -> Self {
        Self { event_bus: None }
    }

    /// 设置事件总线
    pub fn with_event_bus(mut self, bus: std::sync::Arc<EventBus>) -> Self {
        self.event_bus = Some(bus);
        self
    }

    /// 执行动作
    pub async fn act(&self, action: &Action) -> Result<ActionResult, RalphError> {
        // 发射开始事件
        self.emit_event(EventType::ToolCall, format!("Executing {}", action.tool));

        // 模拟执行 (实际需要调用工具)
        let result = ActionResult {
            success: true,
            output: format!("Executed {} with {:?}", action.tool, action.input),
            error: None,
        };

        // 发射完成事件
        self.emit_event(EventType::ToolComplete, result.output.clone());

        Ok(result)
    }

    /// 发射事件到事件总线
    fn emit_event(&self, event_type: EventType, data: impl Into<String>) {
        if let Some(bus) = &self.event_bus {
            let _span = bus.span(
                Component::Tool,
                event_type,
                EventData::Message {
                    message: data.into(),
                },
            );
        }
    }
}

impl Default for Actor {
    fn default() -> Self {
        Self::new()
    }
}
