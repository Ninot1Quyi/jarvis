# Project Skills Layout

本仓库采用“单一技能源”布局：

- 权威目录：`skills/`
- Claude Code 项目级入口：`.claude/skills -> ../skills`（软链接）
- Codex 项目级入口：`.codex/skills -> ../skills`（软链接）

这样做的目的：

1. `dum_e`、Claude Code、Codex 共用一套技能内容。
2. 技能只维护一份，避免多目录拷贝造成漂移。
3. 仓库分发后，其他人拉代码即可直接复用项目级 skill。

当前已包含：

- `skills/doctor/`：问题诊断与修复闭环技能（Harness Engineering）。
