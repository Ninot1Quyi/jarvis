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

## 快速同步与编译（推荐）

首次同步或修改了 package.json 时使用完整同步：

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
PROXY="http://192.168.236.1:7897"

# 1. 同步所有源码（包含 package.json）
sshpass -p "$PASSWORD" rsync -avz \
  --exclude node_modules --exclude .git --exclude dist --exclude target \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password" \
  /Users/Ninot/NinotQuyi/jarvis/ \
  user@${VM_IP}:~/jarvis/

# 2. 删除旧 node_modules 并重新安装
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "rm -rf ~/jarvis/node_modules && export http_proxy=$PROXY && https_proxy=$PROXY && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && npm install"

# 3. 编译
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "export http_proxy=$PROXY && https_proxy=$PROXY && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && npm run build"
```

只修改 src/prompts/config 时使用快速同步：

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 快速同步 src
sshpass -p "$PASSWORD" rsync -avz \
  --exclude node_modules --exclude .git --exclude dist --exclude target \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password" \
  /Users/Ninot/NinotQuyi/jarvis/src/ \
  user@${VM_IP}:~/jarvis/src/

# 快速同步 config
sshpass -p "$PASSWORD" rsync -avz \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password" \
  /Users/Ninot/NinotQuyi/jarvis/config/ \
  user@${VM_IP}:~/jarvis/config/

# 快速同步 prompts
sshpass -p "$PASSWORD" rsync -avz \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password" \
  /Users/Ninot/NinotQuyi/jarvis/prompts/ \
  user@${VM_IP}:~/jarvis/prompts/

# 重新编译
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && npm run build"
```

## VM 环境准备（首次同步后必须执行）

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 1. 修复 workspace 路径（从宿主机路径改为 VM 路径）
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "sed -i 's|\"/Users/Ninot/NinotQuyi/jarvis/workspace\"|\"/home/user/jarvis/workspace\"|' ~/jarvis/config/config.json"

# 2. 创建 workspace 目录
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "mkdir -p ~/jarvis/workspace/screenshots ~/jarvis/workspace/traces"

# 3. 验证配置
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "grep workspace ~/jarvis/config/config.json"
```

## 常见问题与解决方案

### 问题 1: 编译报错找不到 @modelcontextprotocol/sdk

**原因**: package.json 未同步到 VM，导致依赖未安装

**解决**:
```bash
# 重新同步 package.json 并安装依赖
sshpass -p "$PASSWORD" rsync -avz \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password" \
  /Users/Ninot/NinotQuyi/jarvis/package.json \
  user@${VM_IP}:~/jarvis/package.json

sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "rm -rf ~/jarvis/node_modules && export http_proxy=$PROXY && https_proxy=$PROXY && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && npm install && npm run build"
```

### 问题 2: 运行报错 EACCES: permission denied, mkdir '/Users/Ninot/NinotQuyi/jarvis/workspace'

**原因**: config.json 中 workspace 路径指向宿主机路径

**解决**:
```bash
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "sed -i 's|\"/Users/Ninot/NinotQuyi/jarvis/workspace\"|\"/home/user/jarvis/workspace\"|' ~/jarvis/config/config.json"

# 创建目录
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "mkdir -p ~/jarvis/workspace/screenshots ~/jarvis/workspace/traces"
```

### 问题 3: rsync 报错 "Too many authentication failures"

**原因**: SSH 尝试多个密钥导致认证失败

**解决**: 添加 `-o IdentitiesOnly=yes -o PreferredAuthentications=password` 参数

### 问题 4: Memory 系统初始化失败

**症状**: `[Memory] Failed to initialize memory system: {}`

**原因**:
1. sqlite-vec 扩展的 vec0.so 文件缺失
2. @modelcontextprotocol/sdk 依赖未安装

**解决**:
```bash
# 1. 下载 sqlite-vec ARM64 版本
cd ~/jarvis/node_modules/sqlite-vec
curl -L -o vec.tar.gz 'https://github.com/asg017/sqlite-vec/releases/download/v0.1.6/sqlite-vec-0.1.6-loadable-linux-aarch64.tar.gz'
tar -xzf vec.tar.gz

# 2. 安装依赖
cd ~/jarvis
npm install @modelcontextprotocol/sdk

