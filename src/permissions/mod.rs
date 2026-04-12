//! Permissions module - deny rules and permission system

/// Permission decision
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionDecision {
    Allow,
    Deny,
    Ask,
}

/// A deny rule
#[derive(Debug, Clone)]
pub struct DenyRule {
    pub tool_name: String,
    pub pattern: String,
}

/// Permission system
pub struct PermissionSystem {
    rules: Vec<DenyRule>,
}

impl PermissionSystem {
    pub fn new() -> Self {
        Self { rules: vec![] }
    }

    /// Check if a tool is allowed
    pub fn check(&self, tool_name: &str, _input: &serde_json::Value) -> PermissionDecision {
        // Check deny rules
        for rule in &self.rules {
            if rule.tool_name == tool_name {
                return PermissionDecision::Deny;
            }
        }
        PermissionDecision::Allow
    }
}

impl Default for PermissionSystem {
    fn default() -> Self {
        Self::new()
    }
}
