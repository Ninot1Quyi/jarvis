import { useState, useEffect, useRef } from 'react'
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { marked } from 'marked'

// Liquid Glass Input Component
interface LiquidGlassInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  disabled?: boolean
  isConnected?: boolean
  onStop?: () => void
}

function LiquidGlassInput({ value, onChange, onSubmit, placeholder, disabled, isConnected = true, onStop }: LiquidGlassInputProps) {
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

      {/* Stop button */}
      {onStop && (
        <button
          className="input-stop-btn"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onStop()
          }}
          title="Stop agent"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="2" y="2" width="8" height="8" rx="1" />
          </svg>
        </button>
      )}
    </div>
  )
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'status' | 'computer'
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
  console.log('[AttachmentRenderer] Rendering attachments:', attachments)
  
  return (
    <div className="attachments-container">
      {attachments.map((filePath, i) => {
        const mediaType = getMediaType(filePath)
        const src = convertFileSrc(filePath)
        const fileName = filePath.split('/').pop() || filePath
        
        console.log(`[AttachmentRenderer] ${i}: ${fileName} (${mediaType}) -> ${src}`)

        if (mediaType === 'image') {
          return (
            <div key={i} className="attachment-image">
              <img 
                src={src} 
                alt={fileName} 
                loading="lazy" 
                onError={(e) => {
                  console.error(`[AttachmentRenderer] Failed to load image: ${src}`, e)
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          )
        }
        if (mediaType === 'video') {
          return (
            <div key={i} className="attachment-video">
              <video 
                src={src} 
                controls 
                preload="metadata"
                onError={(e) => {
                  console.error(`[AttachmentRenderer] Failed to load video: ${src}`, e)
                }}
              />
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

// Component for rendering markdown content
const CUSTOM_XML_TAGS = ['quote', 'reminder', 'warning', 'thought', 'error']
const CUSTOM_XML_RE = new RegExp(
  `<(${CUSTOM_XML_TAGS.join('|')})>([\\s\\S]*?)<\\/\\1>`,
  'gi'
)

// Escape HTML special chars for safe dangerouslySetInnerHTML usage
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Process plain text content: escape HTML first, then apply custom XML tag labels
function processCustomTags(text: string): string {
  const escaped = escapeHtml(text)
  const escapedTagRe = new RegExp(
    `&lt;(${CUSTOM_XML_TAGS.join('|')})&gt;([\\s\\S]*?)&lt;/\\1&gt;`,
    'gi'
  )
  return escaped.replace(
    escapedTagRe,
    (_match, tag, inner) => `${inner.replace(/[\s\n\r]+$/, '')}<sup class="xml-tag">${escapeHtml(tag)}</sup>`
  )
}

function MarkdownContent({ content }: { content: string }) {
  let htmlContent = marked.parse(content, { async: false }) as string
  // Replace known custom XML tags with content + superscript tag label
  htmlContent = htmlContent.replace(
    CUSTOM_XML_RE,
    (_match, tag, inner) => `${inner.replace(/[\s\n\r]+$/, '')}<sup class="xml-tag">${tag}</sup>`
  )
  return (
    <div
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  )
}

function MessageItem({ msg }: { msg: Message }) {
  // Debug log for each message render
  console.log('[MessageItem] Rendering:', msg.role, msg.content?.slice(0, 50))
  
  const [isExpanded, setIsExpanded] = useState(() => {
    // All messages expanded by default for better visibility
    return true
  })
  // Computer message fold state - default folded for computer messages
  const [isComputerFolded, setIsComputerFolded] = useState(() => msg.role === 'computer')
  // Enable CSS transition only after first user toggle (prevents flash on initial render)
  const [computerAnimated, setComputerAnimated] = useState(false)
  
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 })
  const [isHovered, setIsHovered] = useState(false)
  const messageRef = useRef<HTMLDivElement>(null)

  // Parse source tag from user messages: "[gui] content" -> { source: "gui", content: "content" }
  let userSource = ''
  let displayContent = msg.content
  if (msg.role === 'user') {
    const sourceMatch = msg.content.match(/^\[(gui|mail|tui|notification)\]\s*/)
    if (sourceMatch) {
      userSource = sourceMatch[1]
      displayContent = msg.content.slice(sourceMatch[0].length)
    }
  }

  const isLong = displayContent.length > 100
  const shouldShowExpand = isLong && msg.role === 'tool'
  const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0
  const isClickable = shouldShowExpand || (msg.role === 'assistant' && hasToolCalls) || msg.role === 'computer'

  const handleClick = () => {
    if (msg.role === 'computer') {
      if (!computerAnimated) setComputerAnimated(true)
      setIsComputerFolded(!isComputerFolded)
    } else if (shouldShowExpand) {
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

  return (
    <div
      ref={messageRef}
      className={`message ${msg.role} ${msg.role === 'status' && /connected/i.test(msg.content) && !/disconnected/i.test(msg.content) ? 'connected' : ''} ${isClickable ? 'clickable' : ''} ${isHovered ? 'hovered' : ''}`}
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
          {userSource && <span className="message-source">{userSource}</span>}
          {isClickable && (
            <span className="expand-hint">
              {msg.role === 'assistant' && hasToolCalls 
                ? (toolsExpanded ? ' −' : ' +')
                : msg.role === 'computer'
                  ? (isComputerFolded ? ' +': ' −')
                  : (isExpanded ? ' −' : ' +')}
            </span>
          )}
        </span>
        <span className="message-time">{msg.timestamp}</span>
      </div>
      <div
        className={`message-content ${isExpanded && msg.role !== 'computer' ? 'expanded' : ''} ${msg.role === 'tool' ? 'tool-content' : ''} ${msg.role === 'computer' ? 'computer-content' : ''} ${msg.role === 'computer' && computerAnimated ? 'animated' : ''} ${msg.role === 'computer' && isComputerFolded ? 'folded' : ''}`}
      >
        {msg.role === 'computer' ? (
          <MarkdownContent content={
            (msg.attachments && msg.attachments.length > 0
              ? msg.attachments.map(f => `![screenshot](${convertFileSrc(f)})`).join('\n') + '\n\n'
              : '') + msg.content
          } />
        ) : msg.role === 'assistant' ? (
          <div dangerouslySetInnerHTML={{ __html: processCustomTags(msg.content) }} />
        ) : (
          displayContent
        )}
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
      {msg.role !== 'computer' && msg.attachments && msg.attachments.length > 0 && (
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
  const [isAgentBusy, setIsAgentBusy] = useState(false)
  const [theme] = useState<'light' | 'dark'>('dark')
  const [pendingMessages, setPendingMessages] = useState<Array<{id: string; content: string; timestamp: string}>>([])
  const messagesRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

  // Send message to agent
  const sendMessage = async () => {
    const content = inputValue.trim()
    if (!content) return

    try {
      await invoke('send_to_agent', { content })
      setInputValue('')
      setIsAgentBusy(true)
    } catch (e) {
      console.error('Failed to send message:', e)
      setMessages(prev => [...prev, {
        role: 'status',
        content: `Failed to send: ${e}`,
        timestamp: formatTime(new Date()),
      }])
    }
  }

  // Stop the agent
  const stopAgent = async () => {
    try {
      await invoke('stop_agent')
      setIsAgentBusy(false)
      setMessages(prev => [...prev, {
        role: 'status',
        content: 'Stop signal sent to agent',
        timestamp: formatTime(new Date()),
      }])
    } catch (e) {
      console.error('Failed to stop agent:', e)
      setMessages(prev => [...prev, {
        role: 'status',
        content: `Failed to stop: ${e}`,
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
    const unlistenMessage = listen<any>('agent-message', (event) => {
      console.log('[agent-message] Raw payload:', JSON.stringify(event.payload, null, 2))
      
      // Validate message format
      const payload = event.payload
      if (!payload || typeof payload !== 'object') {
        console.error('[agent-message] Invalid payload:', payload)
        return
      }
      
      // Check for tool-related messages
      if (payload.role === 'tool' || payload.toolCalls || payload.tool_calls) {
        console.log('[agent-message] Tool message detected:', {
          role: payload.role,
          hasToolCalls: !!payload.toolCalls,
          hasToolCallsSnake: !!payload.tool_calls,
          content: payload.content?.slice(0, 50)
        })
      }
      
      // Ensure message has required fields
      const validMessage: Message = {
        role: payload.role || 'system',
        content: payload.content || '',
        timestamp: payload.timestamp || formatTime(new Date()),
        toolCalls: payload.toolCalls || payload.tool_calls,
        attachments: payload.attachments,
      }
      
      console.log('[agent-message] Adding message:', validMessage)
      setMessages(prev => [...prev, validMessage])
      setStatus({ text: 'Connected', type: 'connected' })
      setIsConnected(true)

      // Track agent busy state based on message role
      if (validMessage.role === 'computer' || validMessage.role === 'tool' || validMessage.role === 'assistant') {
        setIsAgentBusy(true)
      } else if (validMessage.role === 'system') {
        const lc = validMessage.content.toLowerCase()
        if (lc.includes('aborted') || lc.includes('waiting for new messages')) {
          setIsAgentBusy(false)
        }
      }
    })

    const unlistenStatus = listen<string>('agent-status', (event) => {
      const content = event.payload
      const lowerContent = content.toLowerCase()

      // Check connection status
      if (lowerContent.includes('connected') && !lowerContent.includes('disconnected')) {
        setIsConnected(true)
      } else if (lowerContent.includes('disconnected')) {
        setIsConnected(false)
        setIsAgentBusy(false)
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
      setIsAgentBusy(false)
    })

    // Listen for pending messages queue updates
    const unlistenPending = listen<Array<{id: string; content: string; timestamp: string}>>('pending-messages', (event) => {
      console.log('[pending-messages] Updated:', event.payload)
      setPendingMessages(event.payload || [])
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
      unlistenPending.then(fn => fn())
    }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, pendingMessages])

  return (
    <div id="app" data-theme={theme} onContextMenu={handleContextMenu}>
      <div id="titlebar" data-tauri-drag-region>
        <span className="title">Jarvis</span>
      </div>

      <div id="messages" ref={messagesRef}>
        {messages.map((msg, i) => (
          <MessageItem key={i} msg={msg} />
        ))}
      </div>

      {/* Pending Messages Queue */}
      {pendingMessages.length > 0 && (
        <div id="pending-queue">
          <div className="pending-header">
            <span className="pending-count">{pendingMessages.length}</span>
            <span className="pending-label">待发送</span>
          </div>
          <div className="pending-list">
            {pendingMessages.map((msg) => (
              <div key={msg.id} className="pending-item">
                <span className="pending-dot" />
                <span className="pending-content" title={msg.content}>
                  {msg.content}
                </span>
                <span className="pending-time">{msg.timestamp}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div id="input-area">
        <LiquidGlassInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={sendMessage}
          placeholder={isConnected ? "Type a message..." : "Disconnected"}
          disabled={false}
          isConnected={isConnected}
          onStop={isConnected && isAgentBusy ? stopAgent : undefined}
        />
      </div>


    </div>
  )
}

export default App
