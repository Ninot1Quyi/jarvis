//! SOUL loader - loads SOUL.md from disk

use super::SoulManager;
use std::path::PathBuf;

/// SOUL file loader
pub struct SoulLoader {
    search_paths: Vec<PathBuf>,
}

impl SoulLoader {
    /// Create a new SOUL loader
    pub fn new() -> Self {
        Self {
            search_paths: vec![],
        }
    }

    /// Add a search path (checked in order)
    pub fn add_search_path(&mut self, path: PathBuf) -> &mut Self {
        self.search_paths.push(path);
        self
    }

    /// Find and load SOUL.md
    pub fn find_and_load(&self) -> std::io::Result<SoulManager> {
        // Check data directory first
        let data_soul = dirs::data_dir().map(|d| d.join("dum-e").join("soul.md"));

        if let Some(path) = data_soul {
            if path.exists() {
                let mut manager = SoulManager::new(path);
                manager.load()?;
                return Ok(manager);
            }
        }

        // Search from current directory up
        let found = self.search_upwards("soul.md");
        if let Some(path) = found {
            let mut manager = SoulManager::new(path);
            manager.load()?;
            return Ok(manager);
        }

        // Create default SOUL in data directory
        let default_path = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("dum-e")
            .join("soul.md");

        let manager = SoulManager::new(default_path);
        manager.save()?; // Create default file
        Ok(manager)
    }

    /// Search upwards for a file
    fn search_upwards(&self, filename: &str) -> Option<PathBuf> {
        let mut dir = std::env::current_dir().ok()?;

        loop {
            let path = dir.join(filename);
            if path.exists() {
                return Some(path);
            }

            if !dir.pop() {
                break;
            }
        }

        None
    }
}

impl Default for SoulLoader {
    fn default() -> Self {
        Self::new()
    }
}

mod dirs {
    use std::path::PathBuf;

    pub fn data_dir() -> Option<PathBuf> {
        #[cfg(target_os = "macos")]
        {
            std::env::var_os("HOME")
                .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
        }

        #[cfg(target_os = "linux")]
        {
            std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .or_else(|| {
                    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share"))
                })
        }

        #[cfg(target_os = "windows")]
        {
            std::env::var_os("APPDATA").map(PathBuf::from)
        }
    }
}
