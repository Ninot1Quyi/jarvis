//! Recommend - 推荐阶段，生成下一步行动建议
//!
//! 基于 Harness Engineering: 基于历史和SOUL偏好推荐最佳下一步

use super::{Action, RalphContext};

/// 推荐器 - 基于上下文生成推荐
pub struct Recommender {
    /// SOUL偏好
    soul_prefs: std::collections::HashMap<String, f32>,
}

impl Recommender {
    pub fn new() -> Self {
        Self {
            soul_prefs: std::collections::HashMap::new(),
        }
    }

    /// 设置SOUL偏好
    pub fn with_soul_prefs(mut self, prefs: std::collections::HashMap<String, f32>) -> Self {
        self.soul_prefs = prefs;
        self
    }

    /// 生成推荐
    pub async fn recommend(&self, ctx: &RalphContext) -> Result<Recommendation, String> {
        // 分析当前任务类型，推测可能需要的工具
        let task_lower = ctx.task.to_lowercase();
        let mut candidates = vec![];

        if task_lower.contains("file")
            || task_lower.contains("write")
            || task_lower.contains("edit")
        {
            candidates.push(("write_file".to_string(), 0.9));
        }
        if task_lower.contains("read") || task_lower.contains("view") || task_lower.contains("show")
        {
            candidates.push(("read_file".to_string(), 0.9));
        }
        if task_lower.contains("bash")
            || task_lower.contains("command")
            || task_lower.contains("shell")
        {
            candidates.push(("bash".to_string(), 0.8));
        }
        if task_lower.contains("search")
            || task_lower.contains("find")
            || task_lower.contains("grep")
        {
            candidates.push(("grep".to_string(), 0.7));
        }
        if task_lower.contains("web") || task_lower.contains("http") || task_lower.contains("fetch")
        {
            candidates.push(("web_fetch".to_string(), 0.6));
        }

        // 如果没有候选，添加默认工具
        if candidates.is_empty() {
            candidates.push(("bash".to_string(), 0.5));
        }

        // 按分数排序
        candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        // 选择最佳候选
        let (tool, score) = candidates
            .first()
            .ok_or_else(|| "No recommendation available".to_string())?;

        Ok(Recommendation {
            action: Action {
                tool: tool.clone(),
                input: serde_json::json!({}),
            },
            confidence: *score,
            reasoning: format!("Task '{}' suggests {} might help", ctx.task, tool),
        })
    }
}

impl Default for Recommender {
    fn default() -> Self {
        Self::new()
    }
}

/// 推荐结果
#[derive(Debug)]
pub struct Recommendation {
    pub action: Action,
    pub confidence: f32,
    pub reasoning: String,
}
