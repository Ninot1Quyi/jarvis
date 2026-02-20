---
name: vm-linux-eval
description: This skill is used when testing Jarvis on Linux virtual machine, syncing code to Linux VM, running evaluation loops, or discussing Linux platform adaptation.
---

# Linux VM Auto-Eval Skill

通过 VMware Fusion + tmux 实现 Linux 虚拟机的自动化评测。支持 Ubuntu/GNOME 桌面环境。

## 环境信息

- VM: VMware Fusion (Ubuntu 22.04 LTS ARM64)
- VM 路径: `/Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx`
- VM IP: 动态获取 (通过 `vmrun getGuestIPAddress`)
- OSWorld Server: 端口 5000 (已预装)
- SSH 用户: user
- SSH 密码: jarvis.linux.123
- 宿主机代理: 192.168.236.1:7897
- Jarvis 路径 (宿主机): /Users/Ninot/NinotQuyi/jarvis
- Jarvis 路径 (VM): /home/user/jarvis
- Node.js: 通过 nvm 管理，使用 v22

## 快速启动

```bash
# 启动 VM 并等待就绪
./vm-start.sh --wait

# 或分步执行
./vm-start.sh                  # 启动 VM
./vm-start.sh -i               # 获取 VM IP
./vm-start.sh --no-start      # 查看连接信息
```

## 代码同步

```bash
VM_IP="192.168.236.129"  # 替换为实际 IP
PASSWORD="jarvis.linux.123"

# 同步代码到 VM (排除不需要的目录)
sshpass -p "$PASSWORD" rsync -avz \
  --exclude node_modules --exclude .git --exclude dist --exclude target \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes" \
  /Users/Ninot/NinotQuyi/jarvis/ \
  user@${VM_IP}:~/jarvis/

# 只同步 prompts 目录 (更快)
sshpass -p "$PASSWORD" rsync -avz \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes" \
  /Users/Ninot/NinotQuyi/jarvis/prompts/ \
  user@${VM_IP}:~/jarvis/prompts/
```

## 初始化 VM (首次设置)

### 1. 启动 VM

```bash
# 方法1: 使用脚本
./vm-start.sh

# 方法2: 手动启动
vmrun -T fusion start /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx
sleep 15
VM_IP=$(vmrun -T fusion getGuestIPAddress /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx -wait)
echo "VM IP: $VM_IP"
```

### 2. 验证 OSWorld Server

```bash
VM_IP="192.168.236.129"  # 替换为实际 IP
curl -s http://$VM_IP:5000/screenshot -o /tmp/vm_screenshot.png
```

### 3. 配置 SSH 访问

**通过 OSWorld API 设置用户密码**（在 VM 终端里执行）:

```bash
# 在 VM 的终端窗口中:
sudo passwd user
# 输入新密码: jarvis.linux.123
```

**通过 OSWorld API 配置 SSH**:
```bash
VM_IP="192.168.236.129"
SERVER="http://$VM_IP:5000"
PASSWORD="jarvis.linux.123"

# 配置 SSH 允许密码登录
curl -s -X POST "$SERVER/execute" \
  -H "Content-Type: application/json" \
  -d "{\"command\": [\"bash\", \"-c\", \"echo '$PASSWORD' | sudo -S sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config\"], \"shell\": false}"

# 重启 SSH
curl -s -X POST "$SERVER/execute" \
  -H "Content-Type: application/json" \
  -d "{\"command\": [\"bash\", \"-c\", \"echo '$PASSWORD' | sudo -S systemctl restart ssh\"], \"shell\": false}"
```

### 4. 同步源代码到 VM

**重要：源代码在宿主机修改，VM 仅用于测试和编译**

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 同步源代码 (排除 node_modules, dist, .git)
sshpass -p "$PASSWORD" rsync -avz \
  --exclude node_modules --exclude .git --exclude dist --exclude target \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes" \
  /Users/Ninot/NinotQuyi/jarvis/src/ \
  user@${VM_IP}:~/jarvis/src/

# 同步配置文件
sshpass -p "$PASSWORD" rsync -avz \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes" \
  /Users/Ninot/NinotQuyi/jarvis/config/ \
  user@${VM_IP}:~/jarvis/config/

