# 测试用例规格：通知功能

## 测试什么功能

测试 Jarvis 在 Linux 平台上的系统通知能力，包括：
- 通知监听 (D-Bus 监控)
- 通知发送 (notify-send)

## 怎么测试功能

### 1. 环境准备
- VM: VMware Fusion Ubuntu 22.04 LTS ARM64
- 确保 libnotify 已安装: `sudo apt install -y libnotify-bin`
- 确保 Python3 dbus 已安装: `sudo apt install -y python3-dbus`
- 确保 GLib 已安装: `sudo apt install -y python3-gi`
- 确保 DISPLAY 环境变量已设置: `export DISPLAY=:0`

### 2. 功能测试方法

#### 2.1 通知监听测试
```bash
# 启动 Jarvis 并检查通知服务是否正常启动
node dist/cli/main.js --no-ui '截取当前屏幕截图'
# 观察日志中是否包含 "[NotificationProvider:linux] started"
```

验证方法：
- **Log 输出 (30%)**: 检查通知服务启动日志
- **VM 真实状态 (50%)**:
  - 使用 `ps aux | grep python3` 验证 Python 进程是否运行
  - 使用 `dbus-monitor --session` 验证 D-Bus 连接
- **思考反思 (20%)**: 分析通知服务架构是否正确

#### 2.2 通知发送测试
```bash
# 在 VM 中手动发送通知测试
notify-send "Test Title" "Test Body"
```

验证方法：
- **Log 输出 (30%)**: 检查是否有通知事件被捕获
- **VM 真实状态 (50%)**:
  - 观察屏幕右上角是否弹出通知
  - 使用 `dbus-monitor` 验证通知是否通过 D-Bus 发送
- **思考反思 (20%)**: 分析通知内容是否正确解析

### 3. 自动化验证脚本

```bash
#!/bin/bash
# verify_notification.sh

VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 启动 Jarvis 并在后台监控通知
sshpass -p "$PASSWORD" ssh user@$VM_IP "DISPLAY=:0 node dist/cli/main.js --no-ui '截取当前屏幕截图'" &
JARVIS_PID=$!

sleep 5

# 发送测试通知
sshpass -p "$PASSWORD" ssh user@$VM_IP "notify-send 'Test' 'Testing notification'"

# 等待通知
sleep 3

# 检查 Jarvis 日志中是否有通知事件
sshpass -p "$PASSWORD" ssh user@$VM_IP "grep -i 'notification' ~/jarvis/data/traces/*.md | tail -10"

# 杀掉 Jarvis
sshpass -p "$PASSWORD" ssh user@$VM_IP "kill $JARVIS_PID 2>/dev/null"
```

## 功能完成的预期效果

### 核心预期
1. 通知服务应在 Jarvis 启动时自动启动
2. 通知监听应通过 D-Bus 连接到 org.freedesktop.Notifications
3. 发送的通知应在系统通知区域显示
4. 通知内容（标题、正文）应被正确解析

### 验收标准

| 功能 | 最低要求 | 理想要求 |
|------|----------|----------|
| 服务启动 | 进程运行 | 日志显示已启动 |
| 通知监听 | D-Bus 连接 | 正确解析通知 |
| 通知发送 | 系统弹出 | 内容正确显示 |

### 评估权重

- **Log 输出 (30%)**: 服务启动日志，通知事件解析
- **VM 真实状态 (50%)**: 进程运行状态，D-Bus 监控，通知弹窗
- **思考反思 (20%)**: 代码架构合理性，错误处理
