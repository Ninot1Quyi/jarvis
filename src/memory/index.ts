import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { MemoryDB } from './db.js'
import { MemoryWatcher } from './watcher.js'
import { mergeHybridResults, DEFAULT_SEARCH_OPTIONS, type HybridSearchOptions } from './search.js'
import { createEmbeddingProvider, type EmbeddingProvider } from './embedding.js'
import type { SearchResult, MemoryFileEntry, MemoryConfig, EmbeddingCacheEntry } from './types.js'
import type { KeyConfig } from '../types.js'

export { type SearchResult, type Chunk, type MemoryFileEntry, type IndexMeta, type EmbeddingCacheEntry, type MemoryConfig } from './types.js'
export { type HybridSearchOptions, DEFAULT_SEARCH_OPTIONS } from './search.js'

export class MemorySystem {
  private db: MemoryDB
  private watcher: MemoryWatcher
  private dataDir: string
  private dirty: boolean = false
  private syncingPromise: Promise<void> | null = null
  private fileSizes: Map<string, number> = new Map()
  private readonly DELTA_BYTES_THRESHOLD = 100_000
  embeddingProvider: EmbeddingProvider | null = null

  private constructor(dataDir: string, db: MemoryDB) {
    this.dataDir = dataDir
    this.db = db
    this.watcher = new MemoryWatcher()
  }

