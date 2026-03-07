# Jarvis A2A 协议实现技术方案

**更新记录**:
- 2026-03-07: 补充 GUI 页面内容显示与解析章节 (3.7)，新增实现步骤 6、11
- 2026-03-07: 移除 `<chat>` 标签支持，直接使用 `message` 工具
- 2026-03-07: 完善 AgentCard skills 动态生成机制，暴露真实工具能力

---

## 1. 背景与目标

### 1.1 现状分析

当前 jarvis 的消息处理机制：

```
MessageLayer
├── inbound queue: tui/gui/mail/notification
└── outbound queue: 消息发送
```

### 1.2 目标

1. **统一消息回复机制**：采用 `message` 工具方式（类似 openclaw）
2. **完整 A2A 协议支持**：
   - 对外暴露标准 A2A HTTP 接口
   - 可被发现和发现其他 Agent
   - 支持 Agent 间任务委派
3. **消息来源追踪**：通过 provenance 元数据区分不同来源
4. **简化设计**：直接使用 `message` 工具，无冗余格式

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Jarvis A2A 架构                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      A2A HTTP Server                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ GET /a2a   │  │POST /a2a   │  │GET /a2a/    │          │   │
│  │  │ (AgentCard) │  │(JSON-RPC)  │  │ stream      │          │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   A2A Protocol Handler                           │   │
│  │  - agents/get       返回 AgentCard                              │   │
│  │  - tasks/send      发送任务                                    │   │
│  │  - tasks/get       获取任务状态                                │   │
│  │  - tasks/cancel    取消任务                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Agent Registry (服务发现)                      │   │
│  │  - Local Agent 注册                                            │   │
│  │  - Remote Agent 发现 (HTTP GET)                                │   │
│  │  - AgentCard 缓存                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Agent (LLM Loop)                              │
│                                                                         │
│  输入消息来源 (provenance.kind):                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  external_user  ← 用户消息 (tui/gui/mail/notification)        │   │
│  │  inter_session  ← 其他 Agent 委派的任务 (A2A)                  │   │
│  │  internal_system← 系统消息 (心跳、定时任务)                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  工具系统:                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  message      ← 统一消息发送工具                                │   │
│  │  sessions_send← Agent 委派工具                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 消息流转

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        消息处理流程                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 消息进入 (多种来源)                                                │
│     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│     │  TUI/GUI     │  │  A2A (HTTP) │  │ Notification │            │
│     │  (本地)      │  │  (远程)      │  │ (外部应用)   │            │
│     └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│            │                 │                 │                      │
│            ▼                 ▼                 ▼                      │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │              MessageLayer.push()                        │        │
│     │  - 添加 provenance 元数据                              │        │
│     │  - kind: external_user | inter_session | internal_system│        │
│     │  - sourceChannel: tui | telegram | sessions_send | ... │        │
│     └─────────────────────────────────────────────────────────┘        │
│                                   │                                    │
│                                   ▼                                    │
│  2. Agent 处理消息                                                   │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │  LLM 收到消息 + provenance                              │        │
│     │  - "这条消息来自哪里"                                   │        │
│     │  - "需要回复到哪里"                                     │        │
│     └─────────────────────────────────────────────────────────┘        │
│                                   │                                    │
│                                   ▼                                    │
│  3. Agent 回复 (两种方式)                                             │
│     ┌─────────────────────┐    ┌─────────────────────┐              │
│     │ 方式 A: message 工具 │    │ 方式 B: sessions_send│             │
│     │                     │    │                     │              │
│     │ message({           │    │ sessions_send({     │              │
│     │   action: "send",  │    │   agentId: "sub",  │              │
│     │   channel: "tui",  │    │   task: "任务描述", │              │
│     │   message: "内容"   │    │   context: "上下文" │              │
│     │ })                 │    │ })                  │              │
│     └─────────────────────┘    └─────────────────────┘              │
│                                   │                                    │
│                                   ▼                                    │
│  4. 消息路由                                                       │
│     ┌─────────────────────┐    ┌─────────────────────┐              │
│     │ message 工具处理      │    │ sessions_send 处理  │              │
│     │                     │    │                     │              │
│     │ - channel: tui → TUI│    │ - 本地 → 写入队列  │              │
│     │ - channel: gui → GUI│    │ - 远程 → HTTP RPC  │              │
│     │ - channel: mail→ Mail│   │                     │              │
│     └─────────────────────┘    └─────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心组件设计

