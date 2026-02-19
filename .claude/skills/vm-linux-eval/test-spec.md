# Linux 平台适配测试规格

本文档记录 Linux 平台适配的测试用例和验证标准。

## 测试环境

- **VMware**: VMware Fusion
- **操作系统**: Ubuntu 22.04 LTS / 24.04 LTS
- **桌面环境**: GNOME Shell
- **VM IP**: 192.168.199.131
- **用户**: jarvis / 123456

## 测试用例

### 1. 剪贴板功能测试

#### 1.1 X11 剪贴板

**前置条件**:
- VM 运行在 X11 会话
- 安装 xclip/xsel

**测试步骤**:
1. 在 VM 中打开终端
2. 使用 Jarvis 输入中文文本
3. 验证文本正确粘贴

**预期结果**: 中文文本正确显示

#### 1.2 Wayland 剪贴板

**前置条件**:
- VM 运行在 Wayland 会话
- 安装 wl-copy

**测试步骤**: 同 1.1

### 2. 截图功能测试

#### 2.1 X11 截图

**前置条件**:
- VM 运行在 X11 会话
- 安装 scrot 或 gnome-screenshot

**测试步骤**:
1. 打开 VM 中的文件管理器
2. 使用 Jarvis 截取屏幕
3. 验证截图文件存在且包含鼠标光标

**预期结果**: 截图成功，鼠标光标可见

### 3. 辅助功能测试

#### 3.1 AT-SPI2 可用性检测

```bash
ssh jarvis@192.168.199.131 'python3 ~/jarvis/native/linux/atspi-query.py state'
```

**预期结果**: 返回 JSON 包含 applications 和 focusedApplication

#### 3.2 坐标点查询

```bash
ssh jarvis@192.168.199.131 'python3 ~/jarvis/native/linux/atspi-query.py query 500 300'
```

#### 3.3 关键词搜索

```bash
ssh jarvis@192.168.199.131 'python3 ~/jarvis/native/linux/atspi-query.py search "file"'
```

### 4. 端到端任务测试

**测试任务**: "打开文件管理器"

**测试步骤**:
1. 同步代码到 VM
2. 启动 Jarvis
3. 发送任务描述
4. 观察执行结果

## 验证清单

| 功能 | X11 | Wayland | 备注 |
|------|-----|---------|------|
| 剪贴板 (xclip) | [ ] | - | |
| 剪贴板 (wl-copy) | - | [ ] | |
| 截图 (scrot) | [ ] | - | |
| 截图 (gnome-screenshot) | [ ] | [ ] | |
| AT-SPI2 查询 | [ ] | [ ] | |
| AT-SPI2 搜索 | [ ] | [ ] | |

## 调试命令

```bash
# 检查桌面环境类型
echo $XDG_SESSION_TYPE

# 检查 AT-SPI2 服务
ps aux | grep at-spi

# 测试手动截图
gnome-screenshot -f /tmp/test.png

# 测试通知发送
notify-send -i dialog-information "Test" "Message"
```

## 版本历史

| 日期 | 修改内容 | 作者 |
|------|----------|------|
| 2026-02-19 | 初始测试规格 | Claude |
