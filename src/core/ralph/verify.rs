//! Verify - 验证阶段，检查结果是否符合预期
//!
//! 基于 Harness Engineering: 每个步骤都有明确的验证标准

use super::{RalphContext, RalphError};

/// 验证结果
#[derive(Debug)]
pub struct VerifyResult {
    pub should_complete: bool,
    pub progress: f32,
    pub issues: Vec<String>,
}

/// 验证器 - 检查当前状态是否符合目标
pub struct Verifier {
    /// 验证规则
    rules: Vec<VerifyRule>,
}

/// 验证规则
#[derive(Debug, Clone)]
pub struct VerifyRule {
    /// 规则名称
    pub name: String,
    /// 验证函数: (context) -> VerifyResult
    pub check: fn(ctx: &RalphContext) -> VerifyResult,
}

impl Verifier {
    pub fn new() -> Self {
        Self { rules: vec![] }
    }

    /// 添加验证规则
    pub fn add_rule(&mut self, rule: VerifyRule) -> &mut Self {
        self.rules.push(rule);
        self
    }

    /// 预定义的验证规则
    pub fn default_rules() -> Self {
        let mut verifier = Self::new();
        verifier.add_rule(VerifyRule {
            name: "has_progress".to_string(),
            check: verify_task_completion,
        });
        verifier.add_rule(VerifyRule {
            name: "no_errors".to_string(),
            check: verify_no_errors,
        });
        verifier.add_rule(VerifyRule {
            name: "has_output".to_string(),
            check: verify_progress,
        });
        verifier
    }

    /// 验证当前上下文
    pub async fn verify(&self, ctx: &RalphContext) -> Result<VerifyResult, RalphError> {
        let mut total_score = 0.0;
        let mut all_issues = vec![];

        for rule in &self.rules {
            let result = (rule.check)(ctx);
            total_score += result.progress;
            all_issues.extend(result.issues);
        }

        let progress = if self.rules.is_empty() {
            0.5
        } else {
            total_score / self.rules.len() as f32
        };

        let should_complete = progress >= 0.8 && all_issues.is_empty();

        Ok(VerifyResult {
            should_complete,
            progress,
            issues: all_issues,
        })
    }

    /// 验证单个执行步骤
    pub fn verify_step(&self, step: &super::ExecutionStep, expected: &super::Action) -> bool {
        if step.action.tool != expected.tool {
            return false;
        }
        if !step.result.success {
            return false;
        }
        true
    }
}

impl Default for Verifier {
    fn default() -> Self {
        Self::default_rules()
    }
}

/// 验证任务是否完成
fn verify_task_completion(ctx: &RalphContext) -> VerifyResult {
    let successful_steps = ctx.history.iter().filter(|s| s.result.success).count();
    if successful_steps == 0 {
        return VerifyResult {
            should_complete: false,
            progress: 0.0,
            issues: vec!["No successful steps yet".to_string()],
        };
    }

    let last_step = ctx.history.last();
    let relevance = if let Some(step) = last_step {
        let tool_match = step
            .action
            .tool
            .to_lowercase()
            .contains(&ctx.goal.to_lowercase());
        if tool_match {
            1.0
        } else {
            0.5
        }
    } else {
        0.0
    };

    let score = (successful_steps as f32 * 0.3) + (relevance * 0.7);
    let passes = score >= 0.6;

    VerifyResult {
        should_complete: passes,
        progress: score,
        issues: if passes {
            vec![]
        } else {
            vec!["Task not yet complete".to_string()]
        },
    }
}

/// 验证无错误执行
fn verify_no_errors(ctx: &RalphContext) -> VerifyResult {
    let error_steps: Vec<_> = ctx
        .history
        .iter()
        .filter(|s| s.result.error.is_some())
        .collect();

    if error_steps.is_empty() {
        VerifyResult {
            should_complete: true,
            progress: 1.0,
            issues: vec![],
        }
    } else {
        let errors: Vec<String> = error_steps
            .iter()
            .filter_map(|s| s.result.error.clone())
            .collect();
        VerifyResult {
            should_complete: false,
            progress: 0.0,
            issues: errors,
        }
    }
}

/// 验证进度
fn verify_progress(ctx: &RalphContext) -> VerifyResult {
    if ctx.history.is_empty() {
        return VerifyResult {
            should_complete: false,
            progress: 0.0,
            issues: vec!["No actions taken yet".to_string()],
        };
    }

    let total = ctx.history.len();
    let successful = ctx.history.iter().filter(|s| s.result.success).count();

    let progress = successful as f32 / total as f32;
    let passes = progress >= 0.5;

    VerifyResult {
        should_complete: passes,
        progress,
        issues: vec![],
    }
}
