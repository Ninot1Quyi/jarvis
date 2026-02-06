import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition } from "@tauri-apps/api/dpi";

// Message types
interface Message {
  role: "user" | "assistant" | "system" | "tool" | "error";
  content: string;
  timestamp: string;
  toolCalls?: string[];
}

// DOM elements
let messagesEl: HTMLElement | null;
let statusEl: HTMLElement | null;
let statusTextEl: HTMLElement | null;

// Format timestamp
function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Truncate long content
function truncateContent(content: string, maxLength: number = 500): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "...";
}

// Add message to UI
function addMessage(msg: Message): void {
  if (!messagesEl) return;

  const messageEl = document.createElement("div");
  messageEl.className = `message ${msg.role}`;

  const headerEl = document.createElement("div");
  headerEl.className = "message-header";

  const roleEl = document.createElement("span");
  roleEl.className = "message-role";
  roleEl.textContent = msg.role;

  const timeEl = document.createElement("span");
  timeEl.className = "message-time";
  timeEl.textContent = msg.timestamp;

  headerEl.appendChild(roleEl);
  headerEl.appendChild(timeEl);

  const contentEl = document.createElement("div");
  contentEl.className = "message-content";
  contentEl.textContent = truncateContent(msg.content);

  messageEl.appendChild(headerEl);
  messageEl.appendChild(contentEl);

  // Add tool calls if present
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    const toolCallsEl = document.createElement("div");
    toolCallsEl.className = "tool-calls";

    for (const tc of msg.toolCalls) {
      const toolCallEl = document.createElement("div");
      toolCallEl.className = "tool-call";
      toolCallEl.innerHTML = `<span class="tool-call-icon">></span> ${escapeHtml(tc)}`;
      toolCallsEl.appendChild(toolCallEl);
    }

    messageEl.appendChild(toolCallsEl);
  }

  messagesEl.appendChild(messageEl);

  // Auto-scroll to bottom
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Update status
function setStatus(text: string, type: "normal" | "connected" | "error" = "normal"): void {
  if (statusEl && statusTextEl) {
    statusTextEl.textContent = text;
    statusEl.className = type;
  }
}

// Position window to bottom-right corner
async function positionWindow(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    const monitor = await currentMonitor();

    if (monitor) {
      const screenWidth = monitor.size.width;
      const screenHeight = monitor.size.height;
      const scaleFactor = monitor.scaleFactor;

      // Window size
      const windowWidth = 400;
      const windowHeight = 500;

      // Position at bottom-right with some margin
      const margin = 20;
      const x = Math.round((screenWidth / scaleFactor) - windowWidth - margin);
      const y = Math.round((screenHeight / scaleFactor) - windowHeight - margin);

      await appWindow.setPosition(new PhysicalPosition(x, y));
    }
  } catch (e) {
    console.error("Failed to position window:", e);
  }
}

// Initialize
window.addEventListener("DOMContentLoaded", async () => {
  messagesEl = document.querySelector("#messages");
  statusEl = document.querySelector("#status");
  statusTextEl = document.querySelector("#status-text");

  const appWindow = getCurrentWindow();

  // Window controls
  document.getElementById("btn-minimize")?.addEventListener("click", () => {
    appWindow.minimize();
  });

  document.getElementById("btn-close")?.addEventListener("click", () => {
    appWindow.close();
  });

  // Enable dragging on titlebar
  const titlebar = document.getElementById("titlebar");
  if (titlebar) {
    titlebar.addEventListener("mousedown", async (e) => {
      // Only drag on left mouse button and not on control buttons
      if (e.button === 0 && !(e.target as HTMLElement).closest(".controls")) {
        await appWindow.startDragging();
      }
    });
  }

  // Position window
  await positionWindow();

  // Listen for messages from the agent
  await listen<Message>("agent-message", (event) => {
    addMessage(event.payload);
    setStatus("Connected", "connected");
  });

  // Listen for status updates
  await listen<string>("agent-status", (event) => {
    setStatus(event.payload, "connected");
  });

  // Listen for errors
  await listen<string>("agent-error", (event) => {
    addMessage({
      role: "error",
      content: event.payload,
      timestamp: formatTime(new Date()),
    });
    setStatus("Error", "error");
  });

  // Add welcome message
  addMessage({
    role: "system",
    content: "Overlay UI initialized. Waiting for agent connection...",
    timestamp: formatTime(new Date()),
  });

  setStatus("Waiting for agent...");
});

// Export for external use
export { addMessage, setStatus, formatTime };
