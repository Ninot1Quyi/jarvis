// DumEvent: events from dum-e to frontend
export type DumEvent =
  | { type: 'AgentStart'; task: string }
  | { type: 'AgentStep'; step: number }
  | { type: 'LlmChunk'; text: string }
  | { type: 'LlmComplete'; message: Message }
  | { type: 'ToolCall'; tool: string; input: object }
  | { type: 'ToolProgress'; tool: string; output: string; state: string }
  | { type: 'ToolComplete'; tool: string; result: string }
  | { type: 'ToolError'; tool: string; error: string }
  | { type: 'VoiceSpeak'; audio: string }
  | { type: 'AgentComplete'; summary: string }
  | { type: 'AgentError'; error: string };

// DumCommand: commands from frontend to dum-e
export type DumCommand =
  | { type: 'SendMessage'; text: string; attachments?: string[] }
  | { type: 'Stop' }
  | { type: 'Regenerate' }
  | { type: 'ActivateSkill'; name: string }
  | { type: 'UpdateConfig'; path: string; value: unknown }
  | { type: 'RunEvolve' };

// Message types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  state: 'pending' | 'running' | 'complete' | 'error';
  output?: string;
}

// Thread types
export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  modelConfigId?: string;
}

// Model config types
export type ModelProvider = 'minimax' | 'openai-compatible' | 'anthropic' | 'custom';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  thinkingBudget?: number;
  streaming?: boolean;
}

export interface ModelSettings {
  configs: ModelConfig[];
  activeConfigId: string;
}

// Skill types
export interface Skill {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  enabled: boolean;
  path: string;
}
