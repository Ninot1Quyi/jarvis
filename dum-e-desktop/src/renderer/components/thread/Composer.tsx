import React, { useState, useRef, useEffect, useCallback, KeyboardEvent, ChangeEvent } from 'react';
import {
  Mic,
  Paperclip,
  CheckSquare,
  ChevronDown,
  ArrowRight,
  Square,
} from 'lucide-react';
import type { ModelConfig } from '../../lib/types';

interface ComposerProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isRunning?: boolean;
  currentModel?: string;
  availableModels?: ModelConfig[];
  onModelChange?: (modelId: string) => void;
}

function useAutoResize(ref: React.RefObject<HTMLTextAreaElement | null>) {
  const adjust = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }, [ref]);

  useEffect(() => {
    adjust();
  });
}

export default function Composer({
  onSend,
  onStop,
  disabled = false,
  isRunning = false,
  currentModel = 'default',
  availableModels = [],
  onModelChange,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [showModelSelector, setShowModelSelector] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);

  useAutoResize(textareaRef);

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close model selector on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setShowModelSelector(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const currentModelConfig = availableModels.find((m) => m.id === currentModel);

  return (
    <div className="flex flex-col">
      {/* Outer container */}
      <div className="rounded-3xl border border-[var(--color-token-input-border)] bg-[var(--color-token-input-background)] overflow-hidden">
        {/* Textarea */}
        <div className="p-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Waiting for response...' : 'Message dum-e...'}
            disabled={disabled}
            className="w-full rounded-xl p-3 resize-none min-h-[56px] max-h-[300px] bg-transparent text-[var(--color-token-text-primary)] placeholder-[var(--color-token-text-tertiary)] text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed leading-relaxed"
            rows={1}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 pb-2">
          {/* Left side: voice, attach, todos */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-2 rounded-full text-[var(--color-token-text-tertiary)] hover:text-[var(--color-token-text-secondary)] hover:bg-[var(--color-token-bg-tertiary)] transition-colors"
              aria-label="Voice input"
              title="Voice input"
            >
              <Mic size={16} />
            </button>
            <button
              type="button"
              className="p-2 rounded-full text-[var(--color-token-text-tertiary)] hover:text-[var(--color-token-text-secondary)] hover:bg-[var(--color-token-bg-tertiary)] transition-colors"
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip size={16} />
            </button>
            <button
              type="button"
              className="p-2 rounded-full text-[var(--color-token-text-tertiary)] hover:text-[var(--color-token-text-secondary)] hover:bg-[var(--color-token-bg-tertiary)] transition-colors"
              aria-label="Todos"
              title="Todos"
            >
              <CheckSquare size={16} />
            </button>
          </div>

          {/* Right side: model selector + send/stop */}
          <div className="flex items-center gap-2">
            {/* Model selector */}
            {availableModels.length > 0 && (
              <div className="relative" ref={modelSelectorRef}>
                <button
                  type="button"
                  onClick={() => setShowModelSelector((v) => !v)}
                  className="flex items-center gap-1 text-xs text-[var(--color-token-text-tertiary)] hover:text-[var(--color-token-text-secondary)] px-2 py-1 rounded-md hover:bg-[var(--color-token-bg-tertiary)] transition-colors"
                >
                  <span className="max-w-[120px] truncate">
                    {currentModelConfig?.name ?? currentModel}
                  </span>
                  <ChevronDown size={12} />
                </button>

                {showModelSelector && (
                  <div className="absolute bottom-full mb-2 right-0 w-64 bg-[var(--color-token-bg-secondary)] border border-[var(--color-token-border)] rounded-lg shadow-lg overflow-hidden z-50">
                    <div className="p-2 text-xs text-[var(--color-token-text-tertiary)] uppercase tracking-wide px-3 py-2 border-b border-[var(--color-token-border)]">
                      Select Model
                    </div>
                    {availableModels.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          onModelChange?.(model.id);
                          setShowModelSelector(false);
                        }}
                        className={`w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--color-token-bg-tertiary)] transition-colors ${
                          model.id === currentModel ? 'bg-[var(--color-token-bg-fog)]' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <span className={`w-2 h-2 rounded-full ${model.id === currentModel ? 'bg-[var(--color-token-button-background)]' : 'bg-transparent border border-[var(--color-token-text-tertiary)]'}`} />
                          <span className="text-sm text-[var(--color-token-text-primary)] truncate">
                            {model.name}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--color-token-text-tertiary)] pl-4">
                          {model.provider} / {model.model}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Send or Stop button */}
            {isRunning ? (
              <button
                type="button"
                onClick={onStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-token-danger)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
                aria-label="Stop"
              >
                <Square size={14} />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!text.trim() || disabled}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-token-button-background)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                <ArrowRight size={14} />
                Send
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
