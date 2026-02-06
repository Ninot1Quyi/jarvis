// Types for Jarvis Agent

// ============ LLM Types ============

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'computer'
  content: string
  toolCallId?: string
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface ImageInput {
  type: 'base64' | 'path' | 'url'
  data: string
  mediaType?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  name?: string  // Image name for display (e.g., "主屏幕", "tool_screenshot_1")
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

export interface ChatResponse {
  content: string
  toolCalls?: ToolCall[]
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

export interface LLMProvider {
  name: string
  chatWithVisionAndTools(
    messages: Message[],
    images: ImageInput[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatResponse>
}

// ============ Tool Types ============

export interface ToolResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  message?: string  // Additional info to display to the agent
}

export interface Tool {
  definition: ToolDefinition
  execute(args: Record<string, unknown>, context?: Record<string, unknown>): Promise<ToolResult>
}

// ============ Memory Types ============

export interface Step {
  timestamp: number
  screenshotPath: string
  thought: string
  toolCall: ToolCall
  result: 'success' | 'failed'
}

export interface Memory {
  id: string
  type: 'preference' | 'skill' | 'history'
  content: string
  embedding?: number[]
  importance: number
  accessCount: number
  createTime: Date
  updateTime: Date
}

// ============ Task Types ============

export interface Task {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  priority: 'high' | 'medium' | 'low'
  createdAt: Date
  source: 'tui' | 'webui' | 'email'
}

// ============ Config Types ============

export interface ProviderConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  nativeToolCall?: boolean
  apiType?: 'openai' | 'anthropic'
}

export interface KeyConfig {
  defaultProvider?: string
  mouseSpeed?: number
  workspace?: string
  anthropic?: ProviderConfig
  openai?: ProviderConfig
  doubao?: ProviderConfig
  [key: string]: ProviderConfig | string | number | undefined
}

export interface JarvisConfig {
  keys: KeyConfig
  defaultProvider: string
  mouseSpeed: number
  maxSteps: number
  screenshotDir: string
  dataDir: string
  workspace: string
}
