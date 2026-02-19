---
name: vm-linux-eval
description: This skill is used when testing Jarvis on Linux virtual machine, syncing code to Linux VM, running evaluation loops, or discussing Linux platform adaptation.
---

# Linux VM Auto-Eval Skill

通过 VMware Fusion + tmux 实现 Linux 虚拟机的自动化评测。支持 Ubuntu/GNOME 桌面环境。

## 环境信息

- VM: VMware Fusion (Ubuntu 22.04 LTS / 24.04 LTS)
- VM IP: 192.168.199.131 (VMware NAT 模式)
- VM 用户: jarvis, 密码: 123456
- 宿主机代理: 192.168.199.1:7897
- Jarvis 路径 (宿主机): /Users/Ninot/NinotQuyi/jarvis
- Jarvis 路径 (VM): ~/jarvis
- Node.js: /usr/bin/node (v20+)

## 完整评测流程

### Step 1: 创建评估分支

```bash
cd /Users/Ninot/NinotQuyi/jarvis
git checkout -b eval/linux-<主题> develop
```

评估工作必须在独立分支进行，不直接修改 develop。

### Step 2: 代码同步到 VM

如果修改了代码，需要同步到 VM：

```bash
sshpass -p '123456' rsync -avz \
  --exclude node_modules --exclude .git --exclude dist --exclude target \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes" \
  /Users/Ninot/NinotQuyi/jarvis/ jarvis@192.168.199.131:~/jarvis/
```

如果只改了 prompts，只同步 prompts 目录更快：

```bash
sshpass -p '123456' rsync -avz \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes" \
  /Users/Ninot/NinotQuyi/jarvis/prompts/ jarvis@192.168.199.131:~/jarvis/prompts/
```

如果改了 TypeScript 代码，需要在 VM 中重新编译：

```bash
sshpass -p '123456' ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes jarvis@192.168.199.131 \
  'export PATH="/usr/bin:$PATH" && cd ~/jarvis && npm run build'
```

### Step 3: 创建 tmux 会话并连接 VM

```bash
tmux kill-server 2>/dev/null
tmux new-session -d -s work "sshpass -p '123456' ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes jarvis@192.168.199.131"
```

验证连接成功（使用 buffer 方式读取，兼容用户同时 attach）：

```bash
tmux capture-pane -t work -b buf && tmux save-buffer -b buf -
# 应该看到 jarvis@ubuntu 的 shell prompt
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
export PATH=/usr/bin:$PATH
cd ~/jarvis
node dist/cli/main.js --no-ui "任务描述"
EOF

# 上传到 VM
sshpass -p '123456' scp -o StrictHostKeyChecking=no -o IdentitiesOnly=yes /tmp/run_task.sh jarvis@192.168.199.131:/tmp/run_task.sh

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
# 使用 VMware 的 screenshot 功能或直接用 GNOME screenshot
sshpass -p '123456' ssh jarvis@192.168.199.131 'gnome-screenshot -f /tmp/screenshot.png'
# 然后拉取到宿主机
sshpass -p '123456' scp jarvis@192.168.199.131:/tmp/screenshot.png /tmp/vm_screenshot.png
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
sshpass -p '123456' ssh -o StrictHostKeyChecking=no jarvis@192.168.199.131 'ls -lt ~/jarvis/data/traces/ | head -5'

# 读取最新 trace
sshpass -p '123456' ssh -o StrictHostKeyChecking=no jarvis@192.168.199.131 'cat ~/jarvis/data/traces/<最新trace>.md'
```

截取最终 VM 屏幕状态：

```bash
sshpass -p '123456' ssh jarvis@192.168.199.131 'gnome-screenshot -f /tmp/final.png'
sshpass -p '123456' scp jarvis@192.168.199.131:/tmp/final.png /tmp/vm_final.png
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
edit /Users/Ninot/NinotQuyi/jarvis/prompts/platform/linux.md

# 修改代码
edit /Users/Ninot/NinotQuyi/jarvis/src/...

# 提交
cd /Users/Ninot/NinotQuyi/jarvis
git add -A && git commit -m "improve: 改进描述"

# 同步到 VM (回到 Step 2)
```

### Step 10: 快照管理（批量评测时使用）

```bash
# 创建干净快照（使用 VMware 快照功能）
# 通过 VMware UI 或 vmrun 命令

# 恢复快照
vmrun revertToSnapshot /path/to/ubuntu.vmwarevm/ubuntu.vmx "snapshot_name"

# 等待 VM 启动
sleep 15
```

## Linux VM 初始化清单

首次设置 Linux VM 时，需要安装以下依赖：

```bash
# 系统包
sudo apt update
sudo apt install -y openssh-server xdotool wmctrl xclip xsel wtype
sudo apt install -y gnome-screenshot scrot
sudo apt install -y nodejs npm

# 启用 SSH
sudo systemctl enable ssh
sudo systemctl start ssh

# 屏幕截图依赖
sudo apt install -y imagemagick

# 窗口管理
sudo apt install -y wmctrl

# 设置静态 IP (VMware NAT)
# 编辑 /etc/netplan/00-installer-config.yaml
```

## 注意事项

- tmux 输出读取必须用 `capture-pane -b buf && save-buffer -b buf -` 方式
- 中文任务描述不要直接放在 `tmux send-keys` 中，写入脚本文件再执行
- Linux 桌面自动化依赖 GNOME 扩展和 AT-SPI2 服务
- 确保 VM 中的 "Accessibility Access" 已启用（系统设置 → 辅助功能）
- VMware 共享文件夹可用于快速传输大文件
- Linux 下可能需要额外配置 Display 变量（DISPLAY=:0）
