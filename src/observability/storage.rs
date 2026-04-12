//! Event storage - handles persisting events to disk in dev mode

use crate::observability::Event;
use parking_lot::Mutex;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use tracing::{error, warn};

/// Event storage with dual-mode support
pub struct EventStorage {
    dev_mode: bool,
    traces_dir: PathBuf,
    file_handles: Mutex<std::collections::HashMap<PathBuf, BufWriter<std::fs::File>>>,
}

impl EventStorage {
    pub fn new(dev_mode: bool, traces_dir: PathBuf) -> Self {
        // Create traces directory in dev mode
        if dev_mode && !traces_dir.exists() {
            if let Err(e) = fs::create_dir_all(&traces_dir) {
                error!(
                    traces_dir = %traces_dir.display(),
                    error = %e,
                    "Failed to create traces directory"
                );
            }
        }

        Self {
            dev_mode,
            traces_dir,
            file_handles: Mutex::new(std::collections::HashMap::new()),
        }
    }

    fn fallback_path(&self, path: &PathBuf) -> PathBuf {
        let fallback_root = std::env::temp_dir().join("dum-e").join("traces");
        if let Ok(rel) = path.strip_prefix(&self.traces_dir) {
            fallback_root.join(rel)
        } else if let Some(file_name) = path.file_name() {
            fallback_root.join(file_name)
        } else {
            fallback_root.join("trace.jsonl")
        }
    }

    fn prepare_parent(path: &PathBuf) -> Result<(), std::io::Error> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        Ok(())
    }

    fn try_prepare_fallback_path(&self, original: &PathBuf) -> Option<PathBuf> {
        let fallback = self.fallback_path(original);
        match Self::prepare_parent(&fallback) {
            Ok(()) => {
                warn!(
                    original = %original.display(),
                    fallback = %fallback.display(),
                    "Trace path not writable, falling back to temp trace path"
                );
                Some(fallback)
            }
            Err(e) => {
                error!(
                    original = %original.display(),
                    fallback = %fallback.display(),
                    error = %e,
                    "Failed to prepare fallback trace path"
                );
                None
            }
        }
    }

    /// Store an event to disk
    pub fn store(&self, event: &Event, path: &PathBuf) {
        if !self.dev_mode {
            return;
        }

        let mut target_path = path.clone();
        if let Err(e) = Self::prepare_parent(&target_path) {
            error!(
                path = %path.display(),
                error = %e,
                "Failed to create trace parent directory"
            );
            let Some(fallback) = self.try_prepare_fallback_path(path) else {
                return;
            };
            target_path = fallback;
        }

        // Get or create file handle
        let mut handles = self.file_handles.lock();
        if !handles.contains_key(&target_path) {
            let file = match OpenOptions::new()
                .create(true)
                .append(true)
                .open(&target_path)
            {
                Ok(file) => file,
                Err(open_err) => {
                    if target_path == *path {
                        if let Some(fallback) = self.try_prepare_fallback_path(path) {
                            match OpenOptions::new().create(true).append(true).open(&fallback) {
                                Ok(file) => {
                                    target_path = fallback;
                                    file
                                }
                                Err(e) => {
                                    error!(
                                        path = %fallback.display(),
                                        error = %e,
                                        "Failed to open fallback trace file"
                                    );
                                    return;
                                }
                            }
                        } else {
                            return;
                        }
                    } else {
                        error!(
                            path = %target_path.display(),
                            error = %open_err,
                            "Failed to open trace file"
                        );
                        return;
                    }
                }
            };

            handles.insert(target_path.clone(), BufWriter::new(file));
        }

        // Write event as JSONL
        if let Some(writer) = handles.get_mut(&target_path) {
            let json = match serde_json::to_string(event) {
                Ok(json) => json,
                Err(e) => {
                    error!(
                        path = %target_path.display(),
                        error = %e,
                        "Failed to serialize event"
                    );
                    return;
                }
            };
            if let Err(e) = writeln!(writer, "{}", json) {
                error!(
                    path = %target_path.display(),
                    error = %e,
                    "Failed to write event"
                );
                return;
            }
            let _ = writer.flush();
        }
    }

    /// Flush all pending writes
    pub fn flush(&self) {
        let mut handles = self.file_handles.lock();
        for writer in handles.values_mut() {
            let _ = writer.flush();
        }
    }
}

impl Drop for EventStorage {
    fn drop(&mut self) {
        self.flush();
    }
}
