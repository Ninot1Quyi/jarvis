import React, { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot } from 'lucide-react';
import type { Message, ToolCall } from '../../lib/types';
import { getShikiHighlighter } from '../../lib/shiki';
import ToolCallRow from './ToolCall';

interface MessageProps {
  message: Message;
  onToolCallRerun?: (toolCall: ToolCall) => void;
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

// Code block with shiki syntax highlighting and copy button
function CodeBlock({ code, language = 'plaintext' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  useEffect(() => {
    getShikiHighlighter().then((highlighter) => {
      const lang = ['javascript', 'typescript', 'tsx', 'jsx', 'rust', 'go', 'python',
        'json', 'bash', 'shell', 'markdown', 'css', 'html', 'yaml', 'sql', 'docker']
        .includes(language) ? language : 'plaintext';
      try {
        const html = highlighter.codeToHtml(code, { lang, theme: 'github-dark' });
        setHighlightedHtml(html);
      } catch {
        setHighlightedHtml(null);
      }
    });
  }, [code, language]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (highlightedHtml) {
    return (
      <div className="relative group my-2 rounded-md overflow-hidden border border-[var(--color-token-border)]">
        <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--color-token-bg-tertiary)] border-b border-[var(--color-token-border)]">
          <span className="text-xs text-[var(--color-token-text-tertiary)]">{language}</span>
          <button
            onClick={handleCopy}
            className="text-xs text-[var(--color-token-text-tertiary)] hover:text-[var(--color-token-text-primary)] transition-colors"
            aria-label="Copy code"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div
          className="shiki github-dark"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </div>
    );
  }

  return (
    <div className="relative group my-2 rounded-md overflow-hidden border border-[var(--color-token-border)]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--color-token-bg-tertiary)] border-b border-[var(--color-token-border)]">
        <span className="text-xs text-[var(--color-token-text-tertiary)]">{language}</span>
        <button
          onClick={handleCopy}
          className="text-xs text-[var(--color-token-text-tertiary)] hover:text-[var(--color-token-text-primary)] transition-colors"
          aria-label="Copy code"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-sm bg-[var(--color-token-bg-primary)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// Extract thinking block from content (delimited by <thinking>...</thinking> or :::thinking ... :::)
function extractThinking(content: string): { thinking: string; content: string } {
  // Try XML-style first
  const xmlMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (xmlMatch) {
    return {
      thinking: xmlMatch[1].trim(),
      content: content.replace(xmlMatch[0], '').trim(),
    };
  }
  return { thinking: '', content };
}

// Custom renderer for markdown content
function MarkdownContent({ content }: { content: string }) {
  const { thinking, content: mainContent } = useMemo(() => extractThinking(content), [content]);
  const [showThinking, setShowThinking] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      {thinking && (
        <div>
          <button
            onClick={() => setShowThinking((v) => !v)}
            className="text-xs text-[var(--color-token-text-tertiary)] hover:text-[var(--color-token-text-secondary)] transition-colors flex items-center gap-1 mb-1"
          >
            <span>{showThinking ? '▼' : '▶'}</span>
            <span>{showThinking ? 'Hide' : 'Show'} Reasoning
            </span>
          </button>
          {showThinking && (
            <div className="pl-3 text-sm text-[var(--color-token-text-tertiary)] border-l-2 border-[var(--color-token-border)] py-1 italic">
              {thinking}
            </div>
          )}
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const code = String(children).replace(/\n$/, '');
            if (match) {
              return <CodeBlock code={code} language={match[1]} />;
            }
            return (
              <code className="px-1 py-0.5 rounded bg-[var(--color-token-bg-tertiary)] text-sm font-mono" {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-token-link)] hover:underline"
              >
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2">
                <table className="min-w-full text-sm border border-[var(--color-token-border)] rounded-md">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="px-3 py-1.5 text-left bg-[var(--color-token-bg-tertiary)] border-b border-[var(--color-token-border)] text-[var(--color-token-text-secondary)] font-medium">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-3 py-1.5 border-b border-[var(--color-token-border-light)]">
                {children}
              </td>
            );
          },
        }}
      >
        {mainContent}
      </ReactMarkdown>
    </div>
  );
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageComponent({ message, onToolCallRerun }: MessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isTool = message.role === 'tool';

  if (isTool) {
    return (
      <div className="flex gap-3 py-3">
        <div className="flex-shrink-0 mt-1">
          <div className="w-6 h-6 rounded-full bg-[var(--color-token-bg-tertiary)] flex items-center justify-center">
            <Bot size={14} className="text-[var(--color-token-warning)]" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-[var(--color-token-text-secondary)]">Tool Result</span>
            <span className="text-xs text-[var(--color-token-text-tertiary)]">{formatTimestamp(message.timestamp)}</span>
          </div>
          <div className="border-l-2 border-[var(--color-token-warning)] bg-[var(--color-token-bg-tertiary)] rounded-md p-3">
            <MarkdownContent content={message.content} />
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex gap-3 py-3">
        <div className="flex-shrink-0 mt-1">
          <div className="w-6 h-6 rounded-full bg-[var(--color-token-bg-fog)] flex items-center justify-center">
            <User size={14} className="text-[var(--color-token-text-secondary)]" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-[var(--color-token-text-secondary)]">You</span>
            <span className="text-xs text-[var(--color-token-text-tertiary)]">{formatTimestamp(message.timestamp)}</span>
          </div>
          <div className="bg-[var(--color-token-bg-fog)] rounded-lg p-3 max-w-[80%]">
            <div className="text-sm text-[var(--color-token-text-primary)] whitespace-pre-wrap">
              {message.content}
            </div>
          </div>
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {message.toolCalls.map((tc) => (
                <ToolCallRow
                  key={tc.id}
                  toolCall={tc}
                  onRerun={onToolCallRerun}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isAssistant) {
    return (
      <div className="flex gap-3 py-3">
        <div className="flex-shrink-0 mt-1">
          <div className="w-6 h-6 rounded-full bg-[var(--color-token-button-background)] flex items-center justify-center">
            <Bot size={14} className="text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-[var(--color-token-text-secondary)]">dum-e</span>
            <span className="text-xs text-[var(--color-token-text-tertiary)]">{formatTimestamp(message.timestamp)}</span>
          </div>
          <div className="text-sm text-[var(--color-token-text-primary)]">
            <MarkdownContent content={message.content} />
          </div>
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {message.toolCalls.map((tc) => (
                <ToolCallRow
                  key={tc.id}
                  toolCall={tc}
                  onRerun={onToolCallRerun}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
