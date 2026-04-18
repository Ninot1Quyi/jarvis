import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import SettingSurface from '../components/ui/SettingSurface';
import SettingRow from '../components/ui/SettingRow';
import Button from '../components/ui/Button';
import Toggle from '../components/ui/Toggle';
import Slider from '../components/ui/Slider';
import Select from '../components/ui/Select';
import Input from '../components/ui/Input';
import Dialog from '../components/ui/Dialog';
import { ArrowLeft, Plus, Pencil, Trash2, Radio } from 'lucide-react';
import type { ModelConfig } from '../lib/types';
import {
  loadActiveModelId,
  loadDesktopPreferences,
  loadModelConfigs,
  saveActiveModelId,
  saveDesktopPreferences,
  saveModelConfigs,
  type DesktopPreferences,
} from '../lib/storage';

type SettingsSection =
  | 'General'
  | 'Model'
  | 'Voice'
  | 'Agent'
  | 'Evolve'
  | 'Skills'
  | 'Memory'
  | 'MCP Servers'
  | 'Tools'
  | 'Connections'
  | 'Appearance'
  | 'Data'
  | 'About';

const SETTINGS_NAV: readonly SettingsSection[] = [
  'General',
  'Model',
  'Voice',
  'Agent',
  'Evolve',
  'Skills',
  'Memory',
  'MCP Servers',
  'Tools',
  'Connections',
  'Appearance',
  'Data',
  'About',
];

const PROVIDER_OPTIONS = [
  { value: 'minimax', label: 'MiniMax' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'custom', label: 'Custom' },
] as const;

const DEFAULT_MODEL_CONFIG: Omit<ModelConfig, 'id'> = {
  name: '',
  provider: 'openai-compatible',
  apiKey: '',
  baseUrl: '',
  model: '',
  temperature: 0.7,
  maxTokens: 4096,
  thinkingBudget: 0,
  streaming: true,
};

