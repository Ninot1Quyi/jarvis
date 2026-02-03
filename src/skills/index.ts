// Skills System - Main Entry

export * from './types.js'
export { SkillRegistry, skillRegistry } from './registry.js'
export { PromptComposer, promptComposer, INJECTION_MARKERS } from './composer.js'

// Re-export built-in skills for convenience
export { macosSkill, windowsSkill, linuxSkill } from './platform/index.js'
export { browserSkill } from './application/index.js'
export { searchSkill } from './domain/index.js'

// Utility function to create skill context
import type { SkillContext, Platform } from './types.js'

/**
 * 创建技能上下文
 */
export function createSkillContext(
  taskDescription: string,
  options: {
    platform?: Platform
    focusedApp?: string
    metadata?: Record<string, unknown>
  } = {}
): SkillContext {
  return {
    platform: options.platform || (process.platform as Platform),
    focusedApp: options.focusedApp,
    taskDescription,
    metadata: options.metadata,
  }
}

/**
 * 快速获取当前平台的技能增强提示
 */
export function getSkillEnhancedPrompt(
  basePrompt: string,
  taskDescription: string,
  focusedApp?: string
): { prompt: string; activeSkills: string[] } {
  const { promptComposer } = require('./composer.js')
  const context = createSkillContext(taskDescription, { focusedApp })
  return promptComposer.append(basePrompt, context)
}
