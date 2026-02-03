import type { Tool, ToolDefinition, ToolResult, ToolCall } from '../../types.js'
import { mouseTools } from './mouse.js'
import { keyboardTools } from './keyboard.js'
import { systemTools } from './system.js'
import { fileTools } from './file.js'
import { todoTools } from './todo.js'
import { skillTools } from './skill.js'
import { logger } from '../../utils/logger.js'

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  constructor() {
    // Register all built-in tools
    // Skill tools first - for progressive skill loading
    this.registerTools(skillTools)
    this.registerTools(mouseTools)
    this.registerTools(keyboardTools)
    this.registerTools(systemTools)
    this.registerTools(fileTools)
    this.registerTools(todoTools)
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.definition.name, tool)
  }

  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.registerTool(tool)
    }
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition)
  }

  async execute(
    toolCall: ToolCall,
    context?: Record<string, unknown>
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name)

    if (!tool) {
      logger.error(`Unknown tool: ${toolCall.name}`)
      return {
        success: false,
        error: `Unknown tool: ${toolCall.name}`,
      }
    }

    logger.tool(toolCall.name, toolCall.arguments)

    try {
      const result = await tool.execute(toolCall.arguments, context)
      logger.result(result.success, result.success ? 'Tool executed' : result.error || 'Failed')
      return result
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error(`Tool execution failed: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
      }
    }
  }
}

export const toolRegistry = new ToolRegistry()

export { mouseTools } from './mouse.js'
export { keyboardTools } from './keyboard.js'
export { systemTools } from './system.js'
export { fileTools } from './file.js'
export { todoTools } from './todo.js'
export { skillTools, setSkillRegistry, getSkillRegistry } from './skill.js'
