# Memory System

## Overview

Memory 系统是 Jarvis 的长期记忆层，负责将会话历史、用户偏好、学习笔记等非结构化文本（含图片）索引为可搜索的知识库。核心设计：双源索引 + 混合搜索 + 主动写入。

系统采用双源架构：
- `source: "memory"` -- 策划型记忆（MEMORY.md + 每日日志），由 Agent 通过 `edit_file`/`write_file` 工具主动写入
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
src/agent/tools/memory.ts   memory_search / memory_read 工具
src/utils/trace.ts          TraceLogger，双格式输出 (JSONL + MD)
src/agent/Agent.ts          自动记忆检索 + 记忆刷新触发
```

---

## 1. 记忆什么时候创建

### 1.1 系统初始化时创建 MemorySystem

```
Agent.constructor()
  -> MemorySystem.create(config.dataDir, config.keys)
```

`MemorySystem.create()` 是唯一的创建入口，在 `Agent.ts:117-124` 中调用：

```typescript
this.memorySystem = await MemorySystem.create(config.dataDir, config.keys)
setMemorySystem(this.memorySystem)  // 注入到 memory tools 模块
```

创建过程：
1. 确保 `data/memory/` 和 `data/memory/assets/` 目录存在
2. 打开 SQLite DB (`data/memory-index.db`)，初始化 schema（含迁移逻辑）
3. 创建 embedding provider（根据 `config.keys.memory.embeddingProvider`）
4. 创建 Memory Agent（根据 `config.keys.memory.memoryAgent`，可选）
5. 计算 `providerKey`（基于 provider/model/baseUrl/apiType 的 SHA-256 前16位），用于隔离不同 API 端点的 embedding 缓存
6. 检测 embedding 维度变更 -> 如果变了，`resetAllEmbeddings()` 清空所有向量并重建
7. 执行首次 `sync()`（见下文"什么时候更新"）
8. `generateEmbeddings()` -- 为缺少 embedding 的 chunk 批量生成向量
9. 启动 `MemoryWatcher`（chokidar）监听文件变更

### 1.2 记忆内容的写入

记忆内容有两个来源：

**手动写入（Agent 通过 `edit_file`/`write_file` 工具）：**
- Agent 在任务执行过程中，通过文件操作工具写入
- 持久知识写入 `data/MEMORY.md`，保持 `##` 标题组织
- 每日日志追加到 `data/memory/{YYYY-MM-DD}.md`，添加 `### HH:MM` 时间戳
- 写入后文件监听器自动检测变更并重索引

**自动记录（Trace 系统）：**
- `TraceLogger` 在每轮 ReAct 循环中自动记录所有消息到 `data/traces/{sessionId}.jsonl`
- 这些 JSONL 文件由 `syncTasks()` 解析、压缩、索引

---

## 2. 记忆什么时候更新

### 2.1 初始化时全量同步

`MemorySystem.create()` 内部调用 `sync()`，执行一次全量同步：

```
sync() -> _doSync()
  1. listMemoryFiles(): 扫描 data/MEMORY.md + data/memory/*.md
  2. 对每个文件调用 db.indexFile()：
     - 读取文件内容，计算 SHA-256 hash
     - 与 DB 中已存储的 hash 比较，相同则跳过
     - 不同则：chunkMarkdown() 分块 -> 写入 chunks + chunks_fts + files 表
  3. 删除 DB 中存在但磁盘上已不存在的 stale 条目
  4. syncTasks(): 扫描 data/traces/*.jsonl，解析并索引（见 2.3）
```

### 2.2 运行时文件监听

`MemoryWatcher` 使用 chokidar 监听三个路径：
- `data/MEMORY.md`
- `data/memory/*.md`
- `data/traces/*.jsonl`

配置：`ignoreInitial: true`，`awaitWriteFinish` 稳定阈值 1500ms，`depth: 0`。

