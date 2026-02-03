// Prompt Composer - 简化版

import type { Skill, Platform } from './types.js'
import { SkillRegistry } from './registry.js'

/**
 * 提示组合器
 *
 * 负责将skills元数据注入到system prompt中
 */
export class PromptComposer {
  private registry: SkillRegistry

  constructor(registry: SkillRegistry) {
    this.registry = registry
  }

  /**
   * 在system prompt末尾追加available_skills信息
   *
   * @param basePrompt 基础系统提示
   * @param platform 当前平台（用于过滤平台特定skills）
   * @returns 增强后的提示
   */
  compose(basePrompt: string, platform?: Platform): string {
    const skills = platform
      ? this.registry.filterByPlatform(platform)
      : this.registry.getAll()

    if (skills.length === 0) {
      return basePrompt
    }

    const skillsXml = this.generateSkillsXml(skills)

    return `${basePrompt}\n\n${skillsXml}`
  }

  /**
   * 生成available_skills XML
   */
  private generateSkillsXml(skills: Skill[]): string {
    const lines = ['<available_skills>']

    for (const skill of skills) {
      lines.push('  <skill>')
      lines.push(`    <name>${this.escapeXml(skill.meta.name)}</name>`)
      lines.push(`    <description>${this.escapeXml(skill.meta.description)}</description>`)
      lines.push('  </skill>')
    }

    lines.push('</available_skills>')

    return lines.join('\n')
  }

  /**
   * 转义XML特殊字符
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  /**
   * 获取指定skill的完整内容
   *
   * 当LLM决定激活某个skill时，调用此方法获取完整指令
   */
  getSkillContent(name: string): string | undefined {
    return this.registry.getContent(name)
  }

  /**
   * 获取所有skills的摘要信息（用于调试）
   */
  getSummary(): string {
    const skills = this.registry.getAll()

    if (skills.length === 0) {
      return 'No skills loaded'
    }

    const lines = [`Loaded ${skills.length} skills:`]
    for (const skill of skills) {
      lines.push(`  - ${skill.meta.name}: ${skill.meta.description.slice(0, 60)}...`)
    }

    return lines.join('\n')
  }
}
