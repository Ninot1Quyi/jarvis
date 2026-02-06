import { useState, useEffect, useRef } from 'react'
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { PhysicalPosition } from '@tauri-apps/api/dpi'

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

function truncateContent(content: string, maxLength: number = 500): string {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '...'
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
          {shouldShowExpand && <span className="expand-hint">{isExpanded ? ' −' : ' +'}</span>}
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
  const [status, setStatus] = useState({ text: 'Waiting for agent...', type: 'normal' as 'normal' | 'connected' })
  const messagesRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

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
    })

    const unlistenStatus = listen<string>('agent-status', (event) => {
      const content = event.payload
      const lowerContent = content.toLowerCase()

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

      <div id="status" className={status.type}>
        <span id="status-text">{status.text}</span>
      </div>
    </div>
  )
}

export default App
