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
  private vectorEnabled: boolean = false
  private vectorLoadError: string | null = null

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

    this.loadVectorExtension()
    this.ensureSchema()
  }

  private loadVectorExtension(): void {
    let err1: string | null = null
    let err2: string | null = null
    let err3: string | null = null

    // Try method 1: package default loader
    try {
      sqliteVec.load(this.db)
      if (this.verifyVectorCapability()) {
        this.vectorEnabled = true
        console.info('[Memory] sqlite-vec loaded via package loader')
        return
      }
    } catch (e) {
      err1 = e instanceof Error ? e.message : String(e)
    }

    // Try method 2: explicit path from package
    try {
      const extPath = sqliteVec.getLoadablePath()
      if (extPath && fs.existsSync(extPath)) {
        this.db.loadExtension(extPath)
        if (this.verifyVectorCapability()) {
          this.vectorEnabled = true
          console.info(`[Memory] sqlite-vec loaded from: ${extPath}`)
          return
        }
      }
    } catch (e) {
      err2 = e instanceof Error ? e.message : String(e)
    }

    // Try method 3: manually downloaded vec0.so in node_modules/sqlite-vec
    try {
      const possiblePaths = [
        path.join(process.cwd(), 'node_modules/sqlite-vec/vec0.so'),
        path.join(__dirname, '../../node_modules/sqlite-vec/vec0.so'),
        '/home/user/jarvis/node_modules/sqlite-vec/vec0.so',
      ]
      for (const extPath of possiblePaths) {
        if (fs.existsSync(extPath)) {
          // For loadExtension, pass without .so suffix (it adds it automatically)
          const loadPath = extPath.endsWith('.so') ? extPath.slice(0, -3) : extPath
          this.db.loadExtension(loadPath)
          if (this.verifyVectorCapability()) {
            this.vectorEnabled = true
            console.info(`[Memory] sqlite-vec loaded from manual path: ${extPath}`)
            return
          }
        }
      }
    } catch (e) {
      err3 = e instanceof Error ? e.message : String(e)
    }

    // All methods failed
    this.vectorEnabled = false
    const errors = [err1, err2, err3].filter(Boolean).join('; ')
    this.vectorLoadError = errors || 'extension file not found'
    console.warn(`[Memory] sqlite-vec unavailable (${this.vectorLoadError}), vector search disabled`)
  }

  private verifyVectorCapability(): boolean {
    try {
      // Simple verification: check if vec0 functions are available
      this.db.prepare("SELECT vec_version()").get()
      return true
    } catch {
      return false
    }
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
        provider_key TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL,
        embedding TEXT NOT NULL,
        dims INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider, model, provider_key, hash)
      );

      CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated ON embedding_cache(updated_at);

      -- Task trace processing state (for incremental processing)
      CREATE TABLE IF NOT EXISTS task_states (
        path TEXT PRIMARY KEY,
        processed_lines INTEGER NOT NULL DEFAULT 0,
        hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)

    // Migrate: if embedding_cache lacks provider_key column, drop and recreate
    try {
      const cols = this.db.prepare("PRAGMA table_info(embedding_cache)").all() as Array<{ name: string }>
      const hasProviderKey = cols.some(c => c.name === 'provider_key')
      if (!hasProviderKey) {
        this.db.exec("DROP TABLE IF EXISTS embedding_cache")
        this.db.exec(`
          CREATE TABLE embedding_cache (
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            provider_key TEXT NOT NULL DEFAULT '',
            hash TEXT NOT NULL,
            embedding TEXT NOT NULL,
            dims INTEGER,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (provider, model, provider_key, hash)
          );
          CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated ON embedding_cache(updated_at);
        `)
      }
    } catch {
      // table might not exist yet (first run), ignore
    }

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
    // Only create if we know the vector dimensions from IndexMeta AND vector extension is loaded
    const meta = this.getMeta()
    if (meta?.vectorDims && this.vectorEnabled) {
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

  resetAllEmbeddings(): void {
    this.db.exec("UPDATE chunks SET embedding = '[]', model = NULL")
    const vecExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
    ).get()
    if (vecExists) {
      this.db.exec('DROP TABLE chunks_vec')
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

  // ---- Task state (for incremental trace processing) ----

  getTaskState(filePath: string): { processedLines: number; hash: string } | null {
    const row = this.db.prepare('SELECT processed_lines, hash FROM task_states WHERE path = ?').get(filePath) as { processed_lines: number; hash: string } | undefined
    if (!row) return null
    return { processedLines: row.processed_lines, hash: row.hash }
  }

  setTaskState(filePath: string, processedLines: number, hash: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO task_states (path, processed_lines, hash, updated_at) VALUES (?, ?, ?, ?)'
    ).run(filePath, processedLines, hash, Date.now())
  }

  // ---- File indexing ----

  private _purgeChunks(filePath: string): void {
    const oldChunks = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(filePath) as Array<{ id: string }>
    if (oldChunks.length === 0) return

    const deleteFts = this.db.prepare("DELETE FROM chunks_fts WHERE id = ?")
    for (const old of oldChunks) deleteFts.run(old.id)

    const vecExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'").get()
    if (vecExists) {
      const deleteVec = this.db.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?")
      for (const old of oldChunks) deleteVec.run(old.id)
    }

    this.db.prepare('DELETE FROM chunks WHERE path = ?').run(filePath)
  }

  private _replaceChunks(filePath: string, source: string, hash: string, mtime: number, size: number, chunks: Chunk[]): void {
    const now = Date.now()
    const txn = this.db.transaction(() => {
      this._purgeChunks(filePath)

      this.db.prepare(
        'INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)'
      ).run(filePath, source, hash, mtime, size)

      const insertChunk = this.db.prepare(
        'INSERT INTO chunks (id, path, source, chunk_index, start_line, end_line, heading, hash, model, content, embedding, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      const insertFts = this.db.prepare(
        'INSERT INTO chunks_fts (content, heading, id, path, source, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        const chunkId = `${filePath}:${i}`
        const chunkHash = c.hash ?? crypto.createHash('sha256').update(c.content).digest('hex')
        insertChunk.run(chunkId, filePath, source, i, c.startLine, c.endLine, c.heading, chunkHash, '', c.content, '[]', now)
        insertFts.run(c.content, c.heading ?? '', chunkId, filePath, source, c.startLine, c.endLine)
      }
    })
    txn()
  }

  indexFile(absolutePath: string, relativePath: string, chunkOptions?: ChunkOptions, source: string = 'memory'): boolean {
    const content = fs.readFileSync(absolutePath, 'utf-8')
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    const stat = fs.statSync(absolutePath)

    const existing = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(relativePath) as { hash: string } | undefined
    if (existing && existing.hash === hash) return false

    this._replaceChunks(relativePath, source, hash, stat.mtimeMs, stat.size, chunkMarkdown(content, chunkOptions))
    return true
  }

  indexTaskEntry(entry: { path: string; absPath: string; mtimeMs: number; size: number; hash: string; content: string; lineMap: number[] }): boolean {
    const existing = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(entry.path) as { hash: string } | undefined
    if (existing && existing.hash === entry.hash) return false

    this._replaceChunks(entry.path, 'tasks', entry.hash, entry.mtimeMs, entry.size, chunkMarkdown(entry.content))
    return true
  }

  removeFile(relativePath: string): void {
    const txn = this.db.transaction(() => {
      this._purgeChunks(relativePath)
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
          f.source,
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
        source: string
        content: string
        heading: string | null
        start_line: number
        end_line: number
        rank: number
      }>

      if (rows.length > 0) {
        return rows.map(r => ({
          path: r.path,
          source: r.source as 'memory' | 'tasks',
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
      SELECT c.path, c.source, c.content, c.heading, c.start_line, c.end_line
      FROM chunks c
      WHERE ${likeClauses}
      LIMIT ?
    `).all(...likeParams, limit) as Array<{
      path: string
      source: string
      content: string
      heading: string | null
      start_line: number
      end_line: number
    }>

    return rows.map((r, i) => ({
      path: r.path,
      source: r.source as 'memory' | 'tasks',
      heading: r.heading || null,
      snippet: r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content,
      startLine: r.start_line,
      endLine: r.end_line,
      score: 0.5 / (1 + i),
    }))
  }

  // ---- Vector search ----

  getChunksForEmbedding(paths?: string[]): Array<{ id: string; hash: string; content: string; path: string }> {
    if (paths && paths.length > 0) {
      const placeholders = paths.map(() => '?').join(',')
      return this.db.prepare(
        `SELECT id, hash, content, path FROM chunks WHERE embedding = '[]' AND path IN (${placeholders})`
      ).all(...paths) as Array<{ id: string; hash: string; content: string; path: string }>
    }
    return this.db.prepare(
      "SELECT id, hash, content, path FROM chunks WHERE embedding = '[]'"
    ).all() as Array<{ id: string; hash: string; content: string; path: string }>
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
    // Check if vector extension is enabled
    if (!this.vectorEnabled) {
      return []
    }

    // Check if vec0 table exists
    const vecExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'"
    ).get()

    if (!vecExists) {
      // Fallback: no vec0 table yet, return empty (BM25 will handle search)
      return []
    }

    const queryBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer)

    // Use vec_distance_cosine for exact cosine similarity (full scan, precise results)
    const rows = this.db.prepare(`
      SELECT c.id, c.path, c.source, c.content, c.heading, c.start_line, c.end_line,
             vec_distance_cosine(v.embedding, ?) AS dist
        FROM chunks_vec v
        JOIN chunks c ON c.id = v.chunk_id
       ORDER BY dist ASC
       LIMIT ?
    `).all(queryBuffer, limit) as Array<{
      id: string
      path: string
      source: string
      content: string
      heading: string | null
      start_line: number
      end_line: number
      dist: number
    }>

    return rows.map(r => ({
      path: r.path,
      source: r.source as 'memory' | 'tasks',
      heading: r.heading || null,
      snippet: r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content,
      startLine: r.start_line,
      endLine: r.end_line,
      score: 1 - r.dist,
    }))
  }

  // ---- Embedding cache ----

  getEmbeddingCache(provider: string, model: string, providerKey: string, hashes: string[]): Map<string, EmbeddingCacheEntry> {
    const result = new Map<string, EmbeddingCacheEntry>()
    if (hashes.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < hashes.length; i += batchSize) {
      const batch = hashes.slice(i, i + batchSize)
      const placeholders = batch.map(() => '?').join(',')
      const rows = this.db.prepare(
        `SELECT hash, embedding, dims FROM embedding_cache WHERE provider = ? AND model = ? AND provider_key = ? AND hash IN (${placeholders})`
      ).all(provider, model, providerKey, ...batch) as Array<{ hash: string; embedding: string; dims: number }>

      for (const row of rows) {
        result.set(row.hash, {
          provider,
          model,
          providerKey,
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
      'INSERT OR REPLACE INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const now = Date.now()

    const txn = this.db.transaction(() => {
      for (const e of entries) {
        stmt.run(e.provider, e.model, e.providerKey, e.hash, JSON.stringify(e.embedding), e.dims, now)
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
      const cacheRows = this.db.prepare('SELECT provider, model, provider_key, hash, embedding, dims, updated_at FROM embedding_cache').all() as Array<{
        provider: string; model: string; provider_key: string; hash: string; embedding: string; dims: number; updated_at: number
      }>
      if (cacheRows.length > 0) {
        const insertCache = tempDb.db.prepare(
          'INSERT OR REPLACE INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        const txn = tempDb.db.transaction(() => {
          for (const row of cacheRows) {
            insertCache.run(row.provider, row.model, row.provider_key, row.hash, row.embedding, row.dims, row.updated_at)
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
