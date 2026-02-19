# 测试用例：截图功能

**测试日期**: 2026-02-19

**测试环境**:
- VM: VMware Fusion Ubuntu 22.04 LTS ARM64
- Node.js: v22.22.0 (via nvm)
- Jarvis: 最新代码

## 测试任务

```
截取当前屏幕截图
```

## 执行命令

```bash
VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"
PROXY="http://192.168.236.1:7897"

sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no user@$VM_IP \
  "export http_proxy=$PROXY && https_proxy=$PROXY && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\" && nvm use 22 && cd /home/user/jarvis && export DISPLAY=:0 && node dist/cli/main.js --no-ui '截取当前屏幕截图'"
```

## 测试结果

- [x] Jarvis 成功启动
- [x] 任务执行开始
- [x] 截图工具被调用
- [x] 截图成功保存
- [x] 通知服务正常启动 (D-Bus GLib main loop)

## 生成的截图文件

```
/home/user/jarvis/workspace/screenshots/1771518871130_current_screen.png
```

文件大小: 705583 bytes

## 结论

- **通过**: 截图功能正常工作
- **通过**: 通知服务正常工作
