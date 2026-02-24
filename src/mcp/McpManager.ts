import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig, Tool } from '../types.js'
import { adaptMcpTools } from './McpToolAdapter.js'
import { logger } from '../utils/logger.js'

interface ServerConnection {
  name: string
  client: Client
  transport: Transport
  tools: Tool[]
}

const CONNECTION_TIMEOUT_MS = 10000

export class McpManager {
  private connections: Map<string, ServerConnection> = new Map()

  /**
   * Connect to all enabled MCP servers.
   * Individual server failures are logged and skipped.
   */
  async connectAll(servers: Record<string, McpServerConfig>): Promise<Tool[]> {
    const allTools: Tool[] = []

    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (serverConfig.enabled === false) {
        logger.info(`[MCP] Skipping disabled server: ${serverName}`)
        continue
      }

      try {
        const tools = await this.connectServer(serverName, serverConfig)
        allTools.push(...tools)
        logger.info(`[MCP] ${serverName}: connected, ${tools.length} tools registered`)
      } catch (error) {
        logger.error(`[MCP] ${serverName}: failed to connect - ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return allTools
  }

  private createTransport(config: McpServerConfig): Transport {
    if (config.url) {
      // Remote server via Streamable HTTP
      const url = new URL(config.url)
      return new StreamableHTTPClientTransport(url, {
        requestInit: config.headers
          ? { headers: config.headers }
          : undefined,
      })
    }

    if (config.command) {
      // Local process via stdio
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env ? { ...process.env as Record<string, string>, ...config.env } : undefined,
      })
    }

    throw new Error('McpServerConfig must specify either "url" (HTTP) or "command" (stdio)')
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<Tool[]> {
    const transport = this.createTransport(config)

    const client = new Client(
      { name: 'jarvis', version: '1.0.0' },
      { capabilities: {} }
    )

    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Connection timeout (${CONNECTION_TIMEOUT_MS}ms)`)), CONNECTION_TIMEOUT_MS)
      ),
    ])

    const { tools: mcpTools } = await client.listTools()
    const adaptedTools = adaptMcpTools(name, mcpTools as any[], client)

    this.connections.set(name, { name, client, transport, tools: adaptedTools })

    return adaptedTools
  }

  /**
   * Get all MCP tool names (for unregistering from ToolRegistry).
   */
  getToolNames(): string[] {
    const names: string[] = []
    for (const conn of this.connections.values()) {
      for (const tool of conn.tools) {
        names.push(tool.definition.name)
      }
    }
    return names
  }

  /**
   * Disconnect all MCP servers gracefully.
   */
  async disconnectAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.client.close()
        logger.info(`[MCP] ${name}: disconnected`)
      } catch (error) {
        logger.warn(`[MCP] ${name}: error during disconnect - ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.connections.clear()
  }
}
