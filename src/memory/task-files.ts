import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

export interface ToolCallEntry {
  name: string
  arguments: Record<string, unknown>
}

export interface TaskFileEntry {
  path: string        // relative to dataDir: "traces/{sessionId}.jsonl"
  absPath: string
  mtimeMs: number
  size: number
  hash: string        // SHA-256 of content + lineMap
  content: string     // "User: xxx\nAssistant: xxx\n[Actions: compressed summary]\n..."
  lineMap: number[]   // maps content lines to JSONL source lines
}

/** Incremental processing state for buildTaskEntry */
export interface IncrementalState {
  processedLines: number        // number of raw JSONL lines already processed
  outputLines: string[]         // accumulated output lines
  lineMap: number[]             // accumulated line map
  pendingToolCalls: ToolCallEntry[]  // tool calls not yet flushed at boundary
}

interface JsonlMessage {
  role: string
  content?: string | Array<{ type: string; text?: string }>
  images?: Array<{ name?: string; path?: string }>
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
}

interface JsonlRecord {
  type: string
  message?: JsonlMessage
}

export function extractMessageText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const block of content) {
      if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
        const t = block.text.trim()
        if (t) texts.push(t)
      }
    }
    return texts.length > 0 ? texts.join('\n') : null
  }
  return null
}

export interface BuildTaskResult {
  entry: TaskFileEntry | null
  state: IncrementalState
}

export async function buildTaskEntry(
  absPath: string,
  compressor?: (toolCalls: ToolCallEntry[]) => Promise<string>,
  prevState?: IncrementalState
): Promise<BuildTaskResult> {
  const emptyState: IncrementalState = { processedLines: 0, outputLines: [], lineMap: [], pendingToolCalls: [] }

  if (!fs.existsSync(absPath)) return { entry: null, state: emptyState }

  const raw = fs.readFileSync(absPath, 'utf-8')
  const stat = fs.statSync(absPath)
  const lines = raw.split('\n').filter(l => l.trim())

  if (lines.length === 0) return { entry: null, state: emptyState }

  // Determine start point: resume from previous state or start fresh
  let startLine = 0
  let outputLines: string[] = []
  let lineMap: number[] = []
  let pendingToolCalls: ToolCallEntry[] = []

  if (prevState && prevState.processedLines <= lines.length) {
    // Resume from previous state
    startLine = prevState.processedLines
    outputLines = [...prevState.outputLines]
    lineMap = [...prevState.lineMap]
    pendingToolCalls = [...prevState.pendingToolCalls]
  }
  // If prevState.processedLines > lines.length, file was truncated — reprocess from scratch

  // Nothing new to process
  if (startLine >= lines.length) {
    if (outputLines.length === 0) return { entry: null, state: prevState ?? emptyState }
    const content = outputLines.join('\n')
    const hashInput = content + '\n' + JSON.stringify(lineMap)
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex')
    const dataDir = path.resolve(absPath, '..', '..')
    const relativePath = path.relative(dataDir, absPath)
    return {
      entry: { path: relativePath, absPath, mtimeMs: stat.mtimeMs, size: stat.size, hash, content, lineMap },
      state: prevState ?? emptyState,
    }
  }

  async function flushToolCalls(): Promise<void> {
    if (pendingToolCalls.length === 0) return
    const calls = pendingToolCalls
    pendingToolCalls = []

    if (compressor) {
      try {
        const summary = await compressor(calls)
        outputLines.push(`[Actions: ${summary}]`)
        lineMap.push(-1)
      } catch {
        for (const tc of calls) {
          outputLines.push(`[Tool: ${tc.name}]`)
          lineMap.push(-1)
        }
      }
    } else {
      for (const tc of calls) {
        outputLines.push(`[Tool: ${tc.name}]`)
        lineMap.push(-1)
      }
    }
  }

  for (let i = startLine; i < lines.length; i++) {
    let record: JsonlRecord
    try {
      record = JSON.parse(lines[i])
    } catch {
      continue
    }

    if (record.type !== 'message' || !record.message) continue
    const msg = record.message

    if (msg.role === 'system') continue

    if (msg.role === 'user' || msg.role === 'computer') {
      await flushToolCalls()
      if (msg.role === 'user') {
        const text = extractMessageText(msg.content)
        if (text) {
          outputLines.push(`User: ${text}`)
          lineMap.push(i)
        }
      }
    } else if (msg.role === 'assistant') {
      const text = extractMessageText(msg.content)

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          pendingToolCalls.push({ name: tc.name, arguments: tc.arguments })
        }
      }

      if (text) {
        await flushToolCalls()
        outputLines.push(`Assistant: ${text}`)
        lineMap.push(i)
      }
    }
  }

  // Flush remaining tool calls
  await flushToolCalls()

  // Build new state
  const newState: IncrementalState = {
    processedLines: lines.length,
    outputLines: [...outputLines],
    lineMap: [...lineMap],
    pendingToolCalls: [...pendingToolCalls],
  }

  if (outputLines.length === 0) return { entry: null, state: newState }

  const content = outputLines.join('\n')
  const hashInput = content + '\n' + JSON.stringify(lineMap)
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex')

  const dataDir = path.resolve(absPath, '..', '..')
  const relativePath = path.relative(dataDir, absPath)

  return {
    entry: { path: relativePath, absPath, mtimeMs: stat.mtimeMs, size: stat.size, hash, content, lineMap },
    state: newState,
  }
}

export function listTaskFiles(tracesDir: string): string[] {
  if (!fs.existsSync(tracesDir)) return []
  return fs.readdirSync(tracesDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(tracesDir, f))
}
