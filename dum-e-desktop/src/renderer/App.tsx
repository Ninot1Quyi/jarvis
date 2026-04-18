import React, { useState, useCallback, useEffect } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import TitleBar from './components/layout/TitleBar';
import Sidebar from './components/layout/Sidebar';
import Home from './pages/Home';
import Thread from './pages/Thread';
import Settings from './pages/Settings';
import Skills from './pages/Skills';
import Evolve from './pages/Evolve';
import Memory from './pages/Memory';
import Todos from './pages/Todos';
import type { Thread as ThreadType } from './lib/types';
import {
  THREADS_CHANGED_EVENT,
  applyTheme,
  loadDesktopPreferences,
  loadThreadsList,
} from './lib/storage';
import './styles/global.css';

applyTheme(loadDesktopPreferences().theme);

const queryClient = new QueryClient();
const MAC_PANEL_RADIUS = 16;

// Persistent layout wrapper - sidebar stays visible during all navigation
function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [threads, setThreads] = useState<ThreadType[]>(loadThreadsList);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const isSettingsPage = location.pathname === '/settings';
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    const syncThreads = () => setThreads(loadThreadsList());

    window.addEventListener(THREADS_CHANGED_EVENT, syncThreads);

    return () => {
      window.removeEventListener(THREADS_CHANGED_EVENT, syncThreads);
    };
  }, []);

  const handleSelectThread = useCallback((id: string) => {
    navigate(`/thread/${id}`);
  }, [navigate]);

  const handleOpenSearch = useCallback(() => {
    setSearchQuery('');
    setSearchOpen(true);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  const visibleSearchThreads = searchQuery.trim().length === 0
    ? threads.slice(0, 12)
    : threads.filter((thread) =>
        (thread.title || 'New Thread').toLowerCase().includes(searchQuery.trim().toLowerCase())
      );

  useEffect(() => {
    if (!searchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ backgroundColor: isSettingsPage ? 'var(--color-token-bg-secondary)' : 'var(--color-token-bg-primary)' }}
    >
      {!isMac && <TitleBar />}
      <div
        className="flex flex-1 overflow-hidden"
        style={{ backgroundColor: isSettingsPage ? 'var(--color-token-bg-secondary)' : 'var(--color-token-bg-primary)' }}
      >
        {!isSettingsPage && (
          <div
            className="flex flex-col shrink-0 h-full min-h-0"
            style={{ backgroundColor: 'var(--color-token-bg-primary)' }}
          >
            <Sidebar
              threads={threads}
              onSelectThread={handleSelectThread}
              onOpenSearch={handleOpenSearch}
              activeThreadId={location.pathname.startsWith('/thread/') ? location.pathname.split('/')[2] : undefined}
            />
          </div>
        )}
        <div
          className="flex flex-col flex-1 min-w-0 h-full min-h-0 relative"
          style={{
            backgroundColor: isSettingsPage ? 'var(--color-token-bg-primary)' : 'var(--color-token-bg-secondary)',
            overflow: 'hidden',
            ...(isSettingsPage
              ? {}
              : {
                  borderTopLeftRadius: MAC_PANEL_RADIUS,
                  borderBottomLeftRadius: MAC_PANEL_RADIUS,
                  boxShadow: `inset 1px 0 0 var(--color-token-border)`,
                }),
          }}
        >
          <main
            className="flex-1 overflow-hidden min-h-0"
            style={{
              backgroundColor: 'var(--color-token-bg-secondary)',
            }}
          >
            {children}
          </main>
          {!isSettingsPage && searchOpen && (
            <div
              className="absolute inset-0 flex items-start justify-center pt-18 px-8"
              style={{ backgroundColor: 'rgba(0,0,0,0.16)' }}
              onClick={handleCloseSearch}
            >
              <div
                className="w-full max-w-[460px] rounded-2xl overflow-hidden"
                style={{
                  backgroundColor: 'var(--color-token-bg-fog)',
                  border: '1px solid var(--color-token-border)',
                  boxShadow: 'var(--shadow-lg)',
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-token-border)' }}>
                  <div className="flex items-center gap-2">
                    <Search size={14} style={{ color: 'var(--color-token-text-tertiary)' }} />
                    <input
                      autoFocus
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search conversations"
                      className="w-full bg-transparent outline-none"
                      style={{
                        color: 'var(--color-token-text-primary)',
                        fontSize: 'var(--text-sm)',
                      }}
                    />
                  </div>
                </div>
                <div className="px-3 py-2">
                  <div
                    className="px-2 py-1"
                    style={{
                      color: 'var(--color-token-text-tertiary)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 500,
                    }}
                  >
                    Recent conversations
                  </div>
                  <div className="max-h-[360px] overflow-y-auto">
                    {visibleSearchThreads.length > 0 ? (
                      visibleSearchThreads.map((thread, index) => (
                        <button
                          key={thread.id}
                          onClick={() => {
                            handleSelectThread(thread.id);
                            handleCloseSearch();
                          }}
                          className="w-full text-left rounded-lg px-3 py-2 transition-colors cursor-pointer"
                          style={{
                            borderTop: index === 0 ? 'none' : '1px solid var(--color-token-border)',
                            color: 'var(--color-token-text-primary)',
                          }}
                          onMouseEnter={(event) => {
                            event.currentTarget.style.backgroundColor = 'var(--color-token-list-hover-background)';
                          }}
                          onMouseLeave={(event) => {
                            event.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          <div className="truncate" style={{ fontSize: 'var(--text-sm)', marginBottom: 4 }}>
                            {thread.title || 'New Thread'}
                          </div>
                          <div
                            style={{
                              color: 'var(--color-token-text-tertiary)',
                              fontSize: 'var(--text-xs)',
                            }}
                          >
                            {new Date(thread.updatedAt).toLocaleString()}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div
                        className="px-3 py-4"
                        style={{
                          color: 'var(--color-token-text-tertiary)',
                          fontSize: 'var(--text-sm)',
                        }}
                      >
                        No conversations found
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/thread/:threadId" element={<Thread />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/evolve" element={<Evolve />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/todos" element={<Todos />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </QueryClientProvider>
  );
}
