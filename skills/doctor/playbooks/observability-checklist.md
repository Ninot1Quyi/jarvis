# Observability Checklist

当问题定位受阻时，按本清单补齐 harness 能力。

## 请求级
- 请求目标（provider/url/model）
- 开始时间、结束时间、总耗时
- attempt 编号（含重试链路）
- 响应状态码、错误分类（connect/timeout/tls/http）
- provider request id / trace id

## 流式级
- 首包延迟（TTFB）
- chunk 统计（text/tool_use/thinking）
- 流终止原因（normal/error/interrupted）

## 工具级
- tool_call 入队时间
- tool 执行开始/结束/耗时
- 成功/失败、错误文本
- 工具并发策略（exclusive/parallel）

## 诊断增强（可选）
- 动态探针/运行时诊断能力（类似 Arthas 思路）
- 可定点观测、重放、局部压测

## 验收标准
- 失败能从日志和 traces 中直接定位到“哪一层失败”
- 不依赖猜测，能拿出结构化证据链
- 最终线上验证窗口内，日志与事件中不允许出现 `error` / `*_error`
- 若出现 `error`，必须继续修复并重新执行完整验证闭环
