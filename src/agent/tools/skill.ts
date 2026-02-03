// Skill Tool - 渐进式加载skill内容

import type { Tool } from '../../types.js'
import { SkillRegistry } from '../../skills/registry.js'

// SkillRegistry实例将在Agent中注入
let skillRegistry: SkillRegistry | null = null

/**
 * 设置SkillRegistry实例
 * 由Agent在初始化时调用
 */
export function setSkillRegistry(registry: SkillRegistry): void {
  skillRegistry = registry
}

/**
 * 获取当前的SkillRegistry实例
 */
export function getSkillRegistry(): SkillRegistry | null {
  return skillRegistry
}

/**
 * Skill Tool
 *
 * 用于按需加载skill的完整内容。
 * LLM在system prompt中看到available_skills列表后，
 * 可以调用此tool获取特定skill的详细指令。
 */
export const skillTool: Tool = {
  definition: {
    name: 'skill',
    description: 'Load a skill to get detailed instructions. Use this when you need specific guidance for a task that matches an available skill.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the skill to load (from available_skills list)',
        },
      },
      required: ['name'],
    },
  },
  async execute(args) {
    const name = args.name as string

    if (!skillRegistry) {
      return {
        success: false,
        error: 'Skill system not initialized',
      }
    }

    // 获取skill元数据
    const skill = skillRegistry.get(name)
    if (!skill) {
      // 列出可用的skills帮助LLM
      const available = skillRegistry.getAll().map(s => s.meta.name)
      return {
        success: false,
        error: `Skill "${name}" not found. Available skills: ${available.join(', ')}`,
      }
    }

    // 获取完整内容
    const content = skillRegistry.getContent(name)
    if (!content) {
      return {
        success: false,
        error: `Failed to load content for skill "${name}"`,
      }
    }

    return {
      success: true,
      data: {
        name: skill.meta.name,
        description: skill.meta.description,
        content: content,
        message: `Skill "${name}" loaded. Follow the instructions below.`,
      },
    }
  },
}

/**
 * List Skills Tool
 *
 * 列出所有可用的skills及其描述
 */
export const listSkillsTool: Tool = {
  definition: {
    name: 'list_skills',
    description: 'List all available skills with their descriptions',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  async execute() {
    if (!skillRegistry) {
      return {
        success: false,
        error: 'Skill system not initialized',
      }
    }

    const skills = skillRegistry.getAll()
    if (skills.length === 0) {
      return {
        success: true,
        data: {
          skills: [],
          message: 'No skills available',
        },
      }
    }

    const skillList = skills.map(s => ({
      name: s.meta.name,
      description: s.meta.description,
    }))

    return {
      success: true,
      data: {
        skills: skillList,
        message: `${skills.length} skills available. Use skill tool to load detailed instructions.`,
      },
    }
  },
}

// Export all skill tools
export const skillTools: Tool[] = [
  skillTool,
  listSkillsTool,
]
