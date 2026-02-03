// Browser Application Skill

import type { Skill } from '../types.js'

export const browserSkill: Skill = {
  name: 'app-browser',
  type: 'application',
  description: '浏览器操作技能，适用于 Chrome、Firefox、Safari、Edge 等主流浏览器',
  version: '1.0.0',

  match: {
    applications: [
      'chrome', 'google chrome',
      'firefox', 'mozilla firefox',
      'safari',
      'edge', 'microsoft edge',
      'brave',
      'opera',
      'arc',
    ],
    keywords: ['浏览器', '网页', '搜索', 'browser', 'web', 'search', 'url', '网站'],
  },

  prompt: {
    rules: `
## 浏览器操作规则

- **使用 middle_click 打开链接到新标签页**：保持当前页面不变，方便对比和返回
- 地址栏操作：先聚焦地址栏，再输入 URL，最后按 enter
- 搜索操作：点击搜索框 → 输入关键词 → 按 enter → 等待结果加载
- 表单提交：填写完成后按 enter 或点击提交按钮
`,

    examples: `
## 浏览器操作示例

### 打开新网址
\`\`\`
1. hotkey: "ctrl l" (Windows/Linux) 或 "cmd l" (macOS) - 聚焦地址栏
2. type: "https://example.com"
3. hotkey: "enter"
4. wait: 1000
\`\`\`

### 搜索操作
\`\`\`
1. click: 搜索框位置
2. type: "搜索关键词"
3. hotkey: "enter"
4. wait: 1000
\`\`\`

### 打开多个搜索结果
\`\`\`
1. middle_click: 第一个结果链接
2. middle_click: 第二个结果链接
3. middle_click: 第三个结果链接
4. wait: 1000
\`\`\`

### 截取多个页面内容
\`\`\`
1. middle_click: 链接位置 - 在新标签页打开
2. wait: 1000 - 等待页面加载
3. take_screenshot: "page_1_top"
4. scroll: down - 向下滚动
5. wait: 300
6. take_screenshot: "page_1_bottom"
7. hotkey: "ctrl w" - 关闭标签页
8. 重复以上步骤处理其他链接
\`\`\`
`,

    tips: `
## 浏览器技巧

- **批量打开链接**：使用 middle_click 连续打开多个链接，然后逐个处理
- **快速导航**：使用快捷键比点击更快（地址栏、刷新、后退等）
- **等待加载**：页面跳转后务必 wait，等待内容加载完成
- **滚动查看**：长页面需要滚动并多次截图才能获取完整内容
- **标签页管理**：处理完一个标签页后及时关闭，避免混乱
`,

    warnings: `
## 浏览器注意事项

- 点击链接前确认是否需要在新标签页打开（middle_click vs click）
- 页面加载需要时间，操作后要适当等待
- 弹窗和对话框可能阻挡操作，需要先处理
- 某些网站有反爬机制，操作过快可能触发验证
`,
  },

  priority: 50,
  enabled: true,
}
