const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { withLineBreak } = require("../core/island-protocol");
const { IslandDemoEngine } = require("../core/island-engine");
const { IslandTraceLiveSource } = require("../core/island-live-source");

function createNativeShellBridge({ app }) {
  const socketPath = path.join(
    os.tmpdir(),
    `jarvis-island-${process.pid}.sock`
  );
  const swiftPackagePath = path.resolve(__dirname, "..", "..", "jarvis-island");
  const inferredRepoRoot = path.resolve(__dirname, "..", "..", "..", "..");

  let swiftProcess = null;
  let socket = null;
  let socketConnected = false;
  let reconnectTimer = null;
  let pendingLines = [];
  let inboundBuffer = "";
  let source = null;

  function log(...args) {
    console.log("[native-shell]", ...args);
  }

  function emitSnapshot(snapshot) {
    const line = withLineBreak(snapshot);
    if (socketConnected && socket) {
      socket.write(line);
      return;
    }
    pendingLines.push(line);
    if (pendingLines.length > 120) {
      pendingLines = pendingLines.slice(-120);
    }
  }

  function flushPending() {
    if (!socketConnected || !socket || pendingLines.length === 0) return;
    for (const line of pendingLines) {
      socket.write(line);
    }
    pendingLines = [];
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectSocket();
    }, 450);
  }

  function connectSocket() {
    if (socket) {
      socket.destroy();
      socket = null;
    }

    const client = net.createConnection(socketPath);
    socket = client;
    client.setEncoding("utf8");

    client.on("connect", () => {
      socketConnected = true;
      log("connected to socket", socketPath);
      flushPending();
    });

    client.on("error", (err) => {
      socketConnected = false;
      log("socket error", err.message);
      scheduleReconnect();
    });

    client.on("data", (chunk) => {
      handleInboundSocketChunk(chunk);
    });

    client.on("close", () => {
      socketConnected = false;
      scheduleReconnect();
    });
  }

  function handleInboundSocketChunk(chunk) {
    inboundBuffer += chunk;
    let delimiter = inboundBuffer.indexOf("\n");
    while (delimiter >= 0) {
      const line = inboundBuffer.slice(0, delimiter).trim();
      inboundBuffer = inboundBuffer.slice(delimiter + 1);
      delimiter = inboundBuffer.indexOf("\n");

      if (!line) continue;

      let payload = null;
      try {
        payload = JSON.parse(line);
      } catch {
        continue;
      }
      handleSocketInboundMessage(payload);
    }
  }

  function handleSocketInboundMessage(payload) {
    if (!payload || payload.type !== "conversation_event") return;
    if (payload.event === "send") {
      const text = String(payload.text ?? "").trim();
      if (!text) return;
      log("conversation input", {
        conversationID: payload.conversationID,
        length: text.length,
      });
      if (source && typeof source.ingestExternalUserInput === "function") {
        source.ingestExternalUserInput(text);
      }
      relayConversationToJarvis({
        text,
        conversationID: String(payload.conversationID ?? ""),
      }).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        log("conversation relay failed", msg);
      });
    }
  }

  function startSwiftShell() {
    try {
      fs.unlinkSync(socketPath);
    } catch {}

    const args = [
      "run",
      "--package-path",
      swiftPackagePath,
      "jarvis-island",
      "--socket",
      socketPath,
    ];

    swiftProcess = spawn("swift", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    swiftProcess.stdout.setEncoding("utf8");
    swiftProcess.stderr.setEncoding("utf8");
    swiftProcess.stdout.on("data", (data) => {
      process.stdout.write(`[swift-shell] ${data}`);
    });
    swiftProcess.stderr.on("data", (data) => {
      process.stderr.write(`[swift-shell] ${data}`);
    });

    swiftProcess.on("exit", (code, signal) => {
      log("swift shell exited", { code, signal });
      shutdown();
      app.quit();
    });
  }

  function shutdown() {
    if (source) {
      source.stop();
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.destroy();
      socket = null;
    }
    socketConnected = false;
    inboundBuffer = "";

    if (swiftProcess && !swiftProcess.killed) {
      swiftProcess.kill("SIGTERM");
    }
    swiftProcess = null;

    try {
      fs.unlinkSync(socketPath);
    } catch {}
  }

  function start() {
    log("starting native-shell bridge", { socketPath });
    startSwiftShell();
    connectSocket();
    source = createSource({
      inferredRepoRoot,
      onSnapshot: emitSnapshot,
    });
    source.start();

    app.on("before-quit", () => {
      shutdown();
    });
  }

  return { start, shutdown, emitSnapshot };
}

async function relayConversationToJarvis({ text, conversationID }) {
  const endpoint = process.env.JARVIS_A2A_URL || "http://127.0.0.1:3000/a2a";
  const requestID = `island-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const taskID = `island-task-${crypto.randomUUID()}`;

  const body = {
    jsonrpc: "2.0",
    id: requestID,
    method: "tasks/send",
    params: {
      id: taskID,
      sessionId: conversationID || undefined,
      message: {
        role: "user",
        parts: [
          {
            type: "text",
            text,
          },
        ],
      },
    },
  };

  const controller = new AbortController();
  const timeoutMs = Number(process.env.JARVIS_A2A_TIMEOUT_MS || 2800);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`A2A HTTP ${response.status}`);
    }
    const data = await response.json().catch(() => ({}));
    if (data && data.error) {
      throw new Error(String(data.error.message || "A2A JSON-RPC error"));
    }
  } finally {
    clearTimeout(timeout);
  }
}

function createSource({ inferredRepoRoot, onSnapshot }) {
  if (process.env.JARVIS_ISLAND_DEMO === "1") {
    return new IslandDemoEngine({ onSnapshot });
  }

  const traceDirs = resolveTraceDirs(inferredRepoRoot);
  return new IslandTraceLiveSource({
    onSnapshot,
    traceDirs,
    pollIntervalMs: Number(process.env.JARVIS_ISLAND_POLL_MS || 650),
    idleAfterMs: Number(process.env.JARVIS_ISLAND_IDLE_AFTER_MS || 9000),
  });
}

function resolveTraceDirs(inferredRepoRoot) {
  const roots = [];
  const pushRoot = (value) => {
    if (!value) return;
    const normalized = path.resolve(String(value));
    if (!roots.includes(normalized)) {
      roots.push(normalized);
    }
  };

  const envRepoRoot = process.env.JARVIS_REPO_ROOT;
  const envDataDir = process.env.JARVIS_ISLAND_DATA_DIR;
  const cwd = process.cwd();
  const primaryRepoRoot = derivePrimaryRepoRoot(inferredRepoRoot);

  pushRoot(envRepoRoot);
  pushRoot(primaryRepoRoot);
  pushRoot(inferredRepoRoot);
  pushRoot(cwd);

  const traceDirs = [];
  const pushTraceDir = (dir) => {
    if (!dir) return;
    const normalized = path.resolve(String(dir));
    if (!traceDirs.includes(normalized)) {
      traceDirs.push(normalized);
    }
  };

  pushTraceDir(envDataDir ? path.join(envDataDir, "traces") : null);
  for (const root of roots) {
    pushTraceDir(path.join(root, "data", "traces"));
  }
  return traceDirs;
}

function derivePrimaryRepoRoot(inferredRepoRoot) {
  const marker = `${path.sep}jarvis-worktrees${path.sep}`;
  const idx = inferredRepoRoot.indexOf(marker);
  if (idx < 0) return null;
  const parent = inferredRepoRoot.slice(0, idx);
  if (!parent) return null;
  return path.join(parent, "jarvis");
}

module.exports = { createNativeShellBridge };
