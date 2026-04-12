#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <CASE_ID> <TITLE> [owner]"
  echo "Example: $0 CASE-20260412-LLM-0001 \"MiniMax stream send failure\" Ninot"
  exit 1
fi

CASE_ID="$1"
TITLE="$2"
OWNER="${3:-unknown}"
NOW="$(date '+%Y-%m-%d %H:%M:%S %z')"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT_DIR/cases/active/${CASE_ID}.md"

if [[ -f "$TARGET" ]]; then
  echo "Case already exists: $TARGET"
  exit 1
fi

cat > "$TARGET" <<EOF
---
case_id: ${CASE_ID}
status: active
title: ${TITLE}
component: unknown
severity: S3
discovered_at: ${NOW}
resolved_at: N/A
owner: ${OWNER}
tags: []
references: []
referenced_by: []
---

# 1. 问题摘要
- 现象：
- 影响范围：
- 首次发现渠道（日志/用户反馈/测试）：

# 2. 历史 Case 检索
- 检索关键词：
- 命中 Case：
- 结论：复用/不复用（说明理由）

# 3. 可观测证据
- 日志：
- Trace/Event 文件：
- 请求上下文（URL、状态码、request id、耗时）：
- 关键配置与环境：

# 4. Harness 缺口检查
- 当前缺口：
- 补齐动作（新增事件、字段、埋点、动态观测手段）：
- 补齐后新增证据：

# 5. 复现路径
## 5.1 前置条件
## 5.2 复现步骤
1.
2.
3.

## 5.3 预期结果
## 5.4 实际结果
## 5.5 复现稳定性（100%/间歇性，次数统计）

# 6. 根因分析
- 直接根因：
- 深层根因：
- 为什么之前没被发现：

# 7. 修复方案与改动
- 修复策略：
- 关键改动：
- 风险与回滚策略：

# 8. 验证
- 复现路径回归结果：
- 自动化测试结果：
- 额外手工验证：

# 9. 时间线
- T0 发现：
- T1 定位：
- T2 修复：
- T3 验证：
- T4 归档：

# 10. References
## 10.1 Related Cases
- 

## 10.2 Referenced By
- 
EOF

echo "Created: $TARGET"
