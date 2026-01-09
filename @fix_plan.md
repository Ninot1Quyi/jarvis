# Jarvis 实施计划

## Phase 1: 基础设施 + UI 框架（并行）

### 1A: 基础设施
- [ ] 初始化 Electron + electron-vite + TypeScript 项目
  - 使用 electron-vite 模板创建项目
  - 配置 TypeScript strict mode，路径别名 @/ → src/
  - 配置 ESLint + Prettier + Husky + lint-staged
  - 配置 pnpm 包管理器
- [ ] 实现核心基础设施
  - `src/main/core/EventBus.ts` - mitt 事件总线
  - `src/main/core/StateManager.ts` - Zustand 状态管理
  - `src/main/core/IPCBridge.ts` - electron-trpc IPC 通信
- [ ] 实现存储层
  - `src/main/store/Database.ts` - better-sqlite3 + drizzle-orm
  - 数据库位置: `~/.jarvis/data/jarvis.db`
  - `src/main/store/HabitDatabase.ts` - 习惯数据存储

### 1B: UI 框架
- [ ] 搭建 React 框架
  - React 18 + TypeScript
  - Tailwind CSS + CSS Modules
  - Framer Motion 动画库
- [ ] 实现液态玻璃主题系统
  - `src/renderer/theme/LiquidGlassTheme.ts`
  - macOS 液态玻璃风格
  - 深色/浅色模式（跟随系统 + 手动选择）
  - Electron vibrancy 优先，CSS 降级
- [ ] 实现灵动岛基础组件
  - `src/renderer/components/dynamic-island/DynamicIsland.tsx`
  - `src/renderer/components/dynamic-island/NotchIntegration.tsx`
  - 8 种状态：idle/listening/thinking/speaking/working/paused/error/notification
  - 单击展开详情，双击打开主界面
  - 全屏应用时自动隐藏
- [ ] 实现系统托盘
  - `src/main/tray/TrayManager.ts`
  - 简约线条 Template Image

**验证**: 运行 `pnpm dev`，确认灵动岛显示在屏幕顶部，冷启动 < 3 秒

---

## Phase 2: 感知层

- [ ] 实现屏幕捕获服务
  - `src/main/services/perception/ScreenCapture.ts`
  - Electron desktopCapturer API
  - 全屏截图后等比例压缩
  - pHash 相似度检测（95% 阈值去重）
  - 动态频率（空闲 5s，活跃 2s，任务执行时立即）
  - 24 小时截图存储
- [ ] 实现窗口监控
  - `src/main/services/perception/WindowMonitor.ts`
  - AppleScript 获取当前活动窗口
  - 窗口切换事件
- [ ] 实现活动追踪
  - `src/main/services/perception/ActivityTracker.ts`
  - 全量键盘监控（包括具体按键）
  - 全量鼠标监控（位置 + 轨迹 + 点击）
  - 全量文件监控
- [ ] 实现权限引导
  - `src/renderer/components/onboarding/PermissionGuide.tsx`
  - 启动时引导授权
  - 设置页面权限入口

**验证**: 运行测试，确认能正确捕获屏幕和监控所有输入

---

## Phase 3: 执行层

- [ ] 实现 nut.js 适配器
  - `src/main/services/operator/NutJSAdapter.ts`
  - 平滑鼠标移动（模拟人类）
  - 键盘输入（可配置延迟，默认 50ms）
  - 剪贴板粘贴中文
  - 操作失败不重试（可配置）
- [ ] 实现动作解析器
  - `src/main/services/operator/ActionParser.ts`
  - 解析大脑输出的动作指令
  - 坐标定位（小脑输出精准坐标）
- [ ] 实现 AppleScript 适配器
  - `src/main/services/operator/AppleScriptAdapter.ts`
  - osascript 命令行执行
  - 应用控制、系统操作
- [ ] 实现 Swift Spaces 控制
  - `native/spaces-control/SpacesControl.swift`
  - 创建/切换虚拟桌面
  - 编译为命令行工具

**验证**: 运行测试，确认能正确执行鼠标点击和键盘输入

---

## Phase 4: 认知层

- [ ] 实现大脑服务
  - `src/main/services/brain/BrainService.ts` - 主服务
  - `src/main/services/brain/QwenProvider.ts` - Qwen3-VL API（主）
  - `src/main/services/brain/DoubaoProvider.ts` - 豆包 API（备用）
  - 流式 API 调用
  - 20 轮对话历史（超过自动摘要）
  - 10s 响应超时（可配置）
- [ ] 实现小脑服务
  - `src/main/services/cerebellum/CerebellumService.ts`
  - `src/main/services/cerebellum/MAIUIClient.ts` - Ollama 客户端
  - UI 元素定位，精准坐标输出
  - Ollama 不可用时自动尝试启动
- [ ] 实现大脑-小脑协作
  - `src/main/services/brain/BrainCerebellumCoordinator.ts`
  - 步骤标记协议 (TaskStep)
  - 并行指令预生成
  - 关键节点汇报机制

**验证**: 运行测试，确认大脑能规划任务，小脑能执行操作

---

## Phase 5: 语音交互

- [ ] 集成字节流式 ASR
  - `src/main/services/voice/ByteDanceASR.ts`
  - 长连接 WebSocket 流式识别
  - 实时转写显示
- [ ] 集成字节 TTS
  - `src/main/services/voice/ByteDanceTTS.ts`
  - 流式语音合成
  - 用户可选音色（3-5 种）
  - 可调节语速（0.8x-1.5x）
- [ ] 实现声纹注册和识别
  - `src/main/services/voice/VoiceprintManager.ts`
  - 多用户声纹注册
  - 首次使用引导（冷笑话朗读）
  - 声纹识别阈值 80%（可配置）
  - 注册失败强制重试
- [ ] 实现打断检测
  - `src/main/services/voice/InterruptionDetector.ts`
  - Silero VAD 集成
  - 150ms 阈值判断
  - 软件回声消除 + 声纹排除
- [ ] 实现离线备用
  - `src/main/services/voice/VoskOffline.ts`
  - Vosk 中等模型（200MB）
  - macOS say 命令 TTS
  - 网络断开自动切换

**验证**: 运行应用，测试语音识别、合成、打断功能

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

**验证**: 运行应用，测试主动提示功能

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

**验证**: 模拟任务偏离，测试纠偏机制

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

**验证**: 模拟崩溃，测试恢复功能

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

**验证**: 视觉检查所有动画效果，确认液态玻璃风格

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
