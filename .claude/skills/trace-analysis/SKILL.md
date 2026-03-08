---
name: trace-analysis
description: Use this skill when the user asks to analyze Jarvis eval results, analyze traces, identify failure patterns, find knowledge gaps, analyze click accuracy, tool usage patterns, skill gaps, or termination behavior from evaluation runs. Triggers on: "analyze traces", "analyze eval results", "what is Jarvis missing", "click accuracy", "failure analysis", "improvement analysis", "why did Jarvis fail".
---

# Trace Analysis Skill

评估 Jarvis 评测运行结果，从多个维度分析失败原因，生成改进路线图。

## 分析工具位置

```
improve/analysis/
  extract_clicks.py        # 从 trace 提取所有 click 动作
  analyze_clicks.py        # 用 LLM 判断每个 click 是否命中正确目标（视觉变化检测）
  analyze_knowledge.py     # 分析 agent 缺失的知识和能力（trace 转多轮对话发给 LLM）
  analyze_termination.py   # 分析 agent 何时/为何停止执行
  analyze_tools.py         # 分析工具使用频率和模式（纯解析，无 LLM）
  analyze_skills_gap.py    # 对比任务类型 vs 现有 skill，生成开发优先级（纯解析，无 LLM）
  results/                 # 所有输出文件（带日期后缀）
```

## 关键配置

```python
# LLM API（在各 analyze_*.py 顶部）
API_KEY = 'sk-TfN0Js5VKZcD6O1rJSSixnTYayhIqrnhHKUHXM1mCjf3CrIc'
BASE_URL = 'https://api.duojie.games/v1'
MODEL = 'gemini-3.1-pro'

# 评测结果目录（按需修改）
RESULTS_DIR = Path('/Users/Ninot/NinotQuyi/jarvis/results/<eval-run-name>')
```

## Trace 文件格式

Trace 是 `.md` 文件，用 `\n===\n` 分隔步骤：

```
## SYSTEM       # 系统 prompt（第一个步骤）
===
## USER         # 用户任务输入，包含 <tui>...</tui> 标签
===
## COMPUTER     # 屏幕状态 + Recent Actions + 截图 ![screen](../memory/screenshots/...)
===
## ASSISTANT    # tool calls，格式：- `click({"coordinate":[x,y],"desc":"..."})`
===
...（交替出现）
```

## 标准分析流程

### Step 1: 定位评测结果目录

```bash
ls results/   # 找到 eval-<name>-<date> 格式的目录
```

每个任务子目录包含：
- `result.json` — `task_id`, `instruction`, `result`(0-1), `done`(bool), `trace_path_local`
- `task_config.json` — `snapshot`(app名), `instruction`, `evaluator`
- `jarvis_output.txt` — 完整 agent 输出

成功判定：`result >= 1.0` 或 `(done == True and result > 0)`

### Step 2: 更新脚本中的 RESULTS_DIR

所有脚本顶部都有 `RESULTS_DIR` 常量，指向当前评测目录：

```bash
# 批量替换目录路径
sed -i '' 's|eval-nogdrive-20260308-010648|<new-eval-dir>|g' improve/analysis/*.py
```

### Step 3: 按需运行分析（推荐顺序）

**3a. 无 LLM 分析（秒级完成，先跑）**

```bash
# 工具使用模式 + 关键洞察
python3 improve/analysis/analyze_tools.py

# Skill 缺口 + MCP 机会
python3 improve/analysis/analyze_skills_gap.py
```

**3b. Click 准确率分析（需要 LLM，约 10-30 分钟）**

```bash
# 先提取 clicks
python3 improve/analysis/extract_clicks.py

# 再分析（支持断点续跑）
python3 improve/analysis/analyze_clicks.py
```

**3c. 知识缺口分析（需要 LLM，先测试 10 个）**

```bash
# 先测试 10 个
python3 improve/analysis/analyze_knowledge.py 10

# 确认正常后跑全部
python3 improve/analysis/analyze_knowledge.py
```

**3d. 终止行为分析（需要 LLM，先测试 10 个）**

```bash
python3 improve/analysis/analyze_termination.py 10
python3 improve/analysis/analyze_termination.py  # 全部
```

### Step 4: 读取结果

结果文件在 `improve/analysis/results/`，文件名带日期后缀（`_YYYYMMDD.json`）。

快速查看汇总：

