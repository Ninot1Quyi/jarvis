---
name: vm-auto-eval
description: This skill should be used when the user asks to "evaluate Jarvis", "run VM test", "auto eval", "test in VM", or discusses testing Jarvis tasks in a macOS virtual machine, syncing code to VM, or running evaluation loops.
---

# VM Auto-Eval Skill

自动化评测 Jarvis 在 macOS 虚拟机中的任务执行效果。通过 Parallels VM + tmux + iTerm2 实现完整的开发→部署→测试→评估→改进循环。

## 环境信息

- VM: Parallels Desktop macOS VM, 名称 "macOS"
- VM IP: 10.211.55.5 (Parallels 默认网段)
- VM 用户: jarvis, 密码: 123456
- 宿主机代理: 10.211.55.2:7897 (VM 视角的宿主机 IP)
- Jarvis 路径 (宿主机): /Users/Ninot/NinotQuyi/jarvis
- Jarvis 路径 (VM): ~/jarvis
- Node.js: /opt/homebrew/opt/node@20/bin

## 完整评测流程

### Step 1: 创建评估分支

```bash
cd /Users/Ninot/NinotQuyi/jarvis
git checkout -b eval/<评估主题> develop
```

评估工作必须在独立分支进行，不直接修改 develop。

### Step 2: 代码同步到 VM

如果修改了代码，需要同步到 VM：

```bash
sshpass -p '123456' rsync -avz \
  --exclude node_modules --exclude .git --exclude dist --exclude target \
  -e "ssh -o IdentitiesOnly=yes" \
  /Users/Ninot/NinotQuyi/jarvis/ jarvis@10.211.55.5:~/jarvis/
```

如果只改了 prompts，只同步 prompts 目录更快：

```bash
sshpass -p '123456' rsync -avz \
  -e "ssh -o IdentitiesOnly=yes" \
  /Users/Ninot/NinotQuyi/jarvis/prompts/ jarvis@10.211.55.5:~/jarvis/prompts/
```

如果改了 TypeScript 代码，需要在 VM 中重新编译：

```bash
sshpass -p '123456' ssh -o IdentitiesOnly=yes jarvis@10.211.55.5 \
  'export PATH="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:$PATH" && cd ~/jarvis && npm run build'
```

### Step 3: 创建 tmux 会话并连接 VM

```bash
tmux kill-server 2>/dev/null
tmux new-session -d -s work "sshpass -p '123456' ssh -o IdentitiesOnly=yes jarvis@10.211.55.5"
```

验证连接成功（使用 buffer 方式读取，兼容用户同时 attach）：

```bash
tmux capture-pane -t work -b buf && tmux save-buffer -b buf -
# 应该看到 jarvis@macos 的 shell prompt
```

### Step 4: 开启 iTerm2 右侧分屏供用户观察

```applescript
osascript -e '
tell application "iTerm2"
    tell current session of current tab of current window
        set newSession to (split vertically with default profile)
        tell newSession
            write text "tmux attach -t work"
        end tell
    end tell
end tell'
```

验证分屏是否成功创建：

```applescript
osascript -e '
tell application "iTerm2"
    tell current tab of current window
        return count of sessions
    end tell
end tell'
# 返回 2 表示分屏成功
```

### Step 5: 创建并发送任务

将任务写入脚本文件（避免中文引号在 tmux send-keys 中的问题）：

```bash
# 在宿主机创建任务脚本
cat > /tmp/run_task.sh << 'EOF'
#!/bin/bash
export PATH=/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:$PATH
cd ~/jarvis
node dist/cli/main.js --no-ui "任务描述"
EOF

# 上传到 VM
sshpass -p '123456' scp -o IdentitiesOnly=yes /tmp/run_task.sh jarvis@10.211.55.5:/tmp/run_task.sh

# 通过 tmux 执行
tmux send-keys -t work "bash /tmp/run_task.sh" Enter
```

### Step 6: 持续监控执行过程

循环读取 tmux 输出，跟踪 Jarvis 的每一步：

```bash
# 读取当前屏幕内容
tmux capture-pane -t work -b buf && tmux save-buffer -b buf -

# 建议每 15-30 秒读取一次，根据任务复杂度调整间隔
sleep 20 && tmux capture-pane -t work -b buf && tmux save-buffer -b buf -
```

关注的关键信息：
- `[THOUGHT]` — Jarvis 的思考过程
- `[TOOL]` — 执行的工具调用
- `[OK]` / `[ERROR]` — 工具执行结果
- `Step N/50` — 当前步数
- `Agent finished after N steps` — 任务完成

同时可以截取 VM 屏幕验证 GUI 状态：

```bash
prlctl capture "macOS" --file /tmp/vm_screenshot.png
```

### Step 7: 任务完成判定

当看到以下输出时，任务已完成：

```
No tool call for 2 consecutive rounds, task confirmed complete.
Agent finished after N steps
Memory: final sync before close...
```

### Step 8: 评估任务执行效果

从 VM 拉取完整 trace 日志：

```bash
# 列出最近的 trace
sshpass -p '123456' ssh -o IdentitiesOnly=yes jarvis@10.211.55.5 'ls -lt ~/jarvis/data/traces/ | head -5'

# 读取最新 trace
sshpass -p '123456' ssh -o IdentitiesOnly=yes jarvis@10.211.55.5 'cat ~/jarvis/data/traces/<最新trace>.md'
```

截取最终 VM 屏幕状态：

```bash
prlctl capture "macOS" --file /tmp/vm_final.png
```

评估维度：
1. **任务完成度** — 是否真正完成了用户交给的任务
2. **步骤效率** — 总步数是否合理，有无浪费步骤
3. **错误处理** — 遇到障碍时是否正确应对（弹窗、权限、网络等）
4. **放弃行为** — 是否过早放弃，是否尝试了多种方案
5. **记忆利用** — 是否利用了已有记忆，是否记录了新发现
6. **GUI 精度** — 点击是否准确，是否频繁误点

### Step 9: 改进与迭代

根据评估结果修改代码/prompt：

```bash
# 修改 prompt
edit /Users/Ninot/NinotQuyi/jarvis/prompts/system.md
edit /Users/Ninot/NinotQuyi/jarvis/prompts/platform/macos.md

# 修改代码
edit /Users/Ninot/NinotQuyi/jarvis/src/...

# 提交
cd /Users/Ninot/NinotQuyi/jarvis
git add -A && git commit -m "improve: 改进描述"

# 同步到 VM (回到 Step 2)
```

### Step 10: 快照管理（批量评测时使用）

```bash
# 创建干净快照
prlctl snapshot "macOS" --name "eval_clean"

# 列出快照
prlctl snapshot-list "macOS"

# 恢复快照（每次评测任务前）
prlctl snapshot-switch "macOS" --id {snapshot-id}

# 等待 VM 恢复
sleep 10
```

## 注意事项

- tmux 输出读取必须用 `capture-pane -b buf && save-buffer -b buf -` 方式，直接 `capture-pane -p` 在用户 attach 时会失败
- 中文任务描述不要直接放在 `tmux send-keys` 中，写入脚本文件再执行
- iTerm2 AppleScript 执行后返回可能显示为空或取消，需要通过 `count of sessions` 验证实际结果
- VM 系统代理设置：`networksetup -setwebproxy Ethernet 10.211.55.2 7897` 等
- 微信等应用可能需要手动登录，Jarvis 会通过 `call_user` 请求协助
- 评估分支的改动是否合并到 develop 由用户决定