**Memory 文件变更（MEMORY.md, memory/*.md）：**
- 直接调用 `db.indexFile()` 重索引
- 标记 `dirty = true`

**Trace JSONL 文件变更：**
- 不立即索引，而是启动 5 秒 debounce 定时器
- 每次文件变更重置定时器，5 秒内无新变更才触发 `syncTasks()`
- 标记 `dirty = true`

### 2.3 Task Trace 增量同步

`syncTasks()` 处理 `data/traces/*.jsonl`：

```
syncTasks()
  for each .jsonl file:
    1. buildTaskEntry(absPath, compressor, prevState)
       - 增量解析：从 prevState.processedLines 开始，只处理新增行
       - 逐行解析 JSONL，过滤 type === "message"
       - 跳过 system 消息，提取 user 和 assistant 角色
       - 工具调用收集为连续序列，批量处理：
         * 有 Memory Agent: 调用 compressToolCalls() -> "[Actions: {压缩摘要}]"
         * 无 Memory Agent: 降级为 "[Tool: {name}]" 逐条列出
       - 输出格式: "User: xxx\nAssistant: xxx\n[Actions: compressed summary]\n..."
    2. db.indexTaskEntry(entry) -- 标准 chunker 分块，source="tasks"
    3. 保存 IncrementalState 供下次增量使用
  删除 DB 中存在但磁盘上已不存在的 stale 条目
```

### 2.4 Embedding 生成

`generateEmbeddings()` 在初始化时调用一次，为所有缺少 embedding 的 chunk 生成向量：

```
generateEmbeddings()
  1. db.getChunksForEmbedding() -- 获取 embedding = '[]' 的 chunk
  2. 查 embedding_cache -- 按 (provider, model, providerKey, hash) 命中缓存，直接复用
  3. 未命中的 chunk:
     - 多模态 provider: extractImages() 从 markdown ![alt](path) 提取图片为 base64
       -> embedMultimodal(inputs)  [120s 超时]
     - 纯文本 provider: embedBatch(texts)  [120s 超时]
  4. 写入 chunks 表 (embedding + model) + chunks_vec 表 (Float32 buffer)
  5. 写入 embedding_cache（含 providerKey 隔离）
  6. 首次生成时更新 IndexMeta.vectorDims 并创建 chunks_vec 表
```

---

## 3. 保存到哪里

### 3.1 磁盘文件

```
data/
  MEMORY.md                    source: "memory"   策划型持久记忆
  memory-index.db              SQLite 数据库 (FTS5 + vec0)
  memory/
    2026-02-12.md              source: "memory"   每日记忆日志
    assets/                    图片资源（截图引用）
  traces/
    {sessionId}.jsonl          source: "tasks"    机器可解析，被索引
    {sessionId}.md             不索引（人类可读）
```

### 3.2 数据库 Schema

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
  embedding TEXT,       -- JSON 数组（冗余存储，兼容无 vec0 场景）
  updated_at INTEGER
)

-- FTS5 全文搜索索引（手动同步，无 trigger）
chunks_fts USING fts5(content, heading, id UNINDEXED, path UNINDEXED, source UNINDEXED, ...)

-- sqlite-vec 向量索引（懒创建，首次生成 embedding 时建表）
chunks_vec USING vec0(chunk_id TEXT PK, embedding FLOAT[dims])

-- Embedding 缓存（避免重复计算，providerKey 隔离不同 API 端点）
embedding_cache (
  provider TEXT, model TEXT, provider_key TEXT, hash TEXT,
  embedding TEXT, dims INTEGER, updated_at INTEGER
)
  PK: (provider, model, provider_key, hash)
```

### 3.3 Markdown 分块规则

`chunkMarkdown(content, options)` 将 markdown 拆分为 `Chunk[]`：

- 默认 `maxChars = 1600`（~400 tokens），`overlapChars = 320`（~80 tokens）
- 跳过 YAML frontmatter
- 按 `## ` 标题切分 -- 每个标题开始新 section，标题间无 overlap
- section 内超长时按 `\n\n`（段落）切分
- overlap：前一个 chunk 的尾部行带入下一个 chunk（同 section 内）

---

## 4. 什么时候检索

### 4.1 自动检索（Agent.ts:359-393）

每轮 ReAct 循环构建 computer 消息时，自动触发记忆检索。两个触发条件：

**条件 A：新任务**
```typescript
if (this.currentTask && this.currentTask !== '(none)' && this.memorySearchedForTask !== this.currentTask) {
  this.memorySearchedForTask = this.currentTask
  memoryQuery = this.currentTask
}
```
- 当 `currentTask` 变更时触发一次
- 用 `memorySearchedForTask` 标记避免同一任务重复搜索
- 查询内容 = 任务描述文本

**条件 B：用户消息**
```typescript
if (hasUserMessage && userMessageText) {
  memoryQuery = userMessageText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
```
- 每次收到用户消息都触发
- 查询内容 = 用户消息文本（去除 XML 标签）
- 如果同时满足条件 A 和 B，B 会覆盖 A 的 query

### 4.2 手动检索（memory_search 工具）

Agent 在任务执行过程中可随时调用 `memory_search` 工具主动搜索：

```typescript
// src/agent/tools/memory.ts
if (memorySystem.embeddingProvider) {
  const queryEmbedding = await memorySystem.embeddingProvider.embedQuery(query)
  results = await memorySystem.searchHybrid(query, queryEmbedding, { maxResults: limit })
} else {
  results = await memorySystem.search(query, limit)  // 纯 BM25
}
```

---

## 5. 检索的方式

### 5.1 混合搜索流程

自动检索和手动检索都走同一条路径：

```
1. 如果有 embeddingProvider:
   a. embedQuery(memoryQuery) -- 将查询文本转为向量 [60s 超时]
   b. searchHybrid(query, queryEmbedding, options)
2. 如果没有 embeddingProvider:
   a. search(query, limit) -- 纯 BM25
```

### 5.2 searchHybrid 内部流程

```
searchHybrid(query, queryEmbedding, options)
  1. 如果 dirty，先 sync() 确保索引最新
  2. candidates = min(200, maxResults * candidateMultiplier)  // 默认 6*4=24
  3. keywordResults = db.searchBM25(query, candidates)
  4. 如果 queryEmbedding 为 null，直接返回 keyword 结果（过滤 minScore）
  5. vectorResults = db.searchVector(queryEmbedding, candidates)
  6. mergeHybridResults(vectorResults, keywordResults, options)
```

### 5.3 BM25 搜索（db.searchBM25）

```
searchBM25(query, limit)
  1. 分词：按空白切分 query
  2. 构建 FTS5 查询：每个 token 用双引号包裹，AND 连接
     例: "打开" AND "微信"
  3. 执行 FTS5 MATCH 查询，bm25() 排序
  4. 如果 FTS5 失败（如 CJK 分词问题）或无结果：
     降级为 LIKE 搜索：WHERE content LIKE '%token1%' AND content LIKE '%token2%'
  5. 分数归一化：
     - FTS5: 1 / (1 + |rank|)
     - LIKE: 0.5 / (1 + i)  （按位置递减）
  6. snippet 截断到 300 字符
```

### 5.4 向量搜索（db.searchVector）

```
searchVector(queryEmbedding, limit)
  1. 检查 chunks_vec 表是否存在，不存在则返回空（降级为纯 BM25）
  2. 将查询向量转为 Float32Array -> Buffer
  3. 精确余弦距离搜索（全表扫描，非 ANN 近似）：
     SELECT c.*, vec_distance_cosine(v.embedding, ?) AS dist
     FROM chunks_vec v JOIN chunks c ON c.id = v.chunk_id
     ORDER BY dist ASC LIMIT ?
  4. 分数转换：score = 1 - dist  （dist 越小越相似，score 越高越好）
```

注意：使用 `vec_distance_cosine()` 函数做精确计算（全表扫描），而非 `MATCH` 的 ANN 近似搜索。对于记忆系统的数据规模（通常几百到几千 chunk），精确搜索既快又准。

### 5.5 混合融合（search.ts mergeHybridResults）

```
mergeHybridResults(vectorResults, keywordResults, options)
  1. 权重归一化：vw = 0.7/1.0 = 0.7, tw = 0.3/1.0 = 0.3
  2. 按 "path:startLine" 去重合并：
     - 同时出现在两个结果中的 chunk：finalScore = 0.7 * vectorScore + 0.3 * textScore
     - 只出现在 vector 中：finalScore = 0.7 * vectorScore + 0.3 * 0
     - 只出现在 keyword 中：finalScore = 0.7 * 0 + 0.3 * textScore
  3. 过滤 finalScore < minScore (0.35)
  4. snippet 截断到 snippetMaxChars (700) 字符（安全处理 surrogate pair）
  5. 按 score 降序排序，取 top maxResults (6) 条
```

默认参数：
```typescript
{
  vectorWeight: 0.7,    // 向量搜索权重
  textWeight: 0.3,      // BM25 文本搜索权重
  minScore: 0.35,       // 最低分数阈值
  maxResults: 6,        // 最大返回结果数
  snippetMaxChars: 700, // snippet 最大字符数
  candidateMultiplier: 4 // 候选倍数
}
```

---

## 6. 检索结果怎么使用

### 6.1 自动检索结果的格式化

Agent.ts:383-388 将搜索结果格式化为 markdown：

```typescript
if (results.length > 0) {
  memoriesText = '## Relevant Memories\n\n' + results.map(r => {
    const loc = r.heading ? `${r.path} > ${r.heading}` : r.path
    return `- [${loc}] (line ${r.startLine}): ${r.snippet}`
  }).join('\n')
}
```

实际输出示例：
```markdown
## Relevant Memories

- [MEMORY.md > User Preferences] (line 5): 用户偏好使用中文交流，喜欢简洁的回复风格...
- [memory/2026-02-15.md > WeChat Automation] (line 12): 发现微信窗口需要先点击激活再操作...
- [traces/2026-02-16T10-30-00.jsonl:3] (line 45): User: 帮我打开微信发消息给张三 Assistant: 好的...
```

### 6.2 手动检索结果

`memory_search` 工具返回原始 `SearchResult[]`，Agent 可以进一步调用 `memory_read` 获取完整内容：

```typescript
// SearchResult 结构
{
  path: string,           // 相对路径
  source: 'memory' | 'tasks',
  heading: string | null, // 所属标题
  snippet: string,        // 截断的内容片段
  startLine: number,
  endLine: number,
  score: number           // 0-1 归一化分数
}
```

---

## 7. 最终结果放到 prompt 的哪里

### 7.1 Prompt 模板

记忆注入到 `prompts/user.md` 模板中的 `{{memories}}` 占位符：

```markdown
## Current Task

{{task}}

## TODO List

{{todoSummary}}

## Recent Actions

{{recentSteps}}

{{screenStatus}}

{{memories}}          <-- 记忆检索结果注入位置

---

Analyze the current situation and respond appropriately:
...
```

### 7.2 注入流程

```
Agent.ts ReAct 循环每轮:
  1. 构建 memoryQuery（新任务 or 用户消息）
  2. embeddingProvider.embedQuery(memoryQuery)  -> queryEmbedding
  3. memorySystem.searchHybrid(memoryQuery, queryEmbedding, { maxResults: 3 })
  4. 格式化为 memoriesText（"## Relevant Memories\n\n- [loc]: snippet\n..."）
  5. fillTemplate(computerTemplate, { ..., memories: memoriesText })
     -> {{memories}} 被替换为实际内容
  6. computerContent 作为 role="computer" 消息发送给 LLM
```

注意：自动检索时 `maxResults: 3`，手动 `memory_search` 默认 `maxResults: 5`。

### 7.3 消息角色

记忆内容嵌入在 `computer` 角色的消息中，与屏幕状态、最近操作、TODO 列表等信息一起发送。这是 ReAct 循环中"Observe"阶段的一部分。

消息序列示例：
```
[system]  系统 prompt（含 memory.md 中的记忆使用指南）
[user]    用户消息（如果有）
[computer] ## Current Task
           打开微信发消息给张三
           ## TODO List
           ...
           ## Recent Actions
           ...
           ## Relevant Memories          <-- 这里
           - [MEMORY.md > Contacts] (line 3): 张三的微信备注名是"张三-同事"...
           ---
           Analyze the current situation...
```

---

## 8. 记忆刷新触发

Agent 在三个时机提醒自己保存记忆：

### 8.1 任务清除时

当 `recordTask(content="")` 清除当前任务时（Agent.ts:679-686）：

```
<reminder>TASK CLEARED -- The current task has been completed and cleared.
If you learned anything important during this task (user preferences, useful techniques,
task outcomes, errors encountered), save them now using memory_write before the context fades.</reminder>
```

### 8.2 接近步数上限时

当 `stepCount === maxSteps - 5` 时（Agent.ts:726-734）：

```
<reminder>MEMORY FLUSH -- You are approaching the step limit (N/M).
If you have learned anything important during this session (user preferences, useful techniques,
task outcomes), write them to data/MEMORY.md or data/memory/ NOW using write_file/edit_file.
This context will be lost after the session ends.</reminder>
```

### 8.3 Autonomous Mode

任务完成后进入 autonomous mode，computer prompt 注入提示 Agent 可以主动整理记忆：

```
## Autonomous Mode
No pending tasks. You are free to:
- Review and organize your memories (memory_search, edit_file)
- Explore interesting topics on the computer
...
```

---

## 9. Memory Agent

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

工作时机：`syncTasks()` 解析 JSONL trace 时，遇到连续工具调用序列，调用 `compressToolCalls()` 压缩。

配置：
```json
"memory": {
  "memoryAgent": {
    "provider": "qwen",
    "model": "qwen-plus"
  }
}
```

不配置 `memoryAgent` 时，工具调用降级为 `[Tool: name]` 逐条列出（无压缩）。

---

## 10. Embedding 系统

### Provider 接口

```typescript
interface EmbeddingProvider {
  readonly id: string
  readonly model: string
  readonly dimensions: number
  readonly maxInputTokens: number
  readonly multimodal?: boolean
  embedQuery(text: string): Promise<number[]>       // 60s 超时
  embedBatch(texts: string[]): Promise<number[][]>  // 120s 超时
  embedMultimodal?(inputs: MultimodalInput[]): Promise<number[][]>  // 120s 超时
}
```

### 两个实现

| Provider | API 格式 | 多模态 | 默认模型 | 维度 |
|----------|---------|--------|---------|------|
| `OpenAIEmbeddingProvider` | OpenAI-compatible (`/embeddings`) | 否 | text-embedding-3-small | 1536 |
| `DashscopeEmbeddingProvider` | Dashscope 原生 API | 是 | qwen3-vl-embedding | 1024 |

### 重试策略

- 最多 3 次重试
- 指数退避：500ms -> 1s -> 2s（上限 8s）
- 20% 随机 jitter
- 可重试条件：HTTP 429/5xx，网络错误 (fetch/ECONNRESET/ETIMEDOUT/socket/abort)

### providerKey 隔离

不同 API 端点（如 openai 官方 vs 代理）生成的 embedding 不兼容。`providerKey` 基于 `{provider, model, baseUrl, apiType}` 的 SHA-256 前 16 位，作为 embedding_cache 主键的一部分，确保缓存不会跨端点污染。

---

## 11. 配置

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
      "model": "qwen-plus"
    }
  }
}
```

- `embeddingProvider` -- 指向 `KeyConfig` 中的 provider 名称，从该 provider 的 `embedding` 字段读取模型配置
- `memoryAgent.provider` -- Memory Agent 使用的 LLM provider（用于压缩工具调用）
- `memoryAgent.model` -- 可选，覆盖 provider 默认模型
- LLM provider、embedding provider、memory agent 可以各自独立配置

---

## 12. 完整数据流图

```
                    写入                              索引
  Agent ──edit_file/write_file──> data/MEMORY.md ──────────> MemoryDB
                          data/memory/*.md ────────>   |
                                                       |  chunkMarkdown()
  TraceLogger ────────> data/traces/*.jsonl            |  -> chunks + chunks_fts
                          |                            |
                          | buildTaskEntry()           |
                          | + MemoryAgent.compress()   |
                          v                            |
                        TaskFileEntry ────────────────>|
                                                       |
                                                       v
                                              generateEmbeddings()
                                                       |
                                              embedding_cache (hit?)
                                                  |         |
                                                 yes        no
                                                  |         |
                                                  |    EmbeddingProvider
                                                  |    .embedBatch()
                                                  |         |
                                                  v         v
                                              chunks.embedding + chunks_vec
                                                       |
                                                       v
                    ┌──────────────────────────────────────────────────┐
                    |              searchHybrid(query, embedding)      |
                    |                                                  |
                    |  BM25 (FTS5/LIKE)          Vector (cosine)      |
                    |       |                         |                |
                    |       v                         v                |
                    |  keywordResults           vectorResults          |
                    |       |                         |                |
                    |       └─────── merge ───────────┘                |
                    |          0.3 * text + 0.7 * vector               |
                    |          filter(score >= 0.35)                   |
                    |          top N results                           |
                    └──────────────────────────────────────────────────┘
                                        |
                                        v
                              "## Relevant Memories\n..."
                                        |
                                        v
                              {{memories}} in prompts/user.md
                                        |
                                        v
                              computer 消息 -> LLM
```
