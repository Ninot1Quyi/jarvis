---
name: evolve
description: Dum-E 自我迭代与进化技能 — 通过对比标杆 agent、修改自身代码与提示词，实现持续进化
---

# Evolve Skill

## 目的

让 Dum-E 具备**持续自我进化**能力，从以下维度全方位提升：

1. **功能** — 新增能力、补齐缺失功能
2. **能力** — 扩展工具边界、提升推理质量
3. **交互** — 改善 UX、TUI 体验、响应格式
4. **性格** — 丰富 SOUL.md 中的 personality traits
5. **灵魂** — 优化决策风格、价值观、行为习惯

## 触发条件

以下任一情况必须启用本技能：

- 手动调用 `evolve_self` 工具
- 空闲时间超过配置的 `auto_evolve_idle_minutes` 分钟
- 版本号发生变更后首次启动

## 对标 Agent 列表（优先级从高到低）

1. **claude-code** — 最高标杆，优先学习
2. **codex** — 代码能力标杆
3. **harness** — 可观测性与测试工程标杆
4. **gemini-cli** — 多模态交互标杆
5. **agent-s** — 架构设计标杆

## 执行约束（强制）

- **禁止向用户提问**，不允许以"等用户确认/等用户补充信息/用户希望怎么做"作为进化停机条件
- **禁止在 main/master 分支直接修改**，所有改动必须在独立的 git worktree 中进行
- **进化过程中不得关闭当前运行的 agent**，等待新版确认启动成功后再切换
- **每次进化只解决一个问题域**，不允许超大 PR（单次修改不超过 5 个文件的核心逻辑）
- **版本号必须递增**，每次成功后 version +1
- **编译失败时先自主修复简单问题**（typo、import 错误等），棘手问题调用 `doctor` 技能
- **验证必须由独立的 subagent 执行**，主 agent 不得自证通过
- 验证不通过时，**不允许推进到合并步骤**
- 进化完成后新版 agent 必须通过**自检**才能关闭旧版

## 修复质量红线（最高优先级）

所有进化方案必须满足以下条件：

### 绝对禁止

- 禁止移除已有的可观测能力（日志、事件、tracing）
- 禁止用更慢的方案替换更快的方案
- 禁止用更低可靠性的方案替换更高可靠性的方案
- 禁止以牺牲核心功能为代价换取新功能
- 禁止引入安全漏洞或降低权限隔离

### 自问自答（每次进化前必须回答）

1. **用户体验**：此进化是否让用户感知到能力提升或体验改善？
2. **稳定性**：此进化是否引入了新的不稳定因素？
3. **性能**：此进化是否导致了性能退化（延迟、内存、吞吐量）？
4. **向后兼容**：此进化是否破坏了已有的配置或接口？
5. **可维护性**：此进化是否让代码更难理解和维护？

## 强制流程（不可跳步）

### Step 1: 自我对标（Compare Agents）

使用 `compare_agents` 工具，对比自己与配置的目标 agent 列表（优先级：claude-code > codex > harness > gemini-cli > agent-s）。

对标维度：

- **功能完整性**：工具集、API、集成能力
- **交互体验**：输入/输出格式、流式响应、错误提示
- **源码架构**：模块划分、设计模式、可扩展性
- **性格与风格**：回复语气、决策方式、行为习惯
- **性能基准**：响应延迟、并发能力、资源占用

### Step 2: 差距分析（Gap Analysis）

将对比结果归类为四类差距：

| 类型 | 描述 | 修复方式 |
|------|------|----------|
| `code` | 源码级差距 | 修改 src/ 下对应文件 |
| `prompt` | 提示词级差距 | 修改 SOUL.md 或 system prompt |
| `tool` | 工具级差距 | 新增或优化工具 |
| `architecture` | 架构级差距 | 重构模块边界或引入新依赖 |

按 **影响范围 × 实现难度** 排序，优先处理高影响、低难度的项。

### Step 3: 制定提升计划（Improvement Plan）

每个提升项必须包含：

```
### [提升项 N]
- **目标**：描述要达成什么
- **类型**：code | prompt | tool | architecture
- **修改位置**：文件路径 + 行号范围
- **预期收益**：具体描述用户/开发者能感受到的改善
- **回滚方案**：如果失败如何回退
```

### Step 4: 在 git worktree 中实施

**绝对禁止在 main/master 分支直接修改！**

1. 基于当前 SOUL.md 中的 version 创建 worktree：
   ```bash
   git worktree add ../dum-e-{version} -b evolve/v{version}
   ```
   其中 `version` 格式为 `{major}.{minor}.{patch}`，如 `1.0.1`

2. 在 worktree 中实施 Step 3 制定的提升计划

3. 如遇文件冲突（worktree 中已有该路径），检查后决定复用或重建

4. 修改完成后，在 worktree 中更新 SOUL.md 版本号（+1 patch）

### Step 5: 编译验证

1. 在 worktree 中运行 `cargo build` 编译
2. 遇到**简单问题**（编译错误、typo、import 错误）：**自主修复**，不要询问用户
3. 遇到**棘手问题**（逻辑错误、设计冲突、依赖冲突）：**自动调用 `activate_skill("doctor")`**，使用 doctor 技能进行系统化诊断和修复，**禁止向用户提问**
4. `cargo build` 成功后再运行 `cargo test`
5. 测试失败同样自动调用 doctor 技能

