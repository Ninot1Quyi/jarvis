# Jarvis 架构设计

## 一、系统总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Jarvis System                                   │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                            Gateway                                     │  │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────┐                           │  │
│  │  │   TUI   │    │  WebUI  │    │  Email  │                           │  │
│  │  └────┬────┘    └────┬────┘    └────┬────┘                           │  │
│  │       │              │              │                                 │  │
│  │       └──────────────┼──────────────┘                                 │  │
│  │                      ▼                                                │  │
│  │              ┌──────────────┐                                         │  │
│  │              │ MessageQueue │ ◄─── messages.md (持久化)               │  │
│  │              └──────┬───────┘                                         │  │
│  └──────────────────────┼────────────────────────────────────────────────┘  │
│                         │                                                    │
│                         ▼                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                             Agent                                      │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                          Head                                    │  │  │
│  │  │                                                                  │  │  │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │  │  │
│  │  │  │    Brain     │  │  Cerebellum  │  │    Hippocampus     │    │  │  │
│  │  │  │              │  │              │  │                    │    │  │  │
│  │  │  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌────────────────┐ │    │  │  │
│  │  │  │ │ Perceive │ │  │ │  Parser  │ │  │ │ ShortTermMemory│ │    │  │  │
│  │  │  │ │ (感知)   │ │  │ │ (解析器) │ │  │ │ (12h, 文件)    │ │    │  │  │
│  │  │  │ └──────────┘ │  │ └──────────┘ │  │ └────────────────┘ │    │  │  │
│  │  │  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌────────────────┐ │    │  │  │
│  │  │  │ │  Think   │ │  │ │ Validator│ │  │ │ LongTermMemory │ │    │  │  │
│  │  │  │ │ (思考)   │ │  │ │ (校验器) │ │  │ │ (向量+结构化)  │ │    │  │  │
│  │  │  │ └──────────┘ │  │ └──────────┘ │  │ └────────────────┘ │    │  │  │
│  │  │  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌────────────────┐ │    │  │  │
│  │  │  │ │  Decide  │ │  │ │ Executor │ │  │ │   Compressor   │ │    │  │  │
│  │  │  │ │ (决策)   │ │  │ │ (执行器) │ │  │ │ (pHash+遗忘)   │ │    │  │  │
│  │  │  │ └──────────┘ │  │ └──────────┘ │  │ └────────────────┘ │    │  │  │
│  │  │  └──────────────┘  └──────────────┘  └────────────────────┘    │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐                  │  │
│  │  │  Tools  │  │   MCP   │  │ Skills  │  │ ID-Card │                  │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘                  │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                        TodoList                                  │  │  │
│  │  │                     (todos.md 持久化)                            │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                           LLM Layer                                    │  │
│  │  ┌─────────────────┐  ┌─────────────────┐                            │  │
│  │  │ AnthropicProvider│  │ OpenAIProvider  │                            │  │
│  │  │ (Claude)         │  │ (Compatible)    │                            │  │
│  │  └─────────────────┘  └─────────────────┘                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、ReAct 主循环

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ReAct Loop                                        │
│                                                                              │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐              │
│   │ Observe │ ──▶ │  Think  │ ──▶ │   Act   │ ──▶ │ Reflect │ ──┐         │
│   │ (截图)  │     │ (思考)  │     │ (执行)  │     │ (反思)  │   │         │
│   └─────────┘     └─────────┘     └─────────┘     └─────────┘   │         │
│        ▲                                                         │         │
│        └─────────────────────────────────────────────────────────┘         │
│                                                                              │
│   终止条件:                                                                  │
│   1. LLM 输出 finished 动作                                                 │
│   2. finished 后触发验证检查，确认真的完成                                   │
│   3. 用户中断                                                               │
│   4. 达到最大步数                                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 单步流程

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Single Step                                     │
│                                                                           │
│  1. Observe (观察)                                                        │
│     ┌─────────────┐                                                       │
│     │ Screenshot  │ ──▶ 保存到 screenshots/{timestamp}.png               │
│     └─────────────┘                                                       │
│                                                                           │
│  2. Think + Decide (思考+决策) - 单次 LLM 调用                            │
│     ┌─────────────────────────────────────────────────────────────────┐  │
│     │                        LLM Request                               │  │
│     │  Input:                                                          │  │
│     │    - 当前截图                                                    │  │
│     │    - 用户任务                                                    │  │
│     │    - 待办列表 (todos.md)                                         │  │
│     │    - 最近 N 步历史 (短期记忆)                                    │  │
│     │    - 相关长期记忆 (向量检索)                                     │  │
│     │                                                                  │  │
│     │  Output:                                                         │  │
│     │    - thought: string (思考过程)                                  │  │
│     │    - action: Action (完整动作，含坐标)                           │  │
│     │    - reflection: string (反思)                                   │  │
│     └─────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  3. Act (执行)                                                            │
│     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐             │
│     │  Cerebellum │ ──▶ │  Validator  │ ──▶ │  Executor   │             │
│     │  (解析动作) │     │  (参数校验) │     │  (执行动作) │             │
│     └─────────────┘     └─────────────┘     └─────────────┘             │
│                                                                           │
│  4. Record (记录)                                                         │
│     ┌─────────────────────────────────────────────────────────────────┐  │
│     │  Step Record ──▶ 写入 memory/steps/{date}/{timestamp}.json      │  │
│     │  {                                                               │  │
│     │    timestamp: number,                                            │  │
│     │    screenshotPath: string,                                       │  │
│     │    thought: string,                                              │  │
│     │    action: Action,                                               │  │
│     │    reflection: string,                                           │  │
│     │    result: 'success' | 'failed'                                  │  │
│     │  }                                                               │  │
│     └─────────────────────────────────────────────────────────────────┘  │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 三、核心模块设计

