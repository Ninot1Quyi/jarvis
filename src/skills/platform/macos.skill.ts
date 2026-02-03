// macOS Platform Skill

import type { Skill } from '../types.js'

export const macosSkill: Skill = {
  name: 'platform-macos',
  type: 'platform',
  description: 'macOS 平台操作技能，包含 macOS 特有的交互规则和快捷键',
  version: '1.0.0',

  match: {
    platform: ['darwin'],
  },

  prompt: {
    rules: `
## macOS 平台规则

- 使用 \`cmd\` 而非 \`ctrl\` 作为主修饰键
- **窗口焦点规则（重要）**：点击非活动窗口时，第一次点击仅激活窗口，第二次点击才执行操作
- 文件路径使用正斜杠 \`/\`
- 临时文件目录：\`/tmp\` 或 \`$TMPDIR\`
`,

    hotkeys: `
## macOS 快捷键

### 系统级
- \`cmd space\` → Spotlight 搜索，输入应用名后按 \`enter\` 启动
- \`cmd tab\` → 切换应用
- \`cmd q\` → 退出当前应用
- \`cmd ,\` → 打开当前应用偏好设置
- \`cmd h\` → 隐藏当前窗口
- \`cmd m\` → 最小化当前窗口
- \`cmd shift 3\` → 全屏截图
- \`cmd shift 4\` → 区域截图

### 文本编辑
- \`cmd c/v/x\` → 复制/粘贴/剪切
- \`cmd a\` → 全选
- \`cmd z\` → 撤销
- \`cmd shift z\` → 重做
- \`cmd f\` → 查找
- \`cmd g\` → 查找下一个
- \`cmd shift g\` → 查找上一个
- \`backspace\` → 删除光标前字符
- \`delete\` 或 \`fn backspace\` → 删除光标后字符
- \`cmd backspace\` → 删除至行首
- \`cmd shift left/right\` → 选择至行首/行尾
- \`option left/right\` → 按词移动光标
- \`cmd left/right\` → 移动至行首/行尾
- \`cmd up/down\` → 移动至文档首/尾
- \`cmd a\` 然后 \`backspace\` → 清空输入框

### 浏览器/标签页
- \`cmd t\` → 新建标签页
- \`cmd w\` → 关闭当前标签页
- \`cmd shift t\` → 恢复关闭的标签页
- \`cmd l\` → 聚焦地址栏
- \`cmd r\` → 刷新页面
- \`cmd shift r\` → 强制刷新（忽略缓存）
- \`cmd [\` / \`cmd ]\` → 后退/前进
- \`cmd 1-9\` → 切换到第 N 个标签页

### Finder
- \`enter\` → 重命名选中项（不是打开！）
- \`cmd o\` → 打开选中项
- \`cmd backspace\` → 移到废纸篓
- \`cmd shift n\` → 新建文件夹
- \`cmd shift g\` → 前往文件夹
- \`space\` → 快速预览
`,

    tips: `
## macOS 技巧

- Spotlight (\`cmd space\`) 是最快的应用启动方式，输入应用名前几个字母即可
- 按住 \`option\` 点击菜单栏图标可显示更多选项
- 三指拖拽可移动窗口（需在辅助功能中开启）
- \`cmd \`\` (反引号) 可在同一应用的多个窗口间切换
`,

    warnings: `
## macOS 注意事项

- **窗口焦点陷阱**：如果点击没有反应，检查目标窗口是否是当前焦点窗口，可能需要先点击一次激活
- Finder 中 \`enter\` 是重命名，不是打开文件
- \`delete\` 键在 Mac 上是 Backspace 功能，真正的 Delete 需要 \`fn+delete\`
`,
  },

  priority: 100, // 平台技能最高优先级
  enabled: true,
}
