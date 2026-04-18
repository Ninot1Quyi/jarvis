import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface ToolbarProps {
  title?: string;
  onBack?: () => void;
  rightContent?: React.ReactNode;
}

export default function Toolbar({ title, onBack, rightContent }: ToolbarProps) {
  return (
    <div
      className="h-[56px] flex items-center justify-between px-4 shrink-0"
      style={{
        backgroundColor: 'var(--color-token-bg-secondary)',
        borderBottom: '1px solid var(--color-token-border)',
      }}
    >
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 rounded-md transition-colors cursor-pointer"
            style={{
              color: 'var(--color-token-text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-token-toolbar-hover-background)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        {title && (
          <span
            style={{
              color: 'var(--color-token-text-primary)',
              fontSize: 'var(--text-base)',
              fontWeight: 500,
            }}
          >
            {title}
          </span>
        )}
      </div>
      {rightContent && <div className="flex items-center gap-2">{rightContent}</div>}
    </div>
  );
}
