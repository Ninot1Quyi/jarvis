import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { chunkMarkdown, type ChunkOptions } from './chunker.js'
import type { Chunk, SearchResult } from './types.js'

export class MemoryDB {
  private db: Database.Database

  constructor(dbPath: string) {
    // Ensure parent directory exists
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.ensureSchema()
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        heading TEXT,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        FOREIGN KEY (path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
    `)

    // FTS5 virtual table - check if exists first
    const ftsExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'"
    ).get()

    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
          content, heading,
          content='chunks', content_rowid='id'
        );

        CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
          INSERT INTO chunks_fts(rowid, content, heading) VALUES (new.id, new.content, new.heading);
        END;

        CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
          INSERT INTO chunks_fts(chunks_fts, rowid, content, heading) VALUES ('delete', old.id, old.content, old.heading);
        END;
      `)
    }
  }

  // Index a single file. Returns true if file was actually re-indexed (hash changed).
  indexFile(absolutePath: string, relativePath: string, chunkOptions?: ChunkOptions): boolean {
    // 1. Read file, compute SHA-256
    const content = fs.readFileSync(absolutePath, 'utf-8')
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    const stat = fs.statSync(absolutePath)

    // 2. Check if hash unchanged
    const existing = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(relativePath) as { hash: string } | undefined
    if (existing && existing.hash === hash) return false

    // 3. Transaction: delete old chunks, insert new
    const insertFile = this.db.prepare(
      'INSERT OR REPLACE INTO files (path, hash, mtime, size) VALUES (?, ?, ?, ?)'
    )
    const deleteChunks = this.db.prepare('DELETE FROM chunks WHERE path = ?')
    const insertChunk = this.db.prepare(
      'INSERT INTO chunks (path, chunk_index, content, heading, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)'
    )

    const chunks = chunkMarkdown(content, chunkOptions)

    const txn = this.db.transaction(() => {
      deleteChunks.run(relativePath)
      insertFile.run(relativePath, hash, stat.mtimeMs, stat.size)
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        insertChunk.run(relativePath, i, c.content, c.heading, c.startLine, c.endLine)
      }
    })
    txn()
    return true
  }

  // Remove a file and its chunks from the index
  removeFile(relativePath: string): void {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE path = ?').run(relativePath)
      this.db.prepare('DELETE FROM files WHERE path = ?').run(relativePath)
    })
    txn()
  }

  // BM25 full-text search with LIKE fallback for CJK text
  searchBM25(query: string, limit: number = 10): SearchResult[] {
    if (!query.trim()) return []

    const tokens = query.trim().split(/\s+/).filter(Boolean)

    // Try FTS5 first (works well for Latin/ASCII tokens)
    const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' AND ')
    try {
      const rows = this.db.prepare(`
        SELECT
          c.path,
          c.heading,
          c.content,
          c.start_line,
          c.end_line,
          bm25(chunks_fts) as rank
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts)
        LIMIT ?
      `).all(ftsQuery, limit) as Array<{
        path: string
        heading: string | null
        content: string
        start_line: number
        end_line: number
        rank: number
      }>

      if (rows.length > 0) {
        return rows.map(r => ({
          path: r.path,
          heading: r.heading,
          snippet: r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content,
          startLine: r.start_line,
          endLine: r.end_line,
          score: 1 / (1 + Math.abs(r.rank)),
        }))
      }
    } catch {
      // FTS query syntax error, fall through to LIKE
    }

    // Fallback: LIKE search for CJK and other non-tokenizable text
    const likeClauses = tokens.map(() => '(c.content LIKE ? OR c.heading LIKE ?)').join(' AND ')
    const likeParams: string[] = []
    for (const t of tokens) {
      const pattern = `%${t}%`
      likeParams.push(pattern, pattern)
    }

    const rows = this.db.prepare(`
      SELECT c.path, c.heading, c.content, c.start_line, c.end_line
      FROM chunks c
      WHERE ${likeClauses}
      LIMIT ?
    `).all(...likeParams, limit) as Array<{
      path: string
      heading: string | null
      content: string
      start_line: number
      end_line: number
    }>

    return rows.map((r, i) => ({
      path: r.path,
      heading: r.heading,
      snippet: r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content,
      startLine: r.start_line,
      endLine: r.end_line,
      score: 0.5 / (1 + i),  // Decreasing score for LIKE results
    }))
  }

  // Get indexed file count and chunk count
  status(): { files: number; chunks: number } {
    const files = (this.db.prepare('SELECT COUNT(*) as cnt FROM files').get() as { cnt: number }).cnt
    const chunks = (this.db.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as { cnt: number }).cnt
    return { files, chunks }
  }

  // Get all indexed file paths
  getIndexedPaths(): string[] {
    const rows = this.db.prepare('SELECT path FROM files').all() as Array<{ path: string }>
    return rows.map(r => r.path)
  }

  close(): void {
    this.db.close()
  }
}
