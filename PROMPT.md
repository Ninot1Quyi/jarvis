# Jarvis - 主动式 AI Agent

## 项目概述

Jarvis 是一个运行在 macOS 上的主动式 AI Agent 桌面应用，具备以下核心能力：

1. **Computer Use** - 像人一样操作电脑（键盘、鼠标、窗口管理）
2. **自然语音对话** - 可打断的实时语音交互
3. **主动交互** - 不只是问答，主动预测用户意图并提供帮助
4. **意图预测** - 观察用户行为，在合适时机主动提供帮助
5. **独立虚拟桌面** - 在独立的 macOS Space 中工作
6. **长时间工作** - 支持数小时甚至数天的持续任务，不偏离目标

## 技术栈

### 核心框架
- **Electron** v33.x + **electron-vite**
- **React 18** + **TypeScript** (strict mode)
- **pnpm** 包管理器

### 状态与通信
- **Zustand** - 状态管理
- **mitt** - 事件总线
- **electron-trpc** - IPC 通信

### 数据存储
- **better-sqlite3** + **drizzle-orm**
- 数据库位置: `~/.jarvis/data/jarvis.db`
- 检查点截图: `~/.jarvis/data/checkpoints/`

### UI 框架
- **Tailwind CSS** + **CSS Modules**
- **Framer Motion** - 动画
- macOS 液态玻璃风格设计

### AI 服务
- **大脑**: Qwen3-VL（主）/ 豆包（备用）
- **小脑**: MAI-UI-2b via Ollama（本地）
- **ASR/TTS**: 字节跳动流式语音服务

### 自动化
- **nut.js** - 桌面自动化
- **AppleScript** - 窗口管理
- **Swift CLI** - macOS Spaces 控制

### 测试
- **Vitest** - 单元测试
- **Playwright** - E2E 测试
- **MSW** - Mock 服务
- **electron-playwright-helpers** - Electron 测试辅助

## 技术选型详情

| 组件 | 技术 | 配置 |
|------|------|------|
| 大脑 VLM | 豆包（主） | API Key: `6b53f54e-11fc-4dee-a1ad-405098a4058d` |
| 大脑 VLM | Qwen3-VL（备用） | API Key: `f1181caebae94db6a1ff403625a7d612` |
| 小脑 | MAI-UI-2b | Ollama `localhost:11434`, model: `ahmadwaqar/mai-ui` |
| 语音识别 | 字节流式 ASR | APP ID: `9849623045` |
| 语音合成 | 字节 TTS | 同上 |
| 离线备用 | Vosk + Silero VAD | 本地模型 |
| 桌面自动化 | nut.js + AppleScript + Swift | macOS 专用 |

### 字节语音服务认证
```
APP ID: 9849623045
Access Token: 06xaC6DV7Wz7dN44DaG1cSw66mtw-1mr
Secret Key: _Sr76vFPwSsmLOQKzkX1NXmtkC39lHLI
```

### 字节 ASR 服务（流式语音识别大模型-小时版）
- **API 文档**: https://www.volcengine.com/docs/6561/1354869?lang=zh
- **资源包 ID**: `Speech_Recognition_Seed_streaming2000000560502727618`
- **配额**: 20.00 小时

### 字节 TTS 服务（语音合成大模型-字符版）
- **API 文档**: https://www.volcengine.com/docs/6561/1257584?lang=zh
- **资源包 ID**: `BigTTS2000000560125871330`
- **配额**: 20,000 字数

### 小脑模型说明
MAI-UI-2b 是基于 Qwen-VL 微调的模型，专门用于 UI 元素定位。直接使用 Ollama 标准方式调用：
```bash
ollama run ahmadwaqar/mai-ui
```

## 架构设计

### 大脑-小脑架构

```
用户输入 → 大脑(Qwen3-VL) → 任务规划 → 小脑(MAI-UI-2b) → 精确操作
                ↑                              ↓
            纠偏检查 ←──────────────────── 执行反馈
```

- **大脑**: 理解意图、规划任务、决策判断
- **小脑**: 精确定位 UI 元素、输出操作坐标

### 灵动岛 UI

仿 iPhone Dynamic Island 设计，8 种状态：
- `idle` - 空闲（小胶囊）
- `listening` - 语音输入（波形动画）
- `thinking` - AI 思考（脉冲动画）
- `speaking` - TTS 播放（声波动画）
- `working` - 执行任务（进度环）
- `paused` - 任务暂停
- `error` - 错误状态
- `notification` - 有通知

交互：单击展开详情，双击打开主界面
动画：弹性动画（300ms）
展开：向下展开，尺寸自适应

### 主界面

