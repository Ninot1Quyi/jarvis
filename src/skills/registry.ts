// Skill Registry - 技能注册中心

import type { Skill, SkillContext, SkillRegistryOptions, SkillLoader, Platform } from './types.js'

// 内置技能导入
import { macosSkill, windowsSkill, linuxSkill } from './platform/index.js'
import { browserSkill } from './application/index.js'
import { searchSkill } from './domain/index.js'

/**
 * 技能注册中心
 *
 * 负责管理所有技能的注册、查询和匹配
 * 支持可插拔设计，可以动态添加/移除技能
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map()
  private loaders: SkillLoader[] = []

  constructor(options: SkillRegistryOptions = {}) {
    const { loadBuiltin = true } = options

    if (loadBuiltin) {
      this.registerBuiltinSkills()
    }
  }

  /**
   * 注册内置技能
   */
  private registerBuiltinSkills(): void {
    // 平台技能
    this.register(macosSkill)
    this.register(windowsSkill)
    this.register(linuxSkill)

    // 应用技能
    this.register(browserSkill)

    // 领域技能
    this.register(searchSkill)
  }

  /**
   * 注册单个技能
   */
  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      console.warn(`Skill "${skill.name}" already registered, overwriting...`)
    }
    this.skills.set(skill.name, skill)
  }

  /**
   * 批量注册技能
   */
  registerAll(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill)
    }
  }

  /**
   * 注销技能
   */
  unregister(name: string): boolean {
    return this.skills.delete(name)
  }

  /**
   * 获取指定技能
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /**
   * 获取所有技能
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values())
  }

  /**
   * 获取所有启用的技能
   */
  getEnabled(): Skill[] {
    return this.getAll().filter(s => s.enabled !== false)
  }

  /**
   * 启用/禁用技能
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const skill = this.skills.get(name)
    if (skill) {
      skill.enabled = enabled
      return true
    }
    return false
  }

  /**
   * 添加技能加载器
   */
  addLoader(loader: SkillLoader): void {
    this.loaders.push(loader)
  }

  /**
   * 从所有加载器加载技能
   */
  async loadFromLoaders(): Promise<void> {
    for (const loader of this.loaders) {
      try {
        const skills = await loader.load()
        this.registerAll(skills)
        console.log(`Loaded ${skills.length} skills from loader: ${loader.name}`)
      } catch (error) {
        console.error(`Failed to load skills from loader: ${loader.name}`, error)
      }
    }
  }

  /**
   * 根据上下文匹配适用的技能
   *
   * @param context 技能上下文
   * @returns 匹配的技能列表（按优先级排序）
   */
  match(context: SkillContext): Skill[] {
    const matched: Skill[] = []

    for (const skill of this.getEnabled()) {
      if (this.isSkillApplicable(skill, context)) {
        matched.push(skill)
      }
    }

    // 处理互斥关系
    const filtered = this.resolveExclusions(matched)

    // 解析依赖
    const withDeps = this.resolveDependencies(filtered)

    // 按优先级排序（高优先级在前）
    return withDeps.sort((a, b) => b.priority - a.priority)
  }

  /**
   * 判断技能是否适用于当前上下文
   */
  private isSkillApplicable(skill: Skill, context: SkillContext): boolean {
    const { match } = skill

    // 平台匹配
    if (match.platform && match.platform.length > 0) {
      if (!match.platform.includes(context.platform)) {
        return false
      }
    }

    // 应用匹配（任一匹配即可）
    if (match.applications && match.applications.length > 0) {
      if (!context.focusedApp) {
        // 如果没有焦点应用信息，跳过应用匹配（不排除）
      } else {
        const appLower = context.focusedApp.toLowerCase()
        const appMatch = match.applications.some(app =>
          appLower.includes(app.toLowerCase())
        )
        if (!appMatch) {
          return false
        }
      }
    }

    // 关键词匹配（任一匹配即可）
    if (match.keywords && match.keywords.length > 0) {
      const taskLower = context.taskDescription.toLowerCase()
      const keywordMatch = match.keywords.some(kw =>
        taskLower.includes(kw.toLowerCase())
      )
      // 关键词不匹配不直接排除，只是不加分
      // 这里我们选择：如果有关键词条件但不匹配，则不激活
      if (!keywordMatch) {
        // 对于 domain 类型技能，关键词是必须匹配的
        if (skill.type === 'domain') {
          return false
        }
      }
    }

    // 正则匹配（任一匹配即可）
    if (match.patterns && match.patterns.length > 0) {
      const patternMatch = match.patterns.some(pattern =>
        pattern.test(context.taskDescription)
      )
      if (!patternMatch && skill.type === 'domain') {
        return false
      }
    }

    // 自定义匹配函数
    if (match.custom) {
      if (!match.custom(context)) {
        return false
      }
    }

    return true
  }

  /**
   * 处理技能互斥关系
   */
  private resolveExclusions(skills: Skill[]): Skill[] {
    const result: Skill[] = []
    const excluded = new Set<string>()

    // 按优先级排序，高优先级的先处理
    const sorted = [...skills].sort((a, b) => b.priority - a.priority)

    for (const skill of sorted) {
      if (excluded.has(skill.name)) {
        continue
      }

      result.push(skill)

      // 标记被排斥的技能
      if (skill.exclusive) {
        for (const excl of skill.exclusive) {
          excluded.add(excl)
        }
      }
    }

    return result
  }

  /**
   * 解析技能依赖
   */
  private resolveDependencies(skills: Skill[]): Skill[] {
    const result = new Map<string, Skill>()
    const skillNames = new Set(skills.map(s => s.name))

    const addWithDeps = (skill: Skill) => {
      if (result.has(skill.name)) return

      // 先添加依赖
      if (skill.dependencies) {
        for (const depName of skill.dependencies) {
          const dep = this.skills.get(depName)
          if (dep && dep.enabled !== false) {
            addWithDeps(dep)
          }
        }
      }

      result.set(skill.name, skill)
    }

    for (const skill of skills) {
      addWithDeps(skill)
    }

    return Array.from(result.values())
  }

  /**
   * 获取当前平台
   */
  static getCurrentPlatform(): Platform {
    return process.platform as Platform
  }
}

// 默认单例
export const skillRegistry = new SkillRegistry()
