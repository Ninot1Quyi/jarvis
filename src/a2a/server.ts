// A2A HTTP Server - Exposes Agent capabilities via HTTP

import express, { Express, Request, Response } from 'express'
import type { AgentCard } from './types.js'
import { AgentRegistry, type ToolRegistryInterface } from './registry.js'
import { JsonRpcHandler } from './json-rpc.js'

export interface A2AServerOptions {
  port?: number
  baseAgentCard: Omit<AgentCard, 'skills'>
  toolRegistry?: ToolRegistryInterface
}

export class A2AServer {
  private app: Express
  private registry: AgentRegistry
  private rpc: JsonRpcHandler
  private server: ReturnType<Express['listen']> | null = null
  private port: number

  constructor(options: A2AServerOptions) {
    this.port = options.port || 3000
    this.app = express()
    this.app.use(express.json())

    // Create registry with tool registry for dynamic skills
    this.registry = new AgentRegistry(options.baseAgentCard, options.toolRegistry)

    // Create RPC handler with message callback
    this.rpc = new JsonRpcHandler(this.registry)

    this.setupRoutes()
  }

  /**
   * Setup HTTP routes.
   */
  private setupRoutes(): void {
    // AgentCard endpoint (service discovery)
    // GET /a2a - returns local AgentCard with dynamically generated skills
    this.app.get('/a2a', (_req: Request, res: Response) => {
      res.json(this.registry.getLocalAgentCard())
    })

    // JSON-RPC endpoint
    // POST /a2a - handle JSON-RPC 2.0 requests
    this.app.post('/a2a', async (req: Request, res: Response) => {
      try {
        const result = await this.rpc.handle(req.body)
        res.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        res.json(this.rpc.errorResponse(req.body.id, -32603, message))
      }
    })

    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok' })
    })
  }

  /**
   * Start the A2A HTTP server.
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          console.log(`[A2A] Server started on port ${this.port}`)
          resolve(this.port)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Stop the A2A HTTP server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[A2A] Server stopped')
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  /**
   * Get the AgentRegistry instance.
   */
  getRegistry(): AgentRegistry {
    return this.registry
  }

  /**
   * Get the port the server is listening on.
   */
  getPort(): number {
    return this.port
  }

  /**
   * Set message handler for incoming A2A tasks.
   */
  setMessageHandler(handler: (text: string, metadata?: { provenance?: { kind: string; sourceTool?: string; sourceSessionKey?: string; sourceChannel?: string } }) => void): void {
    this.rpc.setMessageHandler(handler)
  }

  /**
   * Refresh local AgentCard (after tool registration changes).
   */
  refreshAgentCard(): void {
    this.registry.refreshLocalAgentCard()
  }
}
