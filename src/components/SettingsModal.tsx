import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Settings,
  X,
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
  Trash2,
  Check,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  List,
  RotateCcw,
} from 'lucide-react';
import {
  loadLlmSettings,
  saveLlmSettings,
  clearLlmKey,
  detectProvider,
  createDefaultLlmSettings,
  isModelAuto,
  setModelAuto,
  type LlmSettings,
} from '../lib/storage/settings.ts';
import {
  type LLMProviderId,
  LLM_PROVIDERS,
  getLLMProvider,
} from '../core/llm-providers.ts';
import { PROVIDER_DEFAULTS, LLMAuthError } from '../core/llm.ts';
import type { LLMSyncOptions } from '../lib/sync.ts';
import {
  getSyncLog,
  clearSyncLog,
  flushSyncLog,
  createDefaultStore,
  type KeyValueStore,
} from '../lib/storage/datasetStore.ts';
import type { ActivityLogEntry } from '../lib/activityLog.ts';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReclassifyOther?: (config?: LLMSyncOptions) => Promise<boolean | void>;
  onResetAI?: () => Promise<{ resetCount: number } | void>;
  llmClassifiedCount?: number;
  isSyncing?: boolean;
  hasCachedData?: boolean;
  fetchLlmModels?: (providerId: LLMProviderId, apiKey: string) => Promise<string[]>;
  initialModelList?: string[];
  initialIsLoadingModels?: boolean;
  initialModelListError?: string | null;
  initialModelListErrorDetail?: string | null;
  initialManualModelEntry?: boolean;
  initialTab?: 'general' | 'activity';
  store?: KeyValueStore;
  initialPersistentLogs?: ActivityLogEntry[];
  initialShowKey?: boolean;
  initialShowRevealConfirm?: boolean;
}