- **布局**: 标签页式（对话/任务/设置）
- **尺寸**: 可调整 + 可全屏
- **位置**: 记住上次位置
- **风格**: 精致优雅，macOS 液态玻璃风格

#### 标签页内容

1. **对话页** - 聊天界面，液态玻璃风格消息样式
2. **任务页**:
   - 任务队列
   - 进度显示
   - 检查点管理
   - Agent 实时操作可视化预览监控
3. **设置页** - 各项配置

## 核心模块

### 1. 感知层 (Perception)
- 全量键盘监控（包括具体按键）
- 全量鼠标监控（位置 + 轨迹 + 点击）
- 全量文件监控
- 屏幕截图（动态频率，24h 存储）
- pHash 相似度检测（95% 阈值去重）
- 启动时权限引导

### 2. 执行层 (Execution)
- nut.js 桌面自动化
- 平滑鼠标移动（模拟人类）
- 剪贴板粘贴中文
- 操作失败不重试（可配置）

### 3. 认知层 (Cognition)
- 流式 API 调用
- 20 轮对话历史（超过自动摘要）
- 10s 响应超时（可配置）
- Ollama 不可用时自动尝试启动

### 4. 语音交互 (Voice)
- **无唤醒词设计**: 启动后持续后台监听，不需要唤醒词
- **智能对话识别**: Agent 实时分析语音内容和音色，判断是否在和 Jarvis 说话
  - 结合声纹识别区分主用户和旁人
  - 分析语音内容语义判断是否是指令
  - 区分人声和环境噪音
- 长连接 ASR（减少延迟）
- 多用户声纹注册
- 软件回声消除 + 声纹排除
- Silero VAD 打断检测（150ms）
- 离线备用：Vosk + macOS say

### 5. 主动系统 (Proactive)
- 触发条件：重复操作 + 用户犹豫 + 定期分析
- 预测置信度阈值：70%
- 智能提示位置（避开重要内容）
- RAG 记忆用户拒绝行为
- 无冷却时间（可配置）

### 6. 纠偏系统 (Drift Correction)
- 触发条件：每 10 轮 + 检测到异常 + 用户请求
- 内存分叉检查（30s 超时）
- 偏差分级：
  - minor（轻微）: 提示继续
  - moderate（中度）: 询问用户
  - severe（严重）: 强制暂停
- 用户介入超时：5 分钟后暂停
- 手动接管后 Agent 观察学习
- RAG 记录修正历史（用户查看 + 训练）

### 7. 长任务系统 (Long-running)
- 7 种任务状态：pending/running/paused/blocked/completed/failed/cancelled
- 每次状态变化持久化
- 检查点：步骤完成 + 30s 定时
- 混合存储：元数据 SQLite，截图文件
- 保留最近 10 个 + 关键步骤检查点
- 任意检查点回滚
- 崩溃恢复：显示选项（恢复/放弃/查看详情）
- 恢复前验证当前状态
- 恢复一致性：能撤回的自动撤回，不能撤回的交给 Agent
- 任务队列顺序执行
- 三级优先级（高/中/低）
- 显示预估剩余时间

## 通知策略

- 主要使用灵动岛通知
- 避免系统右上角弹窗
- macOS 系统通知可配置开启
- 声音提示默认开启

## 性能目标

- 冷启动 < 3 秒
- 空闲内存 < 500MB
- 观察循环 CPU < 5%

## 测试策略

### 基础测试
- 单元测试：Vitest
- E2E 测试：Playwright
- 核心模块覆盖率 > 80%
- Mock VLM 响应（离线开发）

### 全流程验证测试
- 测试录制：截图 + 视频
- Mock 策略：可切换真实 API
- 测试数据：固定数据
- 执行方式：串行（避免冲突）
- CI 集成：GitHub Actions

### 测试场景
1. 首次启动流程（权限引导、声纹注册）
2. 语音对话流程（ASR → AI → TTS → 执行）
3. 长任务执行（检查点、崩溃恢复）
4. 纠偏系统（偏差检测、用户介入）
5. 主动建议（意图预测、自动化执行）
6. UI 交互（灵动岛、主界面）

## 数据目录结构

```
~/.jarvis/
├── data/
│   ├── jarvis.db          # 主数据库
│   ├── checkpoints/       # 检查点截图
│   └── screenshots/       # 24h 截图缓存
├── logs/                  # 日志文件（7天保留）
└── config/                # 用户配置
```

## 项目结构

