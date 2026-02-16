export type MemorySource = 'memory' | 'tasks'

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
  hash: string;             // SHA-256 hex of content
}

export interface SearchResult {
  path: string;             // relative to dataDir
  heading: string | null;
  snippet: string;          // truncated content
  startLine: number;
  endLine: number;
  score: number;            // 0-1 normalized
  source?: MemorySource;
}

export interface IndexMeta {
  model: string;
  provider: string;
  chunkTokens: number;
  chunkOverlap: number;
  vectorDims?: number;
}

export interface MultimodalInput {
  text: string
  images?: string[]  // base64 data URIs: "data:image/png;base64,..."
}

export interface EmbeddingCacheEntry {
  provider: string;
  model: string;
  providerKey: string;
  hash: string;
  embedding: number[];
  dims: number;
}

export interface MemoryConfig {
  embedding?: {
    provider: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  };
  search?: {
    vectorWeight?: number;
    textWeight?: number;
    minScore?: number;
    maxResults?: number;
    snippetMaxChars?: number;
  };
  chunk?: {
    maxChars?: number;
    overlapChars?: number;
  };
  cache?: {
    enabled?: boolean;
    maxEntries?: number;
  };
}
