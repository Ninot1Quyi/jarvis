import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
    };
  }
}

export default function TitleBar() {
  const location = useLocation();
  const [isMaximized, setIsMaximized] = useState(false);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  if (isMac) {
    return null;
  }

  const pageLabel = location.pathname.startsWith('/thread/')
    ? 'Conversation'
    : location.pathname === '/settings'
    ? 'Settings'
    : location.pathname === '/skills'
    ? 'Skills'
    : location.pathname === '/memory'
    ? 'Memory'
    : location.pathname === '/todos'
    ? 'Todos'
    : location.pathname === '/evolve'
    ? 'Evolve'
    : 'Home';

  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.minimize();
    }
  };

  const handleMaximize = async () => {
    if (window.electronAPI) {
      window.electronAPI.maximize();
      const max = await window.electronAPI.isMaximized();
      setIsMaximized(max);
    }
  };

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.close();
    }
  };

  return (
    <div
      className="flex items-center justify-between h-9 shrink-0 select-none px-3"
      style={{
        backgroundColor: 'var(--color-token-bg-primary)',
        borderBottom: '1px solid var(--color-token-border)',
        WebkitAppRegion: 'drag' as React.CSSProperties['webkitAppRegion'],
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' as React.CSSProperties['webkitAppRegion'] }}
        >
          <button
            onClick={handleClose}
            className="w-3 h-3 rounded-full transition-opacity hover:opacity-100"
            style={{
              backgroundColor: '#ff5f57',
              opacity: 0.8,
            }}
            title="Close"
          />
          <button
            onClick={handleMinimize}
            className="w-3 h-3 rounded-full transition-opacity hover:opacity-100"
            style={{
              backgroundColor: '#febc2e',
              opacity: 0.8,
            }}
            title="Minimize"
          />
          <button
            onClick={handleMaximize}
            className="w-3 h-3 rounded-full transition-opacity hover:opacity-100"
            style={{
              backgroundColor: '#28c840',
              opacity: 0.8,
            }}
            title={isMaximized ? 'Restore' : 'Maximize'}
          />
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <span
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-token-text-primary)',
              fontWeight: 600,
            }}
          >
            dum-e
          </span>
          <span
            className="truncate"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-token-text-tertiary)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {pageLabel}
          </span>
        </div>
      </div>

      <div className="flex-1" />

      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' as React.CSSProperties['webkitAppRegion'] }}
      >
        <span
          style={{
            color: 'var(--color-token-text-tertiary)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {isMaximized ? 'Full Screen' : ''}
        </span>
      </div>
    </div>
  );
}
