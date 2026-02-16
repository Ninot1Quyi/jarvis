import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { MemoryDB } from './db.js'
import { MemoryWatcher } from './watcher.js'
import { logger } from '../utils/logger.js'
import { mergeHybridResults, DEFAULT_SEARCH_OPTIONS, type HybridSearchOptions } from './search.js'
import { createEmbeddingProvider, type EmbeddingProvider } from './embedding.js'
import type { SearchResult, MemoryFileEntry, MemoryConfig, EmbeddingCacheEntry, MultimodalInput } from './types.js'
import type { KeyConfig } from '../types.js'
import { MemoryAgent, type MemoryAgentConfig } from './memory-agent.js'
import { buildTaskEntry, listTaskFiles, type IncrementalState } from './task-files.js'

export { type SearchResult, type Chunk, type MemoryFileEntry, type IndexMeta, type EmbeddingCacheEntry, type MemoryConfig } from './types.js'
export { type HybridSearchOptions, DEFAULT_SEARCH_OPTIONS } from './search.js'

export class MemorySystem {
  private db: MemoryDB
  private watcher: MemoryWatcher
  private dataDir: string
  private dirty: boolean = false
  private syncingPromise: Promise<void> | null = null
  private taskStates: Map<string, IncrementalState> = new Map()
  private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly SYNC_DEBOUNCE_MS = 5000
  embeddingProvider: EmbeddingProvider | null = null
  private memoryAgent: MemoryAgent | null = null
  private providerKey: string = ''

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
      system.providerKey = system.computeProviderKey(keys)
    }

    if (keys?.memory?.memoryAgent) {
      system.memoryAgent = new MemoryAgent(keys.memory.memoryAgent as MemoryAgentConfig, keys)
    }

    // Detect dimension change: if provider dimensions differ from stored, reset all embeddings
    if (system.embeddingProvider) {
      const meta = db.getMeta()
      if (meta?.vectorDims && meta.vectorDims !== system.embeddingProvider.dimensions) {
        console.log(`Embedding dimensions changed (${meta.vectorDims} -> ${system.embeddingProvider.dimensions}), rebuilding vector index...`)
        db.resetAllEmbeddings()
        meta.vectorDims = undefined
        db.setMeta(meta)
      }
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

        if (relativePath.startsWith('traces/') && relativePath.endsWith('.jsonl')) {
          // Debounce: reset timer on every change, sync after pause
          if (system.syncDebounceTimer) clearTimeout(system.syncDebounceTimer)
          system.syncDebounceTimer = setTimeout(() => {
            system.syncDebounceTimer = null
            logger.info('Memory: debounce sync triggered')
            system.syncTasks().catch((e) => logger.warn(`Memory: debounce sync failed: ${e}`))
          }, system.SYNC_DEBOUNCE_MS)
          system.dirty = true
          return
        }

        try {
          system.db.indexFile(absolutePath, relativePath)
          system.dirty = true
        } catch {}
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
      this.db.indexFile(entry.path, relativePath)
      indexedPaths.delete(relativePath)
    }

    // Remove stale entries (files that no longer exist)
    for (const stalePath of indexedPaths) {
      this.db.removeFile(stalePath)
    }

    await this.syncTasks()

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

    return entries
  }

  private async syncTasks(): Promise<void> {
    const tracesDir = path.join(this.dataDir, 'traces')
    const jsonlFiles = listTaskFiles(tracesDir)
    const indexedPaths = new Set(
      this.db.getIndexedPaths().filter(p => p.startsWith('traces/') && p.endsWith('.jsonl'))
    )

    for (const absPath of jsonlFiles) {
      const relativePath = path.relative(this.dataDir, absPath)
      const compressor = this.memoryAgent
        ? this.memoryAgent.compressToolCalls.bind(this.memoryAgent)
        : undefined
      const prevState = this.taskStates.get(absPath)
      const { entry, state } = await buildTaskEntry(absPath, compressor, prevState)
      this.taskStates.set(absPath, state)
      if (!entry) {
        indexedPaths.delete(relativePath)
        continue
      }
      this.db.indexTaskEntry(entry)
      indexedPaths.delete(relativePath)
    }

    for (const stalePath of indexedPaths) {
      this.db.removeFile(stalePath)
    }
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
      this.providerKey,
      chunks.map(c => c.hash)
    )

    const uncached: Array<{ id: string; hash: string; content: string; path: string }> = []
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
      let embeddings: number[][]

      if (this.embeddingProvider.multimodal && this.embeddingProvider.embedMultimodal) {
        // Multimodal path: extract images from markdown, build MultimodalInput
        const inputs = uncached.map(c => this.extractImages(c.content, c.path))
        embeddings = await this.embeddingProvider.embedMultimodal(inputs)
      } else {
        // Text-only path
        const texts = uncached.map(c => c.content)
        embeddings = await this.embeddingProvider.embedBatch(texts)
      }

      const cacheEntries: EmbeddingCacheEntry[] = []
      for (let i = 0; i < uncached.length; i++) {
        this.db.updateChunkEmbedding(uncached[i].id, embeddings[i], this.embeddingProvider.model)
        cacheEntries.push({
          provider: this.embeddingProvider.id,
          model: this.embeddingProvider.model,
          providerKey: this.providerKey,
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

  // Extract image references from markdown content and read them as base64
  private extractImages(content: string, chunkPath: string): MultimodalInput {
    const images: string[] = []
    const text = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, imgPath: string) => {
      const resolved = this.resolveImagePath(imgPath, chunkPath)
      if (resolved && fs.existsSync(resolved)) {
        try {
          const ext = path.extname(resolved).slice(1).toLowerCase() || 'png'
          const mime = ext === 'jpg' ? 'jpeg' : ext
          const b64 = fs.readFileSync(resolved).toString('base64')
          images.push(`data:image/${mime};base64,${b64}`)
        } catch {
          // File read failed, skip this image
        }
      }
      return alt || ''
    })
    return { text: text.trim(), images: images.length > 0 ? images : undefined }
  }

  // Resolve a relative image path from a markdown file to an absolute path
  private resolveImagePath(imgPath: string, chunkPath: string): string | null {
    if (imgPath.startsWith('data:') || imgPath.startsWith('http')) return null
    const fileDir = path.dirname(path.join(this.dataDir, chunkPath))
    return path.resolve(fileDir, imgPath)
  }

  // Get system status
  status(): { files: number; chunks: number; dirty: boolean; embeddingsReady: boolean } {
    const dbStatus = this.db.status()
    return { ...dbStatus, dirty: this.dirty, embeddingsReady: this.embeddingProvider !== null }
  }

  // Compute a stable key from provider config to isolate embedding caches across different API endpoints
  private computeProviderKey(keys: KeyConfig): string {
    if (!this.embeddingProvider) return ''
    const providerName = keys.memory?.embeddingProvider ?? ''
    const providerConfig = keys[providerName] as Record<string, unknown> | undefined
    const raw = JSON.stringify({
      provider: this.embeddingProvider.id,
      model: this.embeddingProvider.model,
      baseUrl: providerConfig?.baseUrl ?? '',
      apiType: providerConfig?.apiType ?? '',
    })
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)
  }

  // Clean shutdown
  async close(): Promise<void> {
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer)
      this.syncDebounceTimer = null
    }
    logger.info('Memory: final sync before close...')
    await this.syncTasks().catch((e) => logger.warn(`Memory: final sync failed: ${e}`))
    logger.info('Memory: closed')
    this.watcher.close()
    this.db.close()
  }
}
