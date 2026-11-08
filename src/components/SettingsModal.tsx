import React, { useState, useEffect, useRef } from 'react';
import { Settings, X, Eye, EyeOff, ShieldCheck, Sparkles, Trash2, Check } from 'lucide-react';
import {
  loadGeminiKey,
  saveGeminiKey,
  clearGeminiKey,
  isGeminiKeyRemembered,
  loadGeminiSettings,
  saveGeminiSettings,
} from '../lib/storage/settings.ts';
import { GEMINI_MODEL } from '../core/llm.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReclassifyOther?: () => Promise<void>;
  isSyncing?: boolean;
  hasCachedData?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onReclassifyOther,
  isSyncing = false,
  hasCachedData = false,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(GEMINI_MODEL);
  const [intervalSec, setIntervalSec] = useState(4.0);
  const [savedBanner, setSavedBanner] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Load stored settings on open
  useEffect(() => {
    if (isOpen) {
      setApiKey(loadGeminiKey() || '');
      setRemember(isGeminiKeyRemembered());
      const settings = loadGeminiSettings();
      setModel(settings.model || GEMINI_MODEL);
      setIntervalSec(settings.intervalSec || 4.0);
      setSavedBanner(false);
    }
  }, [isOpen]);

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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveGeminiKey(apiKey, remember);
    saveGeminiSettings(model, Math.max(1, intervalSec));
    setSavedBanner(true);
    setTimeout(() => {
      setSavedBanner(false);
      onClose();
    }, 600);
  };

  const handleRemoveKey = () => {
    clearGeminiKey();
    setApiKey('');
    setRemember(false);
  };

  const handleReclassify = async () => {
    saveGeminiKey(apiKey, remember);
    saveGeminiSettings(model, Math.max(1, intervalSec));
    onClose();
    if (onReclassifyOther) {
      await onReclassifyOther();
    }
  };

  const hasKey = Boolean(apiKey.trim());

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
        className="w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-[#c9d1d9]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#58a6ff]/10 border border-[#58a6ff]/30 flex items-center justify-center text-[#58a6ff]">
              <Settings className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="settings-modal-title" className="text-sm font-semibold text-white">
                Classification Settings
              </h2>
              <p className="text-xs text-github-muted mt-0.5">
                Configure optional in-browser Gemini LLM classification
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-github-muted hover:text-white p-1 rounded-md hover:bg-[#21262d] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
          {savedBanner && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#238636]/15 border border-[#238636]/30 text-[#3fb950] animate-in fade-in">
              <Check className="w-4 h-4 shrink-0" />
              <span>Settings saved successfully.</span>
            </div>
          )}

          {/* Gemini Key Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="gemini-key-input" className="font-semibold text-white/90">
                Gemini API key (optional)
              </label>
              {hasKey && (
                <button
                  type="button"
                  onClick={handleRemoveKey}
                  className="text-[11px] text-[#ff7b72] hover:text-[#f85149] inline-flex items-center gap-1 transition-colors cursor-pointer"
                  title="Remove stored Gemini API key"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove key</span>
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="gemini-key-input"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                autoComplete="off"
                spellCheck="false"
                className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs font-mono px-3.5 py-2.5 pr-11 text-white placeholder:text-github-muted placeholder:font-sans focus-visible:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-github-muted hover:text-white p-1 rounded-md transition-colors cursor-pointer"
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                title={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember Key Checkbox */}
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                className="w-4 h-4 rounded border-[#30363d] bg-[#0d1117] text-[#238636] focus:ring-[#58a6ff] focus:ring-offset-0 transition-colors"
              />
              <span className="text-white/90 font-medium">Remember on this device</span>
            </label>
            {remember && (
              <p className="text-[11px] text-[#e3b341] pl-6 leading-relaxed">
                Warning: The key will be stored unencrypted in your browser's localStorage.
              </p>
            )}
          </div>

          {/* Model & Interval Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <label htmlFor="gemini-model-input" className="font-semibold text-white/90">
                Model
              </label>
              <input
                id="gemini-model-input"
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="gemini-3.8-flash"
                className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs font-mono px-3 py-2 text-white placeholder:text-github-muted focus-visible:outline-none transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="gemini-interval-input" className="font-semibold text-white/90">
                Request interval (seconds)
              </label>
              <input
                id="gemini-interval-input"
                type="number"
                min="1"
                step="0.5"
                value={intervalSec}
                onChange={e => setIntervalSec(parseFloat(e.target.value) || 1)}
                className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs font-mono px-3 py-2 text-white placeholder:text-github-muted focus-visible:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Notice Text */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#21262d]/60 border border-[#30363d] text-[11px] text-github-muted leading-relaxed">
            <ShieldCheck className="w-4 h-4 shrink-0 text-[#58a6ff] mt-0.5" aria-hidden="true" />
            <span>
              The key is sent directly from your browser to Google's Gemini API. Restrict the key to this site's URL (HTTP referrer) in Google AI Studio / Cloud Console.
            </span>
          </div>

          {/* Re-classify Other Repos Action */}
          {hasCachedData && onReclassifyOther && (
            <div className="pt-2 border-t border-[#30363d] flex items-center justify-between">
              <div>
                <p className="text-white font-medium">Re-classify ambiguous repositories</p>
                <p className="text-[11px] text-github-muted">
                  Retry all repositories currently labeled as "Other" with Gemini
                </p>
              </div>
              <button
                type="button"
                onClick={handleReclassify}
                disabled={isSyncing || !hasKey}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#a371f7]/15 border border-[#a371f7]/30 text-[#d2a8ff] hover:bg-[#a371f7]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                title={!hasKey ? 'Please enter a Gemini API key first' : 'Re-classify Other repos'}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Re-classify 'Other' repos</span>
              </button>
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#30363d]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 font-medium text-github-muted hover:text-white rounded-lg hover:bg-[#21262d] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-lg font-semibold focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors cursor-pointer shadow-sm"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
