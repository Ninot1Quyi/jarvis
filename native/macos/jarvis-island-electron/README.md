# Jarvis Island (Electron)

这个目录是当前 Swift 版灵动岛的 Electron 复刻实现，目标是保持同一套交互节奏与信息结构：

- `idle / working-compact / expanded` 三态
- hover 展开与收回策略
- 右上角心跳状态
- 展开态左侧“上一轮看到的图”叠放卡片
- 展开态右侧流式回复 + 工具调用摘要
- 底部单一文本输入框（无发送按钮）

## 运行

```bash
cd native/macos/jarvis-island-electron
npm install
npm start
```

默认 `npm start` 为 **native-shell 模式**：

- Electron 负责状态流与桥接
- Swift 壳体（`native/macos/jarvis-island`）负责顶层窗口与交互
- 二者通过 Unix Domain Socket 通信（替代 `stdin`）

可复用核心已拆分到：

- `core/island-protocol.js`：快照协议与构造方法
- `core/island-engine.js`：状态机/工作流引擎（可在其他平台桥接复用）
- `core/island-live-source.js`：真实数据源（读取 `data/traces/*.jsonl` 实时映射为灵动岛快照）

默认会优先读取真实数据（`traceLogger` 输出的 JSONL）：

- 优先目录：`$JARVIS_ISLAND_DATA_DIR/traces`（若设置）
- 其次：`$JARVIS_REPO_ROOT/data/traces`
- 自动推断：当前 worktree 与主仓库的 `data/traces`

可选环境变量：

- `JARVIS_ISLAND_DEMO=1`：强制回退到 demo engine
- `JARVIS_ISLAND_POLL_MS=650`：真实数据轮询间隔
- `JARVIS_ISLAND_IDLE_AFTER_MS=9000`：无事件后回到 idle 的超时
- `JARVIS_A2A_URL=http://127.0.0.1:3000/a2a`：岛内输入回传到 Jarvis 的 A2A 入口
- `JARVIS_A2A_TIMEOUT_MS=2800`：A2A 请求超时

输入回传链路（已启用）：

- Swift 壳体把 `send/dismiss` 对话事件通过 UDS 回传给 bridge
- bridge 收到 `send` 事件后会立即刷新灵动岛状态，并尝试把文本转发到 Jarvis A2A

要让输入真正进入 Jarvis 主循环，需要在 Jarvis 主进程配置并开启 A2A（默认端口 `3000`）。

只运行 Electron 复刻窗口（不走 Swift 壳体）：

```bash
npm run start:web-shell
```

开发调试（带 DevTools）：

```bash
npm run start:devtools
```

语法检查：

```bash
npm run check
```

## 桥接输入

native-shell 模式下，Electron 会启动 Swift 壳体并通过 UDS 推送 JSON 快照。  
Swift 侧对应 Provider：`SocketStatusProvider`。

## 贴边封装（统一接口）

Electron 主进程通过统一接口调用：

- 上层：`window-edge/controller.js`
- 下层平台实现：
  - macOS：Swift helper（`native/macos/window-edge-agent`，通过 Accessibility API 调整窗口位置）
  - 其他平台：Electron 默认 `setBounds` 路径

### macOS 权限

Swift helper 使用 `AXUIElement` 修改窗口位置，首次会弹出辅助功能权限申请。  
需要在 `系统设置 -> 隐私与安全性 -> 辅助功能` 中允许对应终端/应用。
