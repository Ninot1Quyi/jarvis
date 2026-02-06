import { useState, useEffect, useRef } from 'react'
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
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
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  return (
    <div
      className={`liquid-glass-input-container ${isFocused ? 'focused' : ''} ${isHovered ? 'hovered' : ''} ${disabled ? 'disabled' : ''} ${isConnected ? 'connected' : 'disconnected'}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleContainerClick}
    >
      {/* Backdrop blur layer */}
      <div className="liquid-glass-backdrop" />
      
      {/* Glass shimmer effect */}
      <div className="liquid-glass-shimmer" />

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
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function MessageItem({ msg, index, isNew = false }: { msg: Message; index: number; isNew?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(() => {
    // Tool messages default collapsed, assistant and status always expanded
    if (msg.role === 'tool') return false
    if (msg.role === 'assistant' || msg.role === 'status') return true
    return msg.content.length <= 150
  })

  const isLong = msg.content.length > 100
  const shouldShowExpand = isLong && msg.role === 'tool'

  const handleClick = () => {
    if (shouldShowExpand) {
      setIsExpanded(!isExpanded)
    }
  }

  // Only apply animation delay for initial messages, not new ones
  const animationStyle = isNew ? {} : { animationDelay: `${index * 0.06}s` }

  return (
    <div
      className={`message ${msg.role} ${shouldShowExpand ? 'clickable' : ''}`}
      style={animationStyle}
      onClick={handleClick}
    >
      <div className="message-header">
        <span className="message-role">
          {msg.role}
          {shouldShowExpand && <span className="expand-hint">{isExpanded ? ' -' : ' +'}</span>}
        </span>
        <span className="message-time">{msg.timestamp}</span>
      </div>
      <div className={`message-content ${isExpanded ? 'expanded' : ''} ${msg.role === 'tool' ? 'tool-content' : ''}`}>
        {msg.content}
      </div>
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="tool-calls">
          {msg.toolCalls.map((tc, i) => (
            <div key={i} className="tool-call">
              <span className="tool-call-icon">&gt;</span> {tc}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [, setStatus] = useState({ text: 'Waiting for agent...', type: 'normal' as 'normal' | 'connected' })
  const [inputValue, setInputValue] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

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

      // Check if it's an error message (STATUS) or normal system message
      const isError = lowerContent.includes('error') ||
                      lowerContent.includes('disconnected') ||
                      lowerContent.includes('connection reset') ||
                      lowerContent.includes('connection') && lowerContent.includes('reset') ||
                      lowerContent.includes('failed') ||
                      lowerContent.includes('timeout')

      setMessages(prev => [...prev, {
        role: isError ? 'status' : 'system',
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
    <div id="app" onContextMenu={handleContextMenu}>
      <div id="titlebar" data-tauri-drag-region>
        <span className="title">Jarvis</span>
      </div>

      <div id="messages" ref={messagesRef}>
        {messages.map((msg, i) => {
          const isNew = initialLoadDone.current && i >= messages.length - 3
          return <MessageItem key={i} msg={msg} index={i} isNew={isNew} />
        })}
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
