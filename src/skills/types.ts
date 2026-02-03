// Skills System Types

/**
 * 技能类型
 * - platform: 平台相关（macOS/Windows/Linux）
 * - application: 应用相关（浏览器/VSCode/终端）
 * - domain: 领域相关（搜索/表单填写/编程）
 */
export type SkillType = 'platform' | 'application' | 'domain'

/**
 * 支持的平台
 */
export type Platform = 'darwin' | 'win32' | 'linux'

/**
 * 技能匹配条件
 */
export interface SkillMatch {
  /** 平台限制，不设置则适用所有平台 */
  platform?: Platform[]

  /** 应用名匹配（模糊匹配，不区分大小写） */
  applications?: string[]

  /** 任务关键词匹配 */
  keywords?: string[]

  /** 任务正则匹配 */
  patterns?: RegExp[]

  /** 自定义匹配函数 */
  custom?: (context: SkillContext) => boolean
}

/**
 * 技能提示内容
 */
export interface SkillPrompt {
  /** 规则说明 */
  rules?: string

  /** 快捷键列表 */
  hotkeys?: string

  /** 使用示例 */
  examples?: string

  /** 使用技巧 */
  tips?: string

  /** 注意事项/警告 */
  warnings?: string
}

/**
 * 技能定义
 */
export interface Skill {
  /** 技能唯一标识 */
  name: string

  /** 技能类型 */
  type: SkillType

  /** 技能描述 */
  description: string

  /** 版本号 */
  version: string

  /** 匹配条件 */
  match: SkillMatch

  /** 提示内容 */
  prompt: SkillPrompt

  /** 优先级（数值越大优先级越高） */
  priority: number

  /** 依赖的其他技能名称 */
  dependencies?: string[]

  /** 与其他技能互斥（同时只能激活一个） */
  exclusive?: string[]

  /** 是否启用 */
  enabled?: boolean
}

/**
 * 技能上下文（用于匹配判断）
 */
export interface SkillContext {
  /** 当前平台 */
  platform: Platform

  /** 当前焦点应用 */
  focusedApp?: string

  /** 任务描述 */
  taskDescription: string

  /** 额外元数据 */
  metadata?: Record<string, unknown>
}

/**
 * 组合后的提示结果
 */
export interface ComposedPrompt {
  /** 组合后的系统提示 */
  system: string

  /** 激活的技能列表 */
  activeSkills: string[]

  /** 技能注入的位置标记 */
  injectionPoints?: {
    rules: string
    hotkeys: string
    examples: string
    tips: string
  }
}

/**
 * 技能注册选项
 */
export interface SkillRegistryOptions {
  /** 是否自动加载内置技能 */
  loadBuiltin?: boolean
}

/**
 * 技能加载器接口（用于扩展加载方式）
 */
export interface SkillLoader {
  /** 加载器名称 */
  name: string

  /** 加载技能 */
  load(): Promise<Skill[]>
}
