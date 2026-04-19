import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, MoreHorizontal, Trash2, Search, Plus, Blocks, Clock3 } from 'lucide-react';
import type { Thread } from '../../lib/types';
import {
  PREFERENCES_CHANGED_EVENT,
  loadDesktopPreferences,
  saveDesktopPreferences,
} from '../../lib/storage';

interface SidebarProps {
  threads: Thread[];
  onSelectThread: (id: string) => void;
  onOpenSearch: () => void;
  activeThreadId?: string;
  onResizeIntentChange?: (active: boolean) => void;
}

export default function Sidebar({
  threads,
  onSelectThread,
  onOpenSearch,
  activeThreadId,
  onResizeIntentChange,
}: SidebarProps) {
  const SIDEBAR_SAFE_TOP = 38;
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState(loadDesktopPreferences);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadDesktopPreferences().settingsNavWidth);
  const sidebarRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const syncPreferences = () => {
      const next = loadDesktopPreferences();
      setPreferences(next);
      setSidebarWidth(next.settingsNavWidth);
    };

    window.addEventListener(PREFERENCES_CHANGED_EVENT, syncPreferences);
    return () => window.removeEventListener(PREFERENCES_CHANGED_EVENT, syncPreferences);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    onResizeIntentChange?.(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let latestWidth = startWidth;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(180, Math.min(400, startWidth + delta));
      latestWidth = newWidth;
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      onResizeIntentChange?.(false);
      saveDesktopPreferences({
        ...preferences,
        settingsNavWidth: latestWidth,
      });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [onResizeIntentChange, preferences, sidebarWidth]);

  const visibleThreads = threads;

  return (
    <div
      ref={sidebarRef}
      className="flex flex-col shrink-0 relative flex-1 min-h-0"
      style={{
        width: sidebarWidth,
        backgroundColor: 'color-mix(in srgb, var(--color-token-bg-primary) 46%, transparent)',
        backdropFilter: 'blur(18px) saturate(1.45)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.45)',
        borderRight: '1px solid color-mix(in srgb, var(--color-token-border) 72%, transparent)',
        cursor: isResizing ? 'col-resize' : 'default',
        userSelect: isResizing ? 'none' : 'auto',
      }}
    >
      <div
        className="px-2 shrink-0"
        style={{
          paddingTop: SIDEBAR_SAFE_TOP,
          paddingBottom: 12,
        }}
      >
        <SidebarAction icon={<Plus size={14} />} label="New Chat" onClick={() => navigate('/')} />
        <SidebarAction icon={<Search size={14} />} label="Search" onClick={onOpenSearch} />
        <SidebarAction icon={<Blocks size={14} />} label="Plugins" />
        <SidebarAction icon={<Clock3 size={14} />} label="Automations" />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hidden">
        {visibleThreads.length > 0 ? (
          <ThreadList
            threads={visibleThreads}
            activeThreadId={activeThreadId}
            onSelectThread={onSelectThread}
          />
        ) : (
          <div className="px-4 py-8 text-center">
            <p style={{ color: 'var(--color-token-text-tertiary)', fontSize: 'var(--text-sm)' }}>
              No conversations yet
            </p>
          </div>
        )}
      </div>

      <div className="px-2 py-2 shrink-0">
        <button
          onClick={() => navigate('/settings')}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors cursor-pointer"
          style={{ color: 'var(--color-token-text-secondary)', fontSize: 'var(--text-sm)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-token-list-hover-background)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <Settings size={14} />
          <span className="truncate">Settings</span>
        </button>
      </div>

      <div
        onMouseDown={handleMouseDown}
        onMouseEnter={() => onResizeIntentChange?.(true)}
        onMouseLeave={() => {
          if (!isResizing) onResizeIntentChange?.(false);
        }}
        className="absolute top-0 right-[-3px] w-[7px] h-full cursor-col-resize"
        style={{ backgroundColor: 'transparent' }}
      />
    </div>
  );
}

function SidebarAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors cursor-pointer text-left no-drag"
      style={{
        color: 'var(--color-token-text-secondary)',
        fontSize: 'var(--text-sm)',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.backgroundColor = 'var(--color-token-list-hover-background)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ThreadList({
  threads,
  activeThreadId,
  onSelectThread,
}: {
  threads: Thread[];
  activeThreadId?: string;
  onSelectThread: (id: string) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  return (
    <div className="px-2">
      {threads.map((thread) => (
        <div
          key={thread.id}
          className="relative group rounded-md transition-colors"
          style={{
            backgroundColor: activeThreadId === thread.id
              ? 'var(--color-token-list-active-selection-background)'
              : 'transparent',
          }}
          onMouseEnter={(e) => {
            if (activeThreadId !== thread.id) {
              e.currentTarget.style.backgroundColor = 'var(--color-token-list-hover-background)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeThreadId !== thread.id) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <div
            onClick={() => onSelectThread(thread.id)}
            className="w-full flex items-center justify-between px-3 py-2 cursor-pointer text-left"
            style={{
              color: activeThreadId === thread.id
                ? 'var(--color-token-list-active-selection-foreground)'
                : 'var(--color-token-text-primary)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{thread.title || 'New Thread'}</div>
              <div
                className="truncate mt-0.5"
                style={{
                  color: activeThreadId === thread.id
                    ? 'rgba(255,255,255,0.7)'
                    : 'var(--color-token-text-tertiary)',
                  fontSize: 'var(--text-xs)',
                }}
              >
                {formatRelativeThreadTime(thread.updatedAt)}
              </div>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenuId(openMenuId === thread.id ? null : thread.id);
            }}
            className="absolute right-2 top-2 flex items-center justify-center w-5 h-5 rounded shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-token-text-tertiary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-token-bg-tertiary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <MoreHorizontal size={12} />
          </button>
          {openMenuId === thread.id && (
            <div
              className="absolute right-1 top-full z-50 rounded-md shadow-md py-1 min-w-[120px]"
              style={{
                backgroundColor: 'var(--color-token-bg-fog)',
                border: '1px solid var(--color-token-border)',
              }}
            >
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer"
                style={{ color: 'var(--color-token-danger)', fontSize: 'var(--text-sm)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-token-list-hover-background)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onClick={() => setOpenMenuId(null)}
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatRelativeThreadTime(updatedAt: number): string {
  const deltaMs = Date.now() - updatedAt;
  const deltaMin = Math.floor(deltaMs / 60000);
  if (deltaMin < 1) return 'Just now';
  if (deltaMin < 60) return `${deltaMin} min ago`;
  const deltaHours = Math.floor(deltaMin / 60);
  if (deltaHours < 24) return `${deltaHours} hr ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays} day${deltaDays === 1 ? '' : 's'} ago`;
}