### 3.1 类型定义

```typescript
// src/a2a/types.ts

// ========== AgentCard ==========
export interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransition: boolean
  }
  skills: Skill[]
  authentication?: {
    schemes: string[]
  }
}

export interface Skill {
  id: string
  name: string
  description: string
  tags: string[]
  // 工具能力的附加元数据
  toolMetadata?: {
    // 工具参数 schema (JSON Schema 格式)
    parameters?: Record<string, unknown>
    // 能力分类: "messaging" | "system" | "file" | "mouse" | "keyboard" | "ai"
    category?: string
  }
}

// ========== A2A Message ==========
export interface A2AMessage {
  role: 'user' | 'agent'
  parts: Array<TextPart | FilePart | DataPart>
}

export interface TextPart {
  type: 'text'
  text: string
}

export interface FilePart {
  type: 'file'
  file: { name: string; mimeType: string; uri?: string }
}

export interface DataPart {
  type: 'data'
  data: Record<string, unknown>
}

// ========== Task ==========
export interface Task {
  id: string
  status: TaskStatus
  createdAt: string
  updatedAt?: string
  message?: A2AMessage
  artifacts?: Array<{ parts: A2AMessage['parts'] }>
  metadata?: Record<string, unknown>
}

export type TaskStatus =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'cancelled'

// ========== Provenance (消息来源) ==========
export type ProvenanceKind = 'external_user' | 'inter_session' | 'internal_system'

export interface Provenance {
  kind: ProvenanceKind
  sourceSessionKey?: string
  sourceChannel?: string
  sourceTool?: string
}
```

### 3.2 A2A HTTP Server

```typescript
// src/a2a/server.ts

import express from 'express'
import { AgentRegistry } from './registry.js'
import { JsonRpcHandler } from './json-rpc.js'

export class A2AServer {
  private app: express.Application
  private registry: AgentRegistry
  private rpc: JsonRpcHandler

  constructor(
    private port: number = 3000,
    private agentCard: AgentCard
  ) {
    this.app = express()
    this.app.use(express.json())
    this.registry = new AgentRegistry(this.agentCard)
    this.rpc = new JsonRpcHandler(this.registry)
    this.setupRoutes()
  }

  private setupRoutes() {
    // AgentCard 端点 (服务发现)
    this.app.get('/a2a', (req, res) => {
      res.json(this.registry.getLocalAgentCard())
    })

    // JSON-RPC 端点
    this.app.post('/a2a', async (req, res) => {
      try {
        const result = await this.rpc.handle(req.body)
        res.json(result)
      } catch (error) {
        res.json(this.rpc.errorResponse(req.body.id, -32603, String(error)))
      }
    })

    // 可选: 流式响应 (SSE)
    // this.app.get('/a2a/stream', ...)
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => resolve(this.port))
    })
  }

  getRegistry(): AgentRegistry {
    return this.registry
  }
}
```

### 3.3 JSON-RPC Handler

