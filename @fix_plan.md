# Jarvis 实施计划

## 前置准备

### 环境检查清单
- [ ] macOS 13.0+ (Ventura 或更高)
- [ ] Node.js 20.x LTS 已安装
- [ ] pnpm 已安装 (`npm install -g pnpm`)
- [ ] Ollama 已安装并运行 (`brew install ollama && ollama serve`)
- [ ] MAI-UI 模型已下载 (`ollama pull ahmadwaqar/mai-ui`)
- [ ] Xcode Command Line Tools 已安装 (`xcode-select --install`)

### API 密钥准备（已配置）
- [x] 豆包 API Key: `6b53f54e-11fc-4dee-a1ad-405098a4058d`（主）
- [x] Qwen3-VL API Key: `f1181caebae94db6a1ff403625a7d612`（备用）
- [x] 字节语音服务凭证:
  - APP ID: `9849623045`
  - Access Token: `06xaC6DV7Wz7dN44DaG1cSw66mtw-1mr`
  - Secret Key: `_Sr76vFPwSsmLOQKzkX1NXmtkC39lHLI`
- [x] ASR 资源包: `Speech_Recognition_Seed_streaming2000000560502727618`（20小时）
- [x] TTS 资源包: `BigTTS2000000560125871330`（20000字）

### 项目路径
最终部署路径: `~/NinotQuyi/jarvis`

---

## Phase 1: 基础设施 + UI 框架（并行）

### 1A: 基础设施
- [ ] 初始化 Electron + electron-vite + TypeScript 项目
  ```bash
  pnpm create electron-vite jarvis --template react-ts
  cd jarvis
  pnpm install
  ```
  - 配置 TypeScript strict mode，路径别名 @/ → src/
  - 配置 ESLint + Prettier + Husky + lint-staged
- [ ] 实现核心基础设施
  - `src/main/core/EventBus.ts` - mitt 事件总线
  - `src/main/core/StateManager.ts` - Zustand 状态管理
  - `src/main/core/IPCBridge.ts` - electron-trpc IPC 通信
- [ ] 实现存储层
  - `src/main/store/Database.ts` - better-sqlite3 + drizzle-orm
  - `src/main/store/schema.ts` - 数据库 Schema 定义
  - 数据库位置: `~/.jarvis/data/jarvis.db`
  - 自动创建数据目录和迁移
- [ ] 创建环境配置
  - `.env.example` - 环境变量模板
  - `src/main/config/index.ts` - 配置加载器

### 1B: UI 框架
- [ ] 搭建 React 框架
  - React 18 + TypeScript
  - Tailwind CSS + CSS Modules
  - Framer Motion 动画库
- [ ] 实现液态玻璃主题系统
  - `src/renderer/theme/LiquidGlassTheme.ts`
  - `src/renderer/theme/colors.ts` - 颜色变量
  - 深色/浅色模式（跟随系统 + 手动选择）
  - Electron vibrancy 优先，CSS backdrop-filter 降级
- [ ] 实现灵动岛基础组件
  - `src/renderer/components/dynamic-island/DynamicIsland.tsx`
  - `src/renderer/components/dynamic-island/NotchIntegration.tsx`
  - `src/renderer/components/dynamic-island/IslandStates.tsx` - 8 种状态
  - 单击展开详情，双击打开主界面
  - 全屏应用时自动隐藏 (NSWindow level 检测)
- [ ] 实现系统托盘
  - `src/main/tray/TrayManager.ts`
  - 简约线条 Template Image (16x16, 32x32)

**验证标准**:
1. `pnpm dev` 启动成功，无报错
2. 灵动岛显示在屏幕顶部中央
3. 冷启动时间 < 3 秒 (使用 `console.time` 测量)
4. 数据库文件创建在 `~/.jarvis/data/jarvis.db`
5. 深色/浅色模式切换正常

---

## Phase 2: 感知层

- [ ] 实现屏幕捕获服务
  - `src/main/services/perception/ScreenCapture.ts`
  - Electron desktopCapturer API
  - 全屏截图后等比例压缩 (最大 1920x1080)
  - pHash 相似度检测（95% 阈值去重）
  - 动态频率（空闲 5s，活跃 2s，任务执行时立即）
  - 24 小时截图存储，自动清理过期文件
- [ ] 实现窗口监控
  - `src/main/services/perception/WindowMonitor.ts`
  - AppleScript 获取当前活动窗口
  - 窗口切换事件监听
  - 获取窗口标题、应用名称、bounds