### 3.1 Brain (大脑)

```typescript
interface Brain {
  // 感知：获取当前屏幕状态
  perceive(): Promise<Perception>

  // 思考+决策：一次 LLM 调用，输出完整动作
  thinkAndDecide(context: ThinkContext): Promise<Decision>

  // 验证：检查任务是否真的完成
  verify(task: Task): Promise<VerifyResult>
}

interface ThinkContext {
  screenshot: string           // 截图路径
  task: Task                   // 当前任务
  todos: TodoItem[]            // 待办列表
  recentSteps: Step[]          // 最近 N 步
  relevantMemories: Memory[]   // 相关长期记忆
}

interface Decision {
  thought: string              // 思考过程
  action: Action               // 完整动作
  reflection: string           // 反思
  confidence: number           // 置信度 0-1
}
```

### 3.2 Cerebellum (小脑)

```typescript
interface Cerebellum {
  // 获取所有可用工具定义 (供 LLM Tool Calling)
  getToolDefinitions(): ToolDefinition[]

  // 校验工具调用参数
  validate(toolCall: ToolCall): ValidationResult

  // 执行工具调用
  execute(toolCall: ToolCall): Promise<ExecutionResult>
}

// LLM Tool Calling 格式
interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema
}
```

### 3.3 动作空间 (Tools)

所有动作以 Tool 形式定义，使用 LLM 原生 Tool Calling：