```typescript
// src/a2a/json-rpc.ts

export class JsonRpcHandler {
  constructor(private registry: AgentRegistry) {}

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { jsonrpc, id, method, params } = request

    if (jsonrpc !== '2.0') {
      return this.errorResponse(id, -32600, 'Invalid Request')
    }

    switch (method) {
      case 'agents/get':
        return this.handleGetAgent(params, id)
      case 'tasks/send':
        return this.handleSendTask(params, id)
      case 'tasks/get':
        return this.handleGetTask(params, id)
      case 'tasks/cancel':
        return this.handleCancelTask(params, id)
      default:
        return this.errorResponse(id, -32601, `Method not found: ${method}`)
    }
  }

  private async handleGetAgent(params: { agentId?: string }, id: string) {
    const card = params.agentId
      ? await this.registry.getRemoteAgentCard(params.agentId)
      : this.registry.getLocalAgentCard()

    if (!card) {
      return this.errorResponse(id, -32001, 'Agent not found')
    }

    return { jsonrpc: '2.0', id, result: card }
  }

  private async handleSendTask(params: {
    id: string
    message: A2AMessage
    sessionId?: string
  }, id: string) {
    // 创建 Task
    const task: Task = {
      id: params.id,
      status: 'submitted',
      createdAt: new Date().toISOString(),
      message: params.message
    }

    this.registry.createTask(task.id, task)

    // 提取消息文本，发送到 Agent
    const text = this.extractTextFromMessage(task.message)
    messageLayer.push('agent', text, {
      provenance: {
        kind: 'inter_session',
        sourceTool: 'a2a'
      }
    })

    return {
      jsonrpc: '2.0',
      id,
      result: {
        id: task.id,
        status: task.status,
        createdAt: task.createdAt
      }
    }
  }

  private handleGetTask(params: { id: string }, id: string) {
    const task = this.registry.getTask(params.id)
    if (!task) {
      return this.errorResponse(id, -32001, 'Task not found')
    }
    return { jsonrpc: '2.0', id, result: task }
  }

  private extractTextFromMessage(message?: A2AMessage): string {
    if (!message?.parts) return ''
    return message.parts
      .filter(p => p.type === 'text')
      .map(p => (p as TextPart).text)
      .join('\n')
  }

  errorResponse(id: string | number | undefined, code: number, message: string) {
    return { jsonrpc: '2.0', id, error: { code, message } }
  }
}
```

### 3.4 Agent Registry

```typescript
// src/a2a/registry.ts

import type { ToolRegistry } from '../agent/tools/index.js'

export class AgentRegistry {
  private localAgentCard: AgentCard
  private remoteAgents: Map<string, AgentCard> = new Map()
  private taskStore: Map<string, Task> = new Map()

  constructor(
    baseAgentCard: Omit<AgentCard, 'skills'>,
    private toolRegistry?: ToolRegistry
  ) {
    // 动态生成 skills 列表
    this.localAgentCard = {
      ...baseAgentCard,
      skills: this.generateSkillsFromTools()
    }
  }

  /**
   * 从 ToolRegistry 动态生成 skills 列表
   * 每个工具对应一个 skill，让外部 Agent 知道我们的真实能力
   */
  private generateSkillsFromTools(): Skill[] {
    if (!this.toolRegistry) {
      return []
    }

    const skills: Skill[] = []

    for (const tool of this.toolRegistry.getTools()) {
      skills.push({
        id: tool.name,
        name: tool.label || tool.name,
        description: tool.description || '',
        tags: this.getTagsForTool(tool.name),
        toolMetadata: {
          parameters: tool.parameters,
          category: this.getCategoryForTool(tool.name)
        }
      })
    }

    return skills
  }

  /**
   * 根据工具名称判断分类
   */
  private getCategoryForTool(toolName: string): string {
    const categories: Record<string, string> = {
      message: 'messaging',
      sessions_send: 'messaging',
      screenshot: 'system',
      wait: 'system',
      finished: 'system',
      call_user: 'system',
      read_file: 'file',
      write_file: 'file',
      edit_file: 'file',
      grep: 'file',
      bash: 'system',
      todo_read: 'productivity',
      todo_write: 'productivity',
      click: 'mouse',
      double_click: 'mouse',
      right_click: 'mouse',
      drag: 'mouse',
      scroll: 'mouse',
      middle_click: 'mouse',
      type: 'keyboard',
      hotkey: 'keyboard'
    }
    return categories[toolName] || 'other'
  }

  /**
   * 为工具生成标签
   */
  private getTagsForTool(toolName: string): string[] {
    const tags: string[] = []
    const category = this.getCategoryForTool(toolName)
    if (category !== 'other') {
      tags.push(category)
    }
    return tags
  }

  getLocalAgentCard(): AgentCard {
    return this.localAgentCard
  }

  /**
   * 刷新本地 AgentCard（工具注册变更后调用）
   */
  refreshLocalAgentCard() {
    this.localAgentCard.skills = this.generateSkillsFromTools()
  }

  async discoverRemoteAgent(url: string): Promise<AgentCard | null> {
    try {
      const response = await fetch(`${url}/a2a`)
      if (!response.ok) return null
      const card = await response.json() as AgentCard
      this.remoteAgents.set(card.name, card)
      return card
    } catch {
      return null
    }
  }

  async getRemoteAgentCard(agentId: string): Promise<AgentCard | null> {
    // 先检查缓存
    const cached = this.remoteAgents.get(agentId)
    if (cached) return cached
    // TODO: 可以从配置的服务发现获取地址
    return null
  }

  async findAgent(agentId: string): Promise<AgentCard | null> {
    // 1. 先检查本地
    if (agentId === this.localAgentCard.name) {
      return this.localAgentCard
    }
    // 2. 检查远程缓存
    const cached = this.remoteAgents.get(agentId)
    if (cached) return cached
    // 3. 尝试发现
    return this.discoverRemoteAgent(agentId)
  }

  createTask(id: string, task: Task) {
    this.taskStore.set(id, task)
  }

  getTask(id: string): Task | undefined {
    return this.taskStore.get(id)
  }

  updateTaskStatus(id: string, status: TaskStatus) {
    const task = this.taskStore.get(id)
    if (task) {
      task.status = status
      task.updatedAt = new Date().toISOString()
    }
  }
}
```

