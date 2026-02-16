import type { Tool } from '../../types.js'
import * as fs from 'fs'
import * as path from 'path'

// MemorySystem will be injected at runtime
let memorySystem: any = null

export function setMemorySystem(system: any): void {
  memorySystem = system
}

export function getMemorySystem(): any {
  return memorySystem
}

// memory_search tool
const memorySearchTool: Tool = {
  definition: {
    name: 'memory_search',
    description: 'Search your long-term memory for relevant past knowledge, preferences, and experiences. Returns matching chunks with snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - keywords or natural language describing what you are looking for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  async execute(args) {
    if (!memorySystem) {
      return { success: false, error: 'Memory system not initialized' }
    }
    const query = args.query as string
    const limit = (args.limit as number) || 5

    try {
      let results
      if (memorySystem.embeddingProvider) {
        const queryEmbedding = await memorySystem.embeddingProvider.embedQuery(query)
        results = await memorySystem.searchHybrid(query, queryEmbedding, { maxResults: limit })
      } else {
        results = await memorySystem.search(query, limit)
      }
      if (results.length === 0) {
        return {
          success: true,
          data: { results: [] },
          message: 'No matching memories found.',
        }
      }
      return {
        success: true,
        data: { results },
        message: `Found ${results.length} matching memories. Use memory_read to get full content.`,
      }
    } catch (error) {
      return { success: false, error: `Memory search failed: ${(error as Error).message}` }
    }
  },
}

// memory_read tool
const memoryReadTool: Tool = {
  definition: {
    name: 'memory_read',
    description: 'Read content from a memory file. Use after memory_search to get full context of a specific result.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the memory file (e.g. "MEMORY.md" or "memory/2026-02-12.md")',
        },
        from: {
          type: 'number',
          description: 'Start line number (1-indexed, default: 1)',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to read (default: all)',
        },
      },
      required: ['path'],
    },
  },
  async execute(args) {
    if (!memorySystem) {
      return { success: false, error: 'Memory system not initialized' }
    }
    const relPath = args.path as string
    const from = (args.from as number) || 1
    const lines = args.lines as number | undefined

    // Security: only allow MEMORY.md and memory/*.md
    if (!relPath.match(/^(MEMORY\.md|memory\/[^/]+\.md|traces\/[^/]+\.(md|jsonl))$/)) {
      return { success: false, error: 'Invalid path. Only MEMORY.md, memory/*.md, and traces/*.{md,jsonl} are allowed.' }
    }

    try {
      const content = memorySystem.readFile(relPath, from, lines)
      return {
        success: true,
        data: { path: relPath, from, content },
      }
    } catch (error) {
      return { success: false, error: `Memory read failed: ${(error as Error).message}` }
    }
  },
}

const memoryWriteTool: Tool = {
  definition: {
    name: 'memory_write',
    description: 'Write important information to long-term memory. Use for saving learnings, preferences, task outcomes, or any knowledge worth remembering.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Memory content to write (markdown format)',
        },
        file: {
          type: 'string',
          description: 'Target file: "MEMORY.md" for persistent notes, or omit for daily log',
        },
      },
      required: ['content'],
    },
  },
  async execute(args) {
    if (!memorySystem) {
      return { success: false, error: 'Memory system not initialized' }
    }
    const content = args.content as string
    const file = args.file as string | undefined

    try {
      const dataDir = memorySystem.dataDir || path.join(process.cwd(), 'data')
      const now = new Date()
      const timeHeader = `### ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      const block = `\n${timeHeader}\n\n${content}\n`

      let targetPath: string
      if (file === 'MEMORY.md') {
        targetPath = path.join(dataDir, 'MEMORY.md')
      } else {
        const dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`
        const memoryDir = path.join(dataDir, 'memory')
        if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true })
        targetPath = path.join(memoryDir, `${dateStr}.md`)
      }

      fs.appendFileSync(targetPath, block)
      const relPath = path.relative(dataDir, targetPath)
      return { success: true, message: `Written to ${relPath}` }
    } catch (error) {
      return { success: false, error: `Memory write failed: ${(error as Error).message}` }
    }
  },
}

export const memoryTools: Tool[] = [memorySearchTool, memoryReadTool, memoryWriteTool]