```typescript
// 鼠标工具
const mouseTools: ToolDefinition[] = [
  {
    name: 'click',
    description: '在指定坐标点击鼠标左键',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '点击位置的 X 坐标 (像素)' },
        y: { type: 'number', description: '点击位置的 Y 坐标 (像素)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'double_click',
    description: '在指定坐标双击鼠标左键',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '点击位置的 X 坐标 (像素)' },
        y: { type: 'number', description: '点击位置的 Y 坐标 (像素)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'right_click',
    description: '在指定坐标点击鼠标右键',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '点击位置的 X 坐标 (像素)' },
        y: { type: 'number', description: '点击位置的 Y 坐标 (像素)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'mouse_move',
    description: '移动鼠标到指定坐标',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '目标位置的 X 坐标 (像素)' },
        y: { type: 'number', description: '目标位置的 Y 坐标 (像素)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'drag',
    description: '从起点拖拽到终点',
    parameters: {
      type: 'object',
      properties: {
        startX: { type: 'number', description: '起点 X 坐标' },
        startY: { type: 'number', description: '起点 Y 坐标' },
        endX: { type: 'number', description: '终点 X 坐标' },
        endY: { type: 'number', description: '终点 Y 坐标' },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'scroll',
    description: '在指定位置滚动',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '滚动位置的 X 坐标' },
        y: { type: 'number', description: '滚动位置的 Y 坐标' },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: '滚动方向'
        },
        amount: { type: 'number', description: '滚动量 (像素)，默认 300' },
      },
      required: ['x', 'y', 'direction'],
    },
  },
]

// 键盘工具
const keyboardTools: ToolDefinition[] = [
  {
    name: 'type',
    description: '输入文本内容',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要输入的文本' },
      },
      required: ['text'],
    },
  },
  {
    name: 'hotkey',
    description: '按下快捷键组合，如 cmd+c, ctrl+shift+s',
    parameters: {
      type: 'object',
      properties: {
        keys: {
          type: 'string',
          description: '快捷键组合，用 + 连接，如 "cmd+c", "ctrl+shift+s"'
        },
      },
      required: ['keys'],
    },
  },
  {
    name: 'press_key',
    description: '按下单个按键，如 enter, escape, tab',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: '按键名称，如 "enter", "escape", "tab", "backspace"'
        },
      },
      required: ['key'],
    },
  },
]

// 系统工具
const systemTools: ToolDefinition[] = [
  {
    name: 'wait',
    description: '等待指定时间',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: '等待时间 (毫秒)' },
      },
      required: ['ms'],
    },
  },
  {
    name: 'screenshot',
    description: '截取当前屏幕',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'finished',
    description: '标记任务完成，系统会进行验证',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '任务完成摘要' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'call_user',
    description: '请求用户介入，当任务不明确或需要确认时使用',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '向用户说明的内容' },
      },
      required: ['message'],
    },
  },
]
```

### 3.4 Hippocampus (海马体)

```typescript
interface Hippocampus {
  // 短期记忆
  shortTerm: {
    // 添加步骤记录
    addStep(step: Step): void
    // 获取最近 N 步
    getRecentSteps(n: number): Step[]
    // 获取 12h 内所有步骤
    getStepsWithin(hours: number): Step[]
    // 清理过期记录
    cleanup(): void
  }

  // 长期记忆
  longTerm: {
    // 存储记忆
    store(memory: Memory): void
    // 向量检索相关记忆
    retrieve(query: string, topK: number): Memory[]
    // 压缩：pHash 去重 + 遗忘曲线
    compress(): void
  }
}

interface Step {
  timestamp: number
  screenshotPath: string       // 文件路径，不存 base64
  thought: string              // LLM 的思考 (content)
  toolCall: ToolCall           // 工具调用
  result: 'success' | 'failed'
}

interface Memory {
  id: string
  type: 'preference' | 'skill' | 'history'
  content: string
  embedding?: number[]
  importance: number           // 0-10
  accessCount: number
  createTime: Date
  updateTime: Date
}
```

---

## 四、Gateway 设计

### 4.1 消息队列

```
data/
└── messages/
    ├── inbox.md              # 待处理消息
    ├── processing.md         # 处理中消息
    └── archive/              # 已处理消息归档
        └── 2026-02-01.md
```

**inbox.md 格式**:

```markdown
# Inbox

## [2026-02-01 15:30:00] from:user via:tui
打开 Chrome 搜索今天的天气

---

## [2026-02-01 15:35:00] from:user@email.com via:email
帮我整理一下桌面上的文件

---
```

### 4.2 待办列表

```
data/
└── todos.md
```

**todos.md 格式**:

```markdown
# Todo List

## Active Tasks

### [T001] 搜索天气
- status: in_progress
- priority: high
- created: 2026-02-01 15:30:00
- source: tui

### [T002] 整理桌面文件
- status: pending
- priority: medium
- created: 2026-02-01 15:35:00
- source: email

## Completed

### [T000] 发送微信消息
- status: completed
- completed: 2026-02-01 15:25:00
```

### 4.3 消息合并逻辑

