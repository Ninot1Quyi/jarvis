// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

// Expose a typed API to the renderer
contextBridge.exposeInMainWorld('dum', {
  // Event subscription (from A2A server to renderer)
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: unknown) => callback(event);
    ipcRenderer.on('dum-event', listener);
    return () => ipcRenderer.removeListener('dum-event', listener);
  },

  // Start the dum-e process (spawns binary, waits for A2A server)
  start: (config?: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ success: boolean; running: boolean }> => {
    return ipcRenderer.invoke('dum:start', config);
  },

  // Stop the dum-e process
  stop: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dum:stop');
  },

  // Send a message to the A2A server
  send: (text: string): Promise<{ success: boolean; taskId?: string; error?: string }> => {
    return ipcRenderer.invoke('dum:send', { text });
  },

  // Stop the current agent task
  stopAgent: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('dum:stop-agent');
  },

  // Check if A2A server is running
  status: (): Promise<{ running: boolean }> => {
    return ipcRenderer.invoke('dum:status');
  },

  // Get the agent card (discovery)
  agentCard: (): Promise<unknown> => {
    return ipcRenderer.invoke('dum:agent-card');
  },

  // List tasks
  tasks: (): Promise<unknown> => {
    return ipcRenderer.invoke('dum:tasks');
  },
});

// Settings store API
contextBridge.exposeInMainWorld('settings', {
  get: (key: string): Promise<unknown> => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
});

// Model configs API
contextBridge.exposeInMainWorld('models', {
  get: (): Promise<unknown> => ipcRenderer.invoke('models:get'),
  set: (data: unknown): Promise<void> => ipcRenderer.invoke('models:set', data),
});

// Window controls API
contextBridge.exposeInMainWorld('electronAPI', {
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
});