### Step 6: 独立 subagent 验收

在版本递增之前，必须通过独立验证。验证维度：

1. **编译通过**：cargo build 无 error
2. **测试通过**：cargo test 无 FAILED
3. **可观测性完整**：日志、tracing、event 代码仍然存在（grep 验证）

验证通过 LLM subagent 分析 worktree 中的编译和测试输出，严格判断 PASS/FAIL。

**FAIL 处置**：必须输出具体哪项维度失败 + 改进建议，回到 Step 3 调整方案后重新进入循环。

**PASS 处置**：继续 Step 7。

### Step 7: 合并与版本切换（完全自动化）

验证全部 PASS 后（**禁止向用户询问是否继续**）：

1. 版本递增：更新 `data/soul.md` patch +1
2. 在 worktree 中提交改动
3. 获取当前分支名：`git branch --show-current`
4. 将 worktree 分支合并到当前分支：`git merge evolve/v{version} --no-ff`
5. 创建进化记录 `skills/evolve/versions/{version}.md`
6. 清理旧的 evolve 信号文件
7. 启动新版 agent（通过 tmux），传递环境变量：
   - `DUM_E_READY_SIGNAL={path}` — 新 agent 写此文件表示启动完成
   - `DUM_E_OLD_PID={pid}` — 旧 agent 的 PID
8. 轮询 ready 信号文件，最多等待 120 秒
9. 收到 ready 信号后，写入交接上下文文件 `~/.dum-e/evolve_context.json`：
   - 新版本号、旧 PID、当前任务、对话历史摘要
10. 等待 5 秒让新版稳定
11. 调用 `evolve_switch_version` 完成切换：
    - 读取 context 文件中的旧 PID
    - 确认新版 agent 在 tmux 中运行
    - 更新 SOUL.md running_from
    - 更新进化记录状态为 active
    - 清理旧 worktree
    - **向旧版 PID 发送 SIGTERM → SIGKILL 完成关闭**
12. 旧版 agent 退出，TUI 显示进化完成

**上下文传递机制**：
- 旧版 agent 在关闭前写入 `~/.dum-e/evolve_context.json`
- 新版 agent 启动时读取此文件，打印进化 Banner，然后正常进入 TUI
- 用户看到："🤖 Dum-E Evolved Version {version} Started"

**关键原则**：
- 旧版不自己调用关闭，必须由 `evolve_switch_version`（在旧版进程内执行）完成关闭
- 新版 agent 收到 `DUM_E_OLD_PID` 后打印进化 Banner，写 ready 信号，然后等待旧版关闭

## 进化记录管理

每次进化完成后，必须在 `skills/evolve/versions/` 中创建记录：

```
skills/evolve/versions/
├── v1.0.0.md        # 初始版本
├── v1.0.1.md        # Patch: 修复了 X
├── v1.1.0.md        # Minor: 新增了 Y
└── ...
```

记录格式：

```markdown
# Evolve v{major}.{minor}.{patch}

## 时间
{timestamp}

## 对标来源
{compare_targets used}

## 差距分析
{gap analysis results}

## 提升项
{improvement plan items}

## 验证结果
{verification results}

## 版本号变更
{before} -> {after}
```

## 最终完成标准（Definition of Done）

- [ ] 差距分析完成，有明确的优先级排序
- [ ] 所有改动在独立 worktree 中完成
- [ ] 编译通过（cargo build && cargo test）
- [ ] 棘手问题已通过 doctor 技能修复
- [ ] 验证 subagent 全部 6 个维度 PASS
- [ ] 合并到 main 分支
- [ ] SOUL.md version 字段已递增
- [ ] 新版 agent 已启动并通过自检
- [ ] 旧版 agent 已关闭
- [ ] 进化记录已写入 `skills/evolve/versions/`

## Sub-Agent 支持

Dum-E 支持通过 `launch_subagent` 工具启动子 agent 并行处理任务。

### launch_subagent 工具

```
launch_subagent({
  task: "具体的子任务描述",
  mode: "in_process" | "tmux",     // 执行模式
  context_depth: 10,                 // 传递多少轮对话上下文
  wait_for_result: true,             // 是否等待结果
  max_wait_secs: 300,               // 最大等待秒数
  subagent_name: "worker-1"         // 子 agent 名称（可选）
})
```

**模式说明**：
- `in_process`: 快速执行，共享 LLM 连接，在当前进程内运行
- `tmux`: 隔离执行，在 tmux 会话中运行，继承父 agent 崩溃

**使用场景**：
- 并行研究多个方向
- 独立子任务委托
- 不阻塞主 agent 的后台工作

**实现参考**：Claude Code Agent SDK 的 fork subagent 和 swarm teammate 模式

## 脚本化实现

核心进化逻辑已脚本化，位于 `skills/evolve/scripts/`：

- `evolve_main.sh` — 主脚本，实现 Step 3-5：
  - `--step compare`: 运行 LLM 对比分析
  - `--step plan`: 生成改进计划
  - `--step apply`: 应用改进
  - `--step all`: 执行完整流程

Rust evolve_self 工具优先调用脚本，脚本不可用时回退到 Rust LLM 调用。
