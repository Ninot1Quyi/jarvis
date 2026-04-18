import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

// A2A server config
const A2A_HOST = '127.0.0.1';
const A2A_PORT = parseInt(process.env.DUM_E_A2A_PORT || '3000', 10);

let mainWindow: BrowserWindow | null = null;
let dumProcess: ReturnType<typeof spawn> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let currentTaskId: string | null = null;

// ─── HTTP client ────────────────────────────────────────────────

function httpRequest(method: string, path: string, body?: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: A2A_HOST,
      port: A2A_PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── A2A long-poll ─────────────────────────────────────────────

async function pollTask(taskId: string): Promise<void> {
  try {
    const task = await httpRequest('GET', `/tasks/${taskId}`) as Record<string, unknown>;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dum-event', { type: 'TaskUpdate', task });
    }

    const state = task.state as string;
    if (state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELED') {
      currentTaskId = null;
    }
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dum-event', {
        type: 'AgentError',
        error: `Poll failed: ${String(err)}`,
      });
    }
  }
}

// ─── Dum-e process management ──────────────────────────────────

function findDumEBinary(): string | null {
  // Strategy 1: env var override (most reliable for dev)
  if (process.env.DUM_E_BINARY) {
    if (fs.existsSync(process.env.DUM_E_BINARY)) return process.env.DUM_E_BINARY;
  }

  // Strategy 2: resolve from the dum-e git repo root (parent of dum-e-desktop/)
  // During dev: __dirname is in .vite/build/main/ → project root is 3 levels up
  // __dirname = {project}/.vite/build/main/ (compiled main.ts)
  const devRoot = path.resolve(__dirname, '../../../..'); // project root (dum-e-desktop/)

  const candidates = [
    // In the dum-e Rust project (sibling to dum-e-desktop/)
    path.join(devRoot, '../dum-e/target/debug/dum_e'),
    path.join(devRoot, '../dum-e/target/release/dum_e'),
    // Already inside dum-e project (devRoot == dum-e/)
    path.join(devRoot, 'target/debug/dum_e'),
    path.join(devRoot, 'target/release/dum_e'),
    // Packaged app: binary is next to the .app bundle
    path.join(app.isPackaged ? path.dirname(app.getAppPath()) : devRoot, '../dum_e'),
    // Default build location
    '/Users/Ninot/NinotQuyi/dum-e/target/debug/dum_e',
    '/Users/Ninot/NinotQuyi/dum-e/target/release/dum_e',
  ];

  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (fs.existsSync(resolved)) return resolved;
  }

  console.error('[bridge] dum-e binary not found. Searched:', candidates);
  return null;
}

async function checkA2AServer(): Promise<boolean> {
  try {
    await httpRequest('GET', '/agentCard');
    return true;
  } catch {
    return false;
  }
}

async function startDumEProcess(): Promise<boolean> {
  const binary = findDumEBinary();
  if (!binary) {
    console.error('[bridge] Cannot start dum-e: binary not found. Run `cargo build` in dum-e directory.');
    return false;
  }

  console.log(`[bridge] Starting dum-e from ${binary}...`);
  dumProcess = spawn(binary, [], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, DUM_E_A2A_PORT: String(A2A_PORT) },
    detached: false,
  });

  // Wait for A2A server to be ready (up to 10s)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await checkA2AServer()) {
      console.log('[bridge] dum-e A2A server ready on port', A2A_PORT);
      return true;
    }
  }

  console.error('[bridge] dum-e started but A2A server did not become available');
  return false;
}

// ─── Public API ────────────────────────────────────────────────

export function setMainWindow(win: BrowserWindow) {
  mainWindow = win;
}

export async function startA2A(): Promise<{ success: boolean; running: boolean }> {
  if (await checkA2AServer()) {
    console.log('[bridge] dum-e A2A server already running on port', A2A_PORT);
    return { success: true, running: true };
  }

  const ok = await startDumEProcess();
  return { success: ok, running: ok };
}

export async function sendMessage(text: string): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    const result = await httpRequest('POST', '/message:send', {
      message: {
        message_id: crypto.randomUUID(),
        role: 'User',
        parts: [{ Text: { text } }],
      },
      configuration: {
        accepted_output_modes: ['message'],
        returnImmediately: false,
      },
    }) as { id?: string; taskId?: string; state?: string };

    const taskId = (result as Record<string, unknown>).id as string || result.taskId as string;
    if (taskId) {
      currentTaskId = taskId;
      // Start polling
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (currentTaskId) pollTask(currentTaskId);
        else if (pollInterval) clearInterval(pollInterval);
      }, 1000);
    }

    return { success: true, taskId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function stopAgent(): Promise<{ success: boolean }> {
  if (currentTaskId) {
    try {
      await httpRequest('POST', `/tasks/${currentTaskId}:cancel`);
    } catch { /* ignore */ }
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  currentTaskId = null;
  return { success: true };
}

export function stopDumE(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (dumProcess) { dumProcess.kill(); dumProcess = null; }
  currentTaskId = null;
}

export async function getAgentCard(): Promise<unknown> {
  return httpRequest('GET', '/agentCard');
}

export async function listTasks(): Promise<unknown> {
  return httpRequest('GET', '/tasks');
}

// ─── IPC handlers ──────────────────────────────────────────────

export function registerIpcHandlers() {
  ipcMain.handle('dum:start', async (_, config) => startA2A(config));
  ipcMain.handle('dum:stop', () => { stopDumE(); return { success: true }; });
  ipcMain.handle('dum:send', async (_, { text }: { text: string }) => sendMessage(text));
  ipcMain.handle('dum:stop-agent', () => stopAgent());
  ipcMain.handle('dum:status', async () => ({ running: await checkA2AServer() }));
  ipcMain.handle('dum:agent-card', () => getAgentCard());
  ipcMain.handle('dum:tasks', () => listTasks());
}
