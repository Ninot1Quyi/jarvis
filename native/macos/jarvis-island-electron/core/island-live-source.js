const fs = require("node:fs");
const path = require("node:path");
const {
  IslandPhase,
  makeIdleSnapshot,
} = require("./island-protocol");

const DEFAULT_POLL_INTERVAL_MS = 650;
const DEFAULT_IDLE_AFTER_MS = 9000;

class IslandTraceLiveSource {
  constructor({
    onSnapshot,
    traceDirs = [],
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    idleAfterMs = DEFAULT_IDLE_AFTER_MS,
    maxTurns = 8,
    maxToolCalls = 4,
  }) {
    this.onSnapshot = onSnapshot;
    this.traceDirs = Array.isArray(traceDirs) ? traceDirs.filter(Boolean) : [];
    this.pollIntervalMs = pollIntervalMs;
    this.idleAfterMs = idleAfterMs;
    this.maxTurns = maxTurns;
    this.maxToolCalls = maxToolCalls;

    this.timer = null;
    this.currentTraceFile = null;
    this.currentTraceDir = null;
    this.currentOffset = 0;
    this.lineRemainder = "";

    this.messageSeq = 0;
    this.step = 0;
    this.phase = IslandPhase.IDLE;
    this.detail = "等待新的桌面任务。";
    this.title = "Jarvis 已就位";
    this.appName = "Jarvis zzz";
    this.lastActivityAt = 0;

    this.conversationID = "jarvis-live";
    this.turns = [];
    this.streamingReply = "";
    this.toolCalls = [];
    this.lastSeenImage = null;
    this.lastEmittedJSON = "";
  }

  start() {
    if (this.timer) return;
    this.emitSnapshot(this.buildSnapshot());
    this.timer = setInterval(() => {
      this.poll();
    }, this.pollIntervalMs);
    this.poll();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  ingestExternalUserInput(text) {
    const clean = normalizeText(text);
    if (!clean) return;
    this.onUserMessage(clean, Date.now());
    this.emitSnapshot(this.buildSnapshot());
  }

  poll() {
    try {
      const latest = this.findLatestTraceFile();
      if (!latest) {
        this.maybeTransitionToIdle(Date.now(), {
          idleDetail: "等待 Jarvis 产生真实任务流数据。",
        });
        this.emitSnapshot(this.buildSnapshot());
        return;
      }

      if (latest.file !== this.currentTraceFile) {
        this.switchToTraceFile(latest.dir, latest.file);
      }

      const ingested = this.ingestNewRecords();
      const now = Date.now();
      if (!ingested) {
        this.maybeTransitionToIdle(now);
      }
      this.emitSnapshot(this.buildSnapshot());
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.phase = IslandPhase.ERROR;
      this.title = "Jarvis 数据桥接异常";
      this.detail = `真实数据读取失败：${msg}`;
      this.appName = "Jarvis bridge";
      this.emitSnapshot(this.buildSnapshot());
    }
  }

  switchToTraceFile(traceDir, filePath) {
    this.currentTraceDir = traceDir;
    this.currentTraceFile = filePath;
    this.currentOffset = 0;
    this.lineRemainder = "";
    this.messageSeq = 0;
    this.step = 0;
    this.phase = IslandPhase.WAITING;
    this.title = "Jarvis 正在接入任务流";
    this.detail = "已连接最新会话，等待新事件。";
    this.appName = "Jarvis";
    this.lastActivityAt = Date.now();
    this.turns = [];
    this.streamingReply = "";
    this.toolCalls = [];
    this.lastSeenImage = null;
    this.conversationID = `jarvis-live-${path.basename(filePath, ".jsonl")}`;
  }

  findLatestTraceFile() {
    let newest = null;
    for (const dir of this.traceDirs) {
      if (!dir || !fs.existsSync(dir)) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const fullPath = path.join(dir, entry.name);
        let stats = null;
        try {
          stats = fs.statSync(fullPath);
        } catch {
          continue;
        }
        if (!newest || stats.mtimeMs > newest.mtimeMs) {
          newest = {
            dir,
            file: fullPath,
            mtimeMs: stats.mtimeMs,
          };
        }
      }
    }
    return newest;
  }

  ingestNewRecords() {
    if (!this.currentTraceFile) return false;

    let stats = null;
    try {
      stats = fs.statSync(this.currentTraceFile);
    } catch {
      return false;
    }

    if (stats.size < this.currentOffset) {
      this.currentOffset = 0;
      this.lineRemainder = "";
    }
    if (stats.size === this.currentOffset) return false;

    const byteLength = stats.size - this.currentOffset;
    if (byteLength <= 0) return false;

    const fd = fs.openSync(this.currentTraceFile, "r");
    try {
      const chunk = Buffer.alloc(byteLength);
      fs.readSync(fd, chunk, 0, byteLength, this.currentOffset);
      this.currentOffset = stats.size;
      return this.processChunk(chunk.toString("utf8"));
    } finally {
      fs.closeSync(fd);
    }
  }

