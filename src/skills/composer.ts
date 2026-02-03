// Prompt Composer - 提示组合器

import type { Skill, SkillContext, ComposedPrompt } from './types.js'
import { SkillRegistry, skillRegistry } from './registry.js'

/**
 * 提示注入点标记
 */
export const INJECTION_MARKERS = {
  PLATFORM_RULES: '{{SKILL_PLATFORM_RULES}}',
  PLATFORM_HOTKEYS: '{{SKILL_PLATFORM_HOTKEYS}}',
  APP_RULES: '{{SKILL_APP_RULES}}',
  APP_EXAMPLES: '{{SKILL_APP_EXAMPLES}}',
  DOMAIN_RULES: '{{SKILL_DOMAIN_RULES}}',
  DOMAIN_EXAMPLES: '{{SKILL_DOMAIN_EXAMPLES}}',
  TIPS: '{{SKILL_TIPS}}',
  WARNINGS: '{{SKILL_WARNINGS}}',
  ALL_SKILLS: '{{SKILL_ALL}}',
} as const

/**
 * 组合器选项
 */
export interface ComposerOptions {
  /** 使用的技能注册中心 */
  registry?: SkillRegistry

  /** 是否包含技能元信息注释 */
  includeMetaComments?: boolean

  /** 分隔符 */
  separator?: string
}

/**
 * 提示组合器
 *
 * 负责将匹配的技能组合成最终的系统提示
 * 支持增量注入模式，可以在现有 prompt 基础上增强
 */
export class PromptComposer {
  private registry: SkillRegistry
  private includeMetaComments: boolean
  private separator: string

  constructor(options: ComposerOptions = {}) {
    this.registry = options.registry || skillRegistry
    this.includeMetaComments = options.includeMetaComments ?? false
    this.separator = options.separator ?? '\n\n'
  }

  /**
   * 根据上下文组合技能提示
   *
   * @param context 技能上下文
   * @returns 组合后的提示内容
   */
  compose(context: SkillContext): ComposedPrompt {
    const skills = this.registry.match(context)

    // 按类型分组
    const platformSkills = skills.filter(s => s.type === 'platform')
    const appSkills = skills.filter(s => s.type === 'application')
    const domainSkills = skills.filter(s => s.type === 'domain')

    // 组合各部分
    const platformRules = this.combinePromptPart(platformSkills, 'rules')
    const platformHotkeys = this.combinePromptPart(platformSkills, 'hotkeys')
    const appRules = this.combinePromptPart(appSkills, 'rules')
    const appExamples = this.combinePromptPart(appSkills, 'examples')
    const domainRules = this.combinePromptPart(domainSkills, 'rules')
    const domainExamples = this.combinePromptPart(domainSkills, 'examples')
    const tips = this.combinePromptPart(skills, 'tips')
    const warnings = this.combinePromptPart(skills, 'warnings')

    // 组合完整的技能提示
    const allParts = [
      platformRules,
      platformHotkeys,
      appRules,
      appExamples,
      domainRules,
      domainExamples,
      tips,
      warnings,
    ].filter(Boolean)

    const system = allParts.join(this.separator)

    return {
      system,
      activeSkills: skills.map(s => s.name),
      injectionPoints: {
        rules: [platformRules, appRules, domainRules].filter(Boolean).join(this.separator),
        hotkeys: platformHotkeys,
        examples: [appExamples, domainExamples].filter(Boolean).join(this.separator),
        tips: [tips, warnings].filter(Boolean).join(this.separator),
      },
    }
  }

  /**
   * 在现有 prompt 中注入技能内容
   *
   * 支持使用标记占位符的方式，在现有 prompt 模板中注入技能内容
   *
   * @param template 包含注入标记的模板
   * @param context 技能上下文
   * @returns 注入后的完整提示
   */
  inject(template: string, context: SkillContext): { prompt: string; activeSkills: string[] } {
    const composed = this.compose(context)
    let result = template

    // 按类型分组获取内容
    const skills = this.registry.match(context)
    const platformSkills = skills.filter(s => s.type === 'platform')
    const appSkills = skills.filter(s => s.type === 'application')
    const domainSkills = skills.filter(s => s.type === 'domain')

    // 替换各个注入点
    result = result.replace(INJECTION_MARKERS.PLATFORM_RULES, this.combinePromptPart(platformSkills, 'rules'))
    result = result.replace(INJECTION_MARKERS.PLATFORM_HOTKEYS, this.combinePromptPart(platformSkills, 'hotkeys'))
    result = result.replace(INJECTION_MARKERS.APP_RULES, this.combinePromptPart(appSkills, 'rules'))
    result = result.replace(INJECTION_MARKERS.APP_EXAMPLES, this.combinePromptPart(appSkills, 'examples'))
    result = result.replace(INJECTION_MARKERS.DOMAIN_RULES, this.combinePromptPart(domainSkills, 'rules'))
    result = result.replace(INJECTION_MARKERS.DOMAIN_EXAMPLES, this.combinePromptPart(domainSkills, 'examples'))
    result = result.replace(INJECTION_MARKERS.TIPS, this.combinePromptPart(skills, 'tips'))
    result = result.replace(INJECTION_MARKERS.WARNINGS, this.combinePromptPart(skills, 'warnings'))
    result = result.replace(INJECTION_MARKERS.ALL_SKILLS, composed.system)

    return {
      prompt: result,
      activeSkills: composed.activeSkills,
    }
  }

  /**
   * 追加技能内容到现有 prompt
   *
   * 简单地将技能内容追加到现有 prompt 末尾
   *
   * @param basePrompt 基础提示
   * @param context 技能上下文
   * @returns 增强后的提示
   */
  append(basePrompt: string, context: SkillContext): { prompt: string; activeSkills: string[] } {
    const composed = this.compose(context)

    if (!composed.system) {
      return { prompt: basePrompt, activeSkills: [] }
    }

    const skillSection = this.includeMetaComments
      ? `\n\n<!-- Active Skills: ${composed.activeSkills.join(', ')} -->\n\n${composed.system}`
      : `\n\n${composed.system}`

    return {
      prompt: basePrompt + skillSection,
      activeSkills: composed.activeSkills,
    }
  }

  /**
   * 组合指定部分的提示内容
   */
  private combinePromptPart(skills: Skill[], part: keyof Skill['prompt']): string {
    const parts: string[] = []

    for (const skill of skills) {
      const content = skill.prompt[part]
      if (content) {
        if (this.includeMetaComments) {
          parts.push(`<!-- From skill: ${skill.name} -->\n${content.trim()}`)
        } else {
          parts.push(content.trim())
        }
      }
    }

    return parts.join(this.separator)
  }

  /**
   * 获取技能摘要信息
   */
  getSkillSummary(context: SkillContext): string {
    const skills = this.registry.match(context)

    if (skills.length === 0) {
      return 'No skills matched'
    }

    const lines = ['Matched Skills:']
    for (const skill of skills) {
      lines.push(`  - ${skill.name} (${skill.type}, priority: ${skill.priority})`)
    }

    return lines.join('\n')
  }
}

// 默认单例
export const promptComposer = new PromptComposer()
