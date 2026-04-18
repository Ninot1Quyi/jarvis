import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface SettingSurfaceProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export default function SettingSurface({
  title,
  description,
  children,
  collapsible = false,
  defaultCollapsed = false,
}: SettingSurfaceProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'var(--color-token-bg-primary)',
        border: '1px solid var(--color-token-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {(title || description) && (
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-token-border)' }}
        >
          <div className="flex flex-col gap-0.5">
            {title && (
              <h3
                style={{
                  color: 'var(--color-token-text-primary)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 600,
                }}
              >
                {title}
              </h3>
            )}
            {description && (
              <span
                style={{
                  color: 'var(--color-token-text-tertiary)',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 1.5,
                }}
              >
                {description}
              </span>
            )}
          </div>
          {collapsible && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="flex items-center justify-center w-6 h-6 rounded-md transition-transform cursor-pointer"
              style={{ color: 'var(--color-token-text-tertiary)' }}
            >
              <ChevronRight
                size={16}
                style={{
                  transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                  transition: 'transform 0.2s',
                }}
              />
            </button>
          )}
        </div>
      )}
      {!collapsed && <div className="divide-y divide-[var(--color-token-border)]">{children}</div>}
    </div>
  );
}