  processChunk(text) {
    const merged = `${this.lineRemainder}${text}`;
    const lines = merged.split("\n");
    this.lineRemainder = lines.pop() ?? "";

    let changed = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (this.consumeRecord(parsed)) {
        this.emitSnapshot(this.buildSnapshot());
        changed = true;
      }
    }
    return changed;
  }

  consumeRecord(record) {
    if (!record || record.type !== "message" || !record.message) return false;
    const message = record.message;
    const role = String(message.role ?? "");
    const text = normalizeText(message.content);
    const now = Date.now();

    let changed = false;
    switch (role) {
      case "user":
        changed = this.onUserMessage(text, now);
        break;
      case "assistant":
        changed = this.onAssistantMessage(message, text, now);
        break;
      case "computer":
        changed = this.onComputerMessage(message, text, now);
        break;
      case "system":
        changed = this.onSystemMessage(text, now);
        break;
      default:
        return false;
    }

    if (changed) {
      this.lastActivityAt = now;
    }
    return changed;
  }

  onUserMessage(text, now) {
    if (!text) return false;
    this.pushTurn("user", text);
    this.phase = IslandPhase.WAITING;
    this.title = "Jarvis 正在处理新输入";
    this.detail = "收到用户输入，正在规划下一步。";
    this.appName = "Jarvis";
    this.lastActivityAt = now;
    return true;
  }

  onAssistantMessage(message, text, now) {
    let changed = false;

    if (text) {
      this.pushTurn("assistant", text);
      this.streamingReply = text;
      changed = true;
    }

    const parsedToolCalls = parseToolCalls(message.toolCalls, now, this.maxToolCalls);
    if (parsedToolCalls.length > 0) {
      this.step += 1;
      this.toolCalls = parsedToolCalls;
      this.phase = IslandPhase.WORKING;
      this.title = "Jarvis 正在执行工具";
      this.detail = `正在处理 ${parsedToolCalls.length} 个工具调用。`;
      this.appName = "Jarvis";
      changed = true;
    } else {
      if (this.toolCalls.length > 0) {
        this.toolCalls = this.toolCalls.map((call) => ({
          ...call,
          status: "done",
        }));
      }
      this.step = Math.max(this.step, 1);
      this.phase = IslandPhase.WAITING;
      this.title = "Jarvis 正在整理回复";
      this.detail = "等待下一轮动作。";
      this.appName = "Jarvis";
      changed = true;
    }

    this.lastActivityAt = now;
    return changed;
  }

  onComputerMessage(message, text, now) {
    let changed = false;

    const matchedTools = extractToolNamesFromComputerText(text);
    if (matchedTools.length > 0 && this.toolCalls.length > 0) {
      const matched = new Set(matchedTools);
      this.toolCalls = this.toolCalls.map((call) =>
        matched.has(call.name) ? { ...call, status: "done" } : call
      );
      changed = true;
    }

    if (Array.isArray(message.images) && message.images.length > 0) {
      const imagePayload = mapLastSeenImage(message.images);
      if (imagePayload) {
        this.lastSeenImage = imagePayload;
        changed = true;
      }
    }

    if (text) {
      this.detail = summarizeComputerDetail(text);
      this.phase = this.hasRunningTool() ? IslandPhase.WORKING : IslandPhase.WAITING;
      this.title = this.hasRunningTool() ? "Jarvis 正在执行工具" : "Jarvis 等待下一步";
      this.appName = "Jarvis";
      changed = true;
    }

    this.step = Math.max(this.step, 1);
    this.lastActivityAt = now;
    return changed;
  }

  onSystemMessage(text, now) {
    if (!text) return false;
    this.phase = IslandPhase.WAITING;
    this.title = "Jarvis 系统状态更新";
    this.detail = text.slice(0, 120);
    this.appName = "Jarvis";
    this.lastActivityAt = now;
    return true;
  }

  maybeTransitionToIdle(now, { idleDetail } = {}) {
    if (this.phase === IslandPhase.IDLE) return;
    if (this.phase === IslandPhase.ERROR) return;

    if (!this.lastActivityAt || now - this.lastActivityAt < this.idleAfterMs) {
      return;
    }
    this.phase = IslandPhase.IDLE;
    this.title = "Jarvis 已就位";
    this.detail = idleDetail ?? "任务流已安静，等待新的任务。";
    this.appName = "Jarvis zzz";
    if (this.toolCalls.length > 0) {
      this.toolCalls = this.toolCalls.map((call) => ({
        ...call,
        status: "done",
      }));
    }
  }

  hasRunningTool() {
    return this.toolCalls.some((call) => call.status === "running");
  }

  pushTurn(role, text) {
    this.messageSeq += 1;
    this.turns.push({
      id: `${role}-${Date.now()}-${this.messageSeq}`,
      role,
      text: truncate(text, 180),
    });
    if (this.turns.length > 28) {
      this.turns = this.turns.slice(-28);
    }
  }

  buildSnapshot() {
    if (this.phase === IslandPhase.IDLE) {
      return makeIdleSnapshot({
        appName: this.appName || "Jarvis zzz",
        title: this.title || "Jarvis 已就位",
        detail: this.detail || "等待新的桌面任务。",
        expanded: false,
      });
    }

    const phase =
      this.phase === IslandPhase.WORKING ? IslandPhase.WORKING : IslandPhase.WAITING;
    const progressCurrent = Math.max(this.step, 1);
    const conversation = {
      id: this.conversationID,
      title: "Jarvis 对话",
      turns: this.turns.slice(-this.maxTurns),
      inputPlaceholder: "今天想让我做点什么离谱但有用的事？",
      canSend: true,
      streamingReply: this.streamingReply || undefined,
      toolCalls: this.toolCalls.slice(0, this.maxToolCalls),
      lastSeenImage: this.lastSeenImage || undefined,
    };

    return {
      phase,
      title: this.title || "Jarvis 正在工作",
      detail: this.detail || "正在处理任务。",
      appName: this.appName || "Jarvis",
      progress: {
        current: progressCurrent,
        maximum: null,
      },
      expanded: false,
      conversation,
    };
  }

  emitSnapshot(snapshot) {
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.lastEmittedJSON) return;
    this.lastEmittedJSON = serialized;
    this.onSnapshot(snapshot);
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function parseToolCalls(rawToolCalls, now, maxToolCalls) {
  if (!Array.isArray(rawToolCalls)) return [];
  const limited = rawToolCalls.slice(0, maxToolCalls);
  return limited.map((entry, index) => {
    const toolName = normalizeToolName(entry?.name);
    return {
      id: `tool-${now}-${index}`,
      name: toolName,
      status: index === 0 ? "running" : "queued",
      symbol: symbolForToolName(toolName),
    };
  });
}

