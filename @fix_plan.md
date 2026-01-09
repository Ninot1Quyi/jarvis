# Jarvis 实施计划

## Phase 1: 基础设施 + UI 框架（并行）

### 1A: 基础设施
- [ ] 初始化 Electron + Vite + TypeScript 项目
  - 创建项目结构
  - 配置 ESLint、Prettier、TypeScript
  - 配置 Vitest 测试框架
- [ ] 实现核心基础设施
  - `src/main/core/EventBus.ts` - 事件总线
  - `src/main/core/StateManager.ts` - 状态管理
  - `src/main/core/IPCBridge.ts` - IPC 通信层
- [ ] 实现存储层
  - `src/main/store/SQLiteStore.ts` - SQLite 存储
  - `src/main/store/HabitDatabase.ts` - 习惯数据库

### 1B: UI 框架
- [ ] 搭建 React 框架
  - 配置 React + TypeScript
  - 设置热重载
- [ ] 实现液态玻璃主题系统
  - `src/renderer/theme/LiquidGlassTheme.ts`
  - 深色/浅色模式自动切换
  - CSS 变量定义
- [ ] 实现灵动岛基础组件
  - `src/renderer/components/dynamic-island/DynamicIsland.tsx`
  - `src/renderer/components/dynamic-island/NotchIntegration.tsx`
  - 基础状态切换（休眠/工作/通知）
- [ ] 实现系统托盘
  - `src/main/tray/TrayManager.ts`

**验证**: 运行 `npm run dev`，确认灵动岛显示在屏幕顶部

---

## Phase 2: 感知层

- [ ] 实现屏幕捕获服务
  - `src/main/services/perception/ScreenCapture.ts`
  - 截图功能
  - pHash 去重算法
- [ ] 实现窗口监控
  - `src/main/services/perception/WindowMonitor.ts`
  - 获取当前活动窗口
  - 窗口切换事件
- [ ] 实现活动追踪
  - `src/main/services/perception/ActivityTracker.ts`
  - 键盘事件监控
  - 鼠标事件监控
  - 设备连接监控

**验证**: 运行测试，确认能正确捕获屏幕和监控窗口

---

## Phase 3: 执行层

- [ ] 实现 nut.js 适配器
  - `src/main/services/operator/NutJSAdapter.ts`
  - 鼠标移动、点击
  - 键盘输入
  - 屏幕坐标转换
- [ ] 实现动作解析器
  - `src/main/services/operator/ActionParser.ts`
  - 解析大脑输出的动作指令
- [ ] 实现 AppleScript 适配器
  - `src/main/services/operator/AppleScriptAdapter.ts`
  - 应用控制
  - 系统操作
- [ ] 实现 Swift Spaces 控制
  - `native/spaces-control/SpacesControl.swift`
  - 创建/切换虚拟桌面
  - 编译为 Node.js 可调用模块

**验证**: 运行测试，确认能正确执行鼠标点击和键盘输入

---

## Phase 4: 认知层

- [ ] 实现大脑服务
  - `src/main/services/brain/BrainService.ts` - 主服务
  - `src/main/services/brain/DoubaoProvider.ts` - 豆包 API
  - `src/main/services/brain/QwenProvider.ts` - Qwen API
  - 任务规划 Prompt
  - 结果验证 Prompt
- [ ] 实现小脑服务
  - `src/main/services/cerebellum/CerebellumService.ts`
  - `src/main/services/cerebellum/MAIUIClient.ts` - Ollama 客户端
  - UI 元素定位
  - 精准坐标输出
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
  - WebSocket 流式识别
  - 实时转写
- [ ] 集成字节 TTS
  - `src/main/services/voice/ByteDanceTTS.ts`
  - 流式语音合成
  - 自然停顿控制
- [ ] 实现声纹注册和识别
  - `src/main/services/voice/VoiceprintManager.ts`
  - 首次使用引导（冷笑话朗读）
  - 声纹特征提取和匹配
- [ ] 实现打断检测
  - `src/main/services/voice/InterruptionDetector.ts`
  - Silero VAD 集成
  - 能量检测 + 频谱分析
  - 150ms 阈值判断
- [ ] 实现离线备用
  - `src/main/services/voice/VoskOffline.ts`
  - 网络断开自动切换