export default function Settings() {
  const SIDEBAR_SAFE_TOP = 38;
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState<DesktopPreferences>(loadDesktopPreferences);
  const [activeSection, setActiveSection] = useState<SettingsSection>('General');

  // Model settings
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>(loadModelConfigs);
  const [activeConfigId, setActiveConfigId] = useState(loadActiveModelId);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<Omit<ModelConfig, 'id'>>(DEFAULT_MODEL_CONFIG);

  const [settingsNavWidth, setSettingsNavWidth] = useState(preferences.settingsNavWidth);
  const [isResizingNav, setIsResizingNav] = useState(false);
  const settingsNavRef = useRef<HTMLDivElement>(null);

  const updatePreferences = (patch: Partial<DesktopPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      saveDesktopPreferences(next);
      return next;
    });
  };

  const theme = preferences.theme;

  const handleNavResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingNav(true);
    const startX = e.clientX;
    const startWidth = settingsNavWidth;
    let latestWidth = startWidth;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(160, Math.min(320, startWidth + delta));
      latestWidth = newWidth;
      setSettingsNavWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsResizingNav(false);
      updatePreferences({ settingsNavWidth: latestWidth });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [settingsNavWidth]);

  const openAddModel = () => {
    setEditingConfigId(null);
    setModelForm(DEFAULT_MODEL_CONFIG);
    setModelDialogOpen(true);
  };

  const openEditModel = (config: ModelConfig) => {
    setEditingConfigId(config.id);
    setModelForm({
      name: config.name,
      provider: config.provider,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      thinkingBudget: config.thinkingBudget,
      streaming: config.streaming,
    });
    setModelDialogOpen(true);
  };

  const saveModelConfig = () => {
    let nextConfigs = modelConfigs;
    let nextActiveId = activeConfigId;

    if (editingConfigId) {
      nextConfigs = modelConfigs.map((config) =>
        config.id === editingConfigId ? { ...modelForm, id: editingConfigId } : config
      );
    } else {
      const newConfig: ModelConfig = { ...modelForm, id: crypto.randomUUID() };
      nextConfigs = [...modelConfigs, newConfig];
      nextActiveId = newConfig.id;
      setActiveConfigId(newConfig.id);
    }

    setModelConfigs(nextConfigs);
    saveModelConfigs(nextConfigs);
    saveActiveModelId(nextActiveId);
    setModelDialogOpen(false);
  };

  const deleteModelConfig = (id: string) => {
    const remaining = modelConfigs.filter((config) => config.id !== id);
    setModelConfigs(remaining);
    saveModelConfigs(remaining);
    if (activeConfigId === id) {
      const fallbackId = remaining[0]?.id;
      if (fallbackId) {
        setActiveConfigId(fallbackId);
        saveActiveModelId(fallbackId);
      }
    }
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'General':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="General" description="Basic application settings">
              <SettingRow label="Auto-start agent on launch" description="Start the agent automatically when the app opens">
                <Toggle checked={preferences.autoStartAgent} onCheckedChange={(value) => updatePreferences({ autoStartAgent: value })} />
              </SettingRow>
              <SettingRow label="Always on top" description="Keep the window above other windows">
                <Toggle checked={preferences.alwaysOnTop} onCheckedChange={(value) => updatePreferences({ alwaysOnTop: value })} />
              </SettingRow>
              <SettingRow label="Show in Dock" description="Display app icon in the Dock">
                <Toggle checked={preferences.showInDock} onCheckedChange={(value) => updatePreferences({ showInDock: value })} />
              </SettingRow>
            </SettingSurface>
          </div>
        );

      case 'Model':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Model Configurations" description="Manage your LLM model configurations">
              {modelConfigs.map((config) => (
                <div
                  key={config.id}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: '1px solid var(--color-token-border)' }}
                >
                  <button
                    onClick={() => {
                      setActiveConfigId(config.id);
                      saveActiveModelId(config.id);
                    }}
                    className="flex items-center gap-3 cursor-pointer"
                    style={{ color: 'var(--color-token-text-primary)' }}
                  >
                    <Radio
                      size={14}
                      style={{
                        color: activeConfigId === config.id
                          ? 'var(--color-token-link)'
                          : 'var(--color-token-text-tertiary)',
                      }}
                      fill={activeConfigId === config.id ? 'currentColor' : 'none'}
                    />
                    <div className="flex flex-col gap-0.5 text-left">
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{config.name}</span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-token-text-tertiary)' }}>
                        {config.model} · {config.provider}
                      </span>
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEditModel(config)}>
                      <Pencil size={12} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteModelConfig(config.id)} disabled={modelConfigs.length <= 1}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="px-4 py-3">
                <Button variant="secondary" size="sm" onClick={openAddModel}>
                  <Plus size={12} />
                  Add Model
                </Button>
              </div>
            </SettingSurface>

            {(() => {
              const active = modelConfigs.find((c) => c.id === activeConfigId);
              if (!active) return null;
              return (
                <SettingSurface title={`Active: ${active.name}`} description="Configure the active model">
                  <SettingRow label="Temperature" description="Controls randomness (0 = focused, 1 = creative)">
                    <div className="w-48">
                      <Slider value={active.temperature ?? 0.7}
                        onValueChange={(value) => {
                          const next = modelConfigs.map((config) => config.id === activeConfigId ? { ...config, temperature: value } : config);
                          setModelConfigs(next);
                          saveModelConfigs(next);
                        }}
                        min={0} max={2} step={0.05} formatValue={(v) => v.toFixed(2)} />
                    </div>
                  </SettingRow>
                  <SettingRow label="Max Tokens" description="Maximum response length">
                    <div className="w-48">
                      <Slider value={active.maxTokens ?? 4096}
                        onValueChange={(value) => {
                          const next = modelConfigs.map((config) => config.id === activeConfigId ? { ...config, maxTokens: value } : config);
                          setModelConfigs(next);
                          saveModelConfigs(next);
                        }}
                        min={256} max={32768} step={256} formatValue={(v) => v.toLocaleString()} />
                    </div>
                  </SettingRow>
                  <SettingRow label="Thinking Budget" description="Extended thinking tokens (0 = disabled)">
                    <div className="w-48">
                      <Slider value={active.thinkingBudget ?? 0}
                        onValueChange={(value) => {
                          const next = modelConfigs.map((config) => config.id === activeConfigId ? { ...config, thinkingBudget: value } : config);
                          setModelConfigs(next);
                          saveModelConfigs(next);
                        }}
                        min={0} max={16000} step={256} formatValue={(v) => v === 0 ? 'Off' : v.toLocaleString()} />
                    </div>
                  </SettingRow>
                  <SettingRow label="Streaming" description="Stream responses token by token">
                    <Toggle checked={active.streaming ?? true} onCheckedChange={(value) => {
                      const next = modelConfigs.map((config) => config.id === activeConfigId ? { ...config, streaming: value } : config);
                      setModelConfigs(next);
                      saveModelConfigs(next);
                    }} />
                  </SettingRow>
                </SettingSurface>
              );
            })()}
          </div>
        );

      case 'Voice':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Voice Settings" description="Configure text-to-speech and voice input">
              <SettingRow label="Enable Voice" description="Allow voice input and output">
                <Toggle checked={preferences.voiceEnabled} onCheckedChange={(value) => updatePreferences({ voiceEnabled: value })} />
              </SettingRow>
              {preferences.voiceEnabled && (
                <>
                  <SettingRow label="Volume" description="Output volume level">
                    <div className="w-48"><Slider value={preferences.voiceVolume} onValueChange={(value) => updatePreferences({ voiceVolume: value })} min={0} max={100} formatValue={(v) => `${v}%`} /></div>
                  </SettingRow>
                  <SettingRow label="Speech Rate" description="How fast the voice speaks">
                    <div className="w-48"><Slider value={preferences.voiceRate} onValueChange={(value) => updatePreferences({ voiceRate: value })} min={0.5} max={2.0} step={0.1} formatValue={(v) => `${v}x`} /></div>
                  </SettingRow>
                </>
              )}
            </SettingSurface>
          </div>
        );

      case 'Agent':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Agent Identity" description="Configure the agent's personality and identity">
              <div className="px-4 py-3"><Input label="Agent Name" value={preferences.agentName} onChange={(e) => updatePreferences({ agentName: e.target.value })} /></div>
              <div className="px-4 py-3"><Input label="Personality" value={preferences.agentPersonality} onChange={(e) => updatePreferences({ agentPersonality: e.target.value })} placeholder="e.g. helpful assistant" /></div>
            </SettingSurface>
            <SettingSurface title="Agent Behavior" description="Control how the agent operates">
              <SettingRow label="Max Steps" description="Maximum steps before agent stops">
                <div className="w-48"><Slider value={preferences.maxSteps} onValueChange={(value) => updatePreferences({ maxSteps: value })} min={5} max={200} step={5} formatValue={(v) => v.toString()} /></div>
              </SettingRow>
              <SettingRow label="Tool Timeout" description="Time to wait for tool completion">
                <div className="w-48"><Slider value={preferences.toolTimeout} onValueChange={(value) => updatePreferences({ toolTimeout: value })} min={10} max={600} step={10} formatValue={(v) => `${v}s`} /></div>
              </SettingRow>
            </SettingSurface>
          </div>
        );

      case 'Evolve':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Evolve Settings" description="Configure the self-improvement workflow">
              <SettingRow label="Auto-Evolve" description="Automatically run evolve after each session">
                <Toggle checked={preferences.autoEvolve} onCheckedChange={(value) => updatePreferences({ autoEvolve: value })} />
              </SettingRow>
              <SettingRow label="Evolution Interval" description="How often to check for improvements">
                <Select value={preferences.evolveInterval} onValueChange={(value) => updatePreferences({ evolveInterval: value as DesktopPreferences['evolveInterval'] })} options={[
                  { value: 'session', label: 'Every session' },
                  { value: 'daily', label: 'Once per day' },
                  { value: 'manual', label: 'Manual only' },
                ]} />
              </SettingRow>
              <SettingRow label="Include Test Verification" description="Run tests before accepting changes">
                <Toggle checked={preferences.includeTestVerification} onCheckedChange={(value) => updatePreferences({ includeTestVerification: value })} />
              </SettingRow>
            </SettingSurface>
          </div>
        );

      case 'Skills':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Skills Management" description="Configure and manage agent skills">
              <SettingRow label="Skill Auto-Discovery" description="Automatically find skills in the skills directory">
                <Toggle checked={preferences.skillAutoDiscovery} onCheckedChange={(value) => updatePreferences({ skillAutoDiscovery: value })} />
              </SettingRow>
              <SettingRow label="Skill Updates" description="Check for skill updates on startup">
                <Toggle checked={preferences.skillUpdates} onCheckedChange={(value) => updatePreferences({ skillUpdates: value })} />
              </SettingRow>
            </SettingSurface>
          </div>
        );

      case 'Memory':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Memory Settings" description="Configure the agent's long-term memory">
              <SettingRow label="Enable Memory" description="Store conversation context for future sessions">
                <Toggle checked={preferences.memoryEnabled} onCheckedChange={(value) => updatePreferences({ memoryEnabled: value })} />
              </SettingRow>
              <SettingRow label="Memory Backend" description="Where to store memories">
                <Select value={preferences.memoryBackend} onValueChange={(value) => updatePreferences({ memoryBackend: value as DesktopPreferences['memoryBackend'] })} options={[
                  { value: 'local', label: 'Local SQLite' },
                  { value: 'postgres', label: 'PostgreSQL' },
                  { value: 'none', label: 'Disabled' },
                ]} />
              </SettingRow>
              <SettingRow label="Retention Period" description="How long to keep memories">
                <Select value={preferences.retentionPeriod} onValueChange={(value) => updatePreferences({ retentionPeriod: value as DesktopPreferences['retentionPeriod'] })} options={[
                  { value: '7d', label: '7 days' },
                  { value: '30d', label: '30 days' },
                  { value: '90d', label: '90 days' },
                  { value: 'forever', label: 'Forever' },
                ]} />
              </SettingRow>
            </SettingSurface>
          </div>
        );

      case 'MCP Servers':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="MCP Servers" description="Configure Model Context Protocol servers">
              <div className="px-4 py-3 flex justify-between items-center">
                <div className="flex flex-col gap-0.5">
                  <span style={{ color: 'var(--color-token-text-primary)', fontSize: 'var(--text-sm)' }}>No MCP servers configured</span>
                  <span style={{ color: 'var(--color-token-text-tertiary)', fontSize: 'var(--text-xs)' }}>Add MCP servers to extend agent capabilities</span>
                </div>
                <Button variant="secondary" size="sm"><Plus size={12} />Add Server</Button>
              </div>
            </SettingSurface>
          </div>
        );

      case 'Tools':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Tools" description="Configure which tools the agent can use">
              <SettingRow label="Web Search" description="Allow the agent to search the web">
                <Toggle checked={preferences.webSearchEnabled} onCheckedChange={(value) => updatePreferences({ webSearchEnabled: value })} />
              </SettingRow>
              <SettingRow label="File Operations" description="Allow read/write access to files">
                <Toggle checked={preferences.fileOperationsEnabled} onCheckedChange={(value) => updatePreferences({ fileOperationsEnabled: value })} />
              </SettingRow>
              <SettingRow label="Shell Commands" description="Allow execution of shell commands">
                <Toggle checked={preferences.shellCommandsEnabled} onCheckedChange={(value) => updatePreferences({ shellCommandsEnabled: value })} />
              </SettingRow>
              <SettingRow label="Git Operations" description="Allow git operations">
                <Toggle checked={preferences.gitOperationsEnabled} onCheckedChange={(value) => updatePreferences({ gitOperationsEnabled: value })} />
              </SettingRow>
            </SettingSurface>
          </div>
        );

      case 'Connections':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Connections" description="Manage external service integrations">
              <SettingRow label="Claude Code Integration" description="Connect to Claude Code CLI">
                <Toggle checked={preferences.claudeCodeIntegration} onCheckedChange={(value) => updatePreferences({ claudeCodeIntegration: value })} />
              </SettingRow>
              <SettingRow label="Desktop App" description="Connect to dum-e desktop application">
                <Toggle checked={preferences.desktopAppConnection} onCheckedChange={(value) => updatePreferences({ desktopAppConnection: value })} />
              </SettingRow>
            </SettingSurface>
          </div>
        );

      case 'Appearance':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Appearance" description="Customize the look and feel">
              <SettingRow label="Theme" description="Choose your preferred color scheme">
                <div className="flex gap-2">
                  <button
                    onClick={() => updatePreferences({ theme: 'dark' })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer text-sm"
                    style={{
                      backgroundColor: theme === 'dark' ? 'var(--color-token-button-background)' : 'var(--color-token-bg-fog)',
                      color: theme === 'dark' ? '#fff' : 'var(--color-token-text-primary)',
                    }}
                  >
                    Dark
                  </button>
                  <button
                    onClick={() => updatePreferences({ theme: 'light' })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer text-sm"
                    style={{
                      backgroundColor: theme === 'light' ? 'var(--color-token-button-background)' : 'var(--color-token-bg-fog)',
                      color: theme === 'light' ? '#fff' : 'var(--color-token-text-primary)',
                    }}
                  >
                    Light
                  </button>
                </div>
              </SettingRow>
              <SettingRow label="Font Size" description="Base font size for the interface">
                <div className="w-48"><Slider value={preferences.fontSize} onValueChange={(value) => updatePreferences({ fontSize: value })} min={11} max={18} formatValue={(v) => `${v}px`} /></div>
              </SettingRow>
              <SettingRow label="Compact Mode" description="Reduce spacing for denser information display">
                <Toggle checked={preferences.compactMode} onCheckedChange={(value) => updatePreferences({ compactMode: value })} />
              </SettingRow>
            </SettingSurface>
          </div>
        );

      case 'Data':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="Data Management" description="Manage your application data">
              <SettingRow label="Export Data" description="Export all threads, settings, and memories">
                <Button variant="secondary" size="sm">Export</Button>
              </SettingRow>
              <SettingRow label="Import Data" description="Import data from a previous export">
                <Button variant="secondary" size="sm">Import</Button>
              </SettingRow>
              <SettingRow label="Clear All Data" description="Delete all threads, memories, and settings. This cannot be undone.">
                <Button variant="danger" size="sm">Clear Data</Button>
              </SettingRow>
            </SettingSurface>
          </div>
        );

      case 'About':
        return (
          <div className="flex flex-col gap-4">
            <SettingSurface title="About dum-e" description="Desktop AI agent with self-evolution">
              <div className="px-4 py-3 flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span style={{ color: 'var(--color-token-link)', fontSize: 'var(--text-xl)', fontWeight: 700 }}>dum-e</span>
                  <span style={{ color: 'var(--color-token-text-secondary)', fontSize: 'var(--text-xs)' }}>Version 1.0.0</span>
                </div>
                <p style={{ color: 'var(--color-token-text-tertiary)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                  A desktop AI agent built with Claude, featuring autonomous operation, self-evolution capabilities, and a modular skill system.
                </p>
              </div>
            </SettingSurface>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ backgroundColor: 'var(--color-token-bg-primary)' }}
    >
      <div
        ref={settingsNavRef}
        className="shrink-0 flex flex-col relative min-h-0"
        style={{
          width: settingsNavWidth,
          cursor: isResizingNav ? 'col-resize' : 'default',
          userSelect: isResizingNav ? 'none' : 'auto',
          backgroundColor: 'var(--color-token-bg-primary)',
        }}
      >
        <div
          className="px-2 shrink-0"
          style={{
            paddingTop: SIDEBAR_SAFE_TOP,
            paddingBottom: 12,
          }}
        >
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors cursor-pointer text-left"
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
            <ArrowLeft size={14} />
            <span>Back to App</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4 min-h-0">
          {SETTINGS_NAV.map((section) => (
            <button
              key={section}
              onClick={() => setActiveSection(section)}
              className="w-full text-left px-3 py-2 rounded-md transition-colors cursor-pointer mb-0.5"
              style={{
                color: activeSection === section ? 'var(--color-token-text-primary)' : 'var(--color-token-text-secondary)',
                backgroundColor: activeSection === section ? 'var(--color-token-list-hover-background)' : 'transparent',
                fontSize: 'var(--text-sm)',
                fontWeight: activeSection === section ? 500 : 400,
              }}
              onMouseEnter={(e) => {
                if (activeSection !== section) e.currentTarget.style.backgroundColor = 'var(--color-token-list-hover-background)';
              }}
              onMouseLeave={(e) => {
                if (activeSection !== section) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {section}
            </button>
          ))}
        </div>
        <div
          onMouseDown={handleNavResizeMouseDown}
          className="absolute h-full w-1 cursor-col-resize"
          style={{
            right: 0,
            top: 0,
            backgroundColor: 'transparent',
          }}
          onMouseEnter={(e) => {
            if (!isResizingNav) e.currentTarget.style.backgroundColor = 'var(--color-token-border)';
          }}
          onMouseLeave={(e) => {
            if (!isResizingNav) e.currentTarget.style.backgroundColor = 'transparent';
          }}
        />
      </div>

      <div
        className="flex flex-col flex-1 min-w-0 h-full overflow-hidden"
        style={{
          backgroundColor: 'var(--color-token-bg-secondary)',
          borderTopLeftRadius: 16,
          borderBottomLeftRadius: 16,
        }}
      >
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 py-8">
            <div className="draggable flex items-start justify-between gap-6 mb-8">
              <div>
                <div
                  style={{
                    color: 'var(--color-token-text-primary)',
                    fontSize: '24px',
                    fontWeight: 600,
                    marginBottom: 6,
                  }}
                >
                  Settings
                </div>
                <div
                  style={{
                    color: 'var(--color-token-text-tertiary)',
                    fontSize: 'var(--text-sm)',
                    lineHeight: 1.6,
                  }}
                >
                  Model, agent, appearance, and integration preferences.
                </div>
              </div>
              <div
                className="rounded-md px-3 py-2"
                style={{
                  color: 'var(--color-token-text-secondary)',
                  fontSize: 'var(--text-sm)',
                  backgroundColor: 'var(--color-token-bg-primary)',
                  border: '1px solid var(--color-token-border)',
                }}
              >
                {modelConfigs.length} model{modelConfigs.length === 1 ? '' : 's'}
              </div>
            </div>

            <div className="max-w-3xl">{renderContent()}</div>
          </div>
        </div>
      </div>

      {/* Model Config Dialog */}
      <Dialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        title={editingConfigId ? 'Edit Model Configuration' : 'Add Model Configuration'}
        description="Configure connection settings for your LLM provider"
      >
        <div className="flex flex-col gap-4 mt-2">
          <Input label="Configuration Name" placeholder="e.g. Claude Sonnet"
            value={modelForm.name} onChange={(e) => setModelForm((f) => ({ ...f, name: e.target.value }))} />
          <Select label="Provider" value={modelForm.provider}
            onValueChange={(value) => setModelForm((form) => ({ ...form, provider: value as ModelConfig['provider'] }))}
            options={[...PROVIDER_OPTIONS]} />
          <Input label="API Key" type="password" placeholder="sk-..."
            value={modelForm.apiKey} onChange={(e) => setModelForm((f) => ({ ...f, apiKey: e.target.value }))} />
          <Input label="Base URL" placeholder="https://api.example.com"
            value={modelForm.baseUrl} onChange={(e) => setModelForm((f) => ({ ...f, baseUrl: e.target.value }))} />
          <Input label="Model" placeholder="e.g. claude-sonnet-4-5"
            value={modelForm.model} onChange={(e) => setModelForm((f) => ({ ...f, model: e.target.value }))} />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" onClick={() => setModelDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveModelConfig} disabled={!modelForm.name || !modelForm.model}>
              {editingConfigId ? 'Save Changes' : 'Add Model'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
