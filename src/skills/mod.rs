//! Skills module - skill discovery, indexing, and auto-injection.
//!
//! Skills are markdown files stored in:
//! - ~/.dum-e/skills/ (user home directory)
//! - .claude/skills/ (project-level, symlinked to ../skills)
//!
//! The agent automatically discovers and activates relevant skills based on
//! task context, injecting matched skill content into the system prompt.

use std::collections::HashMap;
use std::path::PathBuf;
use once_cell::sync::Lazy;

/// In-memory skill index, built lazily on first access.
static SKILL_INDEX: Lazy<SkillIndex> = Lazy::new(SkillIndex::build);

/// A single indexed skill entry.
#[derive(Debug, Clone)]
pub struct SkillEntry {
    /// Skill name (from frontmatter `name` or filename stem).
    pub name: String,
    /// Path to the skill file.
    pub path: PathBuf,
    /// Full markdown content of the skill.
    pub content: String,
    /// Trigger keywords extracted from frontmatter description + body.
    pub trigger_keywords: Vec<String>,
    /// Which directory this skill came from.
    pub source: SkillSource,
}

#[derive(Debug, Clone, Copy)]
pub enum SkillSource {
    /// ~/.dum-e/skills/
    UserHome,
    /// .claude/skills/ (project-level)
    Project,
}

impl SkillEntry {
    /// Returns true if this skill's trigger keywords match the given task text.
    fn matches(&self, task: &str) -> bool {
        let task_lower = task.to_lowercase();

        // Check each trigger keyword
        for keyword in &self.trigger_keywords {
            let kw_lower = keyword.to_lowercase();
            if kw_lower.len() >= 3 && task_lower.contains(&kw_lower) {
                return true;
            }
        }

        // Also check if the skill name appears in the task
        if task_lower.contains(&self.name.to_lowercase()) {
            return true;
        }

        // Check if the description (first 200 chars of content) appears in task
        let desc_snippet = self.content.lines()
            .skip(1) // skip frontmatter/name line
            .take(5)
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();

        // Check for meaningful word overlap (3+ char words)
        for word in desc_snippet.split_whitespace() {
            if word.len() >= 4 && task_lower.contains(word) {
                return true;
            }
        }

        false
    }
}

/// Index of all available skills.
#[derive(Debug)]
pub struct SkillIndex {
    entries: Vec<SkillEntry>,
    by_name: HashMap<String, usize>,
}

impl SkillIndex {
    /// Build the skill index by scanning both skills directories.
    fn build() -> Self {
        let mut index = Self {
            entries: Vec::new(),
            by_name: HashMap::new(),
        };

        for (dir, source) in Self::skills_dirs() {
            index.scan_dir(&dir, source);
        }

        index
    }

    /// Return the skills directories to search.
    fn skills_dirs() -> Vec<(PathBuf, SkillSource)> {
        let mut dirs = Vec::new();

        if let Ok(home) = std::env::var("HOME") {
            let home_skills = PathBuf::from(home).join(".dum-e").join("skills");
            if home_skills.exists() {
                dirs.push((home_skills, SkillSource::UserHome));
            }
        }

        // Project-level .claude/skills
        if let Ok(cwd) = std::env::current_dir() {
            let project_skills = cwd.join(".claude").join("skills");
            if project_skills.exists() {
                dirs.push((project_skills, SkillSource::Project));
            }
        }

        dirs
    }

    /// Scan a single directory for skill files.
    fn scan_dir(&mut self, dir: &PathBuf, source: SkillSource) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            // Must be .md file
            let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            if ext != "md" {
                continue;
            }