- [ ] 实现活动追踪
  - `src/main/services/perception/ActivityTracker.ts`
  - 全量键盘监控（使用 iohook 或 node-global-key-listener）
  - 全量鼠标监控（位置 + 轨迹 + 点击）
  - 文件监控（使用 chokidar）
- [ ] 实现权限引导
  - `src/renderer/components/onboarding/PermissionGuide.tsx`
  - 检测各项权限状态
  - 启动时引导授权
  - 设置页面权限入口
  - 提供"打开系统偏好设置"按钮

**验证标准**:
1. 截图功能正常，图片保存到 `~/.jarvis/data/screenshots/`
2. pHash 去重生效，相似截图不重复保存
3. 键盘/鼠标事件能正确捕获并记录
4. 权限缺失时显示引导界面
5. 24h 后旧截图自动清理

---

## Phase 3: 执行层

- [ ] 实现 nut.js 适配器
  - `src/main/services/operator/NutJSAdapter.ts`
  - 平滑鼠标移动（贝塞尔曲线，模拟人类）
  - 键盘输入（可配置延迟，默认 50ms）
  - 剪贴板粘贴中文 (使用 clipboard API)
  - 操作失败不重试（可配置重试次数）
  - 屏幕坐标与 Retina 显示器 DPI 转换
- [ ] 实现动作解析器
  - `src/main/services/operator/ActionParser.ts`
  - 解析大脑输出的 JSON 动作指令
  - 支持类型: click, type, scroll, hotkey, wait
  - 坐标验证（确保在屏幕范围内）
- [ ] 实现 AppleScript 适配器
  - `src/main/services/operator/AppleScriptAdapter.ts`
  - osascript 命令行执行
  - 应用启动/切换/关闭
  - 获取应用列表
- [ ] 实现 Swift Spaces 控制
  - `native/spaces-control/SpacesControl.swift`
  - 创建/切换/删除虚拟桌面
  - 编译为命令行工具: `swift build -c release`
  - Node.js 通过 child_process 调用

**验证标准**:
1. 鼠标能移动到指定坐标并点击
2. 键盘能输入英文和中文
3. 热键组合能正确触发 (如 Cmd+Space)
4. AppleScript 能启动/切换应用
5. Swift 工具能创建新的虚拟桌面

---

## Phase 4: 认知层

- [ ] 实现大脑服务
  - `src/main/services/brain/BrainService.ts` - 主服务
  - `src/main/services/brain/DoubaoProvider.ts` - 豆包 API（主）
    - Base URL: `https://ark.cn-beijing.volces.com/api/v3`
    - API Key: `6b53f54e-11fc-4dee-a1ad-405098a4058d`
    - 流式响应处理
  - `src/main/services/brain/QwenProvider.ts` - Qwen3-VL API（备用）
    - Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
    - API Key: `f1181caebae94db6a1ff403625a7d612`
  - `src/main/services/brain/prompts/` - Prompt 模板目录
  - 流式 API 调用，实时返回 token
  - 20 轮对话历史（超过后自动摘要压缩）
  - 10s 响应超时，超时后切换备用
  - 指数退避重试（最多 3 次）
- [ ] 实现小脑服务
  - `src/main/services/cerebellum/CerebellumService.ts`
  - `src/main/services/cerebellum/OllamaClient.ts` - Ollama 客户端
  - 模型: `ahmadwaqar/mai-ui`（基于 Qwen-VL 微调）
  - 端点: `http://localhost:11434`
  - UI 元素定位，输出精准坐标 (x, y)
  - Ollama 健康检查和自动启动
  - 连接失败时提示用户
- [ ] 实现大脑-小脑协作
  - `src/main/services/brain/BrainCerebellumCoordinator.ts`
  - 步骤标记协议 (TaskStep interface)
  - 并行指令预生成（无依赖步骤提前处理）
  - 关键节点汇报机制

**验证标准**:
1. 豆包 API 调用成功，返回流式响应
2. Qwen3-VL API 作为备用能正常切换
3. Ollama 小脑能定位截图中的 UI 元素
4. 大脑规划的步骤能被小脑正确执行
5. 对话历史超过 20 轮时自动摘要

---

## Phase 5: 语音交互

