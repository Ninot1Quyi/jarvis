import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Blocks, Mail, Sparkles } from 'lucide-react';
import {
  MODELS_CHANGED_EVENT,
  createThreadDraft,
  loadActiveModelId,
  loadModelConfigs,
  persistThread,
  saveActiveModelId,
} from '../lib/storage';
import Composer from '../components/thread/Composer';
import type { Message, ModelConfig } from '../lib/types';

export default function Home() {
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelConfig[]>(loadModelConfigs);
  const [activeModelId, setActiveModelId] = useState(loadActiveModelId);
  const [isLaunching, setIsLaunching] = useState(false);
  const launchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const syncModels = () => {
      setModels(loadModelConfigs());
      setActiveModelId(loadActiveModelId());
    };
    window.addEventListener(MODELS_CHANGED_EVENT, syncModels);
    return () => {
      window.removeEventListener(MODELS_CHANGED_EVENT, syncModels);
    };
  }, []);

  const suggestionPrompts = useMemo(
    () => [
      'Build a classic Snake game in this repo.',
      'Create a one-page PDF that summarizes this app.',
      'Create a plan to improve this desktop shell.',
    ],
    []
  );

  const footerActions = useMemo(
    () => [
      { icon: <Mail size={14} />, label: 'Connect Gmail' },
      { icon: <Blocks size={14} />, label: 'Connect Slack' },
      { icon: <Sparkles size={14} />, label: 'Connect your apps to dum-e' },
    ],
    []
  );

  useEffect(() => {
    return () => {
      if (launchTimerRef.current != null) {
        window.clearTimeout(launchTimerRef.current);
      }
    };
  }, []);

  const createThreadAndNavigate = (prompt?: string) => {
    const thread = createThreadDraft();
    if (prompt && prompt.trim().length > 0) {
      const initialMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      thread.messages = [initialMessage];
      thread.updatedAt = Date.now();
    }
    persistThread(thread);
    navigate(`/thread/${thread.id}`);
  };

  const handleLaunchFromHome = (prompt?: string) => {
    if (isLaunching) return;
    setIsLaunching(true);
    launchTimerRef.current = window.setTimeout(() => {
      createThreadAndNavigate(prompt);
    }, 320);
  };

  return (
    <div
      className="h-full overflow-hidden"
      style={{ backgroundColor: 'var(--color-token-bg-secondary)' }}
    >
      <div className="draggable h-11 flex items-center px-4">
        <div
          style={{
            color: 'var(--color-token-text-primary)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
          }}
        >
          New Chat
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          className="absolute left-1/2 w-full max-w-4xl px-8 transition-all duration-300 ease-in-out"
          style={{
            top: isLaunching ? 'calc(100% - 184px)' : '46%',
            transform: isLaunching ? 'translate(-50%, 0)' : 'translate(-50%, -50%)',
          }}
        >
          <div className="max-w-3xl mx-auto">
            <div
              className="transition-all duration-200"
              style={{
                opacity: isLaunching ? 0 : 1,
                transform: isLaunching ? 'translateY(12px)' : 'translateY(0)',
                marginBottom: isLaunching ? 12 : 28,
              }}
            >
              <div
                style={{
                  color: 'var(--color-token-text-primary)',
                  fontSize: '42px',
                  fontWeight: 600,
                  lineHeight: 1.16,
                  textAlign: 'center',
                  marginBottom: 20,
                }}
              >
                What should we build in dum-e?
              </div>
            </div>

            <Composer
              onSend={handleLaunchFromHome}
              disabled={isLaunching}
              isRunning={false}
              currentModel={activeModelId}
              availableModels={models}
              onModelChange={(modelId) => {
                setActiveModelId(modelId);
                saveActiveModelId(modelId);
              }}
            />

            <div
              className="transition-all duration-200"
              style={{
                opacity: isLaunching ? 0 : 1,
                transform: isLaunching ? 'translateY(12px)' : 'translateY(0)',
                marginTop: 14,
              }}
            >
              {footerActions.map((item, index) => (
                <button
                  key={item.label}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left transition-colors cursor-pointer no-drag"
                  style={{
                    borderTop: index === 0 ? 'none' : '1px solid var(--color-token-border)',
                    color: 'var(--color-token-text-tertiary)',
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.backgroundColor = 'var(--color-token-list-hover-background)';
                    event.currentTarget.style.color = 'var(--color-token-text-secondary)';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.backgroundColor = 'transparent';
                    event.currentTarget.style.color = 'var(--color-token-text-tertiary)';
                  }}
                >
                  {item.icon}
                  <span style={{ fontSize: 'var(--text-sm)' }}>{item.label}</span>
                </button>
              ))}
            </div>

            <div
              className="transition-all duration-200"
              style={{
                opacity: isLaunching ? 0 : 1,
                transform: isLaunching ? 'translateY(12px)' : 'translateY(0)',
                marginTop: 18,
              }}
            >
              {suggestionPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleLaunchFromHome(prompt)}
                  className="w-full text-left rounded-xl px-4 py-3 transition-colors cursor-pointer no-drag mb-3"
                  style={{
                    backgroundColor: 'var(--color-token-bg-primary)',
                    border: '1px solid var(--color-token-border)',
                    color: 'var(--color-token-text-primary)',
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.backgroundColor = 'var(--color-token-list-hover-background)';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.backgroundColor = 'var(--color-token-bg-primary)';
                  }}
                >
                  <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{prompt}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
