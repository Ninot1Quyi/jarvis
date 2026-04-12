//! SkillTool - Skill management: activate, list, and save skills
//!
//! Skills are markdown files stored in:
//! - ~/.dum-e/skills/ (user home directory)
//! - .claude/skills/ (project-level)

use crate::tools::{Tool, ToolContext, ToolResult};
use async_trait::async_trait;
use std::path::PathBuf;

/// Get the skills directories to search
fn get_skills_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // User home directory skills
    if let Ok(home) = std::env::var("HOME") {
        let home_skills = PathBuf::from(home).join(".dum-e").join("skills");
        dirs.push(home_skills);
    }

    // Project-level .claude/skills
    if let Ok(cwd) = std::env::current_dir() {
        let project_skills = cwd.join(".claude").join("skills");
        dirs.push(project_skills);
    }

    dirs
}

/// Find a skill file by name in all skills directories
fn find_skill_file(name: &str) -> Option<PathBuf> {
    let skill_filename = format!("{}.md", name);

    for dir in get_skills_dirs() {
        let skill_path = dir.join(&skill_filename);
        if skill_path.exists() {
            return Some(skill_path);
        }
    }

    None
}

/// List all skills from all skills directories
fn list_all_skills() -> Vec<(String, PathBuf)> {
    let mut skills = Vec::new();

    for dir in get_skills_dirs() {
        if dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(ext) = path.extension() {
                            if ext == "md" {
                                if let Some(stem) = path.file_stem() {
                                    if let Some(name) = stem.to_str() {
                                        skills.push((name.to_string(), path));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    skills.sort_by(|a, b| a.0.cmp(&b.0));
    skills
}

/// Get the project-level skills directory, creating it if needed
fn get_or_create_project_skills_dir() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    let skills_dir = cwd.join(".claude").join("skills");

    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir).ok()?;
    }

    Some(skills_dir)
}

// ============================================================================
// ActivateSkillTool - Load a skill by name and return its full content
// ============================================================================

pub struct ActivateSkillTool;

impl ActivateSkillTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ActivateSkillTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for ActivateSkillTool {
    fn name(&self) -> &str {
        "activate_skill"
    }

    fn description(&self) -> &str {
        "Load a skill by name and return its full content. Skills are markdown files stored in ~/.dum-e/skills/ or project-level .claude/skills/"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The name of the skill to activate"
                }
            },
            "required": ["name"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        true
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let name = input["name"].as_str().ok_or("Missing 'name' parameter")?;

        let skill_path = find_skill_file(name);

        match skill_path {
            Some(path) => {
                let content = tokio::fs::read_to_string(&path)
                    .await
                    .map_err(|e| format!("Failed to read skill file: {}", e))?;

                Ok(ToolResult {
                    success: true,
                    output: content,
                    error: None,
                })
            }
            None => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Skill not found: {}.md", name)),
            }),
        }
    }
}

// ============================================================================
// ListSkillsTool - List all available skills
// ============================================================================

pub struct ListSkillsTool;

impl ListSkillsTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ListSkillsTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for ListSkillsTool {
    fn name(&self) -> &str {
        "list_skills"
    }

    fn description(&self) -> &str {
        "List all available skills from ~/.dum-e/skills/ and project-level .claude/skills/"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        true
    }

    fn is_read_only(&self) -> bool {
        true
    }

    async fn call(
        &self,
        _input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let skills = list_all_skills();

        if skills.is_empty() {
            return Ok(ToolResult {
                success: true,
                output: "No skills found. Add skills to ~/.dum-e/skills/ or .claude/skills/"
                    .to_string(),
                error: None,
            });
        }

        let mut output = String::from("Available skills:\n");
        for (name, path) in &skills {
            let source = if path.to_string_lossy().contains(".dum-e") {
                "~/.dum-e/skills/"
            } else {
                ".claude/skills/"
            };
            output.push_str(&format!("  - {} (from {})\n", name, source));
        }

        Ok(ToolResult {
            success: true,
            output,
            error: None,
        })
    }
}

// ============================================================================
// SaveSkillTool - Save a new skill to project-level skills directory
// ============================================================================

pub struct SaveSkillTool;

impl SaveSkillTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SaveSkillTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for SaveSkillTool {
    fn name(&self) -> &str {
        "save_skill"
    }

    fn description(&self) -> &str {
        "Save a new skill to project-level .claude/skills/ directory. The skill content should be in markdown format with # Skill Name, ## Description, and ## Instructions sections."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The name of the skill"
                },
                "description": {
                    "type": "string",
                    "description": "Brief description of the skill"
                },
                "instructions": {
                    "type": "string",
                    "description": "Detailed instructions for the skill"
                }
            },
            "required": ["name", "description", "instructions"]
        })
    }

    fn is_concurrency_safe(&self) -> bool {
        false
    }

    fn is_read_only(&self) -> bool {
        false
    }

    async fn call(
        &self,
        input: &serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, String> {
        let name = input["name"].as_str().ok_or("Missing 'name' parameter")?;
        let description = input["description"]
            .as_str()
            .ok_or("Missing 'description' parameter")?;
        let instructions = input["instructions"]
            .as_str()
            .ok_or("Missing 'instructions' parameter")?;

        let skills_dir =
            get_or_create_project_skills_dir().ok_or("Failed to get or create skills directory")?;

        let skill_filename = format!("{}.md", name);
        let skill_path = skills_dir.join(&skill_filename);

        let content = format!(
            "# {}\n\n## Description\n{}\n\n## Instructions\n{}\n",
            name, description, instructions
        );

        tokio::fs::write(&skill_path, content)
            .await
            .map_err(|e| format!("Failed to write skill file: {}", e))?;

        Ok(ToolResult {
            success: true,
            output: format!("Skill saved to {}", skill_path.display()),
            error: None,
        })
    }
}