# 同步 prompts (如果修改了)
sshpass -p "$PASSWORD" rsync -avz \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes" \
  /Users/Ninot/NinotQuyi/jarvis/prompts/ \
  user@${VM_IP}:~/jarvis/prompts/
```

### 5. 在 VM 中编译

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
PROXY="http://192.168.236.1:7897"

sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "export http_proxy=$PROXY && https_proxy=$PROXY && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && npm run build"
```

### 6. 在 VM 中运行测试

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
PROXY="http://192.168.236.1:7897"

# 测试截图功能
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "export http_proxy=$PROXY && https_proxy=$PROXY && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && export DISPLAY=:0 && node dist/cli/main.js --no-ui '截取当前屏幕截图'"

# 查看截图结果
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "ls -la /home/user/jarvis/workspace/screenshots/"
```

## 开发循环流程

```
┌─────────────────────────────────────────────────────────────┐
│  1. 在宿主机修改代码 (src/, prompts/, config/)            │
│                          ↓                                  │
│  2. 同步到 VM: rsync src/ user@VM:~/jarvis/src/         │
│                          ↓                                  │
│  3. 在 VM 中编译: npm run build                           │
│                          ↓                                  │
│  4. 在 VM 中测试: node dist/cli/main.js --no-ui "任务"   │
│                          ↓                                  │
│  5. 检查结果: screenshots/, traces/                       │
│                          ↓                                  │
│  6. 如需修改 → 回到步骤 1                                 │
└─────────────────────────────────────────────────────────────┘
```

## 常用命令

### 启动 VM
```bash
vmrun -T fusion start /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx
```

### 获取 VM IP
```bash
vmrun -T fusion getGuestIPAddress /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx -wait
```

### SSH 连接到 VM
```bash
sshpass -p 'jarvis.linux.123' ssh -o StrictHostKeyChecking=no user@192.168.236.129
```

### 在 VM 中运行 jarvis
```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
PROXY="http://192.168.236.1:7897"

sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "export http_proxy=$PROXY && export https_proxy=$PROXY && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && export DISPLAY=:0 && node dist/cli/main.js --no-ui '你的任务'"
```

### 快照管理
```bash
# 创建快照
vmrun -T fusion snapshot /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx "clean_state"

# 恢复快照
vmrun -T fusion revertToSnapshot /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx "clean_state"
```

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

**重要：如果 60 秒内没有任何输出变化，说明 Jarvis 卡住了，需要停止并排查问题！**

循环读取 tmux 输出，跟踪 Jarvis 的每一步：

```bash
# 读取当前屏幕内容
tmux capture-pane -t work -b buf && tmux save-buffer -b buf -

# 建议每 15-30 秒读取一次，根据任务复杂度调整间隔
sleep 20 && tmux capture-pane -t work -b buf && tmux save-buffer -b buf -
```

**卡住检测：如果 60 秒内没有新的日志输出，执行以下步骤：**

```bash
# 1. 停止当前任务
tmux send-keys -t work C-c

# 2. 查看 VM 屏幕截图
sshpass -p "$PASSWORD" ssh user@$VM_IP "DISPLAY=:0 gnome-screenshot -f /tmp/screenshot.png"
sshpass -p "$PASSWORD" scp user@$VM_IP:/tmp/screenshot.png /tmp/vm_screenshot.png

# 3. 获取 VM 状态
sshpass -p "$PASSWORD" ssh user@$VM_IP "ps aux | grep -E 'node|firefox'"

# 4. 查看最新 trace 日志
sshpass -p "$PASSWORD" ssh user@$VM_IP "ls -lt ~/jarvis/data/traces/ | head -3"
sshpass -p "$PASSWORD" ssh user@$VM_IP "tail -50 ~/jarvis/data/traces/$(ls -t ~/jarvis/data/traces/ | head -1)"

# 5. 反思问题
# - 检查日志中的错误信息
# - 检查截图中的 GUI 状态
# - 检查工具调用是否失败
# - 必要时修改代码
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

## 相关文档

- [平台适配开发规范](platform-adaptation.md) - Linux 平台开发规范和环境要求
- [测试规格](test-spec.md) - 测试用例和验证清单
