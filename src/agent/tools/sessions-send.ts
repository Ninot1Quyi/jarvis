// sessions_send tool - Agent delegation tool

import type { Tool } from '../../types.js'
import { messageLayer, type Provenance } from '../../message/MessageLayer.js'

export interface SessionsSendToolContext {
  agentSessionKey?: string
}

export const sessionsSendTool: Tool = {
  definition: {
    name: 'sessions_send',
    description: 'Send a task to another agent for delegation',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Target agent ID or label'
        },
        task: {
          type: 'string',
          description: 'Task description for the target agent'
        },
        context: {
          type: 'string',
          description: 'Additional context for the task'
        },
        waitForResult: {
          type: 'boolean',
          default: true,
          description: 'Wait for result or fire-and-forget'
        },
        timeout: {
          type: 'number',
          default: 60,
          description: 'Timeout in seconds'
        }
      },
      required: ['agentId', 'task']
    }
  },
  async execute(args: Record<string, unknown>, context?: SessionsSendToolContext) {
    const agentId = args.agentId as string
    const task = args.task as string
    const contextText = args.context as string | undefined
    const waitForResult = args.waitForResult !== false
    const timeout = (args.timeout as number) || 60

    if (!agentId || !task) {
      return {
        success: false,
        error: 'agentId and task are required'
      }
    }

    // Build task content with optional context
    let taskContent = task
    if (contextText) {
      taskContent = `<task>${task}</task>\n<context>${contextText}</context>`
    }

    // Build provenance for inter-session message
    const provenance: Provenance = {
      kind: 'inter_session',
      sourceSessionKey: context?.agentSessionKey,
      sourceTool: 'sessions_send'
    }

    // Push task to agent queue (for local delegation)
    // Note: For remote delegation, we would need A2A HTTP calls
    messageLayer.pushWithProvenance('agent', taskContent, provenance)

    if (waitForResult) {
      // For now, return immediately - polling would require task tracking
      return {
        success: true,
        message: `Task delegated to agent: ${agentId}`,
        data: {
          agentId,
          status: 'delegated',
          waitForResult: false // Simplified: always return immediately
        }
      }
    }

    return {
      success: true,
      message: `Task delegated to agent: ${agentId}`,
      data: {
        agentId,
        status: 'delegated'
      }
    }
  }
}