```
src/main/
├── services/brain/BrainService.ts          # 大脑核心
├── services/cerebellum/CerebellumService.ts # 小脑核心
├── services/operator/OperatorService.ts     # 操作执行
├── services/voice/VoiceService.ts           # 语音交互
├── services/perception/PerceptionService.ts # 感知系统
├── services/workspace/WorkspaceService.ts   # 工作区管理
├── services/task/TaskService.ts             # 任务管理
├── core/AgentLoop.ts                        # 主循环
└── core/StateManager.ts                     # 状态管理

src/renderer/
├── components/dynamic-island/               # 灵动岛组件
├── components/mouse-hint/                   # 鼠标跟随提示
├── components/dashboard/                    # 主界面
└── components/voice/                        # 语音面板

native/spaces-control/
└── SpacesControl.swift                      # Spaces 控制
```

## 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 单元测试
pnpm test

# E2E 测试
pnpm test:e2e

# 代码检查
pnpm lint
```

## 权限要求

启动时引导用户授权：
- 辅助功能（Accessibility）- 键盘/鼠标控制
- 屏幕录制（Screen Recording）- 截图
- 麦克风（Microphone）- 语音输入
- 完全磁盘访问（Full Disk Access）- 文件监控（可选）

## 系统要求

- **macOS 版本**: 13.0 (Ventura) 或更高
- **Node.js**: 20.x LTS
- **Ollama**: 本地安装并运行

## API 端点配置

### Qwen3-VL (阿里云)
```
Base URL: https://dashscope.aliyuncs.com/compatible-mode/v1
Model: qwen-vl-max
```

### 豆包 (字节跳动)
```
Base URL: https://ark.cn-beijing.volces.com/api/v3
Model: doubao-vision-pro-32k
API Key: 6b53f54e-11fc-4dee-a1ad-405098a4058d
```

**注意**: 豆包 API 需要在火山引擎控制台创建推理接入点（Endpoint），获取 Endpoint ID 后作为 model 参数使用。如果上述 API Key 对应的 Endpoint ID 不是 `doubao-vision-pro-32k`，需要在火山引擎控制台查看实际的 Endpoint ID。

### 字节语音服务
```
ASR WebSocket: wss://openspeech.bytedance.com/api/v2/asr
TTS WebSocket: wss://openspeech.bytedance.com/api/v2/tts
```

## 本地技术实现说明

### 声纹识别实现
使用本地声纹识别方案，无需额外 API：
- **技术方案**: 使用 `resemblyzer` 或 `speechbrain` 的预训练模型提取声纹特征向量
- **存储**: 声纹特征向量存储在本地 SQLite 数据库
- **匹配算法**: 余弦相似度，阈值 80%
- **Node.js 集成**: 通过 Python 子进程或 ONNX Runtime 调用

### RAG 实现（习惯学习 + 拒绝记忆）
使用本地向量数据库，无需云端服务：
- **向量数据库**: `vectra`（纯 TypeScript 实现）或 `lancedb`
- **Embedding 模型**: 使用 Ollama 运行本地 embedding 模型（如 `nomic-embed-text`）
- **存储位置**: `~/.jarvis/data/vectors/`
- **用途**:
  1. 用户习惯模式存储和检索
  2. 拒绝行为场景记忆
  3. 修正历史记录检索

### 需要额外下载的本地模型
```bash
# 小脑 UI 定位模型
ollama pull ahmadwaqar/mai-ui

# Embedding 模型（用于 RAG）
ollama pull nomic-embed-text

# 离线语音识别模型（Vosk）
# 下载地址: https://alphacephei.com/vosk/models
# 推荐: vosk-model-cn-0.22 (~200MB)
```

## 数据库 Schema

```sql
-- 任务表
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  current_step INTEGER DEFAULT 0,
  total_steps INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- 检查点表
CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  state TEXT NOT NULL,
  context TEXT,
  screenshot_path TEXT,
  created_at INTEGER NOT NULL,
  is_key_step INTEGER DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- 对话历史表
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- 用户习惯表
CREATE TABLE habits (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  frequency INTEGER DEFAULT 1,
  last_seen INTEGER NOT NULL,
  weight REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL
);

