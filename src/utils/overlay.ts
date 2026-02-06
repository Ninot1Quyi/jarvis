/**
 * Overlay UI Client
 *
 * WebSocket client for sending messages to the Jarvis overlay UI.
 * The overlay UI listens on ws://127.0.0.1:19823
 */

import WebSocket from 'ws'

const WS_URL = 'ws://127.0.0.1:19823'
const RECONNECT_INTERVAL = 3000

export interface OverlayMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error'
  content: string
  timestamp: string
  toolCalls?: string[]
}

class OverlayClient {
  private ws: WebSocket | null = null
  private enabled: boolean = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private messageQueue: OverlayMessage[] = []

  /**
   * Enable the overlay client and connect to the UI
   */
  enable(): void {
    this.enabled = true
    this.connect()
  }

  /**
   * Disable the overlay client and disconnect
   */
  disable(): void {
    this.enabled = false
    this.disconnect()
  }

  /**
   * Check if overlay is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Check if connected to overlay UI
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Connect to the overlay UI
   */
  private connect(): void {
    if (!this.enabled || this.ws) return

    try {
      this.ws = new WebSocket(WS_URL)

      this.ws.on('open', () => {
        console.log('[Overlay] Connected to UI')
        // Send queued messages
        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift()
          if (msg) this.sendMessage(msg)
        }
      })

      this.ws.on('close', () => {
        console.log('[Overlay] Disconnected from UI')
        this.ws = null
        this.scheduleReconnect()
      })

      this.ws.on('error', (err) => {
        // Silently handle connection errors (UI might not be running)
        this.ws = null
      })
    } catch (err) {
      this.ws = null
      this.scheduleReconnect()
    }
  }

  /**
   * Disconnect from the overlay UI
   */
  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.messageQueue = []
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.enabled || this.reconnectTimer) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, RECONNECT_INTERVAL)
  }

  /**
   * Format current time as HH:MM:SS
   */
  private formatTime(): string {
    const now = new Date()
    return now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  /**
   * Send a message to the overlay UI
   */
  private sendMessage(msg: OverlayMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  /**
   * Send a user message
   */
  sendUser(content: string): void {
    if (!this.enabled) return

    const msg: OverlayMessage = {
      role: 'user',
      content,
      timestamp: this.formatTime(),
    }

    if (this.isConnected()) {
      this.sendMessage(msg)
    } else {
      this.messageQueue.push(msg)
    }
  }

  /**
   * Send an assistant message with optional tool calls
   */
  sendAssistant(content: string, toolCalls?: { name: string; arguments: Record<string, unknown> }[]): void {
    if (!this.enabled) return

    const msg: OverlayMessage = {
      role: 'assistant',
      content,
      timestamp: this.formatTime(),
      toolCalls: toolCalls?.map(tc => `${tc.name}(${JSON.stringify(tc.arguments)})`),
    }

    if (this.isConnected()) {
      this.sendMessage(msg)
    } else {
      this.messageQueue.push(msg)
    }
  }

  /**
   * Send a system message
   */
  sendSystem(content: string): void {
    if (!this.enabled) return

    const msg: OverlayMessage = {
      role: 'system',
      content,
      timestamp: this.formatTime(),
    }

    if (this.isConnected()) {
      this.sendMessage(msg)
    } else {
      this.messageQueue.push(msg)
    }
  }

  /**
   * Send a tool execution message
   */
  sendTool(name: string, result: string): void {
    if (!this.enabled) return

    const msg: OverlayMessage = {
      role: 'tool',
      content: `${name}: ${result}`,
      timestamp: this.formatTime(),
    }

    if (this.isConnected()) {
      this.sendMessage(msg)
    } else {
      this.messageQueue.push(msg)
    }
  }

  /**
   * Send an error message
   */
  sendError(content: string): void {
    if (!this.enabled) return

    const msg: OverlayMessage = {
      role: 'error',
      content,
      timestamp: this.formatTime(),
    }

    if (this.isConnected()) {
      this.sendMessage(msg)
    } else {
      this.messageQueue.push(msg)
    }
  }
}

// Singleton instance
export const overlayClient = new OverlayClient()