            // Also scan subdirectories for nested skills (e.g. skills/doctor/)
            if path.is_dir() {
                self.scan_dir(&path, source);
                continue;
            }

            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };

            // Skip README files
            if stem.eq_ignore_ascii_case("readme") {
                continue;
            }

            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let entry = Self::parse_skill_entry(stem, path.clone(), content, source);
            let idx = self.entries.len();
            self.by_name.insert(entry.name.clone(), idx);
            self.entries.push(entry);
        }
    }

    /// Parse a skill file into a SkillEntry.
    fn parse_skill_entry(
        name: &str,
        path: PathBuf,
        content: String,
        source: SkillSource,
    ) -> SkillEntry {
        // Extract name from frontmatter if present
        let skill_name = Self::extract_frontmatter_field(&content, "name")
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| name.to_string());

        // Extract description from frontmatter
        let desc = Self::extract_frontmatter_field(&content, "description")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        // Extract trigger keywords: lines starting with "## 触发" or "## Trigger" etc.
        let mut trigger_keywords = Vec::new();
        if !desc.is_empty() {
            // Use words from description as keywords
            for word in desc.split(&[',', '，', '、', ' '][..]) {
                let w = word.trim();
                if w.len() >= 2 {
                    trigger_keywords.push(w.to_string());
                }
            }
        }

        // Also extract keywords from body: look for trigger/condition sections
        for line in content.lines() {
            let line_trimmed = line.trim();
            let lower = line_trimmed.to_lowercase();

            // Section headers that contain trigger/condition info
            if lower.starts_with("## 触发") || lower.starts_with("## trigger")
                || lower.starts_with("## 触发条件") || lower.starts_with("## conditions")
                || lower.starts_with("## keywords") || lower.starts_with("## keywords:")
            {
                // Next few lines are trigger content
                continue;
            }

            // Extract keywords from inline lists like "- 故障" or "- error"
            if (lower.starts_with("- ") || lower.starts_with("* ")) && line_trimmed.len() < 60 {
                let keyword = line_trimmed
                    .trim_start_matches(&['-', '*', ' '][..])
                    .trim()
                    .to_string();
                if !keyword.is_empty() && keyword.len() >= 2 && !keyword.starts_with('#') {
                    trigger_keywords.push(keyword);
                }
            }
        }

        // Deduplicate
        trigger_keywords.sort();
        trigger_keywords.dedup();

        SkillEntry {
            name: skill_name,
            path,
            content,
            trigger_keywords,
            source,
        }
    }

    /// Extract a field from YAML frontmatter (between --- markers).
    fn extract_frontmatter_field(content: &str, field: &str) -> Option<String> {
        let mut in_frontmatter = false;
        let mut frontmatter = String::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed == "---" {
                if !in_frontmatter {
                    in_frontmatter = true;
                    continue;
                } else {
                    break;
                }
            }
            if in_frontmatter {
                frontmatter.push_str(line);
                frontmatter.push('\n');
            }
        }

        // Simple field extraction: look for `field: value`
        let pattern = format!("{}:", field);
        for line in frontmatter.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with(&pattern) {
                let after = trimmed[pattern.len()..].trim();
                if after.starts_with('"') || after.starts_with('\'') {
                    // Quoted value
                    let quote = after.chars().next().unwrap();
                    if let Some(end) = after[1..].find(quote) {
                        return Some(after[1..=end].to_string());
                    }
                }
                // Plain value
                return Some(after.to_string());
            }
        }

        None
    }

    /// Find all skills that match the given task.
    pub fn find_matching(&self, task: &str) -> Vec<&SkillEntry> {
        self.entries
            .iter()
            .filter(|e| e.matches(task))
            .collect()
    }

    /// Get a skill by name.
    pub fn get(&self, name: &str) -> Option<&SkillEntry> {
        self.by_name.get(name).and_then(|&i| self.entries.get(i))
    }

    /// List all indexed skills.
    pub fn list(&self) -> &Vec<SkillEntry> {
        &self.entries
    }
}

// ============================================================================
// Public API used by the agent
// ============================================================================

/// Find all skills that match the given task text.
/// Returns skill content ready for injection into the system prompt.
pub fn find_matching_skills(task: &str) -> String {
    let matches = SKILL_INDEX.find_matching(task);

    if matches.is_empty() {
        return String::new();
    }

    let mut output = String::from("\n\n## Relevant Skills\n\n");
    for skill in matches {
        let source_str = match skill.source {
            SkillSource::UserHome => "~/.dum-e/skills/",
            SkillSource::Project => ".claude/skills/",
        };
        output.push_str(&format!(
            "### Skill: {} (from {})\n\n{}\n\n---\n\n",
            skill.name, source_str, skill.content
        ));
    }

    output
}

/// List all available skills with their names and sources.
pub fn list_all_skills() -> Vec<(String, String)> {
    SKILL_INDEX
        .list()
        .iter()
        .map(|e| {
            let source = match e.source {
                SkillSource::UserHome => "~/.dum-e/skills/",
                SkillSource::Project => ".claude/skills/",
            };
            (e.name.clone(), source.to_string())
        })
        .collect()
}

/// Get the full content of a skill by name.
pub fn get_skill(name: &str) -> Option<String> {
    SKILL_INDEX.get(name).map(|e| e.content.clone())
}