-- 修正历史表
CREATE TABLE corrections (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  drift_type TEXT NOT NULL,
  original_action TEXT,
  corrected_action TEXT,
  user_feedback TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

## 核心 Prompt 模板

### 大脑任务规划 Prompt
```
你是 Jarvis，一个 macOS 桌面 AI 助手。根据用户请求和当前屏幕截图，规划执行步骤。

输出格式（JSON）：
{
  "understanding": "对用户意图的理解",
  "steps": [
    {
      "id": "step_1",
      "description": "具体操作描述",
      "type": "click|type|scroll|hotkey|wait",
      "dependencies": [],
      "canPregenerate": true
    }
  ],
  "expectedOutcome": "预期结果"
}

注意：
1. 步骤要细粒度，每步只做一个操作
2. 标记步骤间的依赖关系
3. 标记可以并行预生成的步骤
```

### 小脑 UI 定位 Prompt
```
分析截图，定位目标 UI 元素的精确坐标。

目标：{target_description}

输出格式（JSON）：
{
  "found": true,
  "x": 123,
  "y": 456,
  "confidence": 0.95,
  "element_type": "button|input|link|menu",
  "element_text": "元素文本"
}

如果未找到目标，返回 found: false 并说明原因。
```

### 纠偏检查 Prompt
```
检查当前任务执行是否偏离目标。

原始目标：{original_goal}
已执行步骤：{completed_steps}
当前屏幕状态：[截图]

评估维度：
1. 目标偏离：当前状态是否偏离原始目标
2. 循环检测：是否在重复相同操作
3. 进展停滞：是否长时间无进展

输出格式（JSON）：
{
  "drift_level": "none|minor|moderate|severe",
  "analysis": "分析说明",
  "suggestion": "建议的修正方案"
}
```

## 错误处理策略

### API 调用失败
1. **重试策略**: 指数退避，最多 3 次
2. **超时处理**: 10s 超时后切换备用服务
3. **降级方案**:
   - Qwen3-VL 失败 → 切换豆包
   - 豆包失败 → 提示用户网络问题
   - ASR 失败 → 切换 Vosk 离线
   - TTS 失败 → 切换 macOS say

### Ollama 不可用
1. 检测 Ollama 进程是否运行
2. 尝试自动启动: `ollama serve`
3. 等待 5s 后重试连接
4. 失败后提示用户手动启动

### 权限被拒绝
1. 检测具体缺失的权限
2. 显示权限引导界面
3. 提供"打开系统偏好设置"按钮

## 环境变量 (.env.example)

```bash
# AI 服务 - 大脑 VLM
DOUBAO_API_KEY=6b53f54e-11fc-4dee-a1ad-405098a4058d
QWEN_API_KEY=f1181caebae94db6a1ff403625a7d612

# 字节语音服务
BYTEDANCE_APP_ID=9849623045
BYTEDANCE_ACCESS_TOKEN=06xaC6DV7Wz7dN44DaG1cSw66mtw-1mr
BYTEDANCE_SECRET_KEY=_Sr76vFPwSsmLOQKzkX1NXmtkC39lHLI

# 字节 ASR 资源包
BYTEDANCE_ASR_RESOURCE_ID=Speech_Recognition_Seed_streaming2000000560502727618

# 字节 TTS 资源包
BYTEDANCE_TTS_RESOURCE_ID=BigTTS2000000560125871330

# Ollama 小脑
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=ahmadwaqar/mai-ui

# 开发配置
NODE_ENV=development
LOG_LEVEL=debug
```

## 依赖列表 (package.json 核心依赖)

```json
{
  "dependencies": {
    "zustand": "^4.5.0",
    "mitt": "^3.0.1",
    "@trpc/server": "^10.45.0",
    "@trpc/client": "^10.45.0",
    "electron-trpc": "^0.5.0",
    "better-sqlite3": "^9.4.0",
    "drizzle-orm": "^0.29.0",
    "@nut-tree/nut-js": "^4.2.0",
    "framer-motion": "^11.0.0",
    "vosk": "^0.3.39",
    "silero-vad": "^0.1.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-vite": "^2.0.0",
    "typescript": "^5.3.0",
    "tailwindcss": "^3.4.0",
    "vitest": "^1.2.0",
    "@playwright/test": "^1.41.0",
    "electron-playwright-helpers": "^1.7.0",
    "msw": "^2.1.0",
    "drizzle-kit": "^0.20.0"
  }
}
```

## MCP 配置（开发调试用）

```json
{
  "mcpServers": {
    "electron": {
      "command": "npx",
      "args": ["-y", "electron-mcp-server"],
      "env": {
        "SECURITY_LEVEL": "development",
        "SCREENSHOT_ENCRYPTION_KEY": "fa869f6fbd40dc473a45ef972c500654d0fb8bc51d1e292d5cf89f4104aee6ec"
      }
    },
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "YOUR_API_KEY"
      }
    },
    "vibe_kanban": {
      "command": "npx",
      "args": ["-y", "vibe-kanban@latest", "--mcp"]
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

**注意**:
- Electron 应用调试优先使用 `electron` MCP，因为 Playwright 无法调试 Electron
- `context7` 用于查询最新的库文档
- `vibe_kanban` 用于任务管理

## 项目部署路径

最终项目路径: `~/NinotQuyi/jarvis`