- [ ] 实现文本输入备选
  - `src/renderer/components/voice/TextInput.tsx`

**验证**: 运行应用，测试语音识别、合成、打断功能

---

## Phase 6: 主动系统

- [ ] 实现观察循环
  - `src/main/services/proactive/ObservationLoop.ts`
  - 5秒周期截图
  - 变化检测
- [ ] 实现意图预测
  - `src/main/services/proactive/IntentPredictor.ts`
  - 分析最近操作序列
  - 匹配历史习惯模式
  - 结合当前上下文预测
- [ ] 实现用户习惯学习
  - `src/main/services/proactive/HabitLearner.ts`
  - 应用使用记录
  - 操作模式识别
  - 时间习惯分析
- [ ] 实现鼠标跟随提示
  - `src/renderer/components/mouse-hint/MouseHint.tsx`
  - Spotlight 风格设计
  - 智能避让算法
  - 5秒自动消失
  - 轻柔"叮"声提示

**验证**: 运行应用，测试主动提示功能

---

## Phase 7: 纠偏系统

- [ ] 实现分叉检查机制
  - `src/main/services/drift/DriftChecker.ts`
  - 每 10 轮对话触发检查
  - 创建分叉分支
  - 纠偏分析 Prompt
- [ ] 实现偏差检测和修正
  - `src/main/services/drift/DriftAnalyzer.ts`
  - 偏差严重程度评估
  - 修正建议生成
  - 合并修正到主分支
- [ ] 实现用户介入处理
  - `src/renderer/components/dynamic-island/InterventionPanel.tsx`
  - 继续/重试/取消/手动接管/发送消息
  - 灵动岛展开显示选项

**验证**: 模拟任务偏离，测试纠偏机制

---

## Phase 8: 长时间工作

- [ ] 实现任务状态机
  - `src/main/services/task/TaskStateMachine.ts`
  - 状态定义和转换
  - 持久化
- [ ] 实现检查点管理
  - `src/main/services/task/CheckpointManager.ts`
  - 关键步骤检查点
  - 截图和状态保存
  - 回滚支持
- [ ] 实现崩溃恢复
  - `src/main/services/task/CrashRecovery.ts`
  - 30秒自动保存
  - 启动时恢复检查
  - 用户通知

**验证**: 模拟崩溃，测试恢复功能

---

## Phase 9: UI 完善

- [ ] 完善灵动岛动画
  - `src/renderer/components/dynamic-island/BreathingAnimation.tsx`
  - 呼吸动画（脉冲/膨胀收缩）
  - 扩展动画（液态扩展）
  - 收缩动画
- [ ] 实现通知展开动画
  - `src/renderer/components/dynamic-island/NotificationCard.tsx`
  - 卡片式展开
  - 丝滑过渡
- [ ] 实现飞入融合效果
  - `src/renderer/components/mouse-hint/FlyToIsland.tsx`
  - 贝塞尔曲线飞行轨迹
  - 液态融合效果
- [ ] 实现实时视频预览
  - `src/renderer/components/dynamic-island/VideoPreview.tsx`
  - 悬浮显示
  - 小白鼠标指针标识

**验证**: 视觉检查所有动画效果

---

## Phase 10: 测试与优化

- [ ] 使用 electron MCP 进行调试
  - 配置 MCP 服务器
  - 端到端测试脚本
- [ ] 单元测试
  - 核心服务测试
  - 工具函数测试
- [ ] 集成测试
  - 大脑-小脑协作测试
  - 语音交互测试
  - 纠偏系统测试
- [ ] 性能优化
  - 内存使用优化
  - 响应延迟优化
  - 截图频率调优

**验证**: 所有测试通过，性能指标达标

---

## 端到端测试场景

1. **Computer Use 基础测试**
   - 打开 Chrome 浏览器
   - 访问 github.com
   - 搜索 "jarvis"

2. **语音交互测试**
   - 语音识别准确率
   - 打断响应时间
   - 离线切换

3. **主动帮助测试**
   - 检测重复操作
   - 主动提示显示
   - 用户确认后执行

4. **长时间任务测试**
   - 运行 30 分钟任务
   - 检查点创建
   - 模拟崩溃恢复
