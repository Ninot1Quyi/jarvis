//! Ralph Loop - Task-End Verification Closure
//!
//! Based on Harness Engineering: **闭环反馈系统** - NOT a per-step loop
//!
//! Ralph is called ONCE at task end, not per iteration. It provides:
//! - Verify: Check if task is complete
//! - Feedback: Process results, extract learnings
//! - Recommend: Suggestions for future tasks
//! - Learn: Update SOUL with learnings
//!
//! Architecture (Claude Code stopHooks pattern):
//! ```text
//! Agent Loop (Observe→Think→Act) → [TASK ENDS] → Ralph.close() → Verify + Feedback + Recommend + Learn
//! ```

pub mod act;
pub mod feedback;
pub mod recommend;
pub mod verify;

pub use feedback::FeedbackLoop;
pub use recommend::Recommender;
pub use verify::Verifier;

/// Ralph状态 - Ralph只运行一次，不在循环中
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RalphState {
    /// 任务结束，开始闭环
    Closing,
    /// 验证阶段
    Verifying,
    /// 反馈阶段
    Feedback,
    /// 推荐阶段
    Recommending,
    /// 学习阶段
    Learning,
    /// 已完成
    Completed,
    /// 失败
    Failed,
}

impl Default for RalphState {
    fn default() -> Self {
        Self::Closing
    }
}

/// Ralph循环配置
#[derive(Debug, Clone)]
pub struct RalphConfig {
    /// 验证阈值 - 达到多少百分比认为完成
    pub completion_threshold: f32,
    /// 是否启用自我进化
    pub enable_evolution: bool,
}

impl Default for RalphConfig {
    fn default() -> Self {
        Self {
            completion_threshold: 0.8,
            enable_evolution: true,
        }
    }
}

/// Ralph循环结果
#[derive(Debug)]
pub struct RalphResult {
    /// 最终状态
    pub state: RalphState,
    /// 任务是否完成
    pub completed: bool,
    /// 验证结果
    pub verification: verify::VerifyResult,
    /// 推荐结果
    pub recommendation: Option<recommend::Recommendation>,
    /// 学到的内容
    pub learnings: Vec<String>,
    /// 发现的问题
    pub issues: Vec<String>,
}

/// Ralph循环上下文
#[derive(Debug, Clone)]
pub struct RalphContext {
    /// 当前任务描述
    pub task: String,
    /// 初始状态快照
    pub initial_state: serde_json::Value,
    /// 目标状态
    pub goal: String,
    /// 执行历史
    pub history: Vec<ExecutionStep>,
}

/// 一个执行步骤
#[derive(Debug, Clone)]
pub struct ExecutionStep {
    /// 动作
    pub action: Action,
    /// 结果
    pub result: ActionResult,
    /// 时间戳
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// 一个动作
#[derive(Debug, Clone)]
pub struct Action {
    pub tool: String,
    pub input: serde_json::Value,
}

/// 动作结果
#[derive(Debug, Clone)]
pub struct ActionResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

/// Ralph错误类型
#[derive(Debug, thiserror::Error)]
pub enum RalphError {
    #[error("Verification failed: {0}")]
    VerificationFailed(String),

    #[error("Feedback failed: {0}")]
    FeedbackFailed(String),

    #[error("Recommendation failed: {0}")]
    RecommendationFailed(String),

    #[error("Learning failed: {0}")]
    LearningFailed(String),
}

/// Ralph - Task-End Closure
///
/// Called ONCE at task end (like Claude Code's handleStopHooks).
/// NOT called per step - the Agent's ReAct loop handles iteration.
pub struct Ralph {
    config: RalphConfig,
    verifier: Verifier,
    feedback: FeedbackLoop,
    recommender: Recommender,
    learnings: Vec<String>,
}

impl Ralph {
    /// Create new Ralph with default configuration
    pub fn new() -> Self {
        Self {
            config: RalphConfig::default(),
            verifier: Verifier::default(),
            feedback: FeedbackLoop::new(),
            recommender: Recommender::new(),
            learnings: vec![],
        }
    }

    /// Create with custom config
    pub fn with_config(config: RalphConfig) -> Self {
        Self {
            config,
            verifier: Verifier::default(),
            feedback: FeedbackLoop::new(),
            recommender: Recommender::new(),
            learnings: vec![],
        }
    }

    /// Run Ralph closure - called ONCE at task end
    ///
    /// This is the key difference from Plan-React:
    /// - Plan-React: Loop runs every step
    /// - Ralph: One-shot closure at task end
    pub async fn close(&mut self, context: &RalphContext) -> Result<RalphResult, RalphError> {
        // Phase 1: Verify - is task complete?
        let vr = self
            .verifier
            .verify(context)
            .await
            .map_err(|e| RalphError::VerificationFailed(e.to_string()))?;

        // Phase 2: Feedback - process results
        self.feedback
            .process(context)
            .await
            .map_err(|e| RalphError::FeedbackFailed(e.to_string()))?;

        // Phase 3: Recommend - suggestions for future (optional, don't fail the close)
        let recommendation = self.recommender.recommend(context).await.ok();

        // Phase 4: Learn - extract and record learnings
        self.learnings = self.feedback.extract_learnings();
        let issues = vr.issues.clone();

        Ok(RalphResult {
            state: if vr.should_complete {
                RalphState::Completed
            } else {
                RalphState::Failed
            },
            completed: vr.should_complete,
            verification: vr,
            recommendation,
            learnings: self.learnings.clone(),
            issues,
        })
    }

    /// Get accumulated learnings
    pub fn get_learnings(&self) -> &[String] {
        &self.learnings
    }
}

impl Default for Ralph {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ralph_close_no_history() {
        let mut ralph = Ralph::new();
        let context = RalphContext {
            task: "Test task".to_string(),
            initial_state: serde_json::json!({}),
            goal: "Complete".to_string(),
            history: vec![],
        };

        let result = ralph.close(&context).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        // No history means no progress
        assert!(!r.completed);
    }

    #[tokio::test]
    async fn test_ralph_close_with_success() {
        let mut ralph = Ralph::new();
        let context = RalphContext {
            task: "Test task".to_string(),
            initial_state: serde_json::json!({}),
            goal: "Complete".to_string(),
            history: vec![ExecutionStep {
                action: Action {
                    tool: "read_file".to_string(),
                    input: serde_json::json!({}),
                },
                result: ActionResult {
                    success: true,
                    output: "File content".to_string(),
                    error: None,
                },
                timestamp: chrono::Utc::now(),
            }],
        };

        let result = ralph.close(&context).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        // With one success, should consider completed
        assert!(!r.learnings.is_empty());
    }
}