### 3.5 message 工具 (统一回复)

```typescript
// src/agent/tools/message.ts

export const messageTool = {
  name: 'message',
  description: 'Send messages to users via different channels',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['send', 'reply'],
        description: 'Message action'
      },
      channel: {
        type: 'string',
        enum: ['tui', 'gui', 'mail', 'auto'],
        description: 'Target channel (auto = use originating channel)'
      },
      to: {
        type: 'string',
        description: 'Recipient (for mail: email address)'
      },
      title: {
        type: 'string',
        description: 'Email subject (for mail channel)'
      },
      message: {
        type: 'string',
        description: 'Message content'
      },
      guiContent: {
        type: 'string',
        description: 'GUI-specific content (Markdown supported)'
      },
      tuiContent: {
        type: 'string',
        description: 'TUI-specific content'
      },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths to attach'
      }
    },
    required: ['action', 'message']
  },

  async execute(args: Record<string, unknown>, context: ToolContext) {
    const { action, channel, to, title, message, guiContent, tuiContent, attachments } = args

    // 根据 channel 参数路由
    const targetChannel = channel === 'auto'
      ? context.originatingChannel
      : channel

    const result = await messageLayer.send({
      channel: targetChannel || 'tui',
      to: to as string,
      title: title as string,
      message: message as string,
      guiContent: guiContent as string,
      tuiContent: tuiContent as string,
      attachments: attachments as string[]
    })

    return {
      success: result,
      message: result ? 'Message sent' : 'Failed to send message'
    }
  }
}
```

### 3.6 sessions_send 工具 (Agent 委派)

