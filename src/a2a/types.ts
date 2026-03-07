// A2A Protocol Type Definitions

// ========== AgentCard ==========
export interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransition: boolean
  }
  skills: Skill[]
  authentication?: {
    schemes: string[]
  }
}

export interface Skill {
  id: string
  name: string
  description: string
  tags: string[]
  // Tool capability metadata
  toolMetadata?: {
    // Tool parameters schema (JSON Schema format)
    parameters?: Record<string, unknown>
    // Tool category: "messaging" | "system" | "file" | "mouse" | "keyboard" | "ai"
    category?: string
  }
}

// ========== A2A Message ==========
export interface A2AMessage {
  role: 'user' | 'agent'
  parts: Array<TextPart | FilePart | DataPart>
}

export interface TextPart {
  type: 'text'
  text: string
}

export interface FilePart {
  type: 'file'
  file: { name: string; mimeType: string; uri?: string }
}

export interface DataPart {
  type: 'data'
  data: Record<string, unknown>
}

// ========== Task ==========
export interface Task {
  id: string
  status: TaskStatus
  createdAt: string
  updatedAt?: string
  message?: A2AMessage
  artifacts?: Array<{ parts: A2AMessage['parts'] }>
  metadata?: Record<string, unknown>
}

export type TaskStatus =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'cancelled'

// ========== Provenance (消息来源) ==========
export type ProvenanceKind = 'external_user' | 'inter_session' | 'internal_system'

export interface Provenance {
  kind: ProvenanceKind
  sourceSessionKey?: string
  sourceChannel?: string
  sourceTool?: string
}

// ========== JSON-RPC 2.0 ==========
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}
