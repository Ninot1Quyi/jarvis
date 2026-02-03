// Skills System - Main Entry

export type { Skill, SkillMetadata, SkillLoaderOptions, Platform } from './types.js'
export { SkillRegistry } from './registry.js'
export { PromptComposer } from './composer.js'

import * as path from 'path'
import * as os from 'os'
import { SkillRegistry } from './registry.js'
import { PromptComposer } from './composer.js'
import type { Platform } from './types.js'

/**
 * 获取默认的skills目录列表
 */
export function getDefaultSkillDirectories(projectRoot?: string): string[] {
  const dirs: string[] = []

  // 项目级skills目录
  if (projectRoot) {
    dirs.push(path.join(projectRoot, 'skills'))
    dirs.push(path.join(projectRoot, '.claude', 'skills'))
  }

  // 用户级skills目录
  const homeDir = os.homedir()
  dirs.push(path.join(homeDir, '.claude', 'skills'))
  dirs.push(path.join(homeDir, '.jarvis', 'skills'))

  return dirs
}

/**
 * 创建并初始化skills系统
 *
 * @param projectRoot 项目根目录
 * @returns 初始化后的registry和composer
 */
export async function initSkills(projectRoot?: string): Promise<{
  registry: SkillRegistry
  composer: PromptComposer
}> {
  const directories = getDefaultSkillDirectories(projectRoot)

  const registry = new SkillRegistry({ directories })
  await registry.discover()

  const composer = new PromptComposer(registry)

  return { registry, composer }
}

/**
 * 获取当前平台
 */
export function getCurrentPlatform(): Platform {
  return process.platform as Platform
}
