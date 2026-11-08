import { useState, useEffect, useRef, useCallback } from 'react';
import type { DatasetEnvelope } from '../types/repo.ts';
import {
  syncStarredRepos,
  shouldAutoRefresh,
  type SyncProgress,
  type SyncPhase,
  type SyncError,
  type LLMSyncStatus,
  type GeminiSyncStatus,
  type LLMSyncOptions,
  mapToSyncError,
  resolveSyncFailure,
} from '../lib/sync.ts';
import { loadToken, saveToken, clearToken, loadLlmSettings, saveLlmSettings, isModelAuto } from '../lib/storage/settings.ts';
import { createDefaultStore, type KeyValueStore } from '../lib/storage/datasetStore.ts';
import { getLLMProvider, type LLMProviderId } from '../core/llm-providers.ts';
import { PROVIDER_DEFAULTS } from '../core/llm.ts';
import { createActivityLog, type ActivityLog, type ActivityLogEntry, type ActivityLogKind } from '../lib/activityLog.ts';

export type SyncStatus = 'idle' | 'syncing' | 'ready' | 'error';

export interface GitHubSyncState {
  status: SyncStatus;
  phase: SyncPhase | null;
  progress: SyncProgress;
  error: SyncError | null;
  lastSyncAt: string | null;
  viewerLogin: string | null;
  listsUnavailable: boolean;
  isBackgroundRefreshing: boolean;
  tokenExpiredNotice: string | null;
  llmStatus: LLMSyncStatus;
  llmErrors?: number;
  geminiStatus: GeminiSyncStatus;
  geminiErrors?: number;
  modelFallbackNotice: string | null;
  dataset: DatasetEnvelope | null;
}

export interface UseGitHubSyncOptions {
  store?: KeyValueStore;
  autoRefreshMaxAgeMs?: number;
}

export interface UseGitHubSyncReturn extends GitHubSyncState {
  connect: (token: string, remember: boolean) => Promise<boolean>;
  refresh: () => Promise<void>;
  reclassifyOther: (llmConfig?: LLMSyncOptions) => Promise<boolean>;
  cancel: () => void;
  disconnect: () => Promise<void>;
  clearError: () => void;
  clearTokenExpiredNotice: () => void;
  clearLlmNotice: () => void;
  clearGeminiNotice: () => void;
  clearModelFallbackNotice: () => void;
  fetchLlmModels: (providerId: LLMProviderId, apiKey: string) => Promise<string[]>;
  activityLog: ReadonlyArray<ActivityLogEntry>;
  clearActivityLog: () => void;
}

