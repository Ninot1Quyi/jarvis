# Message Compaction System

## Overview

Jarvis 的消息压缩系统，防止长任务中 messages 数组无限增长导致超出模型上下文窗口。采用三层防御体系，逐层递进。

核心文件：
```
src/agent/compaction.ts    三层压缩逻辑
src/agent/Agent.ts         集成点（ReAct 循环中）
src/utils/config.ts        contextWindow 解析
src/types.ts               ProviderConfig.contextWindow 字段
```

---

## 1. Context Window 解析

`resolveContextWindow()` 在 `Agent.run()` 启动时异步调用，按优先级确定当前 provider 的上下文窗口大小：

| 优先级 | 来源 | 日志标识 |
|--------|------|----------|
| 1 | `config.json` 中显式配置的 `contextWindow` 字段 | `(from config)` |
| 2 | Provider 自身 `/models` API（如 doubao 的 `token_limits.context_window`） | `(from provider API)` |
| 3 | OpenRouter `/api/v1/models` 公开 API | `(from OpenRouter)` |
| 4 | 硬编码 fallback 128000 | `not found anywhere, using fallback` |

Provider API 和 OpenRouter 数据均有缓存，整个生命周期只请求一次，8 秒超时。

### 配置示例

```json
{
  "doubao": {
    "apiKey": "...",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
    "model": "doubao-seed-2-0-pro-260215",
    "contextWindow": 262144
  }
}
```

不配置 `contextWindow` 时自动从 API 获取。

---

## 2. 三层压缩

### Layer 1: Tool Result Soft Trim

每轮 LLM 调用前执行，零 LLM 成本。

**时机：** `trimOldToolResults(messages)` 在 LLM 调用前调用

**逻辑：**
- 保护区：最近 3 轮的 computer/assistant 消息不动
- 对保护区之外的 computer 消息，检测 `## Tool Execution Results` 段落
- 每个工具结果超过 2000 字符时，保留头 800 + 尾 800，中间替换为 `\n...[trimmed {N} chars]...\n`
- 直接修改 messages 数组（in-place）

**效果：** 旧的大段工具输出（如 `read_file` 返回的文件内容、`grep` 结果）被截断，显著减少 token 消耗。

### Layer 2: LLM Compaction

当 token 使用接近上下文窗口上限时触发。

**触发条件：** `response.usage.inputTokens > contextWindow * 0.75`

**逻辑：**
1. 保护区：system 消息 + 最近 6 条消息（约 3 轮）
2. 将保护区之前的所有消息序列化为文本（每条截断到 500 字符）
3. 调用当前 LLM，system prompt 指导压缩，maxTokens 1024
4. 生成的摘要作为一条 `computer` 消息替换所有被压缩的消息
5. 摘要格式：`[Compacted: {N} messages summarized]\n\n{summary}`

**压缩后 messages 数组：** `[system, compacted_summary, ...recent_6_messages]`

**失败处理：** 如果 LLM 调用失败或返回空摘要，降级到 Layer 3。

### Layer 3: Emergency Hard Truncation

最后防线，暴力丢弃旧消息。

**触发条件：**
- Layer 2 的 LLM 调用失败（compactMessages 返回 false）
- 主 LLM 调用抛出 context overflow 错误（检测错误消息中的 `too_large`、`context_length`、`token limit`、`maximum context` 等关键词）

**逻辑：**
- 保留 system + 最近 10 条消息
- 中间插入通知：`[Context truncated: {N} older messages were removed to fit context window]`
- context overflow 触发时最多重试 2 次

---

## 3. 集成点

三层压缩在 `Agent.ts` 的 ReAct 循环中有三个集成点：

```
ReAct Loop:
  |
  |-- [A] trimOldToolResults(messages)     // Layer 1: LLM 调用前
  |
  |-- llm.chatWithVisionAndTools(...)
  |     |
  |     |-- catch: isContextOverflowError  // Layer 3: overflow 重试
  |
  |-- shouldCompact(inputTokens, cw)?      // Layer 2: 调用后检查
  |     |-- compactMessages(...)
  |     |-- fallback: emergencyTruncate()  // Layer 3: compaction 失败
  |
  |-- continue loop...
```

每次 Layer 2 或 Layer 3 执行后，调用 `llm.resetMessageCount()` 重置 trace 日志偏移。

---

## 4. 常量

```typescript
COMPACTION_THRESHOLD = 0.75        // inputTokens / contextWindow 触发阈值
KEEP_RECENT_MESSAGES = 6           // Layer 2 保护最近 N 条消息
TOOL_RESULT_TRIM_THRESHOLD = 2000  // Layer 1 截断阈值（字符）
TOOL_RESULT_KEEP_HEAD = 800        // 保留头部字符数
TOOL_RESULT_KEEP_TAIL = 800        // 保留尾部字符数
KEEP_RECENT_FOR_TRIM = 3           // Layer 1 保护最近 N 轮
EMERGENCY_KEEP_MESSAGES = 10       // Layer 3 保留最近 N 条
MAX_OVERFLOW_RETRIES = 2           // overflow 最大重试次数
```

---

## 5. 不影响的部分

- Trace 系统：压缩后的消息不回写 trace，trace 保留完整历史
- Memory 子系统：独立运行，不受影响
- LLM provider 接口：`doChat` 签名不变
- 工具定义和执行逻辑：不变