```bash
python3 -c "
import json
# 工具分析
d = json.load(open('improve/analysis/results/tool_analysis_YYYYMMDD.json'))
print('KEY INSIGHTS:')
for i in d['key_insights']: print(' -', i)
"

python3 -c "
import json
# Skill 缺口
d = json.load(open('improve/analysis/results/skills_gap_YYYYMMDD.json'))
for item in d['skill_roadmap']:
    print(f\"{item['priority'].upper():8} {item['category']:25} pass={item['pass_count']}/{item['task_count']} score={item['priority_score']}\")
"

python3 -c "
import json
# 知识缺口
d = json.load(open('improve/analysis/results/knowledge_analysis_YYYYMMDD.json'))
print('Top missing knowledge:')
for item in d['top_missing_knowledge'][:10]:
    print(f\"  ({item['count']}x) {item['item']}\")
"
```

## 分析维度说明

### 维度 1: Click 准确率（analyze_clicks.py）

- **方法**：把 click 前后截图发给 Gemini，问屏幕是否按预期变化
- **判定**：HIT / MISS / UNCERTAIN
- **价值**：区分"知道做什么但点错位置"和"不知道做什么"
- **注意**：miss 率在失败任务中约 12-15%，不是主要失败原因

### 维度 2: 知识缺口（analyze_knowledge.py）

- **方法**：把完整 trace 解析成多轮对话历史（COMPUTER→user, ASSISTANT→assistant），发给 Gemini 问缺了什么知识
- **输出**：`failure_reason`, `missing_knowledge[]`, `missing_capabilities[]`, `improvement_plan[]`, `key_insight`
- **价值**：最直接落地，输出可以直接写进 skill 文件
- **注意**：MAX_STEPS=30, MAX_IMG_PER_STEP=1, MAX_DIM=600（控制 token 成本）

### 维度 3: 执行终止模式（analyze_termination.py）

- **分类**：MAX_STEPS_HIT / WRONG_COMPLETION / LOST_CONTEXT / TOOL_FAILURE / CAPABILITY_GAP
- **价值**：区分"步数不够"（调参可解决）和"根本不会做"（需要知识注入）
- **发现规律**：如果 MAX_STEPS_HIT 占多数，优先提高步数上限而非改 prompt

### 维度 4: 工具使用模式（analyze_tools.py）

- **关键指标**：bash 使用率、find_element 使用率、各工具调用频率、click miss 率分 app 统计
- **价值**：发现工具层的结构性缺陷（如 bash/openpyxl 可绕过 GUI 的任务）

### 维度 5: Skill 缺口（analyze_skills_gap.py）

- **方法**：按 app snapshot + 指令关键词分类任务，对比现有 skill 覆盖
- **优先级公式**：`fail_count * (1 - success_rate)`
- **输出**：skill 开发路线图 + MCP 工具接入建议

## 多维度改进决策框架

```
MAX_STEPS_HIT 占多数?
  └── YES → 先提高步数上限，重跑 eval，再分析
  └── NO  → 看 fail_reason 类型

有 skill 缺口 (has_skill=false + score>20)?
  └── YES → 优先写对应 skill
  └── NO  → 看知识缺口

bash 使用率 < 5% 且 app 成功率 = 0%?
  └── YES → 考虑 bash+文件操作替代 GUI（LibreOffice Calc → openpyxl）

click miss 率 > 20% 在某类任务?
  └── YES → 改进坐标描述或接入 find_element
```

## 历史评测记录

| 评测目录 | 日期 | 任务数 | 成功率 | 主要发现 |
|---------|------|--------|--------|---------|
| eval-nogdrive-20260308-010648 | 2026-03-08 | 176/360 | 21% | LibreOffice Calc 0%，步数耗尽为主因，7个类别全无 skill |

分析报告：`improve/click-accuracy-analysis-20260308.md`, `improve/eval-summary-20260308.md`

## 输出文件命名规范

所有结果文件使用 `_YYYYMMDD` 后缀，例如：
- `tool_analysis_20260308.json`
- `skills_gap_20260308.json`
- `knowledge_analysis_20260308.json` (在 results/ 子目录)
- `termination_analysis_20260308.json` (在 results/ 子目录)

新评测时修改脚本顶部的 `RESULTS_DIR` 和 `OUTPUT_FILE` 中的日期即可。
