// Windows Platform Skill

import type { Skill } from '../types.js'

export const windowsSkill: Skill = {
  name: 'platform-windows',
  type: 'platform',
  description: 'Windows 平台操作技能，包含 Windows 特有的交互规则和快捷键',
  version: '1.0.0',

  match: {
    platform: ['win32'],
  },

  prompt: {
    rules: `
## Windows 平台规则

- 使用 \`ctrl\` 而非 \`cmd\` 作为主修饰键
- **窗口焦点规则**：点击非活动窗口会同时激活窗口并触发点击操作（与 macOS 不同）
- 文件路径使用反斜杠 \`\\\`，但大多数程序也接受正斜杠
- 临时文件目录：\`%TEMP%\` 或 \`%TMP%\`
- 文件名不区分大小写
`,

    hotkeys: `
## Windows 快捷键

### 系统级
- \`win\` → 打开开始菜单，可直接输入搜索
- \`win e\` → 打开文件资源管理器
- \`win d\` → 显示桌面
- \`win l\` → 锁定屏幕
- \`win r\` → 打开运行对话框
- \`win i\` → 打开设置
- \`alt tab\` → 切换窗口
- \`win tab\` → 任务视图
- \`alt f4\` → 关闭当前窗口/应用
- \`ctrl shift esc\` → 打开任务管理器
- \`win shift s\` → 截图工具
- \`print screen\` → 全屏截图到剪贴板
- \`win 1-9\` → 启动/切换任务栏第 N 个应用

### 文本编辑
- \`ctrl c/v/x\` → 复制/粘贴/剪切
- \`ctrl a\` → 全选
- \`ctrl z\` → 撤销
- \`ctrl y\` → 重做
- \`ctrl f\` → 查找
- \`f3\` → 查找下一个
- \`shift f3\` → 查找上一个
- \`backspace\` → 删除光标前字符
- \`delete\` → 删除光标后字符
- \`ctrl backspace\` → 删除前一个词
- \`ctrl delete\` → 删除后一个词
- \`shift left/right\` → 选择字符
- \`ctrl shift left/right\` → 选择词
- \`shift home/end\` → 选择至行首/行尾
- \`ctrl home/end\` → 移动至文档首/尾
- \`ctrl a\` 然后 \`backspace\` → 清空输入框

### 浏览器/标签页
- \`ctrl t\` → 新建标签页
- \`ctrl w\` → 关闭当前标签页
- \`ctrl shift t\` → 恢复关闭的标签页
- \`ctrl l\` 或 \`f6\` → 聚焦地址栏
- \`ctrl r\` 或 \`f5\` → 刷新页面
- \`ctrl shift r\` 或 \`ctrl f5\` → 强制刷新
- \`alt left\` / \`alt right\` → 后退/前进
- \`ctrl 1-9\` → 切换到第 N 个标签页

### 文件资源管理器
- \`f2\` → 重命名选中项
- \`enter\` → 打开选中项
- \`delete\` → 删除到回收站
- \`shift delete\` → 永久删除
- \`ctrl shift n\` → 新建文件夹
- \`ctrl l\` → 聚焦地址栏
- \`alt d\` → 聚焦地址栏
- \`f4\` → 展开地址栏下拉
`,

    tips: `
## Windows 技巧

- 按 \`win\` 键后直接输入可快速搜索应用和文件
- 拖拽窗口到屏幕边缘可快速分屏（左/右半屏，角落四分之一屏）
- \`win + 方向键\` 可快速调整窗口位置和大小
- 右键点击开始按钮可快速访问系统工具（电源选项、设备管理器等）
- 任务栏图标可以右键查看最近文件和常用操作
`,

    warnings: `
## Windows 注意事项

- 文件资源管理器中 \`enter\` 是打开，\`f2\` 才是重命名（与 macOS Finder 相反）
- \`delete\` 键直接删除光标后字符，不需要组合键
- 部分应用可能使用 \`ctrl+shift+z\` 重做，但标准是 \`ctrl+y\`
`,
  },

  priority: 100,
  enabled: true,
}
