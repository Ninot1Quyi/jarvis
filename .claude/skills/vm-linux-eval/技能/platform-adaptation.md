# Linux 平台适配开发规范

本文档记录 Jarvis 项目在 Linux 平台上的适配开发过程和规范。

## 1. 平台架构概述

### 1.1 Linux 桌面环境特点

Linux 桌面环境多样化，主要有：
- GNOME (Ubuntu 22.04/24.04 默认)
- KDE Plasma
- XFCE
- LXDE/LXQt

本规范以 **GNOME** 桌面环境为主要目标。

### 1.2 技术栈选择

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 辅助功能 | Swift CLI + AXUIElement | PowerShell + UIAutomation | AT-SPI2 + python3-atspi |
| 截图 | screencapture | .NET ScreenCapture | gnome-screenshot / scrot / nut-js |
| 剪贴板 | pbcopy/pbpaste | PowerShell | xclip / xsel / wl-copy |
| 通知 | osascript | PowerShell | notify-send / dbus |
| 鼠标控制 | nut-js | nut-js | nut-js / xdotool |

## 2. 环境要求

### 2.1 系统依赖

```bash
# 核心依赖
sudo apt install -y openssh-server xdotool wmctrl

# 剪贴板工具
sudo apt install -y xclip xsel wtype

# 截图工具
sudo apt install -y gnome-screenshot scrot imagemagick

# 辅助功能 (AT-SPI2)
sudo apt install -y python3-gi python3-pip
pip3 install pyatspi

# Node.js (v20+)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2.2 GNOME 辅助功能设置

1. 打开 "系统设置" → "辅助功能"
2. 启用 "屏幕阅读器" (这会启动 AT-SPI2 守护进程)
3. 或手动启动：`at-spi2-registryd &`

## 3. 核心模块实现

### 3.1 Accessibility Provider

Linux 使用 AT-SPI2，参考 `native/linux/atspi-query.py`。

### 3.2 Notification Provider

使用 notify-send 或 dbus。

### 3.3 Clipboard

支持 X11 和 Wayland：
- X11: xclip, xsel
- Wayland: wl-copy, wl-paste

## 4. 代码规范

### 4.1 平台检测

```typescript
import { platform } from 'process';

export function isLinux(): boolean {
  return platform === 'linux';
}

export function getDesktopEnvironment(): 'gnome' | 'kde' | 'xfce' | 'unknown' {
  const desktop = process.env.XDG_CURRENT_DESKTOP?.toLowerCase() || '';
  if (desktop.includes('gnome')) return 'gnome';
  if (desktop.includes('kde')) return 'kde';
  if (desktop.includes('xfce')) return 'xfce';
  return 'unknown';
}
```

### 4.2 日志规范

所有 Linux 特定代码必须添加 `[Linux]` 前缀。

## 5. 已知限制

### 5.1 Linux 平台限制

1. **截图质量**: nut-js 在 Linux 下可能不包含鼠标光标
2. **窗口管理**: wmctrl 对某些窗口管理器支持不完整
3. **辅助功能**: AT-SPI2 在不同桌面环境下行为有差异
4. **Wayland**: Wayland 会话下 xdotool 等工具不可用

### 5.2 兼容性问题

| 功能 | X11 | Wayland | 备注 |
|------|-----|----------|------|
| xdotool | ✓ | ✗ | 需要 XWayland |
| xclip | ✓ | ✗ | 需要 XWayland |
| wmctrl | ✓ | △ | 部分支持 |
| gnome-screenshot | ✓ | ✓ | 原生支持 |
| wl-copy/wl-paste | ✗ | ✓ | Wayland 原生 |

## 6. 版本历史

| 日期 | 修改内容 | 作者 |
|------|----------|------|
| 2026-02-19 | 初始版本 | Claude |
