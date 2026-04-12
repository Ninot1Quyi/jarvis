//! Feedback - 反馈阶段，更新SOUL和学习
//!
//! 基于 Harness Engineering: 每个结果都反馈给系统用于学习

use super::{RalphContext, RalphError};

/// 反馈循环 - 处理执行结果，提取学习
pub struct FeedbackLoop {
    /// 学习历史
    learnings: Vec<String>,
}

impl FeedbackLoop {
    pub fn new() -> Self {
        Self { learnings: vec![] }
    }

    /// 处理上下文，提取学习
    pub async fn process(&mut self, ctx: &RalphContext) -> Result<(), RalphError> {
        for step in &ctx.history {
            let lesson = if step.result.success {
                format!("Tool {} succeeded", step.action.tool)
            } else {
                let error = step.result.error.clone().unwrap_or_default();
                format!("Tool {} failed: {}", step.action.tool, error)
            };
            self.learnings.push(lesson);
        }

        // 如果任务完成，添加完成标记
        if ctx.history.len() > 0 {
            let all_success = ctx.history.iter().all(|s| s.result.success);
            if all_success {
                self.learnings
                    .push(format!("Task '{}' completed successfully", ctx.task));
            }
        }

        Ok(())
    }

    /// 提取所有学习
    pub fn extract_learnings(&self) -> Vec<String> {
        self.learnings.clone()
    }

    /// 清除已应用的学习
    pub fn clear_learnings(&mut self) {
        self.learnings.clear();
    }
}

impl Default for FeedbackLoop {
    fn default() -> Self {
        Self::new()
    }
}