```
新消息到达
    │
    ▼
┌─────────────────┐
│ 读取 todos.md   │
│ 获取当前任务列表 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ LLM 判断:       │ ──▶ │ 可合并:         │
│ 新消息是否可以  │     │ 更新现有任务    │
│ 与现有任务合并? │     │ 或添加子任务    │
└────────┬────────┘     └─────────────────┘
         │
         │ 不可合并
         ▼
┌─────────────────┐
│ 创建新任务      │
│ 写入 todos.md   │
└─────────────────┘
```

---

## 五、数据目录结构

```
jarvis/
├── data/
│   ├── messages/
│   │   ├── inbox.md              # 待处理消息
│   │   ├── processing.md         # 处理中
│   │   └── archive/              # 归档
│   │
│   ├── todos.md                  # 待办列表
│   │
│   ├── memory/
│   │   ├── steps/                # 短期记忆 (步骤记录)
│   │   │   └── 2026-02-01/
│   │   │       ├── 153000000.json
│   │   │       └── 153005000.json
│   │   │
│   │   ├── screenshots/          # 截图存储
│   │   │   └── 2026-02-01/
│   │   │       ├── 153000000.png
│   │   │       └── 153005000.png
│   │   │
│   │   └── long_term/            # 长期记忆
│   │       ├── preferences.json  # 用户偏好
│   │       ├── skills.json       # 学到的技能
│   │       └── vector/           # 向量索引
│   │
│   └── config/
│       ├── whitelist.json        # 邮件白名单
│       └── settings.json         # 用户设置
│
├── src/
│   └── ...
│
└── logs/
    └── 2026-02-01.log
```

---

## 六、Prompts

所有 Prompt 模板存放在 `prompts/` 目录，使用 `{{变量}}` 语法：

| 文件 | 用途 |
|------|------|
| `prompts/system.md` | System Prompt，定义 Agent 角色和能力 |
| `prompts/user.md` | User Message 模板，包含任务、历史、截图 |
| `prompts/verify.md` | 验证任务完成的 Prompt |
| `prompts/merge.md` | 判断消息是否可合并的 Prompt |

---

## 七、LLM 调用设计

### 7.1 LLM Tool Calling 流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Tool Calling Flow                                     │
│                                                                              │
│  1. 构建请求                                                                 │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │  system: prompts/system.md                                       │     │
│     │  user: prompts/user.md (填充变量)                                │     │
│     │  tools: [click, double_click, type, hotkey, ...]                │     │
│     │  images: [当前截图]                                              │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  2. LLM 返回                                                                 │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │  content: "我看到搜索框在屏幕中央，准备点击..."                  │     │
│     │  tool_calls: [                                                   │     │
│     │    {                                                             │     │
│     │      id: "call_xxx",                                             │     │
│     │      name: "click",                                              │     │
│     │      arguments: { x: 500, y: 300 }                               │     │
│     │    }                                                             │     │
│     │  ]                                                               │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  3. 执行工具                                                                 │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │  Cerebellum.validate(toolCall)                                   │     │
│     │  Cerebellum.execute(toolCall)                                    │     │
│     │  返回 tool_result                                                │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  4. 继续对话 (下一步截图 + tool_result)                                      │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │  messages: [...之前的消息, tool_result, 新截图]                  │     │
│     │  继续调用 LLM 获取下一步                                         │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

Prompt 模板详见 `prompts/` 目录。

---

## 七、接口定义

### 7.1 LLM Provider

```typescript
interface LLMProvider {
  name: string

  // 带工具调用的对话
  chatWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatResponse>

  // 带视觉+工具调用的对话
  chatWithVisionAndTools(
    messages: Message[],
    images: ImageInput[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatResponse>
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string      // role=tool 时必填
  toolCalls?: ToolCall[]   // role=assistant 时可能有
}

interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema
}

interface ImageInput {
  type: 'base64' | 'path' | 'url'
  data: string
}

interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

interface ChatResponse {
  content: string          // LLM 的文本回复 (思考过程)
  toolCalls?: ToolCall[]   // 工具调用
  usage: {
    inputTokens: number
    outputTokens: number
  }
}
```

### 7.2 Tool Interface

