export interface MemoryFileEntry {
  path: string;      // absolute path
  hash: string;      // SHA-256 hex
  mtime: number;     // ms since epoch
  size: number;      // bytes
}

export interface Chunk {
  content: string;
  heading: string | null;   // the ## heading this chunk belongs to
  startLine: number;        // 1-indexed
  endLine: number;          // 1-indexed
}

export interface SearchResult {
  path: string;             // relative to dataDir (e.g. "MEMORY.md" or "memory/2026-02-12.md")
  heading: string | null;
  snippet: string;          // truncated content (~300 chars)
  startLine: number;
  endLine: number;
  score: number;            // 0-1 normalized
}

export interface MemoryConfig {
  embedding?: {
    provider: 'openai' | 'none'
    model?: string
    apiKey?: string
    baseUrl?: string
  }
  search?: {
    vectorWeight?: number
    textWeight?: number
    minScore?: number
    maxResults?: number
    snippetMaxChars?: number
  }
  chunk?: {
    maxChars?: number
    overlapChars?: number
  }
  cache?: {
    enabled?: boolean
    maxEntries?: number
  }
}
