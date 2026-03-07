// A2A JSON-RPC 2.0 Handler

import type { AgentRegistry } from './registry.js'
import type { JsonRpcRequest, JsonRpcResponse, A2AMessage, TextPart, Task } from './types.js'

// Error codes
const ERROR_INVALID_REQUEST = -32600
const ERROR_METHOD_NOT_FOUND = -32601
const ERROR_INVALID_PARAMS = -32602
const ERROR_INTERNAL_ERROR = -32603
const ERROR_AGENT_NOT_FOUND = -32001

type MessageHandlerFn = (text: string, metadata?: { provenance?: { kind: string; sourceTool?: string; sourceSessionKey?: string; sourceChannel?: string } }) => void

export class JsonRpcHandler {
  constructor(
    private registry: AgentRegistry,
    private messageHandler?: MessageHandlerFn
  ) {}

  /**
   * Handle a JSON-RPC request.
   */
  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { jsonrpc, id, method, params } = request

    if (jsonrpc !== '2.0') {
      return this.errorResponse(id, ERROR_INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"')
    }

    switch (method) {
      case 'agents/get':
        return this.handleGetAgent(params as { agentId?: string } | undefined, id)
      case 'tasks/send':
        return this.handleSendTask(params as {
          id: string
          message?: A2AMessage
          sessionId?: string
        }, id)
      case 'tasks/get':
        return this.handleGetTask(params as { id: string }, id)
      case 'tasks/cancel':
        return this.handleCancelTask(params as { id: string }, id)
      default:
        return this.errorResponse(id, ERROR_METHOD_NOT_FOUND, `Method not found: ${method}`)
    }
  }

  /**
   * Handle agents/get method.
   */
  private handleGetAgent(params: { agentId?: string } | undefined, id: string | number | null): JsonRpcResponse {
    const card = params?.agentId
      ? this.registry.getLocalAgentCard()
      : this.registry.getLocalAgentCard()

    if (!card) {
      return this.errorResponse(id, ERROR_AGENT_NOT_FOUND, 'Agent not found')
    }

    return {
      jsonrpc: '2.0',
      id,
      result: card
    }
  }

  /**
   * Handle tasks/send method - send a task to this agent.
   */
  private async handleSendTask(params: {
    id: string
    message?: A2AMessage
    sessionId?: string
  } | undefined, id: string | number | null): Promise<JsonRpcResponse> {
    if (!params?.id) {
      return this.errorResponse(id, ERROR_INVALID_PARAMS, 'Missing required parameter: id')
    }

    // Create Task
    const task: Task = {
      id: params.id,
      status: 'submitted',
      createdAt: new Date().toISOString(),
      message: params.message
    }

    this.registry.createTask(task.id, task)

    // Extract message text and send to agent
    if (params.message) {
      const text = this.extractTextFromMessage(params.message)
      if (text && this.messageHandler) {
        this.messageHandler(text, {
          provenance: {
            kind: 'inter_session',
            sourceTool: 'a2a'
          }
        })
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      result: {
        id: task.id,
        status: task.status,
        createdAt: task.createdAt
      }
    }
  }

  /**
   * Handle tasks/get method - get task status.
   */
  private handleGetTask(params: { id: string } | undefined, id: string | number | null): JsonRpcResponse {
    if (!params?.id) {
      return this.errorResponse(id, ERROR_INVALID_PARAMS, 'Missing required parameter: id')
    }

    const task = this.registry.getTask(params.id)
    if (!task) {
      return this.errorResponse(id, ERROR_AGENT_NOT_FOUND, 'Task not found')
    }

    return {
      jsonrpc: '2.0',
      id,
      result: task
    }
  }

  /**
   * Handle tasks/cancel method.
   */
  private handleCancelTask(params: { id: string } | undefined, id: string | number | null): JsonRpcResponse {
    if (!params?.id) {
      return this.errorResponse(id, ERROR_INVALID_PARAMS, 'Missing required parameter: id')
    }

    const task = this.registry.getTask(params.id)
    if (!task) {
      return this.errorResponse(id, ERROR_AGENT_NOT_FOUND, 'Task not found')
    }

    // Can only cancel submitted or working tasks
    if (task.status !== 'submitted' && task.status !== 'working') {
      return this.errorResponse(id, -32002, `Cannot cancel task with status: ${task.status}`)
    }

    this.registry.updateTaskStatus(params.id, 'cancelled')

    return {
      jsonrpc: '2.0',
      id,
      result: {
        id: task.id,
        status: 'cancelled',
        updatedAt: new Date().toISOString()
      }
    }
  }

  /**
   * Extract text content from an A2AMessage.
   */
  private extractTextFromMessage(message?: A2AMessage): string {
    if (!message?.parts) return ''
    return message.parts
      .filter(p => p.type === 'text')
      .map(p => (p as TextPart).text)
      .join('\n')
  }

  /**
   * Create an error response.
   */
  errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    }
  }

  /**
   * Set message handler for incoming tasks.
   */
  setMessageHandler(handler: MessageHandlerFn): void {
    this.messageHandler = handler
  }
}
