---
case_id: CASE-20260411-LLM-REQUEST-SEND-FAILURE
status: solved
title: MiniMax 流式请求发送失败导致无输出并进入下一步空转
component: llm/minimax + agent
severity: S2
discovered_at: 2026-04-11 23:12:25 +0800
resolved_at: 2026-04-12 10:37:00 +0800
owner: codex
tags: [streaming, minimax, harness, observability]
references: []
referenced_by: []
---

# 1. 问题摘要
- 现象：`LLM stream error: Request failed: error sending request for url (...)`，且随后继续进入 `Step 2`。
- 影响范围：流式问答失败时会空转，浪费轮次并误导排查。
- 首次发现渠道：用户在 `-v` dev 模式下提供运行日志。

# 2. 历史 Case 检索
- 检索关键词：`Request failed`, `error sending request`, `llm_complete 0 chars`
- 命中 Case：无（该 case 为首例）
- 结论：新建独立 case。

# 3. 可观测证据
- 关键 trace：
  - `/Users/Ninot/.dum-e/traces/748e14ea/d76a4276-e094-4703-b7fa-cd629ee45dcf.jsonl`
  - `/Users/Ninot/.dum-e/traces/748e14ea/69e0c482-154c-48a4-8f05-b86ab98b1caf.jsonl`
  - `/Users/Ninot/.dum-e/traces/748e14ea/24bbf05d-e259-436d-935e-89f104a08d85.jsonl`
- 结论证据：
  - `llm_complete.error` 显示发送失败
  - 同会话继续出现 `Step 2 llm_start`，证明存在空转逻辑

# 4. Harness 缺口检查
- 缺口：
  - 请求失败时未阻断主循环
  - 请求级可观测字段不足（attempt/request id/错误分类）
- 补齐动作：
  - 先修复 fail-fast 逻辑：当无文本、无 tool call 的流式失败发生时立即返回错误，停止下一步空转。
  - 后续待补：请求级结构化诊断字段（另起 case 跟踪）。

# 5. 复现路径
## 5.1 前置条件
- `config.json` 中配置 MiniMax key 与 base_url。
- `-v` 开启 dev 模式。

## 5.2 复现步骤
1. 运行：`cargo run -- -v -t "用ppt画个小房子"`。
2. 在请求发送阶段制造/遭遇网络瞬时失败。
3. 观察日志与 traces。

## 5.3 预期结果
- 请求失败后立即返回错误，不再进入下一 step。

## 5.4 实际结果（修复前）
- 出现 `Step 2`，主循环继续空转。

## 5.5 实际结果（修复后）
- 失败立即退出，返回 `Err("LLM stream failed: ...")`。

# 6. 根因分析
- 直接根因：Agent 在流式出错时只 `break` 当前流循环，后续仍按“本轮结束”流程继续推进。
- 深层根因：缺少“无有效产出时的失败判定与阻断”。

# 7. 修复方案与改动
- 修复策略：在 `run()` 中引入 `stream_error`，若 `full_text.is_empty()` 且 `tool_call_count == 0`，直接返回错误。
- 关键改动文件：
  - `/Users/Ninot/NinotQuyi/dum-e/src/agent/mod.rs`
- 额外改进：
  - Agent 工具调用改为流式到达即执行（Claude Code 风格）。

# 8. 验证
- 自动化：`cargo test -q` 通过。
- 手工验证：
  - 成功链路：可收到 SSE chunk（如 `ThinkingStart`）。
  - 失败链路：请求发送失败时不再进入下一 step。

# 9. 时间线
- T0 发现：用户提供 `-v` 日志显示发送失败后进入 Step2。
- T1 定位：trace 文件确认同一会话出现 `llm_complete.error` + `Step2 llm_start`。
- T2 修复：增加失败阻断逻辑并重新验证。
- T3 验证：测试与手工链路通过。
- T4 归档：状态置为 `solved`。

# 10. References
## 10.1 Related Cases
- 无

## 10.2 Referenced By
- 无

# 11. 2026-04-12 补充修复（同 case 续修）
## 11.1 新增定位结论
- 之前日志只看到 `error sending request`，根因不够明确。
- 本次复盘确认存在高风险配置项：`base_url=https://api.minimaxi.com`（旧域名）。
- 已将默认与项目配置切换到 `https://api.minimax.io`，并在初始化阶段自动兼容旧值，降低误配风险。

## 11.2 本轮代码改动
- `src/config/mod.rs`
  - MiniMax 默认 `base_url` 改为 `https://api.minimax.io`。
- `config.json`
  - 项目配置 `base_url` 改为 `https://api.minimax.io`。
- `src/llm/minimax.rs`
  - 新增 `base_url` 规范化（自动替换 `api.minimaxi.com`，去掉尾部 `/anthropic`）。
  - 请求统一走 `messages_url()` 组装，避免重复拼接路径。
  - 新增发送重试（最多 3 次，指数退避）与错误分类。
  - 错误信息加入可执行 hint（connect/timeout/DNS 方向）。
- `src/lib.rs` + `src/main.rs` + `src/observability/mod.rs`
  - `EventBus` 支持从配置透传 traces 目录。
  - 支持 `~` 展开。
  - traces 目录不可写时自动回退到系统临时目录。
- `src/observability/storage.rs`
  - trace 写入失败不再 panic，改为错误日志 + 回退写入路径，保证诊断链不中断。

## 11.3 复现与验证结果
- 运行验证：`cargo run -- -v -t "测试连通性"`
  - 可见请求 attempt=1/2/3 的重试轨迹。
  - 失败时返回 `kind=connect attempt=3/3` 与 hint。
  - 无 `Step 2 started`，确认 fail-fast 生效。
- 编译验证：`cargo check` 通过。
- 回归验证：`cargo test -q observability::tests::test_event_bus_dev_mode` 通过。

## 11.4 仍需环境侧确认
- 若本机网络可达且 key 有效，需在真实环境再跑一次：
  - `cargo run -- -v -t "用ppt画个小房子"`
  - 预期：拿到流式 chunk 或明确上游 HTTP 错误（带 request_id/trace_id/attempt）。
