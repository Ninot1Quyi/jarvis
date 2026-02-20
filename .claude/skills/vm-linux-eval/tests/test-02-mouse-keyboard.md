# 测试用例：鼠标键盘功能

**测试日期**: 2026-02-20

**测试环境**:
- VM: VMware Fusion Ubuntu 22.04 LTS ARM64
- Node.js: v22.22.0 (via nvm)
- Jarvis: 最新代码 (含 xdotool 回退支持)

## 测试任务

```
打开系统监视器
```

## 执行命令

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
PROXY="http://192.168.236.1:7897"

sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "export http_proxy=$PROXY && https_proxy=$PROXY && export NVM_DIR=\"\\$HOME/.nvm\" && [ -s \"\\$NVM_DIR/nvm.sh\" ] && . \"\\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && export DISPLAY=:0 && node dist/cli/main.js --no-ui '打开系统监视器'"
```

## 测试结果

- [x] Jarvis 成功启动
- [x] 任务执行开始
- [x] **click 工具**: 使用 xdotool 执行成功
  - `click {"coordinate":[25,15],"desc":"Activities"}` - [OK]
- [x] **type 工具**: 使用 xdotool 执行成功
  - `type {"text":"System Monitor"}` - [OK]
- [x] **hotkey 工具**: 使用 xdotool 执行成功
  - `hotkey {"key":"enter"}` - [OK]
- [x] 通知服务正常工作 (D-Bus GLib main loop)

## 结论

- **通过**: click 功能 (xdotool 回退)
- **通过**: type 功能 (xdotool 回退)
- **通过**: hotkey 功能 (xdotool 回退)
- **通过**: 通知服务

## 实现细节

当检测到 Linux 平台时 (`process.platform === 'linux'`), 鼠标和键盘工具使用 xdotool 而不是 nut-js:
- 鼠标移动: `xdotool mousemove x y`
- 鼠标点击: `xdotool click 1/2/3` (左/中/右键)
- 双击: `xdotool click --repeat 2 1`
- 拖拽: `xdotool mousedown/mousemove/mouseup`
- 滚动: `xdotool click 4/5/6/7`
- 键盘输入: `xdotool type -- 'text'`
- 快捷键: `xdotool key ctrl+v`