- [ ] 集成字节流式 ASR
  - `src/main/services/voice/ByteDanceASR.ts`
  - API 文档: https://www.volcengine.com/docs/6561/1354869?lang=zh
  - WebSocket 端点: `wss://openspeech.bytedance.com/api/v2/asr`
  - 资源包 ID: `Speech_Recognition_Seed_streaming2000000560502727618`
  - 长连接流式识别，保持连接复用
  - 实时转写显示到灵动岛
  - 断线自动重连（最多 3 次）
- [ ] 集成字节 TTS
  - `src/main/services/voice/ByteDanceTTS.ts`
  - API 文档: https://www.volcengine.com/docs/6561/1257584?lang=zh
  - WebSocket 端点: `wss://openspeech.bytedance.com/api/v2/tts`
  - 资源包 ID: `BigTTS2000000560125871330`
  - 流式语音合成，边生成边播放
  - 用户可选音色（3-5 种预设）
  - 可调节语速（0.8x-1.5x）
- [ ] 实现无唤醒词智能监听
  - `src/main/services/voice/SmartListenerAgent.ts`
  - **无唤醒词设计**: 启动后持续后台监听
  - **Agent 智能判断**: 实时分析语音内容和音色，判断是否在和 Jarvis 说话
    - 结合声纹识别区分主用户和旁人
    - 分析语音内容语义判断是否是指令（如包含"帮我"、"打开"、"搜索"等）
    - 区分人声和环境噪音（使用 Silero VAD）
    - 上下文感知：如果用户正在与 Jarvis 对话中，降低判断阈值
  - 判断置信度阈值：70%（可配置）
  - 不确定时可询问用户确认
- [ ] 实现声纹注册和识别
  - `src/main/services/voice/VoiceprintManager.ts`
  - 多用户声纹注册（本地存储特征向量）
  - 首次使用引导（显示冷笑话让用户朗读）
  - 声纹识别阈值 80%（可配置）
  - 注册失败强制重试直到成功
- [ ] 实现打断检测
  - `src/main/services/voice/InterruptionDetector.ts`
  - Silero VAD 集成（ONNX Runtime）
  - 150ms 持续人声才算打断
  - 软件回声消除 + 声纹排除自己的声音
- [ ] 实现离线备用
  - `src/main/services/voice/VoskOffline.ts`
  - Vosk 中等模型（~200MB，中文）
  - macOS `say` 命令作为离线 TTS
  - 网络断开自动切换，恢复后切回

**验证标准**:
1. 语音输入能实时转写并显示
2. TTS 播放流畅，无明显延迟
3. 说话时能打断 TTS 播放
4. 声纹注册后能识别用户
5. 断网后自动切换离线模式
6. Agent 能正确判断用户是否在和 Jarvis 说话
7. 旁人说话不会误触发响应

---

## Phase 6: 主动系统

- [ ] 实现观察循环
  - `src/main/services/proactive/ObservationLoop.ts`
  - 空闲 5 秒，活跃 2 秒截图
  - pHash 变化检测（> 5% 触发分析）
  - CPU 占用 < 5%
- [ ] 实现意图预测
  - `src/main/services/proactive/IntentPredictor.ts`
  - 触发条件：重复操作 + 用户犹豫 + 定期分析
  - 预测置信度阈值 70%
  - 预测结果缓存 5 分钟
- [ ] 实现用户习惯学习
  - `src/main/services/proactive/HabitLearner.ts`
  - 每天凌晨更新习惯模型
  - 最近 7 天权重更高
  - 30 天未出现的模式降低权重
- [ ] 实现鼠标跟随提示
  - `src/renderer/components/mouse-hint/MouseHint.tsx`
  - 液态玻璃风格
  - 智能位置（避开重要内容）
  - 500ms 延迟显示，5 秒自动消失
  - 只显示最可能的一个预测
- [ ] 实现拒绝行为记忆
  - RAG 记录用户拒绝的场景
  - 避免重复打扰
  - 无冷却时间（可配置）

**验证标准**:
1. 观察循环 CPU 占用 < 5%（使用 Activity Monitor 验证）
2. 重复操作 3 次后触发主动提示
3. 用户犹豫 5 秒后显示建议
4. 鼠标跟随提示正确显示在光标附近
5. 拒绝后相同场景不再提示（RAG 记忆生效）
6. 习惯学习能识别用户常用操作模式

---

## Phase 7: 纠偏系统

- [ ] 实现分叉检查机制
  - `src/main/services/drift/DriftChecker.ts`
  - 触发条件：每 10 轮 + 检测到异常 + 用户请求
  - 内存中创建分叉副本
  - 30s 检查超时
