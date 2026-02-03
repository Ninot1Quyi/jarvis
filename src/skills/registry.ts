// Skill Registry - 基于文件系统的技能注册中心

import * as fs from 'fs'
import * as path from 'path'
import type { FileSkill, FileSkillLoaderOptions, Platform } from './types.js'

/**
 * 解析SKILL.md文件的frontmatter
 */
function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) {
    return { meta: {}, body: content }
  }

  const yamlStr = match[1]
  const body = match[2]
  const meta: Record<string, any> = {}

  for (const line of yamlStr.split('\n')) {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      let value = line.slice(colonIndex + 1).trim()
      // 去除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      meta[key] = value
    }
  }

  return { meta, body }
}

/**
 * XML特殊字符转义
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 技能注册中心
 *
 * 基于文件系统的技能加载器，支持：
 * - 扫描指定目录查找SKILL.md文件
 * - 解析YAML frontmatter获取元数据
 * - 懒加载：启动时只加载metadata，激活时才加载完整content
 * - 支持多个目录（项目级、用户级）
 */
export class SkillRegistry {
  private skills: Map<string, FileSkill> = new Map()
  private directories: string[] = []

  constructor(options: FileSkillLoaderOptions = { directories: [] }) {
    this.directories = options.directories
  }

  /**
   * 扫描目录加载所有skills的元数据
   */
  async discover(): Promise<void> {
    for (const dir of this.directories) {
      await this.scanDirectory(dir)
    }
  }

  /**
   * 添加扫描目录
   */
  addDirectory(dir: string): void {
    if (!this.directories.includes(dir)) {
      this.directories.push(dir)
    }
  }

  /**
   * 扫描单个目录
   */
  private async scanDirectory(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) return

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(dir, entry.name)
        const skillFile = path.join(skillPath, 'SKILL.md')

        if (fs.existsSync(skillFile)) {
          await this.loadSkillMetadata(skillPath, skillFile)
        }
      }
    }
  }

  /**
   * 加载skill元数据（不加载完整内容）
   */
  private async loadSkillMetadata(skillPath: string, skillFile: string): Promise<void> {
    const content = fs.readFileSync(skillFile, 'utf-8')
    const { meta, body } = parseFrontmatter(content)

    const name = meta.name || path.basename(skillPath)

    // 验证必需字段
    if (!meta.description) {
      console.warn(`Skill ${name} missing required 'description' field`)
      return
    }

    const skill: FileSkill = {
      path: skillPath,
      meta: {
        name,
        description: meta.description,
        license: meta.license,
        compatibility: meta.compatibility,
        metadata: meta.metadata,
        allowedTools: meta['allowed-tools']?.split(' ').filter(Boolean),
      },
      // content 懒加载，这里先存储body
      content: body.trim(),
    }

    this.skills.set(name, skill)
  }

  /**
   * 获取所有skills
   */
  getAll(): FileSkill[] {
    return Array.from(this.skills.values())
  }

  /**
   * 获取指定skill
   */
  get(name: string): FileSkill | undefined {
    return this.skills.get(name)
  }

  /**
   * 获取skill的完整内容（懒加载）
   */
  getContent(name: string): string | undefined {
    const skill = this.skills.get(name)
    if (!skill) return undefined

    // 如果content未加载，从文件读取
    if (skill.content === undefined) {
      const skillFile = path.join(skill.path, 'SKILL.md')
      const content = fs.readFileSync(skillFile, 'utf-8')
      const { body } = parseFrontmatter(content)
      skill.content = body.trim()
    }

    return skill.content
  }

  /**
   * 生成available_skills XML（用于注入system prompt）
   */
  generateAvailableSkillsXml(): string {
    const skills = this.getAll()
    if (skills.length === 0) return ''

    const lines = ['<available_skills>']
    for (const skill of skills) {
      lines.push('  <skill>')
      lines.push(`    <name>${escapeXml(skill.meta.name)}</name>`)
      lines.push(`    <description>${escapeXml(skill.meta.description)}</description>`)
      lines.push(`    <location>${escapeXml(path.join(skill.path, 'SKILL.md'))}</location>`)
      lines.push('  </skill>')
    }
    lines.push('</available_skills>')

    return lines.join('\n')
  }

  /**
   * 根据平台过滤skills
   */
  filterByPlatform(platform: Platform): FileSkill[] {
    return this.getAll().filter(skill => {
      const name = skill.meta.name.toLowerCase()
      // 平台特定skill只在对应平台激活
      if (name.includes('macos') || name.includes('darwin')) {
        return platform === 'darwin'
      }
      if (name.includes('windows') || name.includes('win32')) {
        return platform === 'win32'
      }
      if (name.includes('linux')) {
        return platform === 'linux'
      }
      // 非平台特定skill始终可用
      return true
    })
  }

  /**
   * 获取当前平台
   */
  static getCurrentPlatform(): Platform {
    return process.platform as Platform
  }

  /**
   * 清空所有已加载的skills
   */
  clear(): void {
    this.skills.clear()
  }

  /**
   * 获取已加载的skill数量
   */
  get size(): number {
    return this.skills.size
  }
}

// 默认单例
export const skillRegistry = new SkillRegistry()