  static async create(dataDir: string, keys?: KeyConfig): Promise<MemorySystem> {
    // 1. Ensure data/ and data/memory/ directories exist
    const memoryDir = path.join(dataDir, 'memory')
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true })
    const assetsDir = path.join(memoryDir, 'assets')
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true })

    // 2. Open SQLite DB
    const dbPath = path.join(dataDir, 'memory-index.db')
    const db = new MemoryDB(dbPath)

    // 3. Create instance
    const system = new MemorySystem(dataDir, db)

    // Create embedding provider if configured
    if (keys?.memory?.embeddingProvider) {
      system.embeddingProvider = createEmbeddingProvider(keys.memory.embeddingProvider, keys)
    }

    // 4. Initial sync
    await system.sync()

    // Generate embeddings for chunks that don't have them yet
    if (system.embeddingProvider) {
      await system.generateEmbeddings()
    }

    // 5. Start file watcher
    system.watcher.start(dataDir, {
      onFileChanged: (absolutePath: string) => {
        const relativePath = path.relative(dataDir, absolutePath)

        // Delta threshold for trace files: only re-index if file grew significantly
        if (relativePath.startsWith('traces/')) {
          try {
            const stat = fs.statSync(absolutePath)
            const prevSize = system.fileSizes.get(relativePath) ?? 0
            if (stat.size - prevSize < system.DELTA_BYTES_THRESHOLD) return
            system.fileSizes.set(relativePath, stat.size)
          } catch { return }
        }

        try {
          const chunkOpts = relativePath.startsWith('traces/')
            ? { onlyHeadings: ['USER', 'ASSISTANT'] }
            : undefined
          system.db.indexFile(absolutePath, relativePath, chunkOpts)
          system.dirty = true
        } catch {
          // Silently ignore indexing errors from watcher
        }
      },
      onFileRemoved: (absolutePath: string) => {
        const relativePath = path.relative(dataDir, absolutePath)
        system.db.removeFile(relativePath)
        system.dirty = true
      },
    })

    return system
  }

  // Full sync with promise dedup: concurrent callers share the same sync
  async sync(): Promise<void> {
    if (this.syncingPromise) return this.syncingPromise
    this.syncingPromise = this._doSync()
    try {
      await this.syncingPromise
    } finally {
      this.syncingPromise = null
    }
  }

  private async _doSync(): Promise<void> {
    const memoryFiles = this.listMemoryFiles()
    const indexedPaths = new Set(this.db.getIndexedPaths())

    // Index new/changed files
    for (const entry of memoryFiles) {
      const relativePath = path.relative(this.dataDir, entry.path)
      const chunkOpts = relativePath.startsWith('traces/')
        ? { onlyHeadings: ['USER', 'ASSISTANT'] }
        : undefined
      this.db.indexFile(entry.path, relativePath, chunkOpts)
      indexedPaths.delete(relativePath)

      // Track file sizes for delta threshold
      if (relativePath.startsWith('traces/')) {
        this.fileSizes.set(relativePath, entry.size)
      }
    }

    // Remove stale entries (files that no longer exist)
    for (const stalePath of indexedPaths) {
      this.db.removeFile(stalePath)
    }

    this.dirty = false
  }

  // List all memory files on disk
  private listMemoryFiles(): MemoryFileEntry[] {
    const entries: MemoryFileEntry[] = []

    // 1. MEMORY.md
    const mainFile = path.join(this.dataDir, 'MEMORY.md')
    if (fs.existsSync(mainFile)) {
      const stat = fs.statSync(mainFile)
      const content = fs.readFileSync(mainFile, 'utf-8')
      entries.push({
        path: mainFile,
        hash: crypto.createHash('sha256').update(content).digest('hex'),
        mtime: stat.mtimeMs,
        size: stat.size,
      })
    }

    // 2. memory/*.md (non-recursive, skip assets/)
    const memoryDir = path.join(this.dataDir, 'memory')
    if (fs.existsSync(memoryDir)) {
      const dirEntries = fs.readdirSync(memoryDir, { withFileTypes: true })
      for (const entry of dirEntries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = path.join(memoryDir, entry.name)
          const stat = fs.statSync(filePath)
          const content = fs.readFileSync(filePath, 'utf-8')
          entries.push({
            path: filePath,
            hash: crypto.createHash('sha256').update(content).digest('hex'),
            mtime: stat.mtimeMs,
            size: stat.size,
          })
        }
      }
    }

    // 3. traces/*.md (session transcripts)
    const tracesDir = path.join(this.dataDir, 'traces')
    if (fs.existsSync(tracesDir)) {
      const dirEntries = fs.readdirSync(tracesDir, { withFileTypes: true })
      for (const entry of dirEntries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = path.join(tracesDir, entry.name)
          const stat = fs.statSync(filePath)
          const content = fs.readFileSync(filePath, 'utf-8')
          entries.push({
            path: filePath,
            hash: crypto.createHash('sha256').update(content).digest('hex'),
            mtime: stat.mtimeMs,
            size: stat.size,
          })
        }
      }
    }

    return entries
  }

  // Search memory using BM25, awaits sync if dirty
  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    if (this.dirty) await this.sync()
    return this.db.searchBM25(query, limit)
  }

  // Hybrid search: weighted fusion of BM25 + vector results
  async searchHybrid(
    query: string,
    queryEmbedding: number[] | null,
    options?: Partial<HybridSearchOptions>
  ): Promise<SearchResult[]> {
    if (this.dirty) await this.sync()
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options }
    const candidates = Math.min(200, opts.maxResults * opts.candidateMultiplier)

    const keywordResults = this.db.searchBM25(query, candidates)

    if (!queryEmbedding) {
      // No embedding available, return keyword results with minScore filter
      return keywordResults
        .filter(r => r.score >= opts.minScore)
        .slice(0, opts.maxResults)
    }

    const vectorResults = this.db.searchVector(queryEmbedding, candidates)
    return mergeHybridResults(vectorResults, keywordResults, opts)
  }

  // Read a memory file by relative path
  readFile(relPath: string, from: number = 1, lines?: number): string {
    const absolutePath = path.join(this.dataDir, relPath)
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Memory file not found: ${relPath}`)
    }
    const content = fs.readFileSync(absolutePath, 'utf-8')
    const allLines = content.split('\n')

    const startIdx = Math.max(0, from - 1) // convert 1-indexed to 0-indexed
    const endIdx = lines ? startIdx + lines : allLines.length

    return allLines.slice(startIdx, endIdx).join('\n')
  }

  // Generate embeddings for chunks that don't have them yet
  private async generateEmbeddings(): Promise<void> {
    if (!this.embeddingProvider) return

    const chunks = this.db.getChunksForEmbedding()
    if (chunks.length === 0) return

    // Check embedding cache first
    const cache = this.db.getEmbeddingCache(
      this.embeddingProvider.id,
      this.embeddingProvider.model,
      chunks.map(c => c.hash)
    )

    const uncached: Array<{ id: string; hash: string; content: string }> = []
    for (const chunk of chunks) {
      const cached = cache.get(chunk.hash)
      if (cached) {
        this.db.updateChunkEmbedding(chunk.id, cached.embedding, this.embeddingProvider.model)
      } else {
        uncached.push(chunk)
      }
    }

    if (uncached.length === 0) return

    // Batch embed uncached chunks
    try {
      const texts = uncached.map(c => c.content)
      const embeddings = await this.embeddingProvider.embedBatch(texts)

      const cacheEntries: EmbeddingCacheEntry[] = []
      for (let i = 0; i < uncached.length; i++) {
        this.db.updateChunkEmbedding(uncached[i].id, embeddings[i], this.embeddingProvider.model)
        cacheEntries.push({
          provider: this.embeddingProvider.id,
          model: this.embeddingProvider.model,
          hash: uncached[i].hash,
          embedding: embeddings[i],
          dims: embeddings[i].length,
        })
      }

      // Save to cache
      this.db.setEmbeddingCache(cacheEntries)

      // Update IndexMeta with vector dimensions and create vec0 table
      const meta = this.db.getMeta() ?? { model: '', provider: '', chunkTokens: 0, chunkOverlap: 0 }
      if (!meta.vectorDims && embeddings.length > 0) {
        meta.vectorDims = embeddings[0].length
        this.db.setMeta(meta)
        // Create vec0 table immediately so vector search works without restart
        this.db.ensureVecTable(meta.vectorDims)
      }
    } catch (error) {
      // Embedding failures are non-fatal - BM25 search still works
      console.error('Failed to generate embeddings:', error)
    }
  }

  // Get system status
  status(): { files: number; chunks: number; dirty: boolean; embeddingsReady: boolean } {
    const dbStatus = this.db.status()
    return { ...dbStatus, dirty: this.dirty, embeddingsReady: this.embeddingProvider !== null }
  }

  // Clean shutdown
  close(): void {
    this.watcher.close()
    this.db.close()
  }
}
