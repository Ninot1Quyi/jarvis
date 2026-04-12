//! Memory database with SQLite FTS5 text search

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum MemoryError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Memory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub path: String,
    pub chunk_index: i32,
    pub content: String,
    pub rank: Option<f64>,
}

/// Memory database using SQLite with FTS5
pub struct MemoryDB {
    conn: Mutex<Connection>,
}

impl MemoryDB {
    /// Create a new memory database at the given path
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self, MemoryError> {
        let conn = Connection::open(db_path)?;

        // Create tables
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                hash TEXT NOT NULL,
                mtime INTEGER,
                content TEXT
            );
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                path TEXT,
                chunk_index INTEGER,
                content TEXT
            );
            CREATE TABLE IF NOT EXISTS embedding_cache (
                content_hash TEXT PRIMARY KEY,
                embedding BLOB
            );
            "#,
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Search using simple LIKE match (fallback when FTS5 not available)
    pub async fn search_bm25(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        let conn = self.conn.lock().unwrap();

        // Simple LIKE search - works without FTS5 setup
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, path, chunk_index, content FROM chunks WHERE content LIKE ? LIMIT ?",
        )?;

        let entries = stmt
            .query_map(params![pattern, limit as i64], |row| {
                Ok(MemoryEntry {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    chunk_index: row.get(2)?,
                    content: row.get(3)?,
                    rank: None,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(entries)
    }

    /// Store a memory entry
    pub async fn store(&self, entry: &MemoryEntry) -> Result<(), MemoryError> {
        let conn = self.conn.lock().unwrap();

        // Insert into chunks table
        conn.execute(
            "INSERT OR REPLACE INTO chunks (id, path, chunk_index, content) VALUES (?, ?, ?, ?)",
            params![entry.id, entry.path, entry.chunk_index, entry.content],
        )?;

        Ok(())
    }

    /// Get a memory entry by ID
    pub async fn get(&self, id: &str) -> Result<Option<MemoryEntry>, MemoryError> {
        let conn = self.conn.lock().unwrap();

        let mut stmt =
            conn.prepare("SELECT id, path, chunk_index, content FROM chunks WHERE id = ?")?;

        let entry = stmt
            .query_row(params![id], |row| {
                Ok(MemoryEntry {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    chunk_index: row.get(2)?,
                    content: row.get(3)?,
                    rank: None,
                })
            })
            .ok();

        Ok(entry)
    }

    /// Get database status
    pub async fn status(&self) -> Result<MemoryStatus, MemoryError> {
        let conn = self.conn.lock().unwrap();

        let chunk_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))?;

        let file_count: i64 = conn.query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))?;

        Ok(MemoryStatus {
            chunk_count,
            file_count,
        })
    }

    /// Store file metadata
    pub async fn store_file(
        &self,
        path: &str,
        hash: &str,
        mtime: i64,
        content: &str,
    ) -> Result<(), MemoryError> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "INSERT OR REPLACE INTO files (path, hash, mtime, content) VALUES (?, ?, ?, ?)",
            params![path, hash, mtime, content],
        )?;

        Ok(())
    }

    /// Get file content
    pub async fn get_file(&self, path: &str) -> Result<Option<String>, MemoryError> {
        let conn = self.conn.lock().unwrap();

        let content: Option<String> = conn
            .query_row(
                "SELECT content FROM files WHERE path = ?",
                params![path],
                |row| row.get(0),
            )
            .ok();

        Ok(content)
    }

    /// Cache embedding for content
    pub async fn cache_embedding(
        &self,
        content_hash: &str,
        embedding: &[f32],
    ) -> Result<(), MemoryError> {
        let conn = self.conn.lock().unwrap();

        let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();

        conn.execute(
            "INSERT OR REPLACE INTO embedding_cache (content_hash, embedding) VALUES (?, ?)",
            params![content_hash, bytes],
        )?;

        Ok(())
    }

    /// Get cached embedding
    pub async fn get_cached_embedding(
        &self,
        content_hash: &str,
    ) -> Result<Option<Vec<f32>>, MemoryError> {
        let conn = self.conn.lock().unwrap();

        let bytes: Option<Vec<u8>> = conn
            .query_row(
                "SELECT embedding FROM embedding_cache WHERE content_hash = ?",
                params![content_hash],
                |row| row.get(0),
            )
            .ok();

        let embedding = bytes.map(|b| {
            b.chunks_exact(4)
                .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
                .collect()
        });

        Ok(embedding)
    }
}

/// Memory database status
#[derive(Debug, Clone)]
pub struct MemoryStatus {
    pub chunk_count: i64,
    pub file_count: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_memory_db() {
        let dir = tempdir().unwrap();
        let db = MemoryDB::new(dir.path().join("test.db")).unwrap();

        let entry = MemoryEntry {
            id: "test1".to_string(),
            path: "/test/path".to_string(),
            chunk_index: 0,
            content: "Hello world".to_string(),
            rank: None,
        };

        db.store(&entry).await.unwrap();

        let results = db.search_bm25("Hello", 10).await.unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].content, "Hello world");

        let retrieved = db.get("test1").await.unwrap();
        assert!(retrieved.is_some());

        let status = db.status().await.unwrap();
        assert_eq!(status.chunk_count, 1);
    }
}
