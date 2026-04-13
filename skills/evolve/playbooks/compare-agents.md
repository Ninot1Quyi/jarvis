# Compare Agents Playbook

## Step 1: 确定对标目标

按优先级从高到低依次对标，每轮至少分析 1 个 agent，最多 3 个：

1. **claude-code** — 最高标杆
2. **codex** — 代码能力
3. **harness** — 可观测性
4. **gemini-cli** — 多模态
5. **agent-s** — 架构

## Step 2: 获取目标能力信息

### claude-code
- 搜索官方文档：https://docs.anthropic.com/claude-code
- 搜索 GitHub：anthropics/claude-code
- 分析 README、CHANGELOG、capabilities 章节

### codex
- 搜索 OpenAI Codex 文档
- 搜索 GitHub：openai/codex
- 分析 CLI 功能列表和 API 覆盖

### harness
- 分析本项目中 harness 相关代码
- 搜索 GitHub：harness 关键词
- 理解 harness-driven development 理念

### gemini-cli
- 搜索 Google Gemini CLI
- 分析多模态能力列表

### agent-s
- 搜索 agent-s 相关开源项目
- 分析架构设计模式

## Step 3: 对比分析框架

对每个维度打分（1-5）：

| 维度 | Dum-E 当前 | 目标 Agent | 差距 |
|------|-----------|-----------|------|
| 工具数量 | | | |
| 交互体验 | | | |
| 源码架构 | | | |
| 性格丰富度 | | | |
| 性能 | | | |
| 可观测性 | | | |

## Step 4: 输出结构化报告

```json
{
  "dume_version": "v1.0.0",
  "comparisons": [
    {
      "target": "claude-code",
      "dimension": "tools",
      "dume_score": 3,
      "target_score": 5,
      "gaps": ["缺少 MCP 支持", "缺少 skill 系统"],
      "priority": "high"
    }
  ],
  "priority_order": ["gap_1", "gap_2", ...]
}
```
