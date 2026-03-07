// A2A Agent Registry - Service discovery and task management

import type { AgentCard, Skill, Task, TaskStatus } from './types.js'

// Tool category mapping
const TOOL_CATEGORIES: Record<string, string> = {
  message: 'messaging',
  sessions_send: 'messaging',
  screenshot: 'system',
  wait: 'system',
  finished: 'system',
  call_user: 'system',
  read_file: 'file',
  write_file: 'file',
  edit_file: 'file',
  grep: 'file',
  bash: 'system',
  todo_read: 'productivity',
  todo_write: 'productivity',
  click: 'mouse',
  double_click: 'mouse',
  right_click: 'mouse',
  drag: 'mouse',
  scroll: 'mouse',
  middle_click: 'mouse',
  type: 'keyboard',
  hotkey: 'keyboard',
  screen: 'system',
  recordTask: 'system',
  set_max_steps: 'system',
  take_screenshot: 'system',
  memory_search: 'ai',
  memory_write: 'ai',
}

export interface ToolInfo {
  name: string
  label?: string
  description?: string
  parameters?: Record<string, unknown>
}

export interface ToolRegistryInterface {
  getTools(): ToolInfo[]
}

export class AgentRegistry {
  private localAgentCard: AgentCard
  private remoteAgents: Map<string, AgentCard> = new Map()
  private taskStore: Map<string, Task> = new Map()
  private toolRegistry: ToolRegistryInterface | undefined

  constructor(
    baseAgentCard: Omit<AgentCard, 'skills'>,
    toolRegistry?: ToolRegistryInterface
  ) {
    this.toolRegistry = toolRegistry
    // Dynamically generate skills list
    this.localAgentCard = {
      ...baseAgentCard,
      skills: this.generateSkillsFromTools()
    }
  }

  /**
   * Dynamically generate skills list from ToolRegistry.
   * Each tool corresponds to a skill, exposing our real capabilities to external Agents.
   */
  private generateSkillsFromTools(): Skill[] {
    if (!this.toolRegistry) {
      return []
    }

    const skills: Skill[] = []

    for (const tool of this.toolRegistry.getTools()) {
      skills.push({
        id: tool.name,
        name: tool.label || tool.name,
        description: tool.description || '',
        tags: this.getTagsForTool(tool.name),
        toolMetadata: {
          parameters: tool.parameters,
          category: this.getCategoryForTool(tool.name)
        }
      })
    }

    return skills
  }

  /**
   * Get category for a tool.
   */
  private getCategoryForTool(toolName: string): string {
    return TOOL_CATEGORIES[toolName] || 'other'
  }

  /**
   * Generate tags for a tool.
   */
  private getTagsForTool(toolName: string): string[] {
    const tags: string[] = []
    const category = this.getCategoryForTool(toolName)
    if (category !== 'other') {
      tags.push(category)
    }
    return tags
  }

  getLocalAgentCard(): AgentCard {
    return this.localAgentCard
  }

  /**
   * Refresh local AgentCard after tool registration changes.
   */
  refreshLocalAgentCard(): void {
    this.localAgentCard.skills = this.generateSkillsFromTools()
  }

  /**
   * Discover a remote Agent by URL.
   */
  async discoverRemoteAgent(url: string): Promise<AgentCard | null> {
    try {
      const response = await fetch(`${url}/a2a`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })
      if (!response.ok) return null
      const card = await response.json() as AgentCard
      this.remoteAgents.set(card.name, card)
      return card
    } catch {
      return null
    }
  }

  /**
   * Get a remote AgentCard by agentId (from cache).
   */
  async getRemoteAgentCard(agentId: string): Promise<AgentCard | null> {
    // Check cache first
    const cached = this.remoteAgents.get(agentId)
    if (cached) return cached
    // TODO: Could fetch from configured service discovery
    return null
  }

  /**
   * Find an Agent by ID (local or remote).
   */
  async findAgent(agentId: string): Promise<AgentCard | null> {
    // 1. Check local
    if (agentId === this.localAgentCard.name) {
      return this.localAgentCard
    }
    // 2. Check remote cache
    const cached = this.remoteAgents.get(agentId)
    if (cached) return cached
    // 3. Try discovery (will need URL)
    // For now, return null - discovery requires URL configuration
    return null
  }

  /**
   * Create a new task.
   */
  createTask(id: string, task: Task): void {
    this.taskStore.set(id, task)
  }

  /**
   * Get a task by ID.
   */
  getTask(id: string): Task | undefined {
    return this.taskStore.get(id)
  }

  /**
   * Update task status.
   */
  updateTaskStatus(id: string, status: TaskStatus): void {
    const task = this.taskStore.get(id)
    if (task) {
      task.status = status
      task.updatedAt = new Date().toISOString()
    }
  }

  /**
   * Add an artifact to a task.
   */
  addTaskArtifact(id: string, artifact: unknown): void {
    const task = this.taskStore.get(id)
    if (task) {
      if (!task.artifacts) {
        task.artifacts = []
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      task.artifacts.push(artifact as any)
    }
  }
}