# 3. 重新编译
npm run build
```

### 问题 5: sqlite-vec 加载失败 (wrong ELF class)

**症状**:
```
[Memory] sqlite-vec unavailable (..., wrong ELF class: ELFCLASS32), vector search disabled
```

**原因**: sqlite-vec 官方预编译的 `loadable-linux-aarch64.tar.gz` 实际上是 32 位 ARM 二进制，不是真正的 64 位 ARM64 (aarch64)。

**验证**:
```bash
file node_modules/sqlite-vec/vec0.so
# 错误输出: ELF 32-bit LSB shared object, ARM
# 正确输出: ELF 64-bit LSB shared object, ARM aarch64
```

**解决 (从源码编译)**:
```bash
# 1. 安装编译依赖 (在 VM 中执行)
echo 'jarvis.linux.123' | sudo -S apt-get install -y build-essential cmake sqlite3 libsqlite3-dev git

# 2. 克隆 sqlite-vec 源码
cd /tmp
rm -rf sqlite-vec
git clone --depth 1 --branch v0.1.6 https://github.com/asg017/sqlite-vec.git

# 3. 编译 loadable extension
cd sqlite-vec
make loadable

# 4. 复制编译好的 vec0.so 到正确位置
cp dist/vec0.so ~/jarvis/node_modules/sqlite-vec/vec0.so

