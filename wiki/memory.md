# Memory System

## Overview

Memory 系统是 Jarvis 的长期记忆层，负责将会话历史、用户偏好、学习笔记等非结构化文本（含图片）索引为可搜索的知识库。核心设计：双源索引 + 混合搜索 + 主动写入。

系统采用双源架构：
- `source: "memory"` -- 策划型记忆（MEMORY.md + 每日日志），由 Agent 通过 `memory_write` 工具主动写入
- `source: "tasks"` -- 任务执行记录（JSONL trace），由 Memory Agent 压缩工具调用后自动索引

两个源共同参与混合搜索（BM25 + vector）。

## 文件结构

```
src/memory/
  index.ts          MemorySystem -- 主入口，编排同步/索引/搜索/embedding
  db.ts             MemoryDB -- SQLite 持久层 (better-sqlite3 + FTS5 + sqlite-vec)
  embedding.ts      Embedding 提供者 (OpenAI-compatible + Dashscope 多模态)
  chunker.ts        Markdown 分块器 (heading-aware, overlap)
  search.ts         混合搜索融合 (BM25 + vector weighted merge)
  watcher.ts        Chokidar 文件监听，实时重索引
  task-files.ts     JSONL trace 解析器，将 trace 转为干净文本
  memory-agent.ts   LLM 压缩器，将工具调用序列压缩为自然语言摘要
  types.ts          类型定义
```

外部集成：
```
src/agent/tools/memory.ts   memory_search / memory_read / memory_write 工具
src/utils/trace.ts          TraceLogger，双格式输出 (JSONL + MD)
src/agent/Agent.ts          Autonomous mode + memory flush triggers
```

## 数据目录

```
data/
  MEMORY.md                    source: "memory"   (策划型持久记忆)
  memory-index.db              SQLite 数据库 (FTS5 + vec0)
  memory/
    2026-02-12.md              source: "memory"   (每日记忆日志)
    assets/                    图片资源
    screenshots/               按日期分目录的截图
    steps/                     按日期分目录的步骤 JSON
  traces/
    {sessionId}.jsonl          source: "tasks"    (机器可解析，被索引)
    {sessionId}.md             不索引 (人类可读)
```

索引两个来源：
1. `data/MEMORY.md` + `data/memory/*.md` -- source: "memory"，策划型记忆
2. `data/traces/*.jsonl` -- source: "tasks"，经 Memory Agent 压缩后索引

## 双格式 Trace

`TraceLogger` 同时输出两种格式：

**JSONL** (append-only，机器可解析，用于索引)：
```jsonl
{"type":"message","message":{"role":"system","content":"..."}}
{"type":"message","message":{"role":"user","content":"...","images":[{"name":"screen","path":"..."}]}}
{"type":"message","message":{"role":"assistant","content":"...","toolCalls":[{"name":"click","arguments":{...}}]}}
```

**MD** (全量重写，人类可读，不索引)：
```markdown
## SYSTEM
...
---
## USER
...
---
## ASSISTANT
...
```

## Task Trace 解析 (task-files.ts)

`buildTaskEntry()` 将 JSONL trace 转为干净的索引文本：

1. 逐行解析 JSONL，过滤 `type === "message"`
2. 跳过 `system` 消息，提取 `user` 和 `assistant` 角色
3. 文本内容：归一化空白，从 content 数组中提取文本块
4. 工具调用：收集连续的 toolCalls 序列，批量处理：
   - 有 compressor（Memory Agent）：`[Actions: {压缩摘要}]`
   - 无 compressor（降级）：`[Tool: {name}]` 逐条列出
5. 输出格式：`User: xxx\nAssistant: xxx\n[Actions: compressed summary]\n...`
6. hash 包含 content + lineMap，用于变更检测

## Memory Agent (memory-agent.ts)

LLM 压缩器，将冗长的工具调用序列压缩为语义文本摘要。

```typescript
class MemoryAgent {
  constructor(config: MemoryAgentConfig, keys: KeyConfig)
  async compressToolCalls(toolCalls: ToolCallEntry[]): Promise<string>
}
```

压缩 prompt：
```
You are a memory compression agent. Summarize this sequence of tool calls into a concise
natural language description. Preserve semantic intent (not raw coordinates), outcomes,
and key identifiers (file paths, URLs, app names). One paragraph, no bullets.
```

使用 `createProvider()` 工厂创建 LLM，provider/model 从 `keys.memory.memoryAgent` 配置读取。压缩在 `syncTasks()` 期间同步执行。

## 初始化流程

