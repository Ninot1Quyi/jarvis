import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, RotateCcw, Loader2 } from 'lucide-react';
import type { ToolCall } from '../../lib/types';

interface ToolCallProps {
  toolCall: ToolCall;
  onRerun?: (toolCall: ToolCall) => void;
}

const STATE_COLORS: Record<ToolCall['state'], string> = {
  pending: 'border-[var(--color-token-text-tertiary)]',
  running: 'border-[var(--color-token-warning)]',
  complete: 'border-[var(--color-token-success)]',
  error: 'border-[var(--color-token-danger)]',
};

const STATE_DOT_COLORS: Record<ToolCall['state'], string> = {
  pending: 'bg-[var(--color-token-text-tertiary)]',
  running: 'bg-[var(--color-token-warning)]',
  complete: 'bg-[var(--color-token-success)]',
  error: 'bg-[var(--color-token-danger)]',
};

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export default function ToolCallRow({ toolCall, onRerun }: ToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const isRunning = toolCall.state === 'running';

  const handleCopy = () => {
    const text = `Input: ${formatJson(toolCall.input)}\nOutput: ${toolCall.output ?? 'N/A'}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inputPreview = truncate(formatJson(toolCall.input), 80);

  return (
    <div
      className={`border-l-2 ${STATE_COLORS[toolCall.state]} bg-[var(--color-token-bg-secondary)] rounded-r-md overflow-hidden`}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-token-bg-tertiary)] transition-colors"
      >
        <span className="text-[var(--color-token-text-tertiary)]">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        {isRunning && (
          <span className={`w-2 h-2 rounded-full ${STATE_DOT_COLORS[toolCall.state]} animate-pulse`} />
        )}
        <span className="text-sm font-mono font-medium text-[var(--color-token-text-primary)]">
          {toolCall.name}
        </span>
        <span className="text-xs text-[var(--color-token-text-tertiary)] truncate flex-1">
          {inputPreview}
        </span>
        <span className="text-xs capitalize text-[var(--color-token-text-tertiary)]">
          {toolCall.state}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Input section */}
          <div>
            <div className="text-xs font-medium text-[var(--color-token-text-tertiary)] mb-1 uppercase tracking-wide">
              Input
            </div>
            <div className="bg-[var(--color-token-bg-primary)] rounded-md p-3 text-xs font-mono text-[var(--color-token-text-secondary)] overflow-x-auto whitespace-pre">
              {formatJson(toolCall.input)}
            </div>
          </div>

          {/* Output section */}
          {toolCall.output !== undefined && (
            <div>
              <div className="text-xs font-medium text-[var(--color-token-text-tertiary)] mb-1 uppercase tracking-wide">
                Output
              </div>
              <div className="bg-[var(--color-token-bg-primary)] rounded-md p-3 text-xs font-mono text-[var(--color-token-text-secondary)] overflow-x-auto whitespace-pre max-h-[300px]">
                {toolCall.output}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-[var(--color-token-text-tertiary)] hover:text-[var(--color-token-text-secondary)] transition-colors px-2 py-1 rounded hover:bg-[var(--color-token-bg-tertiary)]"
            >
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy'}
            </button>
            {onRerun && (
              <button
                onClick={() => onRerun(toolCall)}
                className="flex items-center gap-1 text-xs text-[var(--color-token-text-tertiary)] hover:text-[var(--color-token-text-secondary)] transition-colors px-2 py-1 rounded hover:bg-[var(--color-token-bg-tertiary)]"
              >
                <RotateCcw size={12} />
                Re-run
              </button>
            )}
            {isRunning && (
              <div className="flex items-center gap-1 text-xs text-[var(--color-token-warning)]">
                <Loader2 size={12} className="animate-spin" />
                Running...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