# 5. 验证
file ~/jarvis/node_modules/sqlite-vec/vec0.so
# 应该输出: ELF 64-bit LSB shared object, ARM aarch64
```

### 问题 6: sqlite-vec Android aarch64 版本 libdl.so 依赖问题

**症状**:
```
[Memory] sqlite-vec unavailable (..., libdl.so: cannot open shared object file: No such file or directory), vector search disabled
```

**原因**: Android 编译的版本有 Android 特定的系统库依赖，不能在标准 Ubuntu Linux 上运行。

**解决**: 使用上面"问题 5"的从源码编译方法，不要用 Android 版本。

### 问题 7: better-sqlite3 加载扩展时路径问题

**症状**: 即使 vec0.so 存在，加载仍失败，错误显示找的是 `vec0.so.so`

**原因**: `better-sqlite3` 的 `loadExtension()` 方法会自动添加 `.so` 后缀，所以传 `vec0.so` 会变成找 `vec0.so.so`。

**解决**: 传路径时去掉 `.so` 后缀：
```typescript
// 正确做法
const extPath = '/path/to/vec0.so'
const loadPath = extPath.endsWith('.so') ? extPath.slice(0, -3) : extPath
db.loadExtension(loadPath)
```

这个已经在 `src/memory/db.ts` 中修复了。

## sqlite-vec 完整修复记录 (2026-03-07)

### 完整修复方案

除了上面的问题解决，我们还对 `src/memory/db.ts` 做了以下改进：

1. **新增状态标记**: `vectorEnabled` 和 `vectorLoadError`，明确跟踪向量搜索能力
2. **多路径 fallback 加载**: 依次尝试包 loader、显式路径、手动编译路径
3. **能力验证**: 加载后通过 `vec_version()` 验证扩展真正可用
4. **显式诊断日志**: 不再吞掉真实错误，输出完整的错误信息

### 完整加载流程

```typescript
// 1. 尝试包默认 loader
// 2. 尝试 sqliteVec.getLoadablePath()
// 3. 尝试手动编译路径 (node_modules/sqlite-vec/vec0)
// 4. 任何一步成功后验证 vec_version() 可用
// 5. 设置 vectorEnabled = true 或记录错误
```

### 验证 memory 系统正常

```bash
cd ~/jarvis
node - <<'NODE'
const { MemorySystem } = require('./dist/memory');
const { loadConfig } = require('./dist/utils/config');
(async () => {
  const config = loadConfig();
  const memory = await MemorySystem.create(config.memoryDir || config.dataDir, config.keys);
  const status = memory.status();
  console.log(JSON.stringify({ ok: true, memoryDir: config.memoryDir, files: status.files, chunks: status.chunks }));
  if (memory.shutdown) await memory.shutdown();
})().catch(err => {
  console.error('MEMORY_INIT_FAILED');
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
NODE
```

成功输出应该包含：
```
[Memory] sqlite-vec loaded from manual path: /home/user/jarvis/node_modules/sqlite-vec/vec0.so
[Memory] Memory system ready
{"ok":true,...}
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

### 4. 配置 GNOME 代理

**通过 OSWorld API 配置系统代理**（让浏览器可以访问外网）:
```bash
VM_IP="192.168.236.129"
SERVER="http://$VM_IP:5000"

# 配置 HTTP 代理
curl -s -X POST "$SERVER/execute" \
  -H "Content-Type: application/json" \
  -d '{"command": ["gsettings", "set", "org.gnome.system.proxy.http", "host", "192.168.236.1"], "shell": false}'

curl -s -X POST "$SERVER/execute" \
  -H "Content-Type: application/json" \
  -d '{"command": ["gsettings", "set", "org.gnome.system.proxy.http", "port", "7897"], "shell": false}'

# 配置 HTTPS 代理
curl -s -X POST "$SERVER/execute" \
  -H "Content-Type: application/json" \
  -d '{"command": ["gsettings", "set", "org.gnome.system.proxy.https", "host", "192.168.236.1"], "shell": false}'

curl -s -X POST "$SERVER/execute" \
  -H "Content-Type: application/json" \
  -d '{"command": ["gsettings", "set", "org.gnome.system.proxy.https", "port", "7897"], "shell": false}'

# 启用手动代理模式
curl -s -X POST "$SERVER/execute" \
  -H "Content-Type: application/json" \
  -d '{"command": ["gsettings", "set", "org.gnome.system.proxy", "mode", "manual"], "shell": false}'
```

**验证代理是否生效**:
```bash
curl -s --proxy http://192.168.236.1:7897 -o /dev/null -w '%{http_code}' https://www.google.com
# 返回 200 表示成功
```

### 5. 同步源代码到 VM

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
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 完整同步（包含 package.json）
sshpass -p "$PASSWORD" rsync -avz \
  --exclude node_modules --exclude .git --exclude dist --exclude target \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password" \
  /Users/Ninot/NinotQuyi/jarvis/ \
  user@${VM_IP}:~/jarvis/

# 然后重新安装依赖并编译（见"快速同步与编译"部分）
```

如果只改了 prompts，使用快速同步：

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

sshpass -p "$PASSWORD" rsync -avz \
  -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o PreferredAuthentications=password" \
  /Users/Ninot/NinotQuyi/jarvis/prompts/ \
  user@${VM_IP}:~/jarvis/prompts/

# 重新编译
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 && cd ~/jarvis && npm run build'
```

### Step 3: 创建 tmux 会话并开启 iTerm2 分屏

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 1. 创建 tmux 会话
tmux kill-session -t jarvis 2>/dev/null || true
tmux new-session -d -s jarvis "sshpass -p '$PASSWORD' ssh -o StrictHostKeyChecking=no user@$VM_IP"

# 2. 验证连接成功
sleep 2
tmux capture-pane -t jarvis -b buf && tmux save-buffer -b buf -
# 应该看到 user@ubuntu 的 shell prompt

# 3. 开启 iTerm2 右侧分屏供用户观察
osascript -e '
tell application "iTerm2"
    tell current session of current tab of current window
        set newSession to (split vertically with default profile)
        tell newSession
            write text "tmux attach -t jarvis"
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
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
PROXY="http://192.168.236.1:7897"

# 在宿主机创建任务脚本
cat > /tmp/run_task.sh << 'EOF'
#!/bin/bash
export http_proxy=http://192.168.236.1:7897
export https_proxy=http://192.168.236.1:7897
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22
cd ~/jarvis
export DISPLAY=:0
node dist/cli/main.js --no-ui "任务描述"
EOF

# 上传到 VM
sshpass -p "$PASSWORD" scp -o StrictHostKeyChecking=no /tmp/run_task.sh user@${VM_IP}:/tmp/run_task.sh

# 通过 tmux 执行
tmux send-keys -t jarvis "bash /tmp/run_task.sh" Enter
```

### Step 6: 持续监控执行过程

**重要：如果 60 秒内没有任何输出变化，说明 Jarvis 卡住了，需要停止并排查问题！**

循环读取 tmux 输出，跟踪 Jarvis 的每一步：

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 读取当前屏幕内容
tmux capture-pane -t jarvis -b buf && tmux save-buffer -b buf -

# 建议每 15-30 秒读取一次，根据任务复杂度调整间隔
sleep 20 && tmux capture-pane -t jarvis -b buf && tmux save-buffer -b buf -
```

**卡住检测：如果 60 秒内没有新的日志输出，执行以下步骤：**

```bash
# 1. 停止当前任务
tmux send-keys -t jarvis C-c

# 2. 查看 VM 屏幕截图
sshpass -p "$PASSWORD" ssh user@$VM_IP "DISPLAY=:0 gnome-screenshot -f /tmp/screenshot.png"
sshpass -p "$PASSWORD" scp user@$VM_IP:/tmp/screenshot.png /tmp/vm_screenshot.png

# 3. 获取 VM 状态
sshpass -p "$PASSWORD" ssh user@$VM_IP "ps aux | grep -E 'node|firefox'"

# 4. 查看最新 trace 日志
sshpass -p "$PASSWORD" ssh user@$VM_IP "ls -lt ~/jarvis/data/traces/ | head -3"
sshpass -p "$PASSWORD" ssh user@$VM_IP "tail -50 ~/jarvis/data/traces/\$(ls -t ~/jarvis/data/traces/ | head -1)"

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
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 使用 VMware 的 screenshot 功能或直接用 GNOME screenshot
sshpass -p "$PASSWORD" ssh user@$VM_IP 'gnome-screenshot -f /tmp/screenshot.png'
# 然后拉取到宿主机
sshpass -p "$PASSWORD" scp user@$VM_IP:/tmp/screenshot.png /tmp/vm_screenshot.png
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
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 列出最近的 trace
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP 'ls -lt ~/jarvis/data/traces/ | head -5'

# 读取最新 trace
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP 'cat ~/jarvis/data/traces/<最新trace>.md'
```

截取最终 VM 屏幕状态：

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

sshpass -p "$PASSWORD" ssh user@$VM_IP 'gnome-screenshot -f /tmp/final.png'
sshpass -p "$PASSWORD" scp user@$VM_IP:/tmp/final.png /tmp/vm_final.png
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

## OSWorld 全量评测

使用 OSWorld 框架进行全量评测（368 个任务）：

### 前提条件

1. VM 已启动并运行
2. 代码已同步到 VM 并编译成功
3. VM 环境已配置完成（workspace 路径已修复）

### 启动全量评测

```bash
# 激活 OSWorld Python 环境
source /Users/Ninot/NinotQuyi/OSWorld/.venv/bin/activate

# 运行全量评测
python /Users/Ninot/NinotQuyi/jarvis/scripts/run_jarvis_eval.py \
  --vm-ip 192.168.236.129 \
  --vm-path /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx \
  --task-file /Users/Ninot/NinotQuyi/OSWorld/evaluation_examples/test_all.json \
  --jarvis-dir /home/user/jarvis \
  --output-dir /Users/Ninot/NinotQuyi/jarvis/results/linux-full-$(date +%Y%m%d) \
  --max-tasks 368 \
  --max-time 300
```

### 任务文件说明

| 文件 | 任务数 | 用途 |
|------|--------|------|
| `test_all.json` | 368 | 全量评测 |
| `test_small.json` | 39 | 小规模测试 |
| `test_nogdrive.json` | 360 | 无 Google Drive 测试 |
| `test_infeasible.json` | 29 | 不可行任务测试 |

### 评测结果

结果保存在 `--output-dir` 指定目录：

- `summary.json`: 汇总统计（成功率、平均分）
- `{task_id}/result.json`: 单任务结果
- `{task_id}/jarvis_output.txt`: Jarvis 完整输出
- `{task_id}/task_config.json`: 任务配置

### 快速验证（单任务测试）

先跑一个小测试验证环境：

```bash
source /Users/Ninot/NinotQuyi/OSWorld/.venv/bin/activate

python /Users/Ninot/NinotQuyi/jarvis/scripts/run_jarvis_eval.py \
  --vm-ip 192.168.236.129 \
  --vm-path /Users/Ninot/NinotQuyi/OSWorld/vmware_vm_data/Ubuntu0/Ubuntu.vmx \
  --task-file /Users/Ninot/NinotQuyi/jarvis/scripts/test_single.json \
  --jarvis-dir /home/user/jarvis \
  --output-dir /Users/Ninot/NinotQuyi/jarvis/results/linux-test \
  --max-tasks 1 \
  --max-time 180
```

## 相关文档

- [平台适配开发规范](platform-adaptation.md) - Linux 平台开发规范和环境要求
- [测试规格](test-spec.md) - 测试用例和验证清单