```
Agent.constructor
  -> MemorySystem.create(dataDir, keys)
     1. 确保 data/memory/ 和 data/memory/assets/ 目录存在
     2. 打开 SQLite DB (data/memory-index.db)
     3. 创建 embedding provider (根据 keys.memory.embeddingProvider)
     4. 创建 Memory Agent (根据 keys.memory.memoryAgent，可选)
     5. 检测 embedding 维度变更 -> 如果变了，resetAllEmbeddings() 重建
     6. sync():
        a. 扫描 memory 文件 (MEMORY.md + memory/*.md)，索引新增/变更，source="memory"
        b. syncTasks(): 扫描 traces/*.jsonl，经 Memory Agent 压缩后索引，source="tasks"
     7. generateEmbeddings() -- 为缺少 embedding 的 chunk 批量生成向量
     8. 启动 MemoryWatcher (chokidar) 监听文件变更
  -> setMemorySystem(memorySystem)  // 注入到 memory tools 模块
```

## 数据库 Schema

```sql
-- 元数据 (IndexMeta: model, provider, chunkTokens, chunkOverlap, vectorDims)
meta (key TEXT PK, value TEXT)

-- 已索引文件
files (path TEXT PK, source TEXT, hash TEXT, mtime INTEGER, size INTEGER)

-- 内容分块
chunks (
  id TEXT PK,           -- "relativePath:chunkIndex"
  path TEXT FK->files,  -- 相对路径
  source TEXT,          -- 'memory' | 'tasks'
  chunk_index INTEGER,
  start_line INTEGER,
  end_line INTEGER,
  heading TEXT,         -- 所属 ## 标题
  hash TEXT,            -- 内容 SHA-256
  model TEXT,           -- embedding model 名称
  content TEXT,
  embedding TEXT,       -- JSON 数组 (冗余存储，兼容无 vec0 场景)
  updated_at INTEGER
)

-- FTS5 全文搜索索引 (手动同步，无 trigger)
chunks_fts USING fts5(content, heading, id UNINDEXED, path UNINDEXED, source UNINDEXED, ...)

-- sqlite-vec 向量索引 (懒创建，首次生成 embedding 时建表)
chunks_vec USING vec0(chunk_id TEXT PK, embedding FLOAT[dims])

-- Embedding 缓存 (避免重复计算)
embedding_cache (provider TEXT, model TEXT, hash TEXT, embedding TEXT, dims INTEGER, updated_at INTEGER)
  PK: (provider, model, hash)
```

## 源分离

`indexFile()` 接受 `source` 参数（默认 `'memory'`），memory 文件和 task 文件分别标记。

`indexTaskEntry()` 专用于 task trace 索引：
- 接受预解析的 `TaskFileEntry`（content 已经过 Memory Agent 压缩）
- 使用标准 chunker 分块
- 固定 `source = 'tasks'`
- 通过 hash 检测变更，避免重复索引

搜索结果（BM25 / Vector）均返回 `source` 字段，调用方可区分结果来源。

## Markdown 分块

`chunkMarkdown(content, options)` 将 markdown 拆分为 `Chunk[]`：

- 默认 `maxChars = 1600` (~400 tokens)，`overlapChars = 320` (~80 tokens)
- 跳过 YAML frontmatter
- 按 `## ` 标题切分 -- 每个标题开始新 section，标题间无 overlap
- section 内超长时按 `\n\n`（段落）切分
- overlap：前一个 chunk 的尾部行带入下一个 chunk

## Embedding 系统

### Provider 接口

```typescript
interface EmbeddingProvider {
  readonly id: string
  readonly model: string
  readonly dimensions: number
  readonly maxInputTokens: number
  readonly multimodal?: boolean
  embedQuery(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  embedMultimodal?(inputs: MultimodalInput[]): Promise<number[][]>
}
```

### 两个实现

| Provider | API 格式 | 多模态 | 默认模型 | 维度 |
|----------|---------|--------|---------|------|
| `OpenAIEmbeddingProvider` | OpenAI-compatible (`/embeddings`) | 否 | text-embedding-3-small | 1536 |
| `DashscopeEmbeddingProvider` | Dashscope 原生 API | 是 | qwen3-vl-embedding | 1024 |

### Dashscope 多模态 API

```
POST https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding

Request:
{
  "model": "qwen3-vl-embedding",
  "input": {
    "contents": [
      {"text": "描述"},
      {"text": "描述", "image": "data:image/png;base64,..."}
    ]
  },
  "parameters": {"dimension": 1024}
}

Response:
{
  "output": {
    "embeddings": [
      {"index": 0, "embedding": [...], "type": "text"},
      {"index": 1, "embedding": [...], "type": "fusion"}
    ]
  }
}
```

### Embedding 生成流程

```
generateEmbeddings()
  1. db.getChunksForEmbedding() -- 获取缺少 embedding 的 chunk (含 path)
  2. 查 embedding_cache -- 按内容 hash 命中缓存，直接复用
  3. 未命中的 chunk:
     - 多模态 provider: extractImages() 从 markdown ![alt](path) 提取图片为 base64
       -> embedMultimodal(inputs)
     - 纯文本 provider: embedBatch(texts)
  4. 写入 chunks 表 + chunks_vec 表
  5. 写入 embedding_cache
  6. 首次生成时创建 chunks_vec 表
```

### 维度变更处理

