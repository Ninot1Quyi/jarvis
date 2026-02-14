import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as sqliteVec from 'sqlite-vec'
import { chunkMarkdown, type ChunkOptions } from './chunker.js'
import type { Chunk, SearchResult, IndexMeta, EmbeddingCacheEntry } from './types.js'

export class MemoryDB {
  private db!: Database.Database
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.openDb(dbPath)
  }

  private openDb(dbPath: string): void {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    // Load sqlite-vec extension
    sqliteVec.load(this.db)

    this.ensureSchema()
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'memory',
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'memory',
        chunk_index INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        heading TEXT,
        hash TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        embedding TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);

      CREATE TABLE IF NOT EXISTS embedding_cache (
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        hash TEXT NOT NULL,
        embedding TEXT NOT NULL,
        dims INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider, model, hash)
      );

      CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated ON embedding_cache(updated_at);
    `)

    // FTS5 virtual table -- manual sync, no triggers (TEXT primary key)
    const ftsExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'"
    ).get()

    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
          content,
          heading,
          id UNINDEXED,
          path UNINDEXED,
          source UNINDEXED,
          start_line UNINDEXED,
          end_line UNINDEXED
        );
      `)
    }

    // vec0 virtual table for vector search
    // Only create if we know the vector dimensions from IndexMeta
    const meta = this.getMeta()
    if (meta?.vectorDims) {
      this.ensureVecTable(meta.vectorDims)
    }
  }

  ensureVecTable(dims: number): void {
    const vecExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
    ).get()

    if (!vecExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE chunks_vec USING vec0(
          chunk_id TEXT PRIMARY KEY,
          embedding FLOAT[${dims}]
        );
      `)

      // Backfill: insert existing embeddings into vec0
      const rows = this.db.prepare(
        "SELECT id, embedding FROM chunks WHERE embedding != '[]'"
      ).all() as Array<{ id: string; embedding: string }>

      if (rows.length > 0) {
        const insert = this.db.prepare('INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)')
        const txn = this.db.transaction(() => {
          for (const row of rows) {
            const emb = JSON.parse(row.embedding) as number[]
            insert.run(row.id, Buffer.from(new Float32Array(emb).buffer))
          }
        })
        txn()
      }
    }
  }

  // ---- Meta ----

  getMeta(): IndexMeta | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'index_meta'").get() as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value) as IndexMeta
    } catch {
      return null
    }
  }

  setMeta(meta: IndexMeta): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('index_meta', ?)"
    ).run(JSON.stringify(meta))
  }

  // ---- File indexing ----

  indexFile(absolutePath: string, relativePath: string, chunkOptions?: ChunkOptions): boolean {
    const content = fs.readFileSync(absolutePath, 'utf-8')
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    const stat = fs.statSync(absolutePath)

    const existing = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(relativePath) as { hash: string } | undefined
    if (existing && existing.hash === hash) return false

    const chunks = chunkMarkdown(content, chunkOptions)
    const now = Date.now()

    const txn = this.db.transaction(() => {
      // Delete old FTS entries for this path
      const oldChunks = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(relativePath) as Array<{ id: string }>
      const deleteFts = this.db.prepare("DELETE FROM chunks_fts WHERE id = ?")
      for (const old of oldChunks) {
        deleteFts.run(old.id)
      }

      // Delete old vec entries
      const vecExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
      ).get()
      if (vecExists) {
        const deleteVec = this.db.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?")
        for (const old of oldChunks) {
          deleteVec.run(old.id)
        }
      }

      // Delete old chunks
      this.db.prepare('DELETE FROM chunks WHERE path = ?').run(relativePath)

      // Upsert file record
      this.db.prepare(
        'INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)'
      ).run(relativePath, 'memory', hash, stat.mtimeMs, stat.size)

      // Insert new chunks + FTS
      const insertChunk = this.db.prepare(
        'INSERT INTO chunks (id, path, source, chunk_index, start_line, end_line, heading, hash, model, content, embedding, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      const insertFts = this.db.prepare(
        'INSERT INTO chunks_fts (content, heading, id, path, source, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        const chunkId = `${relativePath}:${i}`
        const chunkHash = c.hash ?? crypto.createHash('sha256').update(c.content).digest('hex')
        insertChunk.run(chunkId, relativePath, 'memory', i, c.startLine, c.endLine, c.heading, chunkHash, '', c.content, '[]', now)
        insertFts.run(c.content, c.heading ?? '', chunkId, relativePath, 'memory', c.startLine, c.endLine)
      }
    })
    txn()
    return true
  }

  removeFile(relativePath: string): void {
    const txn = this.db.transaction(() => {
      // Remove FTS entries
      const oldChunks = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(relativePath) as Array<{ id: string }>
      const deleteFts = this.db.prepare("DELETE FROM chunks_fts WHERE id = ?")
      for (const old of oldChunks) {
        deleteFts.run(old.id)
      }

      // Delete vec entries
      const vecExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
      ).get()
      if (vecExists) {
        const deleteVec = this.db.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?")
        for (const old of oldChunks) {
          deleteVec.run(old.id)
        }
      }

      this.db.prepare('DELETE FROM chunks WHERE path = ?').run(relativePath)
      this.db.prepare('DELETE FROM files WHERE path = ?').run(relativePath)
    })
    txn()
  }

  // ---- BM25 search ----

  searchBM25(query: string, limit: number = 10): SearchResult[] {
    if (!query.trim()) return []

    const tokens = query.trim().split(/\s+/).filter(Boolean)

    // Try FTS5 first
    const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' AND ')
    try {
      const rows = this.db.prepare(`
        SELECT
          f.id,
          f.path,
          f.content,
          f.heading,
          f.start_line,
          f.end_line,
          bm25(chunks_fts) as rank
        FROM chunks_fts f
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts)
        LIMIT ?
      `).all(ftsQuery, limit) as Array<{
        id: string
        path: string
        content: string
        heading: string | null
        start_line: number
        end_line: number
        rank: number
      }>

      if (rows.length > 0) {
        return rows.map(r => ({
          path: r.path,
          heading: r.heading || null,
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
    const likeClauses = tokens.map(() => 'c.content LIKE ?').join(' AND ')
    const likeParams: string[] = tokens.map(t => `%${t}%`)

    const rows = this.db.prepare(`
      SELECT c.path, c.content, c.heading, c.start_line, c.end_line
      FROM chunks c
      WHERE ${likeClauses}
      LIMIT ?
    `).all(...likeParams, limit) as Array<{
      path: string
      content: string
      heading: string | null
      start_line: number
      end_line: number
    }>

    return rows.map((r, i) => ({
      path: r.path,
      heading: r.heading || null,
      snippet: r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content,
      startLine: r.start_line,
      endLine: r.end_line,
      score: 0.5 / (1 + i),
    }))
  }

  // ---- Vector search ----

  getChunksForEmbedding(paths?: string[]): Array<{ id: string; hash: string; content: string }> {
    if (paths && paths.length > 0) {
      const placeholders = paths.map(() => '?').join(',')
      return this.db.prepare(
        `SELECT id, hash, content FROM chunks WHERE embedding = '[]' AND path IN (${placeholders})`
      ).all(...paths) as Array<{ id: string; hash: string; content: string }>
    }
    return this.db.prepare(
      "SELECT id, hash, content FROM chunks WHERE embedding = '[]'"
    ).all() as Array<{ id: string; hash: string; content: string }>
  }

  updateChunkEmbedding(id: string, embedding: number[], model: string): void {
    this.db.prepare(
      'UPDATE chunks SET embedding = ?, model = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(embedding), model, Date.now(), id)

    // Also update vec0 table if it exists
    const vecExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
    ).get()

    if (vecExists) {
      const buffer = Buffer.from(new Float32Array(embedding).buffer)
      // Use INSERT OR REPLACE - vec0 supports this
      this.db.prepare(
        'INSERT OR REPLACE INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)'
      ).run(id, buffer)
    }
  }

  searchVector(queryEmbedding: number[], limit: number = 10): SearchResult[] {
    // Check if vec0 table exists
    const vecExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
    ).get()

    if (!vecExists) {
      // Fallback: no vec0 table yet, return empty (BM25 will handle search)
      return []
    }

    const queryBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer)

    const vecRows = this.db.prepare(`
      SELECT chunk_id, distance FROM chunks_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(queryBuffer, limit) as Array<{ chunk_id: string; distance: number }>

    if (vecRows.length === 0) return []

    // Fetch chunk details
    const ids = vecRows.map(r => r.chunk_id)
    const distanceMap = new Map(vecRows.map(r => [r.chunk_id, r.distance]))
    const placeholders = ids.map(() => '?').join(',')

    const chunks = this.db.prepare(`
      SELECT id, path, content, heading, start_line, end_line
      FROM chunks WHERE id IN (${placeholders})
    `).all(...ids) as Array<{
      id: string
      path: string
      content: string
      heading: string | null
      start_line: number
      end_line: number
    }>

    return chunks.map(c => {
      const distance = distanceMap.get(c.id) ?? Infinity
      // Convert L2 distance to similarity score: 1 / (1 + distance)
      const score = 1 / (1 + distance)
      return {
        path: c.path,
        heading: c.heading || null,
        snippet: c.content.length > 300 ? c.content.slice(0, 300) + '...' : c.content,
        startLine: c.start_line,
        endLine: c.end_line,
        score,
      }
    }).sort((a, b) => b.score - a.score)
  }

  // ---- Embedding cache ----

  getEmbeddingCache(provider: string, model: string, hashes: string[]): Map<string, EmbeddingCacheEntry> {
    const result = new Map<string, EmbeddingCacheEntry>()
    if (hashes.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < hashes.length; i += batchSize) {
      const batch = hashes.slice(i, i + batchSize)
      const placeholders = batch.map(() => '?').join(',')
      const rows = this.db.prepare(
        `SELECT hash, embedding, dims FROM embedding_cache WHERE provider = ? AND model = ? AND hash IN (${placeholders})`
      ).all(provider, model, ...batch) as Array<{ hash: string; embedding: string; dims: number }>

      for (const row of rows) {
        result.set(row.hash, {
          provider,
          model,
          hash: row.hash,
          embedding: JSON.parse(row.embedding) as number[],
          dims: row.dims,
        })
      }
    }

    return result
  }

  setEmbeddingCache(entries: EmbeddingCacheEntry[]): void {
    if (entries.length === 0) return

    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO embedding_cache (provider, model, hash, embedding, dims, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const now = Date.now()

    const txn = this.db.transaction(() => {
      for (const e of entries) {
        stmt.run(e.provider, e.model, e.hash, JSON.stringify(e.embedding), e.dims, now)
      }
    })
    txn()
  }

  pruneEmbeddingCache(maxEntries: number): void {
    const count = (this.db.prepare('SELECT COUNT(*) as cnt FROM embedding_cache').get() as { cnt: number }).cnt
    if (count <= maxEntries) return

    const excess = count - maxEntries
    this.db.prepare(
      'DELETE FROM embedding_cache WHERE rowid IN (SELECT rowid FROM embedding_cache ORDER BY updated_at ASC LIMIT ?)'
    ).run(excess)
  }

  // ---- Atomic reindex ----

  async atomicReindex(indexFn: (tempDb: MemoryDB) => Promise<void>): Promise<void> {
    const uuid = crypto.randomUUID()
    const tempPath = `${this.dbPath}.tmp-${uuid}`
    const backupPath = `${this.dbPath}.backup-${uuid}`

    let tempDb: MemoryDB | null = null

    try {
      tempDb = new MemoryDB(tempPath)

      // Copy embedding cache from current DB to temp
      const cacheRows = this.db.prepare('SELECT provider, model, hash, embedding, dims, updated_at FROM embedding_cache').all() as Array<{
        provider: string; model: string; hash: string; embedding: string; dims: number; updated_at: number
      }>
      if (cacheRows.length > 0) {
        const insertCache = tempDb.db.prepare(
          'INSERT OR REPLACE INTO embedding_cache (provider, model, hash, embedding, dims, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        const txn = tempDb.db.transaction(() => {
          for (const row of cacheRows) {
            insertCache.run(row.provider, row.model, row.hash, row.embedding, row.dims, row.updated_at)
          }
        })
        txn()
      }

      await indexFn(tempDb)

      tempDb.close()
      tempDb = null
      this.db.close()

      // Atomic swap
      fs.renameSync(this.dbPath, backupPath)
      for (const suffix of ['-wal', '-shm']) {
        const src = this.dbPath + suffix
        if (fs.existsSync(src)) fs.renameSync(src, backupPath + suffix)
      }

      fs.renameSync(tempPath, this.dbPath)
      for (const suffix of ['-wal', '-shm']) {
        const src = tempPath + suffix
        if (fs.existsSync(src)) fs.renameSync(src, this.dbPath + suffix)
      }

      // Remove backup
      for (const suffix of ['', '-wal', '-shm']) {
        const f = backupPath + suffix
        if (fs.existsSync(f)) fs.unlinkSync(f)
      }

      this.openDb(this.dbPath)
    } catch (err) {
      if (tempDb) {
        try { tempDb.close() } catch { /* ignore */ }
      }
      for (const suffix of ['', '-wal', '-shm']) {
        const f = tempPath + suffix
        if (fs.existsSync(f)) try { fs.unlinkSync(f) } catch { /* ignore */ }
      }

      try {
        if (!this.db.open) {
          this.openDb(this.dbPath)
        }
      } catch { /* ignore */ }

      throw err
    }
  }

  // ---- Status ----

  status(): { files: number; chunks: number } {
    const files = (this.db.prepare('SELECT COUNT(*) as cnt FROM files').get() as { cnt: number }).cnt
    const chunks = (this.db.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as { cnt: number }).cnt
    return { files, chunks }
  }

  getIndexedPaths(): string[] {
    const rows = this.db.prepare('SELECT path FROM files').all() as Array<{ path: string }>
    return rows.map(r => r.path)
  }

  close(): void {
    this.db.close()
  }
}