```typescript
// src/agent/tools/sessions-send.ts

export const sessionsSendTool = {
  name: 'sessions_send',
  description: 'Send a task to another agent for delegation',
  parameters: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'Target agent ID or label'
      },
      task: {
        type: 'string',
        description: 'Task description for the target agent'
      },
      context: {
        type: 'string',
        description: 'Additional context'
      },
      waitForResult: {
        type: 'boolean',
        default: true,
        description: 'Wait for result or fire-and-forget'
      },
      timeout: {
        type: 'number',
        default: 60,
        description: 'Timeout in seconds'
      }
    },
    required: ['agentId', 'task']
  },

  async execute(args: Record<string, unknown>, context: ToolContext) {
    const { agentId, task, context, waitForResult, timeout } = args

    // 1. 查找目标 Agent
    const targetCard = await a2aRegistry.findAgent(agentId as string)

    if (!targetCard) {
      return { success: false, error: `Agent not found: ${agentId}` }
    }

    // 2. 判断本地/远程
    if (targetCard.url === a2aRegistry.getLocalAgentCard().url) {
      // 本地 Agent
      return this.delegateLocal(agentId as string, task as string, context as string)
    } else {
      // 远程 Agent
      if (waitForResult) {
        return this.delegateRemoteWithWait(targetCard, task, context, timeout as number)
      } else {
        return this.delegateRemoteFireForget(targetCard, task, context)
      }
    }
  }

  private async delegateLocal(agentId: string, task: string, context?: string): Promise<ToolResult> {
    // 发送到本地消息队列
    messageLayer.push('agent', `<task>${task}</task><context>${context || ''}</context>`)
    return { success: true, message: `Task delegated to local agent: ${agentId}` }
  }

  private async delegateRemoteWithWait(card: AgentCard, task: string, context?: string, timeout: number): Promise<ToolResult> {
    const taskId = `task-${Date.now()}`

    // 发送任务
    await fetch(`${card.url}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: taskId,
        method: 'tasks/send',
        params: {
          id: taskId,
          message: { role: 'user', parts: [{ type: 'text', text: task }] },
          metadata: { context }
        }
      })
    })

    // 轮询等待结果
    const startTime = Date.now()
    while (Date.now() - startTime < timeout * 1000) {
      const response = await fetch(`${card.url}/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: taskId,
          method: 'tasks/get',
          params: { id: taskId }
        })
      })

      const result = await response.json()
      const status = result.result?.status

      if (status === 'completed') {
        const reply = this.extractReply(result.result)
        return { success: true, message: reply }
      } else if (status === 'failed') {
        return { success: false, error: 'Task failed' }
      }

      await new Promise(r => setTimeout(r, 1000))
    }

    return { success: false, error: 'Timeout waiting for result' }
  }

  private extractReply(task: Task): string {
    // 从 artifacts 中提取回复
    return task.artifacts?.[0]?.parts
      .filter(p => p.type === 'text')
      .map(p => (p as TextPart).text)
      .join('\n') || ''
  }
}
```

### 3.7 MessageLayer 扩展

```typescript
// src/message/MessageLayer.ts 扩展

export interface MessageOptions {
  provenance?: {
    kind: 'external_user' | 'inter_session' | 'internal_system'
    sourceSessionKey?: string
    sourceChannel?: string
    sourceTool?: string
  }
}

export class MessageLayer {
  // ... 现有代码 ...

  /**
   * 发送消息 (由 message 工具调用)
   */
  async send(params: {
    channel: 'tui' | 'gui' | 'mail' | 'auto'
    to?: string
    title?: string
    message: string
    guiContent?: string
    tuiContent?: string
    attachments?: string[]
  }): Promise<boolean> {
    const { channel, to, title, message, guiContent, tuiContent, attachments } = params

    // auto 模式：从当前上下文获取来源渠道
    const targetChannel = channel === 'auto'
      ? this.currentOriginatingChannel
      : channel

    switch (targetChannel) {
      case 'tui':
        // TUI 优先使用 tuiContent，回退到 message
        const tuiMessage = tuiContent || message
        return this.deliverTui(tuiMessage, attachments)
      case 'gui':
        // GUI 优先使用 guiContent，回退到 message
        const guiMessage = guiContent || message
        return this.deliverGui(guiMessage, attachments)
      case 'mail':
        return this.deliverMail(to!, title!, message, attachments)
      default:
        return false
    }
  }

  /**
   * 带 provenance 的消息推送
   */
  push(source: MessageSource, content: string, options?: MessageOptions): string {
    const id = `m${Date.now()}_${++idCounter}`
    const message: QueuedMessage = {
      id,
      timestamp: new Date(),
      source,
      content: content.trim(),
      consumed: false,
      status: 'pending',
      provenance: options?.provenance
    }
    this.messages.push(message)
    this.save()
    return id
  }

  /**
   * 格式化待处理消息 (包含 provenance 信息)
   */
  formatPending(): string | null {
    const pending = this.getPending()
    if (pending.length === 0) return null

    // 按来源分组
    const bySource: Record<MessageSource, string[]> = {
      tui: [], gui: [], mail: [], notification: [], agent: []
    }

    for (const msg of pending) {
      bySource[msg.source].push(msg.content)
    }

    let result = ''

    // Agent 来源的消息
    if (bySource.agent.length > 0) {
      result += '<agent>\n'
      result += bySource.agent.join('\n---\n')
      result += '\n</agent>\n'
    }

    // 普通用户消息 - 直接包含内容，不使用 <chat> 包装
    const chatSources = ['tui', 'gui', 'mail'] as MessageSource[]
    for (const source of chatSources) {
      if (bySource[source].length > 0) {
        const combined = bySource[source].join('\n---\n')
        result += `[${source}]\n${combined}\n`
      }
    }

    // Notification
    if (bySource.notification.length > 0) {
      result += `<notification>\n${bySource.notification.join('\n---\n')}\n</notification>`
    }

    return result.trim() || null
  }

  // GUI 消息传递到 overlay-ui
  private deliverGui(content: string, attachments?: string[]): boolean {
    // 发送到 Tauri 事件，由 overlay-ui 接收
    invoke('send_gui_message', {
      role: 'assistant',
      content: content,  // Markdown 内容，由 MarkdownContent 组件处理
      attachments: attachments,
      timestamp: new Date().toISOString()
    })
    return true
  }
}
```

---

## 3.8 GUI 页面内容显示与解析

### 3.8.1 现有机制分析

overlay-ui 的 App.tsx 中有两套内容渲染机制：

```typescript
// 1. 自定义 XML 标签定义
const CUSTOM_XML_TAGS = ['chat', 'quote', 'reminder', 'warning', 'thought', 'error', 'tui', 'gui']
const CUSTOM_XML_RE = new RegExp(
  `<(${CUSTOM_XML_TAGS.join('|')})>([\\s\\S]*?)<\\/\\1>`,
  'gi'
)

// 2. assistant 消息使用 processCustomTags 直接处理 (第 344 行)
<div dangerouslySetInnerHTML={{ __html: processCustomTags(msg.content) }} />

// 3. 其他消息使用 MarkdownContent 组件
<MarkdownContent content={msg.content} />
```

### 3.8.2 processCustomTags 函数

```typescript
// 处理流程:
// 1. 先 escapeHtml 转义所有 HTML 特殊字符
// 2. 然后查找转义后的标签 &lt;tag&gt;...&lt;/tag&gt;
// 3. 替换为: inner_content<sup class="xml-tag">tag</sup>

function processCustomTags(text: string): string {
  let result = escapeHtml(text)
  const escapedTagRe = new RegExp(
    `&lt;(${CUSTOM_XML_TAGS.join('|')})&gt;([\\s\\S]*?)&lt;/\\1&gt;`,
    'gi'
  )
  // 循环处理嵌套标签
  let prev = ''
  while (prev !== result) {
    prev = result
    result = result.replace(
      escapedTagRe,
      (_match, tag, inner) => `${inner.replace(/[\s\n\r]+$/, '')}<sup class="xml-tag">${escapeHtml(tag)}</sup>`
    )
  }
  return result
}
```

### 3.8.3 消息渲染路径

```
消息来源
    │
    ├─→ role: 'assistant'
    │      └─→ processCustomTags()
    │           ├─→ escapeHtml (转义所有 HTML)
    │           └─→ 替换 <tag>content</tag> → content<sup>tag</sup>
    │
    └─→ role: 'computer' | 'tool' | 'user'
           └─→ MarkdownContent
                ├─→ marked.parse() (Markdown → HTML)
                └─→ 替换 <tag>content</tag> → content<sup>tag</sup>
```

### 3.8.4 message 工具与 GUI 的集成

当使用 `message` 工具发送消息时，需要考虑 GUI 显示：

```typescript
// message 工具参数设计
interface MessageToolParams {
  action: 'send' | 'reply'
  channel: 'tui' | 'gui' | 'mail' | 'auto'
  message: string  // 纯文本，不包含 XML 标签
  guiContent?: string  // 可选: GUI 专用内容（支持 Markdown）
  tuiContent?: string  // 可选: TUI 专用内容
}
```

**GUI 显示优先级**：
- 如果提供 `guiContent` → 使用它（Markdown）
- 否则使用 `message`（纯文本）

### 3.8.5 System Prompt 更新

需要在 system prompt 中说明：

```
## 消息回复方式

使用 message 工具回复消息：

- action: "send" | "reply"
- channel: "tui" | "gui" | "mail" | "auto" (auto = 回复到来源渠道)
- message: 消息内容（纯文本）
- guiContent: (可选) GUI 专用内容，支持 Markdown
- tuiContent: (可选) TUI 专用内容

## GUI 内容提示

- GUI 界面支持 Markdown 格式化
- 如果消息包含代码、列表、链接等格式，使用 guiContent 参数提供 Markdown 版本
- 纯文本消息同时适用于 TUI 和 GUI
```

---

## 4. 实现计划

### 4.1 文件结构

```
src/
├── a2a/
│   ├── types.ts          # 类型定义
│   ├── registry.ts       # Agent 注册与发现
│   ├── json-rpc.ts       # JSON-RPC 处理器
│   └── server.ts         # HTTP 服务器
├── agent/
│   └── tools/
│       ├── message.ts     # 统一消息工具 (新增)
│       ├── sessions-send.ts # Agent 委派工具 (新增)
│       └── index.ts       # 工具注册 (修改)
└── message/
    └── MessageLayer.ts   # 消息层 (扩展 provenance)
```

### 4.2 实现步骤

| 阶段 | 任务 | 文件 |
|------|------|------|
| 1 | A2A 类型定义（含 Skill.toolMetadata） | `src/a2a/types.ts` |
| 2 | Agent Registry（含 ToolRegistry 集成和动态 skills） | `src/a2a/registry.ts` |
| 3 | JSON-RPC Handler | `src/a2a/json-rpc.ts` |
| 4 | A2A HTTP Server | `src/a2a/server.ts` |
| 5 | 扩展 MessageLayer provenance | `src/message/MessageLayer.ts` |
| 6 | 扩展 MessageLayer 渠道分发 | `src/message/MessageLayer.ts` |
| 7 | message 工具（含 guiContent/tuiContent） | `src/agent/tools/message.ts` |
| 8 | sessions_send 工具 | `src/agent/tools/sessions-send.ts` |
| 9 | 工具注册 | `src/agent/tools/index.ts` |
| 10 | 集成到 Agent（含 A2A Server 启动） | `src/agent/Agent.ts` |
| 11 | overlay-ui 消息接收调整 | `overlay-ui/src/App.tsx` |
| 12 | System Prompt 更新 | `prompts/system.md` |

---

## 5. 配置选项

```typescript
// config/config.ts
export interface Config {
  // ... 现有配置
  a2a?: {
    enabled: boolean
    port: number
    agentCard: {
      name: string
      description: string
      url: string
      skills: Skill[]
    }
    remoteAgents?: string[]  // 已知远程 Agent 地址
  }
}
```

---

## 6. 测试计划

### 6.1 单元测试

- A2A 类型和序列化
- JSON-RPC 请求/响应
- Agent Registry 发现逻辑
- message/sessions_send 工具

### 6.2 集成测试

- 本地 Agent 间通信
- 远程 Agent 发现和通信
- 消息来源追溯

---

## 7. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| A2A 服务端口冲突 | 配置项支持自定义端口 |
| 远程 Agent 不可达 | 超时 + 错误处理 + 重试 |
| 消息循环委派 | 引入 depth 限制 |

---

## 8. 总结

本方案实现了：

1. **统一消息回复**：使用 `message` 工具
2. **完整 A2A 协议**：
   - HTTP Server + JSON-RPC
   - AgentCard 服务发现
   - 任务委派和状态跟踪
3. **消息来源追溯**：通过 provenance 元数据区分不同来源
4. **GUI/TUI 渠道分离**：支持 guiContent/tuiContent 分别定制
5. **能力暴露机制**：
   - AgentCard.skills 从 ToolRegistry 动态生成
   - 每个工具对应一个 skill，包含参数 schema 和分类
   - 外部 Agent 可通过 GET /a2a 发现我们的真实能力
   - 支持工具变更后刷新 AgentCard
