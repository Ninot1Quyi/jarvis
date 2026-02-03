// Skills System Types

/**
 * 支持的平台
 */
export type Platform = 'darwin' | 'win32' | 'linux'

/**
 * Skill元数据（从SKILL.md frontmatter解析）
 */
export interface SkillMetadata {
  /** 技能名称（必需，与目录名一致） */
  name: string

  /** 技能描述（必需，用于LLM判断何时使用） */
  description: string

  /** 许可证（可选） */
  license?: string

  /** 兼容性说明（可选） */
  compatibility?: string

  /** 额外元数据（可选） */
  metadata?: Record<string, string>

  /** 预授权工具列表（可选，实验性） */
  allowedTools?: string[]
}

/**
 * 完整的Skill定义（基于SKILL.md文件）
 */
export interface Skill {
  /** 技能目录路径 */
  path: string

  /** 元数据（从frontmatter解析） */
  meta: SkillMetadata

  /** 完整内容（懒加载，首次访问时从SKILL.md body读取） */
  content?: string
}

// 类型别名，保持向后兼容
export type FileSkill = Skill
export type FileSkillMetadata = SkillMetadata

/**
 * Skill加载选项
 */
export interface SkillLoaderOptions {
  /** 技能目录列表 */
  directories: string[]

  /** 是否递归搜索 */
  recursive?: boolean
}

// 类型别名，保持向后兼容
export type FileSkillLoaderOptions = SkillLoaderOptions
