import type { ModelConfig, Thread } from './types';

export const THREADS_CHANGED_EVENT = 'dum-e:threads-changed';
export const MODELS_CHANGED_EVENT = 'dum-e:models-changed';
export const PREFERENCES_CHANGED_EVENT = 'dum-e:preferences-changed';

const THREADS_KEY = 'dum-e-threads';
const MODELS_KEY = 'dum-e-models';
const ACTIVE_MODEL_KEY = 'dum-e-active-model';
const PREFERENCES_KEY = 'dum-e-preferences';

export type DesktopTheme = 'dark' | 'light';
export type EvolveInterval = 'session' | 'daily' | 'manual';
export type MemoryBackend = 'local' | 'postgres' | 'none';
export type RetentionPeriod = '7d' | '30d' | '90d' | 'forever';

export interface DesktopPreferences {
  autoStartAgent: boolean;
  alwaysOnTop: boolean;
  showInDock: boolean;
  voiceEnabled: boolean;
  voiceVolume: number;
  voiceRate: number;
  agentName: string;
  agentPersonality: string;
  maxSteps: number;
  toolTimeout: number;
  theme: DesktopTheme;
  fontSize: number;
  compactMode: boolean;
  settingsNavWidth: number;
  autoEvolve: boolean;
  evolveInterval: EvolveInterval;
  includeTestVerification: boolean;
  skillAutoDiscovery: boolean;
  skillUpdates: boolean;
  memoryEnabled: boolean;
  memoryBackend: MemoryBackend;
  retentionPeriod: RetentionPeriod;
  webSearchEnabled: boolean;
  fileOperationsEnabled: boolean;
  shellCommandsEnabled: boolean;
  gitOperationsEnabled: boolean;
  claudeCodeIntegration: boolean;
  desktopAppConnection: boolean;
}

export const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [
  {
    id: 'default',
    name: 'dum-e Default',
    provider: 'minimax',
    apiKey: '',
    baseUrl: '',
    model: 'dum-e',
    temperature: 0.7,
    maxTokens: 4096,
    thinkingBudget: 0,
    streaming: true,
  },
];

export const DEFAULT_PREFERENCES: DesktopPreferences = {
  autoStartAgent: false,
  alwaysOnTop: false,
  showInDock: true,
  voiceEnabled: false,
  voiceVolume: 80,
  voiceRate: 1,
  agentName: 'dum-e',
  agentPersonality: 'helpful assistant',
  maxSteps: 50,
  toolTimeout: 120,
  theme: 'dark',
  fontSize: 13,
  compactMode: false,
  settingsNavWidth: 208,
  autoEvolve: false,
  evolveInterval: 'session',
  includeTestVerification: true,
  skillAutoDiscovery: true,
  skillUpdates: false,
  memoryEnabled: true,
  memoryBackend: 'local',
  retentionPeriod: '30d',
  webSearchEnabled: true,
  fileOperationsEnabled: true,
  shellCommandsEnabled: true,
  gitOperationsEnabled: true,
  claudeCodeIntegration: false,
  desktopAppConnection: true,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function emit(eventName: string): void {
  window.dispatchEvent(new CustomEvent(eventName));
}

export function applyTheme(theme: DesktopTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function loadDesktopPreferences(): DesktopPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...readJson<Partial<DesktopPreferences>>(PREFERENCES_KEY, {}),
  };
}

export function saveDesktopPreferences(preferences: DesktopPreferences): void {
  writeJson(PREFERENCES_KEY, preferences);
  applyTheme(preferences.theme);
  emit(PREFERENCES_CHANGED_EVENT);
}

export function loadModelConfigs(): ModelConfig[] {
  const configs = readJson<ModelConfig[]>(MODELS_KEY, DEFAULT_MODEL_CONFIGS);
  return configs.length > 0 ? configs : DEFAULT_MODEL_CONFIGS;
}

export function loadActiveModelId(): string {
  const configs = loadModelConfigs();
  const activeId = localStorage.getItem(ACTIVE_MODEL_KEY) ?? configs[0]?.id ?? 'default';
  return configs.some((config) => config.id === activeId) ? activeId : configs[0].id;
}

export function saveModelConfigs(configs: ModelConfig[]): void {
  writeJson(MODELS_KEY, configs);
  emit(MODELS_CHANGED_EVENT);
}

export function saveActiveModelId(id: string): void {
  localStorage.setItem(ACTIVE_MODEL_KEY, id);
  emit(MODELS_CHANGED_EVENT);
}

export function getActiveModelLabel(): string {
  const configs = loadModelConfigs();
  const activeId = loadActiveModelId();
  return configs.find((config) => config.id === activeId)?.name ?? 'No model';
}

export function createThreadDraft(id = crypto.randomUUID(), title?: string): Thread {
  return {
    id,
    title: title ?? `Conversation ${new Date().toLocaleDateString()}`,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
  };
}

export function loadThreadsRecord(): Record<string, Thread> {
  return readJson<Record<string, Thread>>(THREADS_KEY, {});
}

export function loadThreadsList(): Thread[] {
  return Object.values(loadThreadsRecord()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function persistThread(thread: Thread): void {
  const threads = loadThreadsRecord();
  threads[thread.id] = thread;
  writeJson(THREADS_KEY, threads);
  emit(THREADS_CHANGED_EVENT);
}

export function ensureThread(threadId: string): Thread {
  const threads = loadThreadsRecord();
  if (threads[threadId]) {
    return threads[threadId];
  }

  const thread = createThreadDraft(threadId);
  threads[threadId] = thread;
  writeJson(THREADS_KEY, threads);
  emit(THREADS_CHANGED_EVENT);
  return thread;
}
