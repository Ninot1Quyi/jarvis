//! Memory module - vector and semantic search

mod db;
mod embed;

pub use db::{MemoryDB, MemoryEntry, MemoryError, MemoryStatus};
pub use embed::{EmbedError, Embedder, OpenAIEmbedder};