`MemorySystem.create()` 检测 `meta.vectorDims !== provider.dimensions`，如果不同：
- `db.resetAllEmbeddings()` -- 清空所有 chunk embedding，drop vec0 表
- 重新 `generateEmbeddings()` 全量重建

### 重试策略

- 最多 3 次重试
- 指数退避：500ms -> 1s -> 2s（上限 8s）
- 20% 随机 jitter
- 可重试条件：HTTP 429/5xx，网络错误 (fetch/ECONNRESET/ETIMEDOUT/socket/abort)

## 搜索架构

### BM25 搜索 (`db.searchBM25`)

1. FTS5 `MATCH` 查询，token 用 AND 连接，`bm25()` 排序
2. FTS5 失败时（如 CJK 文本）降级为 `LIKE` 搜索
3. 分数归一化：FTS5 `1/(1+|rank|)`，LIKE `0.5/(1+i)`
4. 结果包含 `source` 字段

### 向量搜索 (`db.searchVector`)

1. 查询文本 -> embedding -> Float32 buffer
2. `chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
3. L2 距离转相似度：`1/(1+distance)`
4. 结果包含 `source` 字段

### 混合搜索 (`search.ts mergeHybridResults`)

```
最终分数 = vectorWeight * vectorScore + textWeight * textScore
默认权重: vector 0.7, text 0.3
最低分数: 0.35
最大结果: 6
```

按 `path:startLine` 去重，两个来源的分数加权合并。memory 和 tasks 两个 source 的结果统一参与排序。

## 文件监听 (`watcher.ts`)

Chokidar 监听三个路径：
- `data/MEMORY.md`
- `data/memory/*.md`
- `data/traces/*.jsonl`

配置：`ignoreInitial: true`，`awaitWriteFinish` 稳定阈值 1500ms。

Trace JSONL 文件有增量阈值：文件增长 >= 100KB 才触发 `syncTasks()` 重新索引（`DELTA_BYTES_THRESHOLD = 100_000`），避免会话进行中频繁重索引。

Memory 文件（MEMORY.md, memory/*.md）变更时直接调用 `indexFile()` 重索引。

## Agent 集成

### 自动记忆搜索

Agent 每次接收新任务时，自动执行一次 `memorySystem.search(currentTask, 3)`，将结果注入 system prompt 的 `## Relevant Memories` 部分。通过 `memorySearchedForTask` 标记避免重复搜索。

### 记忆刷新触发

三个触发点：

1. **Task clear** -- 当 `recordTask(content="")` 清除任务时，注入系统提醒要求 Agent 通过 `memory_write` 保存学习成果
2. **maxSteps - 5** -- 接近步数上限时，注入系统提醒要求保存重要记忆
3. **memory_write 工具** -- Agent 可在任何时候主动写入记忆

### 记忆工具

| 工具 | 输入 | 行为 |
|------|------|------|
| `memory_search` | query, limit? | 有 embedding provider 时走混合搜索，否则 BM25 |
| `memory_read` | path, from?, lines? | 读取原始文件内容（路径白名单：MEMORY.md, memory/*.md, traces/*.{md,jsonl}） |
| `memory_write` | content, file? | 写入记忆：file="MEMORY.md" 写持久笔记，省略则写每日日志 |

### memory_write 行为

- 默认：追加到 `data/memory/{YYYY-MM-DD}.md`
- `file="MEMORY.md"`：追加到 `data/MEMORY.md`
- 自动添加时间戳标题：`### HH:MM`
- 文件监听器检测变更后自动重索引

### Autonomous Mode

Agent 完成任务后不再进入 idle-wait 轮询，而是进入 autonomous mode：

1. 任务完成（连续两轮无工具调用）-> 设置 `autonomous = true`
2. 同一个 ReAct 循环继续运行，但 computer prompt 注入 autonomous 上下文
3. Agent 自主决定行为：整理记忆、探索、学习、休息
4. 新消息到达时自动退出 autonomous mode，恢复正常任务处理

关键设计：autonomous mode 不是独立循环，而是同一个 ReAct 循环的不同上下文。一个循环，一条代码路径。

## 配置

```json
// config/config.json
{
  "qwen": {
    "apiKey": "...",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "apiType": "openai",
    "embedding": {
      "model": "qwen3-vl-embedding",
      "apiType": "dashscope",
      "dimensions": 1024
    }
  },
  "memory": {
    "embeddingProvider": "qwen",
    "memoryAgent": {
      "provider": "qwen",
      "model": "qwen-turbo"
    }
  }
}
```

- `embeddingProvider` -- 指向 `KeyConfig` 中的 provider 名称，从该 provider 的 `embedding` 字段读取模型配置
- `memoryAgent.provider` -- Memory Agent 使用的 LLM provider（用于压缩工具调用）
- `memoryAgent.model` -- 可选，覆盖 provider 默认模型（推荐用轻量模型如 qwen-turbo）
- LLM provider、embedding provider、memory agent 可以各自独立配置
- 不配置 `memoryAgent` 时，工具调用降级为 `[Tool: name]` 逐条列出（无压缩）