function normalizeToolName(raw) {
  const name = String(raw ?? "").trim();
  if (!name) return "tool";
  return name.replace(/[^\w.\-]/g, "_").slice(0, 32);
}

function symbolForToolName(name) {
  const n = name.toLowerCase();
  if (n.includes("screenshot") || n.includes("capture") || n.includes("image")) {
    return "camera.viewfinder";
  }
  if (n.includes("click") || n.includes("mouse") || n.includes("drag")) {
    return "cursorarrow.click";
  }
  if (n.includes("search") || n.includes("find")) {
    return "magnifyingglass";
  }
  if (n.includes("write") || n.includes("edit") || n.includes("patch")) {
    return "pencil.and.scribble";
  }
  if (n.includes("memory") || n.includes("read")) {
    return "book";
  }
  if (n.includes("run") || n.includes("exec") || n.includes("command")) {
    return "terminal";
  }
  return "hammer";
}

function extractToolNamesFromComputerText(text) {
  if (!text) return [];
  const names = [];
  const regex = /###\s+([A-Za-z0-9_.-]+)\s*\(/g;
  let match = regex.exec(text);
  while (match) {
    names.push(match[1]);
    match = regex.exec(text);
  }
  return names;
}

function mapLastSeenImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const last = images[images.length - 1] || {};
  const fileName = last.path ? path.basename(String(last.path)) : "";
  const title = normalizeText(last.name) || cleanFileStem(fileName) || "上一轮看到的图";
  const subtitle = images.length > 1
    ? `已缓存 ${images.length} 张图像上下文`
    : "已缓存最近一帧视觉输入";

  return {
    title: truncate(title, 24),
    subtitle: truncate(subtitle, 34),
    symbol: "photo.on.rectangle.angled",
  };
}

function cleanFileStem(fileName) {
  if (!fileName) return "";
  const stem = fileName.replace(/\.[^.]+$/, "");
  return stem.replace(/[_-]+/g, " ").trim();
}

function summarizeComputerDetail(text) {
  if (!text) return "正在处理工具结果。";
  const oneLine = normalizeText(
    text
      .replace(/###\s+[A-Za-z0-9_.-]+\s*\([^)]*\)/g, "工具调用结果")
      .replace(/\*\*/g, "")
  );
  if (!oneLine) return "正在处理工具结果。";
  return truncate(oneLine, 42);
}

module.exports = {
  IslandTraceLiveSource,
};
