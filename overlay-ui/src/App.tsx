import { useState, useEffect, useRef } from 'react'
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { PhysicalPosition } from '@tauri-apps/api/dpi'

// Liquid Glass Input Component
interface LiquidGlassInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  disabled?: boolean
  isConnected?: boolean
}

function LiquidGlassInput({ value, onChange, onSubmit, placeholder, disabled, isConnected = true }: LiquidGlassInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim()) {
        onSubmit()
      }
    }
  }

  const handleContainerClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus()
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setMousePos({ x, y })
  }

  return (
    <div
      ref={containerRef}
      className={`liquid-glass-input-container ${isFocused ? 'focused' : ''} ${isHovered ? 'hovered' : ''} ${disabled ? 'disabled' : ''} ${isConnected ? 'connected' : 'disconnected'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleContainerClick}
      onMouseMove={handleMouseMove}
    >
      {/* Backdrop blur layer */}
      <div className="liquid-glass-backdrop" />
      
      {/* Glass shimmer effect */}
      <div className="liquid-glass-shimmer" />

      {/* Mouse follow edge refraction */}
      <div 
        className="edge-refraction"
        style={{
          background: `
            radial-gradient(ellipse 120% 40% at ${mousePos.x}% -10%, rgba(255, 255, 255, 0.15) 0%, transparent 60%),
            radial-gradient(ellipse 120% 40% at ${100 - mousePos.x}% 110%, rgba(255, 255, 255, 0.08) 0%, transparent 50%)
          `,
        }}
      />

      {/* Connection status indicator */}
      <div className="connection-indicator" />
      
      {/* Input field */}
      <textarea
        ref={inputRef}
        className="liquid-glass-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={disabled ? 'Waiting for agent...' : placeholder}
        disabled={disabled}
        rows={1}
      />
    </div>
  )
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'status'
  content: string
  timestamp: string
  toolCalls?: string[]
  attachments?: string[]
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function getMediaType(filePath: string): 'image' | 'video' | 'file' {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video'
  return 'file'
}

function AttachmentRenderer({ attachments }: { attachments: string[] }) {
  return (
    <div className="attachments-container">
      {attachments.map((filePath, i) => {
        const mediaType = getMediaType(filePath)
        const src = convertFileSrc(filePath)
        const fileName = filePath.split('/').pop() || filePath

        if (mediaType === 'image') {
          return (
            <div key={i} className="attachment-image">
              <img src={src} alt={fileName} loading="lazy" />
            </div>
          )
        }
        if (mediaType === 'video') {
          return (
            <div key={i} className="attachment-video">
              <video src={src} controls preload="metadata" />
            </div>
          )
        }
        return (
          <div key={i} className="attachment-file">
            <span className="attachment-file-name">{fileName}</span>
          </div>
        )
      })}
    </div>
  )
}

function MessageItem({ msg }: { msg: Message }) {
  const [isExpanded, setIsExpanded] = useState(() => {
    // Tool messages default collapsed, assistant and status always expanded
    if (msg.role === 'tool') return false
    if (msg.role === 'assistant' || msg.role === 'status') return true
    return msg.content.length <= 150
  })
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 })
  const [isHovered, setIsHovered] = useState(false)
  const messageRef = useRef<HTMLDivElement>(null)

  const isLong = msg.content.length > 100
  const shouldShowExpand = isLong && msg.role === 'tool'
  const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0
  const isClickable = shouldShowExpand || (msg.role === 'assistant' && hasToolCalls)

  const handleClick = () => {
    if (shouldShowExpand) {
      setIsExpanded(!isExpanded)
    } else if (msg.role === 'assistant' && hasToolCalls) {
      setToolsExpanded(!toolsExpanded)
    }
  }

  const handleToolsClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setToolsExpanded(!toolsExpanded)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!messageRef.current) return
    const rect = messageRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setMousePos({ x, y })
  }

  // No animation delay - all messages render immediately
  const animationStyle = {}

  return (
    <div
      ref={messageRef}
      className={`message ${msg.role} ${isClickable ? 'clickable' : ''} ${isHovered ? 'hovered' : ''}`}
      style={animationStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    >
      {/* Mouse follow edge refraction for message bubble */}
      <div 
        className="message-edge-refraction"
        style={{
          background: `
            radial-gradient(ellipse 100% 30% at ${mousePos.x}% -5%, rgba(255, 255, 255, 0.12) 0%, transparent 55%),
            radial-gradient(ellipse 100% 30% at ${100 - mousePos.x}% 105%, rgba(255, 255, 255, 0.06) 0%, transparent 45%)
          `,
        }}
      />
      <div className="message-header">
        <span className="message-role">
          {msg.role}
          {isClickable && (
            <span className="expand-hint">
              {msg.role === 'assistant' && hasToolCalls 
                ? (toolsExpanded ? ' −' : ' +')
                : (isExpanded ? ' −' : ' +')}
            </span>
          )}
        </span>
        <span className="message-time">{msg.timestamp}</span>
      </div>
      <div className={`message-content ${isExpanded ? 'expanded' : ''} ${msg.role === 'tool' ? 'tool-content' : ''}`}>
        {msg.content}
      </div>
      {hasToolCalls && (
        <div
          className={`tool-bubble ${toolsExpanded ? 'expanded' : ''}`}
          onClick={handleToolsClick}
        >
          <div className="tool-bubble-header">
            <span className="tool-bubble-icon">{toolsExpanded ? '−' : '+'}</span>
            <span className="tool-bubble-text">
              {msg.toolCalls!.length} tool{msg.toolCalls!.length > 1 ? 's' : ''} used
            </span>
          </div>
          <div className="tool-bubble-content">
            {msg.toolCalls!.map((tc, i) => (
              <div key={i} className="tool-item">
                {tc}
              </div>
            ))}
          </div>
        </div>
      )}
      {msg.attachments && msg.attachments.length > 0 && (
        <AttachmentRenderer attachments={msg.attachments} />
      )}
    </div>
  )
}

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [, setStatus] = useState({ text: 'Waiting for agent...', type: 'normal' as 'normal' | 'connected' })
  const [inputValue, setInputValue] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const messagesRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

  // Toggle theme
  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  // Send message to agent
  const sendMessage = async () => {
    const content = inputValue.trim()
    if (!content) return

    try {
      await invoke('send_to_agent', { content })

      // Add to local messages
      setMessages(prev => [...prev, {
        role: 'user',
        content: content,
        timestamp: formatTime(new Date()),
      }])

      setInputValue('')
    } catch (e) {
      console.error('Failed to send message:', e)
      setMessages(prev => [...prev, {
        role: 'status',
        content: `Failed to send: ${e}`,
        timestamp: formatTime(new Date()),
      }])
    }
  }

  // Handle context menu for window controls
  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()

    // Right click to minimize
    const appWindow = getCurrentWindow()
    await appWindow.minimize()
  }

  // Position window
  useEffect(() => {
    async function positionWindow() {
      try {
        const appWindow = getCurrentWindow()
        const monitor = await currentMonitor()

        if (monitor) {
          const screenWidth = monitor.size.width
          const screenHeight = monitor.size.height
          const scaleFactor = monitor.scaleFactor

          const windowWidth = 400
          const windowHeight = 500
          const margin = 20

          const x = Math.round((screenWidth / scaleFactor) - windowWidth - margin)
          const y = Math.round((screenHeight / scaleFactor) - windowHeight - margin)

          await appWindow.setPosition(new PhysicalPosition(x, y))
        }
      } catch (e) {
        console.error('Failed to position window:', e)
      }
    }

    positionWindow()
  }, [])

  // Titlebar dragging
  useEffect(() => {
    const titlebar = document.getElementById('titlebar')
    const appWindow = getCurrentWindow()

    const handleMouseDown = async (e: MouseEvent) => {
      if (e.button === 0 && !(e.target as HTMLElement).closest('.controls')) {
        await appWindow.startDragging()
      }
    }

    titlebar?.addEventListener('mousedown', handleMouseDown)
    return () => titlebar?.removeEventListener('mousedown', handleMouseDown)
  }, [])

  // Listen for agent messages
  useEffect(() => {
    const unlistenMessage = listen<Message>('agent-message', (event) => {
      setMessages(prev => [...prev, event.payload])
      setStatus({ text: 'Connected', type: 'connected' })
      setIsConnected(true)
    })

    const unlistenStatus = listen<string>('agent-status', (event) => {
      const content = event.payload
      const lowerContent = content.toLowerCase()

      // Check connection status
      if (lowerContent.includes('connected') && !lowerContent.includes('disconnected')) {
        setIsConnected(true)
      } else if (lowerContent.includes('disconnected')) {
        setIsConnected(false)
      }

      // All connection-related status messages should use 'status' role
      // This includes "Agent connected", "disconnected", errors, etc.
      setMessages(prev => [...prev, {
        role: 'status',
        content: content,
        timestamp: formatTime(new Date()),
      }])
      setStatus({ text: content, type: 'connected' })
    })

    const unlistenError = listen<string>('agent-error', (event) => {
      // Show disconnection as status message (red)
      setMessages(prev => [...prev, {
        role: 'status',
        content: event.payload,
        timestamp: formatTime(new Date()),
      }])
      setStatus({ text: event.payload, type: 'normal' })
      setIsConnected(false)
    })

    // Welcome message
    setMessages([{
      role: 'system',
      content: 'Overlay UI initialized. Waiting for agent connection...',
      timestamp: formatTime(new Date()),
    }])

    // Mark initial load as done after a short delay
    setTimeout(() => {
      initialLoadDone.current = true
    }, 100)

    return () => {
      unlistenMessage.then(fn => fn())
      unlistenStatus.then(fn => fn())
      unlistenError.then(fn => fn())
    }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div id="app" data-theme={theme} onContextMenu={handleContextMenu}>
      <div id="titlebar" data-tauri-drag-region>
        <span className="title">Jarvis</span>
        <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
          {theme === 'light' ? '☀️' : '🌙'}
        </button>
      </div>

      <div id="messages" ref={messagesRef}>
        {messages.map((msg, i) => (
          <MessageItem key={i} msg={msg} />
        ))}
      </div>

      <div id="input-area">
        <LiquidGlassInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={sendMessage}
          placeholder={isConnected ? "Type a message..." : "Disconnected"}
          disabled={false}
          isConnected={isConnected}
 />
      </div>


    </div>
  )
}

export default App