```typescript
interface Tool {
  name: string
  description: string

  // 执行工具
  execute(params: Record<string, any>): Promise<ToolResult>
}

interface ToolResult {
  success: boolean
  data?: any
  error?: string
}
```

### 7.3 MCP Interface

```typescript
interface MCPServer {
  name: string
  transport: 'stdio' | 'http'

  // 列出可用工具
  listTools(): Promise<MCPTool[]>

  // 调用工具
  callTool(name: string, params: Record<string, any>): Promise<MCPResult>
}
```

---

## 八、文件结构

```
jarvis/
├── src/
│   ├── index.ts                  # 入口
│   │
│   ├── agent/
│   │   ├── Agent.ts              # Agent 主类
│   │   ├── head/
│   │   │   ├── Brain.ts          # 大脑
│   │   │   ├── Cerebellum.ts     # 小脑
│   │   │   └── Hippocampus.ts    # 海马体
│   │   ├── tools/
│   │   │   ├── index.ts          # 工具注册
│   │   │   ├── screenshot.ts     # 截图
│   │   │   ├── mouse.ts          # 鼠标操作
│   │   │   ├── keyboard.ts       # 键盘操作
│   │   │   └── file.ts           # 文件操作
│   │   ├── mcp/
│   │   │   └── MCPManager.ts     # MCP 管理
│   │   ├── skills/
│   │   │   └── SkillManager.ts   # 技能管理
│   │   └── id-card/
│   │       └── IDCard.ts         # A2A 身份
│   │
│   ├── gateway/
│   │   ├── Gateway.ts            # 网关主类
│   │   ├── MessageQueue.ts       # 消息队列 (md 持久化)
│   │   ├── TodoList.ts           # 待办列表 (md 持久化)
│   │   ├── channels/
│   │   │   ├── TUIChannel.ts     # TUI 输入
│   │   │   ├── WebUIChannel.ts   # WebUI 输入
│   │   │   └── EmailChannel.ts   # 邮件输入
│   │   └── router/
│   │       └── MessageRouter.ts  # 消息路由 + 合并
│   │
│   ├── llm/
│   │   ├── LLMProvider.ts        # 抽象接口
│   │   ├── AnthropicProvider.ts  # Anthropic 实现
│   │   └── OpenAIProvider.ts     # OpenAI Compatible 实现
│   │
│   ├── memory/
│   │   ├── ShortTermMemory.ts    # 短期记忆
│   │   ├── LongTermMemory.ts     # 长期记忆
│   │   └── Compressor.ts         # 压缩器 (pHash + 遗忘曲线)
│   │
│   ├── executor/
│   │   ├── ActionExecutor.ts     # 动作执行器
│   │   ├── NutJSOperator.ts      # nut.js 封装
│   │   └── validators/
│   │       └── ActionValidator.ts # 动作校验
│   │
│   └── utils/
│       ├── config.ts             # 配置加载
│       ├── logger.ts             # 日志
│       ├── markdown.ts           # MD 文件读写
│       └── phash.ts              # 感知哈希
│
├── data/                         # 运行时数据 (gitignore)
├── package.json
├── tsconfig.json
├── REQUIREMENTS.md
└── ARCHITECTURE.md
```

---

## 九、MVP 实现顺序

### Phase 1: 基础骨架
1. 项目初始化 (package.json, tsconfig.json)
2. LLM 抽象层 (AnthropicProvider)
3. 基础 Agent 结构

### Phase 2: 核心循环
4. Brain - 截图 + LLM 调用
5. Cerebellum - 动作解析 + 执行
6. ReAct 主循环

### Phase 3: 记忆系统
7. ShortTermMemory (文件存储)
8. 截图管理

### Phase 4: Gateway
9. TUI 输入
10. MessageQueue (md 持久化)
11. TodoList (md 持久化)

### Phase 5: 完善
12. 任务验证 (finished 检查)
13. 消息合并逻辑
14. 错误处理

---

## 修订历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-02-01 | 初始架构设计 |
| 0.2 | 2026-02-01 | 改为 LLM 原生 Tool Calling 方式实现动作空间 |
