// Type-safe wrapper around the exposed window.dum API
declare global {
  interface Window {
    dum: {
      onEvent: (callback: (event: unknown) => void) => () => void;
      start: (config?: { apiKey?: string; baseUrl?: string; model?: string }) => Promise<{ success: boolean; running: boolean }>;
      stop: () => Promise<{ success: boolean }>;
      send: (text: string) => Promise<{ success: boolean; taskId?: string; error?: string }>;
      stopAgent: () => Promise<{ success: boolean }>;
      status: () => Promise<{ running: boolean }>;
      agentCard: () => Promise<unknown>;
      tasks: () => Promise<unknown>;
    };
    settings: {
      get: <T>(key: string) => Promise<T | undefined>;
      set: <T>(key: string, value: T) => Promise<void>;
    };
    models: {
      get: () => Promise<unknown>;
      set: (data: unknown) => Promise<void>;
    };
  }
}

export const dumApi = window.dum;
export const settingsApi = window.settings;
export const modelsApi = window.models;
