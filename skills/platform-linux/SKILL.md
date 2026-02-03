---
name: platform-linux
description: Linux 平台操作技能，包含 Linux 桌面环境的交互规则和快捷键。当在 Linux 系统上操作时自动激活。
---

# Linux Platform Skill

## 平台规则

- 使用 `ctrl` 作为主修饰键（部分桌面环境也支持 `super` 键）
- `super` 键通常是键盘上的 Windows 键或 Command 键
- **窗口焦点规则**：取决于桌面环境设置，默认点击激活并触发操作
- 文件路径使用正斜杠 `/`
- 临时文件目录：`/tmp`
- 文件名区分大小写

## 快捷键 (GNOME/KDE 通用)

### 系统级
- `super` → 打开活动视图/应用菜单
- `super a` → 显示应用程序列表 (GNOME)
- `alt f2` → 运行命令对话框
- `alt tab` → 切换窗口
- `super tab` → 切换应用
- `alt f4` → 关闭当前窗口
- `ctrl alt t` → 打开终端
- `ctrl alt delete` → 注销/关机菜单
- `print screen` → 截图
- `alt print screen` → 当前窗口截图
- `super left/right` → 窗口靠左/右半屏
- `super up` → 最大化窗口
- `super down` → 还原/最小化窗口

### 文本编辑
- `ctrl c/v/x` → 复制/粘贴/剪切
- `ctrl a` → 全选
- `ctrl z` → 撤销
- `ctrl shift z` 或 `ctrl y` → 重做
- `ctrl f` → 查找
- `ctrl g` → 查找下一个
- `ctrl shift g` → 查找上一个
- `backspace` → 删除光标前字符
- `delete` → 删除光标后字符
- `ctrl backspace` → 删除前一个词
- `ctrl delete` → 删除后一个词
- `home/end` → 移动至行首/行尾
- `ctrl home/end` → 移动至文档首/尾

### 浏览器/标签页
- `ctrl t` → 新建标签页
- `ctrl w` → 关闭当前标签页
- `ctrl shift t` → 恢复关闭的标签页
- `ctrl l` → 聚焦地址栏
- `ctrl r` 或 `f5` → 刷新页面
- `ctrl shift r` → 强制刷新
- `alt left` / `alt right` → 后退/前进

### 文件管理器 (Nautilus/Dolphin)
- `f2` → 重命名
- `enter` → 打开
- `delete` → 移到回收站
- `shift delete` → 永久删除
- `ctrl shift n` → 新建文件夹
- `ctrl l` → 显示路径栏

### 终端特有
- `ctrl shift c` → 复制（终端中）
- `ctrl shift v` → 粘贴（终端中）
- `ctrl c` → 中断当前命令（终端中）
- `ctrl d` → 退出/EOF（终端中）
- `ctrl l` → 清屏（终端中）
- `ctrl r` → 搜索历史命令（终端中）

## 技巧

- 不同桌面环境（GNOME、KDE、XFCE）快捷键可能略有不同
- 中键点击可粘贴选中的文本（X11 选择缓冲区）
- 大多数应用支持拖放操作
- 终端中的复制粘贴需要加 `shift`（`ctrl+shift+c/v`）

## 注意事项

- 终端中 `ctrl+c` 是中断命令，不是复制！复制需要 `ctrl+shift+c`
- 不同发行版和桌面环境的快捷键可能有差异
- 文件名区分大小写，`File.txt` 和 `file.txt` 是不同文件
