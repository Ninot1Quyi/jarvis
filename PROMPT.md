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
| 大脑 VLM | Qwen3-VL（主） | API Key: `f1181caebae94db6a1ff403625a7d612` |
| 大脑 VLM | 豆包（备用） | API Key: `6b53f54e-11fc-4dee-a1ad-405098a4058d` |
| 小脑 | MAI-UI-2b | Ollama `localhost:11434`, model: `ahmadwaqar/mai-ui` |
| 语音识别 | 字节流式 ASR | APP ID: `9849623045` |
| 语音合成 | 字节 TTS | 同上 |
| 离线备用 | Vosk + Silero VAD | 本地模型 |
| 桌面自动化 | nut.js + AppleScript + Swift | macOS 专用 |

### 字节语音服务认证
- APP ID: `9849623045`
- Access Token: `06xaC6DV7Wz7dN44DaG1cSw66mtw-1mr`
- Secret Key: `_Sr76vFPwSsmLOQKzkX1NXmtkC39lHLI`

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

## MCP 配置

```json
{
  "mcpServers": {
    "electron": {
      "command": "npx",
      "args": ["-y", "electron-mcp-server"],
      "env": {
        "SECURITY_LEVEL": "development"
      }
    },
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```