export function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function sortModelsByFamily(providerId: LLMProviderId, models: string[]): string[] {
  const deduped = Array.from(new Set(models));
  const defaultModel = PROVIDER_DEFAULTS[providerId].defaultModel;

  return deduped.sort((a, b) => {
    // Default model always first
    if (a === defaultModel) return -1;
    if (b === defaultModel) return 1;

    switch (providerId) {
      case 'google': {
        const aFlash = a.toLowerCase().includes('flash');
        const bFlash = b.toLowerCase().includes('flash');
        if (aFlash && !bFlash) return -1;
        if (!aFlash && bFlash) return 1;
        break;
      }
      case 'openai': {
        const aGpt6 = /^gpt-6/i.test(a);
        const bGpt6 = /^gpt-6/i.test(b);
        if (aGpt6 && !bGpt6) return -1;
        if (!aGpt6 && bGpt6) return 1;
        const aMini = /mini/i.test(a);
        const bMini = /mini/i.test(b);
        if (aMini && !bMini) return -1;
        if (!aMini && bMini) return 1;
        break;
      }
      case 'anthropic': {
        const aSonnet = a.toLowerCase().includes('sonnet');
        const bSonnet = b.toLowerCase().includes('sonnet');
        if (aSonnet && !bSonnet) return -1;
        if (!aSonnet && bSonnet) return 1;
        break;
      }
      case 'deepseek': {
        if (a === 'deepseek-chat') return -1;
        if (b === 'deepseek-chat') return 1;
        break;
      }
    }
    return a.localeCompare(b);
  });
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onReclassifyOther,
  onResetAI,
  llmClassifiedCount,
  isSyncing = false,
  hasCachedData = false,
  fetchLlmModels,
  initialModelList,
  initialIsLoadingModels,
  initialModelListError,
  initialModelListErrorDetail,
  initialManualModelEntry,
  initialTab,
  store,
  initialPersistentLogs,
  initialShowKey,
  initialShowRevealConfirm,
}) => {
  const [settings, setSettings] = useState<LlmSettings>(() => createDefaultLlmSettings());
  const [showKey, setShowKey] = useState(initialShowKey ?? false);
  const [showRevealConfirm, setShowRevealConfirm] = useState(initialShowRevealConfirm ?? false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detectHint, setDetectHint] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  // Tabs state & persistent log
  const [activeTab, setActiveTab] = useState<'general' | 'activity'>(initialTab ?? 'general');
  const [persistentLogs, setPersistentLogs] = useState<ActivityLogEntry[]>(initialPersistentLogs ?? []);
  const [copiedHint, setCopiedHint] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const modalStore = store ?? createDefaultStore();

  // Model list state (kept in component state only, NOT persisted)
  const [modelList, setModelList] = useState<string[] | null>(initialModelList ?? null);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(initialIsLoadingModels ?? false);
  const [modelListError, setModelListError] = useState<string | null>(initialModelListError ?? null);
  const [modelListErrorDetail, setModelListErrorDetail] = useState<string | null>(initialModelListErrorDetail ?? null);
  const [manualModelEntry, setManualModelEntry] = useState<boolean>(initialManualModelEntry ?? false);

  const modalRef = useRef<HTMLDivElement>(null);

  const currentProviderId = settings.provider;
  const currentProviderDef = getLLMProvider(currentProviderId);
  const currentEntry = settings.providers[currentProviderId] || {
    apiKey: '',
    model: PROVIDER_DEFAULTS[currentProviderId].defaultModel,
    modelAuto: true,
    intervalSec: null,
    remember: false,
  };
  const currentKey = currentEntry.apiKey;
  const currentModel = currentEntry.model || PROVIDER_DEFAULTS[currentProviderId].defaultModel;
  const isAutoModel = isModelAuto(settings, currentProviderId);

  const isAutoInterval = currentEntry.intervalSec === null;
  const displayInterval = isAutoInterval
    ? PROVIDER_DEFAULTS[currentProviderId].defaultIntervalSec
    : currentEntry.intervalSec;

  // Load persistent logs
  const loadLogs = useCallback(async () => {
    try {
      await flushSyncLog();
      const logs = await getSyncLog(modalStore);
      setPersistentLogs(logs);
    } catch {
      // ignore
    }
  }, [modalStore]);

  useEffect(() => {
    if (isOpen) {
      if (initialPersistentLogs === undefined) {
        loadLogs();
      }
      if (initialTab) {
        setActiveTab(initialTab);
      }
    } else {
      setShowKey(false);
      setShowRevealConfirm(false);
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
    }
  }, [isOpen, initialTab, initialPersistentLogs, loadLogs]);

  useEffect(() => {
    if (isOpen && activeTab === 'activity') {
      if (initialPersistentLogs === undefined) {
        loadLogs();
      }
    }
  }, [isOpen, activeTab, initialPersistentLogs, loadLogs]);

  useEffect(() => {
    if (activeTab === 'activity' && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [activeTab, persistentLogs]);

  // Fetch model list for active provider and key
  const fetchModelsForActive = useCallback(
    async (providerId: LLMProviderId, apiKey: string) => {
      const trimmed = apiKey.trim();
      if (!trimmed) {
        setModelList(null);
        setModelListError(null);
        setModelListErrorDetail(null);
        return;
      }

      setIsLoadingModels(true);
      setModelListError(null);
      setModelListErrorDetail(null);
      const providerLabel = getLLMProvider(providerId).label;
      try {
        const fetcher = fetchLlmModels ?? ((p, k) => getLLMProvider(p).listModels({ apiKey: k }));
        const models = await fetcher(providerId, trimmed);
        setModelList(models);
      } catch (err: unknown) {
        setModelListError('Could not load model list — enter the model id manually.');
        const isAuth =
          err instanceof LLMAuthError ||
          (err instanceof Error && err.name === 'LLMAuthError') ||
          (typeof err === 'object' && err !== null && (err as { status?: number }).status === 401);
        if (isAuth) {
          setModelListErrorDetail(`Key was rejected by ${providerLabel} — check the key.`);
        } else {
          const raw = err instanceof Error ? err.message : String(err);
          const truncated = raw.length > 120 ? raw.slice(0, 117) + '...' : raw;
          setModelListErrorDetail(`${providerLabel} said: ${truncated}`);
        }
      } finally {
        setIsLoadingModels(false);
      }
    },
    [fetchLlmModels]
  );

  // Load stored settings on open
  useEffect(() => {
    if (isOpen) {
      const loaded = loadLlmSettings();
      setSettings(loaded);
      setShowKey(initialShowKey ?? false);
      setShowRevealConfirm(initialShowRevealConfirm ?? false);
      setDetectHint(null);
      setSavedBanner(false);
      if (initialModelList === undefined) {
        setModelList(null);
      }
      if (initialIsLoadingModels === undefined) {
        setIsLoadingModels(false);
      }
      if (initialModelListError === undefined) {
        setModelListError(null);
      }
      if (initialModelListErrorDetail === undefined) {
        setModelListErrorDetail(null);
      }
      if (initialManualModelEntry === undefined) {
        setManualModelEntry(false);
      }

      const activeEntry = loaded.providers[loaded.provider];
      if (activeEntry?.apiKey?.trim() && initialModelList === undefined) {
        fetchModelsForActive(loaded.provider, activeEntry.apiKey.trim());
      }
    }
  }, [isOpen, fetchModelsForActive, initialModelList, initialIsLoadingModels, initialModelListError, initialModelListErrorDetail, initialManualModelEntry]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleProviderSelect = (newProvider: LLMProviderId) => {
    setSettings(prev => ({
      ...prev,
      provider: newProvider,
    }));
    setDetectHint(null);
    setModelList(null);
    setModelListError(null);
    setModelListErrorDetail(null);
    setManualModelEntry(false);

    const entry = settings.providers[newProvider];
    if (entry?.apiKey?.trim()) {
      fetchModelsForActive(newProvider, entry.apiKey.trim());
    }
  };

  const handleKeyChange = (val: string) => {
    const detected = detectProvider(val);
    let targetProvider = settings.provider;
    let hint: string | null = null;

    if (val.trim()) {
      if (detected) {
        targetProvider = detected;
        hint = null;
      } else {
        hint = 'Provider could not be detected from this key — please choose one.';
      }
    } else {
      hint = null;
    }

    setDetectHint(hint);
    setSettings(prev => ({
      ...prev,
      provider: targetProvider,
      providers: {
        ...prev.providers,
        [targetProvider]: {
          ...prev.providers[targetProvider],
          apiKey: val,
        },
      },
    }));

    if (val.trim()) {
      fetchModelsForActive(targetProvider, val.trim());
    } else {
      setModelList(null);
      setModelListError(null);
    }
  };

  const handleSelectModelChange = (val: string) => {
    if (val === '__auto__') {
      setSettings(prev => setModelAuto(prev, prev.provider, true));
      setManualModelEntry(false);
      return;
    }
    if (val === '__manual__') {
      setSettings(prev => setModelAuto(prev, prev.provider, false));
      setManualModelEntry(true);
      return;
    }
    setSettings(prev => {
      const updated = setModelAuto(prev, prev.provider, false);
      return {
        ...updated,
        providers: {
          ...updated.providers,
          [updated.provider]: {
            ...updated.providers[updated.provider],
            model: val,
          },
        },
      };
    });
    setManualModelEntry(false);
  };

  const handleManualModelChange = (val: string) => {
    setSettings(prev => {
      const updated = setModelAuto(prev, prev.provider, false);
      return {
        ...updated,
        providers: {
          ...updated.providers,
          [updated.provider]: {
            ...updated.providers[updated.provider],
            model: val,
          },
        },
      };
    });
  };

  const handleAutoIntervalToggle = (checked: boolean) => {
    setSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [prev.provider]: {
          ...prev.providers[prev.provider],
          intervalSec: checked ? null : PROVIDER_DEFAULTS[prev.provider].defaultIntervalSec,
        },
      },
    }));
  };

  const handleIntervalNumberChange = (val: number) => {
    setSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [prev.provider]: {
          ...prev.providers[prev.provider],
          intervalSec: Math.max(1, val),
        },
      },
    }));
  };

  const handleRememberToggle = (checked: boolean) => {
    setSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [prev.provider]: {
          ...prev.providers[prev.provider],
          remember: checked,
        },
      },
    }));
  };

  const handleRemoveKey = () => {
    clearLlmKey(currentProviderId);
    setSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [prev.provider]: {
          ...prev.providers[prev.provider],
          apiKey: '',
          remember: false,
        },
      },
    }));
    setDetectHint(null);
    setModelList(null);
    setModelListError(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveLlmSettings(settings);
    setSavedBanner(true);
    setTimeout(() => {
      setSavedBanner(false);
      onClose();
    }, 600);
  };

  const handleToggleKeyVisibility = () => {
    if (showKey) {
      setShowKey(initialShowKey ?? false);
      setShowRevealConfirm(initialShowRevealConfirm ?? false);
      setShowRevealConfirm(false);
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
    } else {
      setShowRevealConfirm(prev => !prev);
    }
  };

  const handleConfirmReveal = () => {
    setShowRevealConfirm(false);
    setShowKey(true);
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    autoHideTimerRef.current = setTimeout(() => {
      setShowKey(initialShowKey ?? false);
      setShowRevealConfirm(initialShowRevealConfirm ?? false);
      autoHideTimerRef.current = null;
    }, 30000);
  };

  const handleCancelReveal = () => {
    setShowRevealConfirm(false);
  };

  const handleClearPersistentLog = async () => {
    if (window.confirm('Clear all stored activity log entries?')) {
      await clearSyncLog(modalStore);
      setPersistentLogs([]);
    }
  };

  const handleCopyLog = async () => {
    const text = persistentLogs
      .map(entry => `${formatLogTime(entry.ts)} ${entry.kind ? `[${entry.kind.toUpperCase()}] ` : ''}${entry.text}`)
      .join('\n');
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopiedHint(true);
      setTimeout(() => setCopiedHint(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleResetAI = async () => {
    const count = llmClassifiedCount ?? 0;
    if (count === 0 || !onResetAI) return;
    const confirmed = window.confirm(
      `Reset AI classifications for ${count} ${count === 1 ? 'repository' : 'repositories'}? They will be reverted to 'Other'.`
    );
    if (confirmed) {
      await onResetAI();
    }
  };

  const handleReclassify = async () => {
    saveLlmSettings(settings);
    onClose();
    if (onReclassifyOther) {
      const activeEntry = settings.providers[currentProviderId];
      const autoMode = isModelAuto(settings, currentProviderId);
      const isAutoInterval = activeEntry.intervalSec === null || activeEntry.intervalSec === undefined;
      const config: LLMSyncOptions = {
        provider: currentProviderId,
        apiKey: activeEntry.apiKey.trim(),
        model: autoMode ? undefined : (activeEntry.model || PROVIDER_DEFAULTS[currentProviderId].defaultModel),
        adaptive: isAutoInterval,
        minIntervalSec: isAutoInterval ? PROVIDER_DEFAULTS[currentProviderId].defaultIntervalSec : (activeEntry.intervalSec ?? undefined),
        allowModelHeal: autoMode,
      };
      await onReclassifyOther(config);
    }
  };

  const hasKey = Boolean(currentKey.trim());
  const defaultModel = PROVIDER_DEFAULTS[currentProviderId].defaultModel;

  // Compute sorted deduplicated models
  const sortedModels = modelList && modelList.length > 0
    ? sortModelsByFamily(currentProviderId, modelList)
    : [defaultModel];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg max-h-[85vh] sm:max-h-[90dvh] bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-[#c9d1d9]"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#58a6ff]/10 border border-[#58a6ff]/30 flex items-center justify-center text-[#58a6ff]">
              <Settings className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="settings-modal-title" className="text-sm font-semibold text-white">
                AI Classification Settings
              </h2>
              <p className="text-xs text-github-muted mt-0.5">
                Configure optional in-browser LLM classification for unmatched repositories
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-github-muted hover:text-white p-1 rounded-md hover:bg-[#21262d] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="shrink-0 flex items-center border-b border-[#30363d] bg-[#161b22] px-5 pt-1.5 gap-4">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'general'
                ? 'border-[#58a6ff] text-white'
                : 'border-transparent text-github-muted hover:text-white'
            }`}
          >
            General
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('activity')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'activity'
                ? 'border-[#58a6ff] text-white'
                : 'border-transparent text-github-muted hover:text-white'
            }`}
          >
            Activity Log
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {activeTab === 'general' ? (
            <form id="settings-form" onSubmit={handleSave} className="p-5 space-y-4 text-xs">
              {savedBanner && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#238636]/15 border border-[#238636]/30 text-[#3fb950] animate-in fade-in">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Settings saved successfully.</span>
                </div>
              )}

              {/* Provider Selector */}
              <div className="space-y-1.5">
                <label className="font-semibold text-white/90">AI Provider</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {Object.values(LLM_PROVIDERS).map(p => {
                    const isSelected = p.id === currentProviderId;
                    const providerKeyConfigured = Boolean(settings.providers[p.id]?.apiKey?.trim());
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleProviderSelect(p.id)}
                        className={`px-2.5 py-2 rounded-xl text-xs font-medium border text-center transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          isSelected
                            ? 'bg-[#21262d] border-[#58a6ff] text-white shadow-xs'
                            : 'bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-white hover:border-[#8b949e]'
                        }`}
                      >
                        <span>{p.label}</span>
                        {providerKeyConfigured && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" title="Key configured" />
                        )}
                      </button>
                    );
                  })}
                </div>
                {detectHint && (
                  <p className="text-[11px] text-[#e3b341] mt-1 leading-relaxed">
                    {detectHint}
                  </p>
                )}
              </div>

              {/* API Key Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="llm-key-input" className="font-semibold text-white/90">
                    {currentProviderDef.label} API key (optional)
                  </label>
                  {hasKey && (
                    <button
                      type="button"
                      onClick={handleRemoveKey}
                      className="text-[11px] text-[#ff7b72] hover:text-[#f85149] inline-flex items-center gap-1 transition-colors cursor-pointer"
                      title={`Remove stored ${currentProviderDef.label} key`}
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove key</span>
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="llm-key-input"
                    type={showKey ? 'text' : 'password'}
                    value={currentKey}
                    onChange={e => handleKeyChange(e.target.value)}
                    placeholder={currentProviderDef.keyPlaceholder}
                    autoComplete="off"
                    spellCheck="false"
                    className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs font-mono px-3.5 py-2.5 pr-11 text-white placeholder:text-github-muted placeholder:font-sans focus-visible:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleToggleKeyVisibility}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-github-muted hover:text-white p-1 rounded-md transition-colors cursor-pointer"
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    title={showKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {showRevealConfirm && (
                  <div className="p-2.5 rounded-xl bg-[#21262d] border border-[#e3b341]/40 text-xs space-y-2 animate-in fade-in">
                    <p className="text-[#e3b341]">
                      Reveal API key? Anyone looking at your screen could see it.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleConfirmReveal}
                        className="px-2.5 py-1 bg-[#238636] hover:bg-[#2ea043] text-white rounded text-xs font-semibold cursor-pointer transition-colors"
                      >
                        Yes, reveal
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelReveal}
                        className="px-2.5 py-1 bg-[#30363d] hover:bg-[#21262d] text-[#c9d1d9] rounded text-xs cursor-pointer transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Remember Key Checkbox */}
              <div className="space-y-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(currentEntry.remember)}
                    onChange={e => handleRememberToggle(e.target.checked)}
                    className="w-4 h-4 rounded border-[#30363d] bg-[#0d1117] text-[#238636] focus:ring-[#58a6ff] focus:ring-offset-0 transition-colors"
                  />
                  <span className="text-white/90 font-medium">Remember on this device</span>
                </label>
                {currentEntry.remember && (
                  <p className="text-[11px] text-[#e3b341] pl-6 leading-relaxed">
                    Warning: The key will be stored unencrypted in your browser's localStorage.
                  </p>
                )}
              </div>

              {/* Request Interval */}
              <div className="space-y-2 pt-1">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="llm-interval-input" className="font-semibold text-white/90">
                      Delay (seconds)
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-github-muted hover:text-white">
                      <input
                        type="checkbox"
                        checked={isAutoInterval}
                        onChange={e => handleAutoIntervalToggle(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-[#30363d] bg-[#0d1117] text-[#238636] focus:ring-[#58a6ff] focus:ring-offset-0"
                      />
                      <span>Auto (recommended)</span>
                    </label>
                  </div>
                  <input
                    id="llm-interval-input"
                    type="number"
                    min="1"
                    step="0.5"
                    disabled={isAutoInterval}
                    value={displayInterval ?? ''}
                    onChange={e => handleIntervalNumberChange(parseFloat(e.target.value) || 1)}
                    className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs font-mono px-3 py-2 text-white placeholder:text-github-muted focus-visible:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <p className="text-[11px] text-github-muted leading-relaxed">
                  Auto uses the provider's recommended delay. Lower it (≤1s) if you have a paid/high-quota tier; raise it (10–15s) if you see rate-limit warnings on a free tier. Failed requests retry automatically; repos that still fail fall back to rule-based classification.
                </p>
              </div>

              {/* Advanced Drawer: Model Picker */}
              <details className="group border border-[#30363d] rounded-xl bg-[#0d1117]/40 overflow-hidden">
                <summary className="flex items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-white/90 cursor-pointer select-none hover:bg-[#21262d]/50 transition-colors">
                  <span className="flex items-center gap-2">
                    <span>Advanced Settings</span>
                    <span className="text-[11px] font-normal text-github-muted">
                      (Model: {isAutoModel ? 'Auto' : currentModel})
                    </span>
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-github-muted transition-transform group-open:rotate-180" />
                </summary>

                <div className="p-3.5 pt-2 border-t border-[#30363d]/60 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="llm-model-picker" className="font-semibold text-white/90">
                        Model
                      </label>
                      <div className="flex items-center gap-1.5">
                        {manualModelEntry && (
                          <button
                            type="button"
                            onClick={() => setManualModelEntry(false)}
                            className="text-[11px] text-[#58a6ff] hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <List className="w-3 h-3" />
                            <span>Back to list</span>
                          </button>
                        )}
                        {hasKey && !manualModelEntry && (
                          <button
                            type="button"
                            onClick={() => fetchModelsForActive(currentProviderId, currentKey)}
                            disabled={isLoadingModels}
                            className="text-github-muted hover:text-white p-0.5 rounded transition-colors cursor-pointer disabled:opacity-40"
                            title="Refresh model list"
                            aria-label="Refresh model list"
                          >
                            <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                      </div>
                    </div>

                    {isLoadingModels ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-[#21262d]/50 border border-[#30363d] text-xs text-github-muted" role="status">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#58a6ff]" />
                          <span>Loading models…</span>
                        </div>
                        <input
                          id="llm-model-input"
                          type="text"
                          value={isAutoModel ? '' : currentModel}
                          onChange={e => handleManualModelChange(e.target.value)}
                          placeholder={`Default: ${defaultModel} (or enter custom model)`}
                          className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs font-mono px-3 py-2 text-white placeholder:text-github-muted focus-visible:outline-none transition-colors"
                        />
                      </div>
                    ) : modelListError ? (
                      <div className="space-y-2">
                        <div className="p-2.5 rounded-lg bg-[#f85149]/10 border border-[#f85149]/30 text-xs text-[#ff7b72] space-y-1.5" role="alert">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 font-medium">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>{modelListError}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => fetchModelsForActive(currentProviderId, currentKey)}
                              disabled={isLoadingModels}
                              className="shrink-0 text-[11px] font-semibold text-[#58a6ff] hover:underline cursor-pointer disabled:opacity-40"
                            >
                              Retry
                            </button>
                          </div>
                          {modelListErrorDetail && (
                            <p className="text-[11px] text-github-muted pl-5 break-words">
                              {modelListErrorDetail}
                            </p>
                          )}
                        </div>
                        <input
                          id="llm-model-input"
                          type="text"
                          value={isAutoModel ? '' : currentModel}
                          onChange={e => handleManualModelChange(e.target.value)}
                          placeholder={defaultModel}
                          className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs font-mono px-3 py-2 text-white placeholder:text-github-muted focus-visible:outline-none transition-colors"
                        />
                      </div>
                    ) : manualModelEntry ? (
                      <input
                        id="llm-model-input"
                        type="text"
                        value={currentModel}
                        onChange={e => handleManualModelChange(e.target.value)}
                        placeholder={defaultModel}
                        className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs font-mono px-3 py-2 text-white placeholder:text-github-muted focus-visible:outline-none transition-colors"
                      />
                    ) : (
                      <div className="relative">
                        <select
                          id="llm-model-picker"
                          value={isAutoModel ? '__auto__' : currentModel}
                          onChange={e => handleSelectModelChange(e.target.value)}
                          className="w-full appearance-none bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs font-mono px-3 py-2 pr-9 text-white placeholder:text-github-muted focus-visible:outline-none transition-colors cursor-pointer"
                        >
                          <option value="__auto__">Auto (recommended)</option>
                          {sortedModels.map(m => (
                            <option key={m} value={m}>
                              {m === defaultModel ? `${m} (Recommended)` : m}
                            </option>
                          ))}
                          <option value="__manual__">Enter manually…</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-github-muted pointer-events-none" />
                      </div>
                    )}
                  </div>
                </div>
              </details>

              {/* Provider Security / Referrer Notice */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#21262d]/60 border border-[#30363d] text-[11px] text-github-muted leading-relaxed">
                <ShieldCheck className="w-4 h-4 shrink-0 text-[#58a6ff] mt-0.5" aria-hidden="true" />
                <span>
                  {currentProviderId === 'google' &&
                    "The key is sent directly from your browser to Google's Gemini API. Restrict the key to this site's URL (HTTP referrer) in Google AI Studio / Cloud Console."}
                  {currentProviderId === 'openai' &&
                    "The key is sent directly from your browser to OpenAI's API. Restrict the key by HTTP referrer where supported."}
                  {currentProviderId === 'anthropic' &&
                    "The key is sent directly from your browser to Anthropic's API using direct browser access headers."}
                  {currentProviderId === 'deepseek' &&
                    "The key is sent directly from your browser to DeepSeek's API."}
                </span>
              </div>

              {/* Actions: Re-classify Other Repos and Reset AI classifications */}
              {hasCachedData && (onReclassifyOther || onResetAI) && (
                <div className="pt-2 border-t border-[#30363d] space-y-3">
                  {onReclassifyOther && (
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-white font-medium">Re-classify ambiguous repositories</p>
                        <p className="text-[11px] text-github-muted">
                          Retry all repositories currently labeled as "Other" with {currentProviderDef.label}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleReclassify}
                        disabled={isSyncing || !hasKey}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#a371f7]/15 border border-[#a371f7]/30 text-[#d2a8ff] hover:bg-[#a371f7]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
                        title={!hasKey ? `Please enter a ${currentProviderDef.label} API key first` : 'Re-classify Other repos'}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Re-classify 'Other' repos</span>
                      </button>
                    </div>
                  )}

                  {onResetAI && (
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-white font-medium">Reset AI classifications</p>
                        <p className="text-[11px] text-github-muted">
                          {`Revert ${llmClassifiedCount ?? 0} AI-classified ${llmClassifiedCount === 1 ? 'repository' : 'repositories'} back to 'Other'`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetAI}
                        disabled={isSyncing || (llmClassifiedCount ?? 0) === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#f85149]/15 border border-[#f85149]/30 text-[#ff7b72] hover:bg-[#f85149]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
                        title={(llmClassifiedCount ?? 0) === 0 ? 'No AI classifications to reset' : `Reset ${llmClassifiedCount} AI classifications`}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset AI classifications</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </form>
          ) : (
            <div className="p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-github-muted leading-relaxed">
                  Last 500 events are kept on this device. Clearing browsing data removes them.
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyLog}
                    disabled={persistentLogs.length === 0}
                    className="px-2.5 py-1 text-xs rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-github-muted hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {copiedHint ? 'Copied!' : 'Copy log'}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearPersistentLog}
                    disabled={persistentLogs.length === 0}
                    className="px-2.5 py-1 text-xs rounded-lg bg-[#21262d] hover:bg-[#f85149]/20 border border-[#30363d] hover:border-[#f85149]/40 text-github-muted hover:text-[#ff7b72] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Clear log
                  </button>
                </div>
              </div>

              <div
                ref={logContainerRef}
                className="bg-[#0d1117] border border-[#30363d] rounded-xl p-3 font-mono text-[11px] max-h-80 overflow-y-auto space-y-1"
              >
                {persistentLogs.length === 0 ? (
                  <div className="text-github-muted text-center py-8 font-sans">
                    No activity logged yet.
                  </div>
                ) : (
                  persistentLogs.map((entry, idx) => {
                    const timeStr = formatLogTime(entry.ts);
                    const colorClass =
                      entry.kind === 'warn'
                        ? 'text-[#e3b341]'
                        : entry.kind === 'error'
                        ? 'text-[#ff7b72]'
                        : entry.kind === 'success'
                        ? 'text-[#3fb950]'
                        : 'text-[#8b949e]';

                    return (
                      <div key={`${entry.ts}-${idx}`} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-github-muted shrink-0 select-none">{timeStr}</span>
                        <span className={`break-words ${colorClass}`}>{entry.text}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-[#30363d] bg-[#161b22]">
          {activeTab === 'general' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 font-medium text-github-muted hover:text-white rounded-lg hover:bg-[#21262d] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="settings-form"
                className="px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-lg font-semibold focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors cursor-pointer shadow-sm"
              >
                Save Settings
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] text-white rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] cursor-pointer"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
