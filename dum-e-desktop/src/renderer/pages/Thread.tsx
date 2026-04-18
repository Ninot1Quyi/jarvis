import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Copy, RotateCcw, Square, Check, Pencil, CheckCheck } from 'lucide-react';
import type { Thread, Message, ToolCall, ModelConfig } from '../lib/types';
import { useDumCommands } from '../lib/events';
import { getShikiHighlighter } from '../lib/shiki';
import {
  MODELS_CHANGED_EVENT,
  ensureThread,
  loadActiveModelId,
  loadModelConfigs,
  persistThread,
  saveActiveModelId,
} from '../lib/storage';
import MessageComponent from '../components/thread/Message';
import Composer from '../components/thread/Composer';

// Initialize shiki highlighter on app start
getShikiHighlighter().catch(console.error);

// ---- Agent status helper ----
type AgentStatus = 'idle' | 'running' | 'error';

function AgentStatusDot({ status }: { status: AgentStatus }) {
  const colorMap: Record<AgentStatus, string> = {
    idle: 'bg-[var(--color-token-success)]',
    running: 'bg-[var(--color-token-warning)] animate-pulse',
    error: 'bg-[var(--color-token-danger)]',
  };
  const labelMap: Record<AgentStatus, string> = {
    idle: 'Idle',
    running: 'Running',
    error: 'Error',
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${colorMap[status]}`} />
      <span className="text-xs text-[var(--color-token-text-tertiary)]">{labelMap[status]}</span>
    </div>
  );
}

// ---- Thread page ----
export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();

  const [thread, setThread] = useState<Thread | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>(loadModelConfigs);
  const [activeModelId, setActiveModelId] = useState<string>(loadActiveModelId());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = useRef(0);

  const { sendMessage, stop, regenerate } = useDumCommands();

  // Load thread from localStorage
  useEffect(() => {
    if (!threadId) return;
    setThread(ensureThread(threadId));
  }, [threadId]);

  // Save thread to localStorage whenever it changes
  useEffect(() => {
    if (!thread) return;
    persistThread({ ...thread, updatedAt: Date.now() });
  }, [thread]);

  useEffect(() => {
    const syncModels = () => {
      const models = loadModelConfigs();
      setAvailableModels(models);
      setActiveModelId((current) => {
        if (models.some((model) => model.id === current)) {
          return current;
        }
        return loadActiveModelId();
      });
    };

    window.addEventListener(MODELS_CHANGED_EVENT, syncModels);
    return () => window.removeEventListener(MODELS_CHANGED_EVENT, syncModels);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!thread) return;
    const prevLen = prevMessagesLengthRef.current;
    const newLen = thread.messages.length;
    if (newLen > prevLen && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
    prevMessagesLengthRef.current = newLen;
  }, [thread?.messages.length]);

  // Subscribe to dum events for local simulation
  useEffect(() => {
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail;
      handleDumEvent(event);
    };
    window.addEventListener('dum-event', handler);
    return () => window.removeEventListener('dum-event', handler);
  }, [thread]);

  const handleDumEvent = useCallback((event: { type: string; [key: string]: unknown }) => {
    if (!thread) return;

    if (event.type === 'AgentStart') {
      setAgentStatus('running');
    } else if (event.type === 'LlmChunk') {
      // Streaming text update — append to last assistant message
      setThread((prev) => {
        if (!prev) return prev;
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          messages[messages.length - 1] = {
            ...lastMsg,
            content: lastMsg.content + (event.text as string),
          };
        } else {
          const newMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: event.text as string,
            timestamp: Date.now(),
          };
          messages.push(newMsg);
        }
        return { ...prev, messages };
      });
    } else if (event.type === 'LlmComplete') {
      const message = event.message as Message;
      setThread((prev) => {
        if (!prev) return prev;
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === message.content) {
          // Streaming message already updated, just update id
          messages[messages.length - 1] = message;
        } else {
          messages.push(message);
        }
        return { ...prev, messages };
      });
    } else if (event.type === 'ToolCall') {
      const toolCall: ToolCall = {
        id: crypto.randomUUID(),
        name: event.tool as string,
        input: event.input as Record<string, unknown>,
        state: 'running',
      };
      setThread((prev) => {
        if (!prev) return prev;
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          messages[messages.length - 1] = {
            ...lastMsg,
            toolCalls: [...(lastMsg.toolCalls ?? []), toolCall],
          };
        }
        return { ...prev, messages };
      });
    } else if (event.type === 'ToolComplete') {
      setThread((prev) => {
        if (!prev) return prev;
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.toolCalls) {
          const toolCalls = lastMsg.toolCalls.map((tc) =>
            tc.name === event.tool
              ? { ...tc, state: 'complete' as const, output: event.result as string }
              : tc
          );
          messages[messages.length - 1] = { ...lastMsg, toolCalls };
        }
        return { ...prev, messages };
      });
    } else if (event.type === 'ToolError') {
      setThread((prev) => {
        if (!prev) return prev;
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.toolCalls) {
          const toolCalls = lastMsg.toolCalls.map((tc) =>
            tc.name === event.tool
              ? { ...tc, state: 'error' as const, output: event.error as string }
              : tc
          );
          messages[messages.length - 1] = { ...lastMsg, toolCalls };
        }
        return { ...prev, messages };
      });
    } else if (event.type === 'AgentComplete') {
      setAgentStatus('idle');
    } else if (event.type === 'AgentError') {
      setAgentStatus('error');
    }
  }, [thread]);

  // ---- Handlers ----
  const handleSend = useCallback((text: string) => {
    if (!thread) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setThread((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: [...prev.messages, userMessage],
        updatedAt: Date.now(),
      };
    });

    // Send via IPC or local fallback
    try {
      sendMessage(text);
      setAgentStatus('running');
    } catch {
      // If IPC not ready, simulate a response for local dev
      setAgentStatus('running');
      // Dispatch a simulated response for local development
      setTimeout(() => {
        const simMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `This is a simulated response to: "${text}"\n\nThe actual dum-e agent will respond via IPC when connected.`,
          timestamp: Date.now(),
        };
        setThread((prev) => {
          if (!prev) return prev;
          return { ...prev, messages: [...prev.messages, simMsg] };
        });
        setAgentStatus('idle');
      }, 500);
    }
  }, [thread, sendMessage]);

  const handleStop = useCallback(() => {
    try {
      stop();
    } catch { /* ignore */ }
    setAgentStatus('idle');
  }, [stop]);

  const handleRegenerate = useCallback(() => {
    if (!thread || thread.messages.length === 0) return;
    try {
      regenerate();
      setAgentStatus('running');
    } catch { /* ignore */ }
  }, [thread, regenerate]);

  const handleTitleSave = () => {
    if (!thread || !titleDraft.trim()) return;
    setThread((prev) => prev ? { ...prev, title: titleDraft.trim() } : prev);
    setEditingTitle(false);
  };

  const handleCopyDeeplink = () => {
    const url = `${window.location.origin}${window.location.pathname}#/thread/${threadId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleModelChange = (modelId: string) => {
    setActiveModelId(modelId);
    saveActiveModelId(modelId);
  };

  // Title editing
  const startEditTitle = () => {
    if (!thread) return;
    setTitleDraft(thread.title);
    setEditingTitle(true);
  };

  if (!thread) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--color-token-text-tertiary)]">Loading thread...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: 'var(--color-token-bg-secondary)' }}>
      {/* Header */}
      <div
        className="draggable flex items-center justify-between px-4 h-11 shrink-0"
        style={{ borderBottom: 'none' }}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {editingTitle ? (
            <div className="flex items-center gap-2 min-w-0">
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSave();
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                onBlur={handleTitleSave}
                className="text-base font-medium bg-transparent outline-none border-b px-1 min-w-[100px] max-w-[300px]"
                style={{
                  color: 'var(--color-token-text-primary)',
                  borderColor: 'var(--color-token-button-background)',
                }}
              />
              <button onClick={handleTitleSave} className="p-1 no-drag" style={{ color: 'var(--color-token-success)' }}>
                <Check size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={startEditTitle}
              className="text-base font-medium truncate max-w-[300px] flex items-center gap-1.5 cursor-pointer no-drag"
              style={{ color: 'var(--color-token-text-primary)' }}
              title="Click to edit title"
            >
              {thread.title}
              <Pencil size={12} style={{ color: 'var(--color-token-text-tertiary)' }} />
            </button>
          )}
          <AgentStatusDot status={agentStatus} />
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {agentStatus === 'running' ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors no-drag"
              style={{ color: 'var(--color-token-danger)', backgroundColor: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-token-bg-fog)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Square size={14} />
              Stop
            </button>
          ) : (
            <>
              <button
                onClick={handleRegenerate}
                disabled={thread.messages.length === 0}
                className="p-2 rounded-md transition-colors disabled:opacity-30 cursor-pointer no-drag"
                style={{ color: 'var(--color-token-text-tertiary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-token-text-primary)'; e.currentTarget.style.backgroundColor = 'var(--color-token-bg-fog)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-token-text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                title="Regenerate last response"
              >
                <RotateCcw size={16} />
              </button>
              <button
                onClick={handleCopyDeeplink}
                className="p-2 rounded-md transition-colors cursor-pointer no-drag"
                style={{ color: 'var(--color-token-text-tertiary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-token-text-primary)'; e.currentTarget.style.backgroundColor = 'var(--color-token-bg-fog)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-token-text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                title="Copy thread link"
              >
                {copiedLink ? <CheckCheck size={16} style={{ color: 'var(--color-token-success)' }} /> : <Copy size={16} />}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto min-h-[calc(100%-56px)] px-4 flex flex-col">
        {/* Message list */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto relative"
        >
        {thread.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center max-w-2xl mx-auto pb-12">
            <div className="w-14 h-14 rounded-full bg-[var(--color-token-bg-tertiary)] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="text-[var(--color-token-button-background)]">
                <path d="M16 4C9.373 4 4 9.373 4 16s5.373 12 12 12 12-5.373 12-12S22.627 4 16 4zm0 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S6 21.523 6 16 10.477 6 16 6z" fill="currentColor" opacity="0.3"/>
                <path d="M16 10v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-medium text-[var(--color-token-text-primary)] mb-1">
                {thread.title}
              </h2>
              <p className="text-sm text-[var(--color-token-text-tertiary)] leading-6">
                Send a message to start the conversation.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto py-4">
            {thread.messages.map((message) => (
              <MessageComponent
                key={message.id}
                message={message}
                onToolCallRerun={(tc) => {
                  // Re-run logic will be implemented with IPC
                  console.log('Rerun tool:', tc);
                }}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
        <div
          className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(30,30,30,0) 0%, var(--color-token-bg-secondary) 100%)',
          }}
        />
        </div>

        <div className="pt-4 pb-4">
          <Composer
            onSend={handleSend}
            onStop={handleStop}
            disabled={false}
            isRunning={agentStatus === 'running'}
            currentModel={activeModelId}
            availableModels={availableModels}
            onModelChange={handleModelChange}
          />
        </div>
      </div>
    </div>
  );
}
