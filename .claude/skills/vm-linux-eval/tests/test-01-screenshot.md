# 测试用例规格：截图功能

## 测试什么功能

测试 Jarvis 在 Linux 平台上的截图能力，包括：
- 全屏截图
- 指定区域截图
- 截图文件保存

## 怎么测试功能

### 1. 环境准备
- VM: VMware Fusion Ubuntu 22.04 LTS ARM64
- 确保 GNOME screenshot 已安装: `sudo apt install -y gnome-screenshot`
- 或使用 scrot: `sudo apt install -y scrot`
- 确保 DISPLAY 环境变量已设置: `export DISPLAY=:0`

### 2. 功能测试方法

#### 2.1 全屏截图测试
```bash
# 测试命令：截取当前屏幕截图
node dist/cli/main.js --no-ui '截取当前屏幕截图'
```

验证方法：
- **Log 输出 (30%)**: 检查 screenshot 工具调用是否成功返回，查看生成的截图文件路径
- **VM 真实状态 (50%)**:
  - 使用 `ls -la` 验证截图文件是否存在于预期目录
  - 检查文件大小是否合理 (> 10KB)
  - 使用 `file` 命令验证文件格式是否为图片
- **思考反思 (20%)**: 分析截图是否包含正确的屏幕内容

#### 2.2 截图文件验证
```bash
# 在 VM 中验证截图文件
ls -la ~/jarvis/workspace/screenshots/
file ~/jarvis/workspace/screenshots/*.png
```

### 3. 自动化验证脚本

```bash
#!/bin/bash
# verify_screenshot.sh

VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 执行截图任务
sshpass -p "$PASSWORD" ssh user@$VM_IP "DISPLAY=:0 node dist/cli/main.js --no-ui '截取当前屏幕截图'"

# 列出截图目录
sshpass -p "$PASSWORD" ssh user@$VM_IP "ls -la ~/jarvis/workspace/screenshots/"

# 获取最新截图文件信息
sshpass -p "$PASSWORD" ssh user@$VM_IP "ls -lt ~/jarvis/workspace/screenshots/ | head -3"

# 拉取截图到宿主机进行查看
LATEST_FILE=$(sshpass -p "$PASSWORD" ssh user@$VM_IP "ls -t ~/jarvis/workspace/screenshots/*.png | head -1")
sshpass -p "$PASSWORD" scp user@$VM_IP:$LATEST_FILE /tmp/vm_screenshot.png
```

## 功能完成的预期效果

### 核心预期
1. 截图文件应保存在配置的 workspace 目录下的 screenshots 子目录
2. 文件名应包含时间戳以避免覆盖
3. 截图应为有效的 PNG 或 JPEG 格式
4. 截图内容应与当前屏幕内容一致

### 验收标准

| 功能 | 最低要求 | 理想要求 |
|------|----------|----------|
| 文件生成 | 截图文件存在 | 文件大小合理 (> 10KB) |
| 文件格式 | 有效图片格式 | PNG 无损格式 |
| 内容正确 | 包含屏幕内容 | 完整无裁剪 |

### 评估权重

- **Log 输出 (30%)**: 工具调用成功返回，文件路径正确
- **VM 真实状态 (50%)**: 文件实际存在，大小合理，可正常打开
- **思考反思 (20%)**: 代码正确处理路径和格式
