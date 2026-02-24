import type { Tool, ToolDefinition, ToolResult } from '../types.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

/**
 * MCP tool schema returned by Client.listTools().
 */
interface McpToolSchema {
  name: string
  description?: string
  inputSchema?: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
}

/**
 * Adapt MCP tools from a single server into Jarvis Tool[].
 *
 * Naming convention follows Claude Code: mcp__<serverName>__<toolName>
 */
export function adaptMcpTools(
  serverName: string,
  mcpTools: McpToolSchema[],
  client: Client
): Tool[] {
  return mcpTools.map(mcpTool => adaptMcpTool(serverName, mcpTool, client))
}

function adaptMcpTool(serverName: string, mcpTool: McpToolSchema, client: Client): Tool {
  const prefixedName = `mcp__${serverName}__${mcpTool.name}`

  const definition: ToolDefinition = {
    name: prefixedName,
    description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
    parameters: {
      type: 'object',
      properties: (mcpTool.inputSchema?.properties as Record<string, unknown>) || {},
      required: mcpTool.inputSchema?.required,
    },
  }

  return {
    definition,
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      try {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: args,
        })
        return mapCallToolResult(result)
      } catch (error) {
        return {
          success: false,
          error: `MCP tool ${serverName}/${mcpTool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  }
}

/**
 * Map MCP CallToolResult to Jarvis ToolResult.
 *
 * MCP content blocks: text, image, resource, resource_link
 * -> text blocks concatenated into message
 * -> first image block into data.image
 * -> resource text extracted
 */
function mapCallToolResult(result: Record<string, unknown>): ToolResult {
  const isError = result.isError === true
  const contents = (result.content as Array<Record<string, unknown>>) || []

  const textParts: string[] = []
  let imageData: { base64: string; mimeType: string } | undefined

  for (const block of contents) {
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
    } else if (block.type === 'image' && !imageData && typeof block.data === 'string') {
      imageData = { base64: block.data as string, mimeType: block.mimeType as string }
    } else if (block.type === 'resource') {
      const resource = block.resource as Record<string, unknown> | undefined
      if (resource?.text && typeof resource.text === 'string') {
        textParts.push(resource.text)
      }
    }
  }

  const message = textParts.join('\n')

  return {
    success: !isError,
    message: message || undefined,
    error: isError ? message : undefined,
    data: imageData ? { image: imageData } : undefined,
  }
}
