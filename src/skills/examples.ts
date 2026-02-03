// Skills Integration Example
//
// 这个文件展示如何在 Agent 中集成 Skills 系统
// 采用可插拔设计，不修改现有代码，只需在需要时引入

import {
  skillRegistry,
  promptComposer,
  createSkillContext,
  type Skill,
  type SkillContext,
} from './index.js'

/**
 * 示例 1: 基础使用 - 获取当前平台的技能增强
 */
export function example1_basicUsage() {
  // 创建上下文
  const context = createSkillContext('打开浏览器搜索 Claude AI')

  // 获取匹配的技能
  const skills = skillRegistry.match(context)
  console.log('Matched skills:', skills.map(s => s.name))

  // 组合技能提示
  const composed = promptComposer.compose(context)
  console.log('Active skills:', composed.activeSkills)
  console.log('Skill prompt length:', composed.system.length)
}

/**
 * 示例 2: 增强现有 prompt
 */
export function example2_enhanceExistingPrompt() {
  const basePrompt = `
You are a GUI agent. You are given a task and your action history, with screenshots.

## Coordinate System
- Coordinates are integers in range [0, 1000]
- (0, 0) = top-left, (1000, 1000) = bottom-right

## User Instruction
`

  const context = createSkillContext('在 Chrome 中搜索天气预报', {
    focusedApp: 'Google Chrome',
  })

  // 追加技能内容
  const { prompt, activeSkills } = promptComposer.append(basePrompt, context)

  console.log('Enhanced prompt length:', prompt.length)
  console.log('Active skills:', activeSkills)
}

/**
 * 示例 3: 使用注入标记
 */
export function example3_injectionMarkers() {
  // 带有注入标记的模板
  const template = `
You are a GUI agent.

## Platform Rules
{{SKILL_PLATFORM_RULES}}

## Hotkeys
{{SKILL_PLATFORM_HOTKEYS}}

## Application Tips
{{SKILL_APP_RULES}}
{{SKILL_APP_EXAMPLES}}

## Warnings
{{SKILL_WARNINGS}}

## User Instruction
`

  const context = createSkillContext('使用 VSCode 编写代码')

  const { prompt, activeSkills } = promptComposer.inject(template, context)

  console.log('Injected prompt preview:', prompt.substring(0, 500))
  console.log('Active skills:', activeSkills)
}

/**
 * 示例 4: 动态注册自定义技能
 */
export function example4_customSkill() {
  // 定义自定义技能
  const vscodeSkill: Skill = {
    name: 'app-vscode',
    type: 'application',
    description: 'VSCode 编辑器操作技能',
    version: '1.0.0',

    match: {
      applications: ['code', 'visual studio code', 'vscode'],
      keywords: ['编程', '代码', 'coding', 'code', 'vscode'],
    },

    prompt: {
      rules: `
## VSCode 操作规则

- 使用命令面板 (Ctrl+Shift+P / Cmd+Shift+P) 可以执行几乎所有操作
- 文件操作优先使用快捷键而非鼠标点击
`,
      hotkeys: `
## VSCode 快捷键

- \`ctrl shift p\` / \`cmd shift p\` → 命令面板
- \`ctrl p\` / \`cmd p\` → 快速打开文件
- \`ctrl \`\` → 打开终端
- \`ctrl b\` / \`cmd b\` → 切换侧边栏
- \`ctrl /\` / \`cmd /\` → 注释/取消注释
- \`alt up/down\` → 移动当前行
- \`ctrl d\` / \`cmd d\` → 选择下一个相同词
- \`ctrl shift k\` / \`cmd shift k\` → 删除当前行
`,
      tips: `
## VSCode 技巧

- 多光标编辑：按住 Alt 点击可添加多个光标
- 快速重命名：F2 可以重命名符号（变量、函数等）
- 代码折叠：Ctrl+Shift+[ 折叠，Ctrl+Shift+] 展开
`,
    },

    priority: 50,
    enabled: true,
  }

  // 注册自定义技能
  skillRegistry.register(vscodeSkill)

  // 验证注册
  const context = createSkillContext('在 VSCode 中编写 Python 代码', {
    focusedApp: 'Visual Studio Code',
  })

  const skills = skillRegistry.match(context)
  console.log('Matched skills after registration:', skills.map(s => s.name))
}

/**
 * 示例 5: 在 Agent.run() 中集成（伪代码）
 */
export function example5_agentIntegration() {
  /*
  // 在 Agent 类中的集成方式：

  import { promptComposer, createSkillContext } from '../skills/index.js'

  class Agent {
    async run(taskDescription: string): Promise<void> {
      // 1. 获取基础 prompt（现有逻辑不变）
      const systemPromptName = this.nativeToolCall ? 'system-native' : 'system'
      let systemPrompt = getPrompt(systemPromptName)

      // 2. 创建技能上下文
      const skillContext = createSkillContext(taskDescription, {
        focusedApp: await this.getFocusedWindow(),
      })

      // 3. 增强 prompt（可选，渐进式采用）
      const { prompt: enhancedPrompt, activeSkills } = promptComposer.append(
        systemPrompt,
        skillContext
      )

      // 4. 记录激活的技能
      logger.debug(`Active skills: ${activeSkills.join(', ')}`)

      // 5. 使用增强后的 prompt
      const messages: Message[] = [
        { role: 'system', content: enhancedPrompt },
      ]

      // ... 后续逻辑不变
    }
  }
  */

  console.log('See code comments for Agent integration example')
}

/**
 * 示例 6: 技能启用/禁用
 */
export function example6_toggleSkills() {
  // 禁用某个技能
  skillRegistry.setEnabled('domain-search', false)

  const context = createSkillContext('搜索文件')
  let skills = skillRegistry.match(context)
  console.log('Skills with search disabled:', skills.map(s => s.name))

  // 重新启用
  skillRegistry.setEnabled('domain-search', true)

  skills = skillRegistry.match(context)
  console.log('Skills with search enabled:', skills.map(s => s.name))
}

// 运行所有示例
export function runAllExamples() {
  console.log('\n=== Example 1: Basic Usage ===')
  example1_basicUsage()

  console.log('\n=== Example 2: Enhance Existing Prompt ===')
  example2_enhanceExistingPrompt()

  console.log('\n=== Example 3: Injection Markers ===')
  example3_injectionMarkers()

  console.log('\n=== Example 4: Custom Skill ===')
  example4_customSkill()

  console.log('\n=== Example 5: Agent Integration ===')
  example5_agentIntegration()

  console.log('\n=== Example 6: Toggle Skills ===')
  example6_toggleSkills()
}
