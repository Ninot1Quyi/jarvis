# Diagnosis Loop Playbook

## Global Gate: No-Ask + Must-Pass
- 整个流程禁止向用户提问，默认自主排障与修复。
- 任何一步出现功能异常或观测到 `error`，必须回到 Step 3 继续，不得结束。
- 必须完成线上依赖验证并通过，未通过不得关闭 case。

## Step 1: Intake
- 明确“症状、影响、时间、环境”
- 先写 2-3 个可证伪假设

## Step 2: Search Existing Cases
- 在 `cases/INDEX.md` 和 `cases/*` 中检索关键错误签名
- 有相似 case 时，先复用其复现路径和验证清单

## Step 3: Observability First
- 收集：
  - trace/event 文件
  - 请求级诊断字段（request id、status、latency、attempt）
  - 配置快照
- 证据不足时立即补埋点（harness 缺口优先修）

## Step 4: Reproduce
- 提炼最小复现路径（MRE）
- 固化为可重复步骤和输入

## Step 5: Root Cause & Fix
- 给出完整因果链
- 修复要可验证、可回滚

## Step 6: Verify
- 必须包含：
  - 复现路径回归
  - 自动化测试
  - 线上依赖验证（真实外部依赖链路）
  - 验证窗口 `error` 扫描（日志与 trace/event）

## Step 7: Case Closure
- 文档写全（发现→定位→修复→验证）
- 更新 `cases/INDEX.md`
- 仅在 Step 6 全部通过且 `error` 扫描为空时，状态从 `active` 转 `solved`
- `solved` 后持续观察稳定再归档