export function useGitHubSync(options: UseGitHubSyncOptions = {}): UseGitHubSyncReturn {
  const [store] = useState<KeyValueStore>(() => options.store ?? createDefaultStore());
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [phase, setPhase] = useState<SyncPhase | null>(null);
  const [progress, setProgress] = useState<SyncProgress>({ phase: 'fetching', done: 0 });
  const [error, setError] = useState<SyncError | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [viewerLogin, setViewerLogin] = useState<string | null>(null);
  const [listsUnavailable, setListsUnavailable] = useState<boolean>(false);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState<boolean>(false);
  const [tokenExpiredNotice, setTokenExpiredNotice] = useState<string | null>(null);
  const [modelFallbackNotice, setModelFallbackNotice] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LLMSyncStatus>('disabled');
  const [llmErrors, setLlmErrors] = useState<number | undefined>(undefined);
  const [dataset, setDataset] = useState<DatasetEnvelope | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activityLogRef = useRef<ActivityLog>(createActivityLog(50));
  const [activityLogSnapshot, setActivityLogSnapshot] = useState<ReadonlyArray<ActivityLogEntry>>([]);

  const addLogEntry = useCallback((entry: { text: string; kind?: ActivityLogKind }) => {
    activityLogRef.current.add(entry);
    setActivityLogSnapshot(activityLogRef.current.entries());
  }, []);

  const clearActivityLog = useCallback(() => {
    activityLogRef.current.clear();
    setActivityLogSnapshot([]);
  }, []);

  const runSync = useCallback(
    async (
      token: string,
      isBackground: boolean = false,
      syncOpts: { ignoreOtherCache?: boolean; llm?: LLMSyncOptions } = {}
    ): Promise<boolean> => {
      // Abort any existing operation
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setError(null);
      setPhase('fetching');
      setProgress({ phase: 'fetching', done: 0 });

      if (isBackground) {
        setIsBackgroundRefreshing(true);
      } else {
        setStatus('syncing');
      }

      try {
        let effectiveLlm: LLMSyncOptions | undefined = syncOpts.llm;
        if (!effectiveLlm) {
          const settings = loadLlmSettings();
          const activeProvider = settings.provider;
          const activeEntry = settings.providers[activeProvider];
          if (activeEntry?.apiKey?.trim()) {
            const isAuto = isModelAuto(settings, activeProvider);
            const isAutoInterval = activeEntry.intervalSec === null || activeEntry.intervalSec === undefined;
            effectiveLlm = {
              provider: activeProvider,
              apiKey: activeEntry.apiKey.trim(),
              model: isAuto ? undefined : (activeEntry.model || PROVIDER_DEFAULTS[activeProvider].defaultModel),
              adaptive: isAutoInterval,
              minIntervalMs:
                (isAutoInterval
                  ? PROVIDER_DEFAULTS[activeProvider].defaultIntervalSec
                  : (activeEntry.intervalSec ?? PROVIDER_DEFAULTS[activeProvider].defaultIntervalSec)) * 1000,
              allowModelHeal: isAuto,
              onModelFallback: (pickedModel: string) => {
                const currentSettings = loadLlmSettings();
                currentSettings.providers[activeProvider] = {
                  ...currentSettings.providers[activeProvider],
                  model: pickedModel,
                  modelAuto: false,
                };
                saveLlmSettings(currentSettings);
                setModelFallbackNotice(`Default model was retired; switched to ${pickedModel}.`);
                addLogEntry({ text: `Default model retired; switched to ${pickedModel}`, kind: 'warn' });
              },
            };
          }
        }

        const activeProviderId = effectiveLlm?.provider || loadLlmSettings().provider || 'google';
        const providerLabel = getLLMProvider(activeProviderId).label;

        const result = await syncStarredRepos({
          token,
          store,
          signal: controller.signal,
          llm: effectiveLlm,
          ignoreOtherCache: syncOpts.ignoreOtherCache,
          onProgress: p => {
            setPhase(p.phase);
            setProgress(p);

            if (p.phase === 'fetching') {
              addLogEntry({ text: `Fetching stars — page ${p.page ?? 1}`, kind: 'info' });
            } else if (p.phase === 'classifying') {
              const repoName = p.repoName ?? p.currentRepo ?? '';
              addLogEntry({ text: `Classifying ${p.done} / ${p.total || '?'} — ${repoName}`, kind: 'info' });
            } else if (p.phase === 'llm') {
              const repoName = p.repoName ?? p.currentRepo ?? '';
              addLogEntry({ text: `${providerLabel} · ${p.done} / ${p.total || '?'} — ${repoName}`, kind: 'info' });
            } else if (p.phase === 'waiting') {
              const sec = Math.ceil((p.waitingMs ?? 0) / 1000);
              if (p.isThrottled) {
                addLogEntry({ text: `${providerLabel} · rate limit, waiting ${sec}s`, kind: 'warn' });
              } else {
                addLogEntry({ text: `${providerLabel} · next in ${sec}s`, kind: 'info' });
              }
            }
          },
        });

        if (result.llmErrors && result.llmErrors > 0) {
          addLogEntry({ text: `${providerLabel} · ${result.llmErrors} repos fell back to rules`, kind: 'warn' });
        }
        const repos = result.envelope.repos || [];
        const total = repos.length;
        const nRule = repos.filter(r => r.classification?.method === 'rule').length;
        const nAI = repos.filter(r => r.classification?.method === 'llm').length;
        const nOther = repos.filter(r => r.category === 'Other').length;
        const nErrors = result.llmErrors ?? 0;
        addLogEntry({
          text: `Sync finished: ${total} repos, ${nRule} rule-based, ${nAI} AI, ${nOther} Other, ${nErrors} errors`,
          kind: 'success',
        });

        setDataset(result.envelope);
        setListsUnavailable(result.listsUnavailable);
        setViewerLogin(result.envelope.username || null);
        setLlmStatus(result.llmStatus);
        setLlmErrors(result.llmErrors);
        const nowIso = new Date().toISOString();
        setLastSyncAt(nowIso);
        setStatus('ready');
        setError(null);
        return true;
      } catch (err) {
        const syncErr = mapToSyncError(err);

        if (syncErr.code !== 'aborted') {
          addLogEntry({
            text: `Sync failed: ${syncErr.message}`,
            kind: 'error',
          });
        }

        if (syncErr.code === 'aborted') {
          // If aborted, keep previous ready state if dataset exists
          setDataset(prev => {
            if (prev) {
              setStatus('ready');
            } else {
              setStatus('idle');
            }
            return prev;
          });
          return false;
        }

        setError(syncErr);

        setDataset(prev => {
          const resolution = resolveSyncFailure(syncErr, Boolean(prev));
          if (resolution.shouldClearToken) {
            clearToken();
          }
          if (resolution.bannerMessage) {
            setTokenExpiredNotice(resolution.bannerMessage);
          } else if (syncErr.code !== 'invalid_token') {
            setTokenExpiredNotice(null);
          }

          if (resolution.keepCachedDataset && prev) {
            setStatus('ready');
            return prev;
          } else {
            setStatus('error');
            return null;
          }
        });
        return false;
      } finally {
        setIsBackgroundRefreshing(false);
        setPhase(null);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [store]
  );

  // Initialize and check stored dataset/token on mount
  useEffect(() => {
    let isMounted = true;

    async function initialize() {
      try {
        const [cachedDataset, cachedLastSyncAt, cachedViewerLogin] = await Promise.all([
          store.get<DatasetEnvelope>('dataset'),
          store.get<string>('lastSyncAt'),
          store.get<string>('viewerLogin'),
        ]);

        if (!isMounted) return;

        const storedToken = loadToken();

        if (cachedDataset) {
          setDataset(cachedDataset);
          setLastSyncAt(cachedLastSyncAt || null);
          setViewerLogin(cachedViewerLogin || cachedDataset.username || null);
          setStatus('ready');

          if (storedToken && shouldAutoRefresh(cachedLastSyncAt, Date.now(), options.autoRefreshMaxAgeMs)) {
            runSync(storedToken, true);
          }
        } else if (storedToken) {
          // Token exists but no cached dataset -> start initial sync
          runSync(storedToken, false);
        } else {
          setStatus('idle');
        }
      } catch {
        if (isMounted) {
          setStatus('idle');
        }
      }
    }

    initialize();

    return () => {
      isMounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [store, runSync, options.autoRefreshMaxAgeMs]);

  const connect = useCallback(
    async (token: string, remember: boolean): Promise<boolean> => {
      const ok = await runSync(token, false);
      if (ok) {
        saveToken(token, remember);
        setTokenExpiredNotice(null);
      }
      return ok;
    },
    [runSync]
  );

  const refresh = useCallback(async (): Promise<void> => {
    const token = loadToken();
    if (!token) {
      setError(
        mapToSyncError(
          new Error('No GitHub token stored. Please connect your GitHub account again.')
        )
      );
      setStatus('error');
      return;
    }
    await runSync(token, Boolean(dataset));
  }, [runSync, dataset]);

  const reclassifyOther = useCallback(
    async (llmConfig?: LLMSyncOptions): Promise<boolean> => {
      const token = loadToken();
      if (!token) return false;
      return runSync(token, false, { ignoreOtherCache: true, llm: llmConfig });
    },
    [runSync]
  );

  const fetchLlmModels = useCallback(
    async (providerId: LLMProviderId, apiKey: string): Promise<string[]> => {
      const provider = getLLMProvider(providerId);
      return provider.listModels({ apiKey });
    },
    []
  );

  const cancel = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsBackgroundRefreshing(false);
    setPhase(null);
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    cancel();
    clearToken();
    try {
      await Promise.all([
        store.delete('dataset'),
        store.delete('classificationCache'),
        store.delete('lastSyncAt'),
        store.delete('viewerLogin'),
      ]);
    } catch {
      // Ignore store deletion error
    }
    setDataset(null);
    setLastSyncAt(null);
    setViewerLogin(null);
    setListsUnavailable(false);
    setTokenExpiredNotice(null);
    setModelFallbackNotice(null);
    setError(null);
    setStatus('idle');
  }, [cancel, store]);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  const clearTokenExpiredNotice = useCallback((): void => {
    setTokenExpiredNotice(null);
  }, []);

  const clearModelFallbackNotice = useCallback((): void => {
    setModelFallbackNotice(null);
  }, []);

  const clearLlmNotice = useCallback((): void => {
    setLlmStatus('disabled');
    setModelFallbackNotice(null);
  }, []);

  const clearGeminiNotice = clearLlmNotice;

  return {
    status,
    phase,
    progress,
    error,
    lastSyncAt,
    viewerLogin,
    listsUnavailable,
    isBackgroundRefreshing,
    tokenExpiredNotice,
    llmStatus,
    llmErrors,
    geminiStatus: llmStatus,
    geminiErrors: llmErrors,
    modelFallbackNotice,
    dataset,
    connect,
    refresh,
    reclassifyOther,
    cancel,
    disconnect,
    clearError,
    clearTokenExpiredNotice,
    clearLlmNotice,
    clearGeminiNotice,
    clearModelFallbackNotice,
    fetchLlmModels,
    activityLog: activityLogSnapshot,
    clearActivityLog,
  };
}