- [ ] 实现偏差检测和修正
  - `src/main/services/drift/DriftAnalyzer.ts`
  - 偏差分级：minor/moderate/severe
  - minor: 提示继续
  - moderate: 询问用户
  - severe: 强制暂停
- [ ] 实现用户介入处理
  - `src/renderer/components/dynamic-island/InterventionPanel.tsx`
  - 继续/重试/取消/手动接管/发送消息
  - 用户介入超时：5 分钟后暂停
  - 手动接管后 Agent 观察学习
- [ ] 实现修正历史记录
  - RAG 记录修正历史
  - 用户可查看 + 训练数据

**验证标准**:
1. 每 10 轮对话自动触发纠偏检查
2. 检测到循环操作时触发异常检查
3. minor 偏差显示提示但继续执行
4. moderate 偏差弹出询问面板
5. severe 偏差强制暂停任务
6. 用户手动接管后 Agent 进入观察模式
7. 修正历史正确记录到数据库

---

## Phase 8: 长时间工作

- [ ] 实现任务状态机
  - `src/main/services/task/TaskStateMachine.ts`
  - 7 种状态：pending/running/paused/blocked/completed/failed/cancelled
  - 每次状态变化持久化
  - 任务队列顺序执行
  - 三级优先级（高/中/低）
- [ ] 实现检查点管理
  - `src/main/services/task/CheckpointManager.ts`
  - 步骤完成 + 30s 定时创建
  - 混合存储：元数据 SQLite，截图文件
  - 保留最近 10 个 + 关键步骤检查点
  - 任意检查点回滚
- [ ] 实现崩溃恢复
  - `src/main/services/task/CrashRecovery.ts`
  - 心跳机制：每 5 秒写入时间戳
  - 启动时检测：上次心跳 > 30 秒 = 崩溃
  - 显示恢复选项（恢复/放弃/查看详情）
  - 恢复前验证当前状态
  - 能撤回的自动撤回，不能撤回的交给 Agent
- [ ] 实现进度显示
  - 基于步骤数计算进度
  - 显示预估剩余时间（标注"预估"）

**验证标准**:
1. 任务状态正确流转（pending → running → completed）
2. 每 30 秒自动创建检查点
3. 步骤完成时创建关键检查点
4. 检查点数量不超过 10 个（自动清理旧的）
5. 模拟崩溃后重启，显示恢复选项
6. 选择恢复后从最近检查点继续
7. 进度百分比和预估时间正确显示
8. 高优先级任务能插队执行

---

## Phase 9: UI 完善

- [ ] 完善灵动岛动画
  - `src/renderer/components/dynamic-island/BreathingAnimation.tsx`
  - 弹性动画（300ms）
  - 向下展开，尺寸自适应
  - 各状态视觉表现
- [ ] 实现主界面
  - `src/renderer/components/dashboard/MainWindow.tsx`
  - 标签页式布局（对话/任务/设置）
  - 可调整尺寸 + 可全屏
  - 记住上次位置
  - 液态玻璃风格消息样式
- [ ] 实现任务页
  - `src/renderer/components/dashboard/TaskPanel.tsx`
  - 任务队列显示
  - 进度显示
  - 检查点管理
  - Agent 实时操作可视化预览监控
- [ ] 实现通知系统
  - 主要使用灵动岛通知
  - 避免系统右上角弹窗
  - macOS 系统通知可配置
  - 声音提示默认开启
- [ ] 实现飞入融合效果
  - `src/renderer/components/mouse-hint/FlyToIsland.tsx`
  - 贝塞尔曲线飞行轨迹
  - 液态融合效果

**验证标准**:
1. 灵动岛 8 种状态切换动画流畅（300ms）
2. 单击灵动岛展开详情面板
3. 双击灵动岛打开主界面
4. 主界面三个标签页切换正常
5. 对话页消息显示液态玻璃风格
6. 任务页实时显示 Agent 操作预览
7. 窗口位置和尺寸重启后保持
8. 通知优先显示在灵动岛，不弹系统通知
9. 飞入融合动画效果自然

---

## Phase 10: 测试与优化

### 基础测试
- [ ] 配置 Vitest 单元测试
  - 核心模块覆盖率 > 80%
  - Mock VLM 响应（离线开发）
- [ ] 配置 Playwright E2E 测试
  - electron-playwright-helpers 集成
  - MSW Mock 服务

