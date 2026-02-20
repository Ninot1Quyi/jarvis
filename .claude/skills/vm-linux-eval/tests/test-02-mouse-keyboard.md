# 测试用例规格：鼠标键盘功能

## 测试什么功能

测试 Jarvis 在 Linux 平台上的鼠标和键盘操作能力，包括：
- 鼠标点击 (click)
- 鼠标双击 (doubleClick)
- 鼠标右键 (rightClick)
- 鼠标中键 (middleClick)
- 鼠标拖拽 (drag)
- 鼠标滚动 (scroll)
- 键盘输入 (type)
- 键盘快捷键 (hotkey)

## 怎么测试功能

### 1. 环境准备
- VM: VMware Fusion Ubuntu 22.04 LTS ARM64
- 确保 xdotool 已安装: `sudo apt install -y xdotool`
- 确保 DISPLAY 环境变量已设置: `export DISPLAY=:0`

### 2. 功能测试方法

#### 2.1 鼠标点击测试
```bash
# 测试命令：在桌面左侧 Activities 按钮上点击
node dist/cli/main.js --no-ui '点击屏幕左上角的 Activities 按钮'
```

验证方法：
- **Log 输出 (30%)**: 检查 click 工具调用是否成功返回
- **VM 真实状态 (50%)**:
  - 使用 `xdotool getmouselocation` 验证鼠标位置
  - 使用 `gnome-screenshot` 截取操作后屏幕，对比操作前后状态
  - 检查 Activities 菜单是否弹出
- **思考反思 (20%)**: 分析点击位置是否准确，是否需要调整坐标

#### 2.2 键盘输入测试
```bash
# 测试命令：打开终端并输入文本
node dist/cli/main.js --no-ui '打开终端应用并输入 hello world'
```

验证方法：
- **Log 输出 (30%)**: 检查 type 工具调用是否成功返回
- **VM 真实状态 (50%)**:
  - 使用 `xdotool getactivewindow getwindowname` 验证活动窗口
  - 使用 `xdotool search` 查找终端窗口内容
  - 截取屏幕验证文本是否出现在终端中
- **思考反思 (20%)**: 分析字符编码是否正确处理

#### 2.3 快捷键测试
```bash
# 测试命令：使用 Ctrl+Alt+T 打开终端
node dist/cli/main.js --no-ui '使用快捷键打开终端'
```

验证方法：
- **Log 输出 (30%)**: 检查 hotkey 工具调用是否成功返回
- **VM 真实状态 (50%)**:
  - 检查终端是否已启动
  - 使用 `ps aux | grep gnome-terminal` 验证进程
  - 截取屏幕验证结果
- **思考反思 (20%)**: 分析快捷键映射是否正确

#### 2.4 组合操作测试
```bash
# 测试命令：打开文件管理器并进入主目录
node dist/cli/main.js --no-ui '打开文件管理器并进入主目录'
```

验证方法：
- **Log 输出 (30%)**: 检查多个工具调用链是否成功
- **VM 真实状态 (50%)**:
  - 检查文件管理器窗口是否打开
  - 使用 `xdotool` 验证当前路径是否为 ~ 或 /home/user
  - 截取屏幕验证目录视图
- **思考反思 (20%)**: 分析操作流程是否合理

### 3. 自动化验证脚本

```bash
#!/bin/bash
# verify_mouse_keyboard.sh

VM_IP="192.168.236.129"
PASSWORD="jarvis.linux.123"

# 测试前截图
sshpass -p "$PASSWORD" ssh user@$VM_IP "DISPLAY=:0 gnome-screenshot -f /tmp/before.png"

# 执行测试任务
sshpass -p "$PASSWORD" ssh user@$VM_IP "DISPLAY=:0 node dist/cli/main.js --no-ui '打开系统监视器'"

# 测试后截图
sshpass -p "$PASSWORD" ssh user@$VM_IP "DISPLAY=:0 gnome-screenshot -f /tmp/after.png"

# 拉取截图到宿主机
sshpass -p "$PASSWORD" scp user@$VM_IP:/tmp/before.png /tmp/vm_before.png
sshpass -p "$PASSWORD" scp user@$VM_IP:/tmp/after.png /tmp/vm_after.png
```

## 功能完成的预期效果

### 核心预期
1. **鼠标操作**:
   - 点击应在指定坐标位置触发点击事件
   - 双击应连续触发两次点击事件
   - 拖拽应从起点移动到终点并保持按下状态
   - 滚动应在指定位置触发滚动事件

2. **键盘操作**:
   - 文本输入应在活动窗口中显示对应字符
   - 快捷键应触发对应的系统操作
   - 非 ASCII 字符（中文等）应通过剪贴板正确输入

3. **跨平台一致性**:
   - Linux 平台使用 xdotool 实现
   - macOS 平台使用 nut-js 实现
   - Windows 平台使用 nut-js 实现
   - 相同任务在不同平台应有相同执行结果

### 验收标准

| 功能 | 最低要求 | 理想要求 |
|------|----------|----------|
| click | 点击事件触发 | 坐标准确，元素可点击 |
| doubleClick | 两次点击触发 | 间隔合理，触发成功 |
| type | 字符输入 | 正确处理中文和特殊字符 |
| hotkey | 快捷键触发 | 常用快捷键均可用 |
| scroll | 滚动触发 | 方向正确，幅度合理 |

### 评估权重

- **Log 输出 (30%)**: 工具调用成功返回，无错误信息
- **VM 真实状态 (50%)**: 实际 GUI 状态符合预期，截图对比明显
- **思考反思 (20%)**: 代码逻辑正确，错误处理完善