### 全流程验证测试
- [ ] 实现测试场景脚本
  - 场景 1: 首次启动流程（权限引导、声纹注册）
  - 场景 2: 语音对话流程（ASR → AI → TTS → 执行）
  - 场景 3: 长任务执行（检查点、崩溃恢复）
  - 场景 4: 纠偏系统（偏差检测、用户介入）
  - 场景 5: 主动建议（意图预测、自动化执行）
  - 场景 6: UI 交互（灵动岛、主界面）
- [ ] 配置测试录制
  - 截图 + 视频
  - 可切换真实 API / Mock
  - 固定测试数据
  - 串行执行（避免冲突）
- [ ] 配置 GitHub Actions CI
  - macOS runner
  - 自动运行 E2E 测试
  - 上传测试结果 artifacts

### 性能优化
- [ ] 启动时间优化
  - 目标: < 3 秒冷启动
  - 懒加载模块
  - 代码分割
  - 预加载关键资源
- [ ] 内存优化
  - 目标: < 500MB 空闲时
- [ ] 日志系统
  - 控制台 + 文件
  - 7 天保留
  - 敏感信息自动脱敏

**验证**: 所有测试通过，性能指标达标

**Phase 10 验证标准**:
1. 单元测试覆盖率 > 80%（使用 `vitest --coverage` 验证）
2. 所有 6 个 E2E 测试场景通过
3. 冷启动时间 < 3 秒（测量 3 次取平均）
4. 空闲内存 < 500MB（Activity Monitor 验证）
5. GitHub Actions CI 自动运行测试
6. 测试录制视频可回放
7. 日志文件正确写入 `~/.jarvis/logs/`
8. 敏感信息（API Key）在日志中脱敏显示

---

## 端到端测试场景

1. **首次启动测试**
   - 权限引导界面
   - 声纹注册流程
   - 灵动岛正常显示

2. **语音交互测试**
   - 语音识别准确率
   - 打断响应时间
   - 离线切换

3. **Computer Use 测试**
   - 打开 Chrome 浏览器
   - 访问 github.com
   - 搜索 "jarvis"

4. **主动帮助测试**
   - 检测重复操作
   - 主动提示显示
   - 用户确认后执行

5. **长时间任务测试**
   - 运行 30 分钟任务
   - 检查点创建
   - 模拟崩溃恢复

6. **纠偏系统测试**
   - 模拟任务偏离
   - 偏差检测触发
   - 用户介入处理

---

## 最终交付检查清单

在所有 Phase 完成后，必须通过以下检查才能视为交付完成：

### 功能完整性检查
- [ ] 灵动岛 8 种状态全部实现且可切换
- [ ] 语音输入/输出完整工作
- [ ] Computer Use 能执行基本操作（点击、输入、滚动）
- [ ] 主动提示功能正常触发
- [ ] 纠偏系统能检测并处理偏差
- [ ] 长任务检查点和恢复功能正常
- [ ] 主界面三个标签页功能完整

### 稳定性检查
- [ ] 连续运行 1 小时无崩溃
- [ ] 内存无明显泄漏（1 小时后内存增长 < 100MB）
- [ ] 所有 API 调用有错误处理和降级方案
- [ ] 网络断开后能切换离线模式

### 用户体验检查
- [ ] 首次启动引导流程完整
- [ ] 所有动画流畅（无卡顿）
- [ ] 错误信息对用户友好
- [ ] 设置项可正常保存和加载

### 代码质量检查
- [ ] TypeScript 无编译错误
- [ ] ESLint 无错误（警告可接受）
- [ ] 单元测试覆盖率 > 80%
- [ ] 所有 E2E 测试通过

### 文档检查
- [ ] README.md 包含安装和使用说明
- [ ] 环境变量配置说明完整
- [ ] API 密钥获取指南

---

## 已知风险和缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Ollama 模型下载慢 | 首次启动延迟 | 提供预下载脚本，显示下载进度 |
| 字节语音服务不稳定 | 语音功能中断 | 自动切换 Vosk 离线模式 |
| macOS 权限被拒绝 | 功能受限 | 清晰的权限引导，提供手动开启入口 |
| Retina 屏幕坐标问题 | 点击位置偏移 | DPI 缩放转换，测试多种分辨率 |
| 中文输入法兼容 | 输入异常 | 使用剪贴板粘贴方式 |
| API 配额耗尽 | 服务不可用 | 显示配额警告，支持多 API Key |
