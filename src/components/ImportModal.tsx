import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, X, AlertCircle, FileJson, RotateCcw } from 'lucide-react';
import type { Repository } from '../types/repo.ts';
import { parseAndValidateDataset } from '../lib/datasetValidation.ts';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (repos: Repository[], fileName: string) => void;
  isImported: boolean;
  importedFileName?: string;
  onResetToDefault: () => void;
  defaultRepoCount: number;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  isImported,
  importedFileName,
  onResetToDefault,
  defaultRepoCount,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
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

  // Reset internal error state when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setIsDragging(false);
    }
  }, [isOpen]);

  const processFile = useCallback(
    (file: File) => {
      if (!file) return;

      // Basic validation on file type/extension
      if (!file.name.toLowerCase().endsWith('.json') && file.type && file.type !== 'application/json') {
        setErrorMessage('Only .json files are supported.');
        return;
      }

      // Check max reasonable file size (e.g. 25 MB)
      if (file.size > 25 * 1024 * 1024) {
        setErrorMessage('File size exceeds 25 MB limit.');
        return;
      }

      setErrorMessage(null);

      const reader = new FileReader();

      reader.onload = (event: ProgressEvent<FileReader>) => {
        try {
          const content = event.target?.result;
          if (typeof content !== 'string') {
            setErrorMessage('Failed to read file contents.');
            return;
          }

          const validation = parseAndValidateDataset(content);
          if (!validation.valid || !validation.data) {
            setErrorMessage(validation.error || 'Dataset validation failed.');
            return;
          }

          // Successful import
          onImport(validation.data, file.name);
          onClose();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error during import.';
          setErrorMessage(`Import error: ${msg}`);
        }
      };

      reader.onerror = () => {
        setErrorMessage('Failed to read the file from disk.');
      };

      reader.readAsText(file);
    },
    [onImport, onClose]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        processFile(file);
      }
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      processFile(file);
      // Reset input so the same file can be re-selected if desired
      e.target.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden flex flex-col text-[#c9d1d9]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[#21262d] border border-[#30363d] flex items-center justify-center text-[#58a6ff]">
              <Upload className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="import-modal-title" className="text-sm font-semibold text-white">
                Import Repository Dataset
              </h2>
              <p className="text-xs text-github-muted mt-0.5">
                Load a local <code className="text-[#58a6ff] text-[11px]">repos.json</code> into browser memory
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

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {/* Active Dataset Status / Revert Banner */}
          {isImported && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-[#21262d]/60 border border-[#388bfd]/30 text-xs">
              <div className="flex items-center gap-2 text-white">
                <FileJson className="w-4 h-4 text-[#58a6ff] shrink-0" aria-hidden="true" />
                <span>
                  Active: <strong className="text-[#58a6ff]">{importedFileName}</strong> (session memory)
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onResetToDefault();
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#c9d1d9] hover:text-white bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Use Default ({defaultRepoCount})</span>
              </button>
            </div>
          )}

          {/* Drag & Drop Area */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2.5 select-none ${
              isDragging
                ? 'border-[#58a6ff] bg-[#58a6ff]/10 text-white'
                : 'border-[#30363d] hover:border-[#8b949e] bg-[#0d1117]/60 hover:bg-[#0d1117]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileInputChange}
              aria-label="Upload JSON repository dataset"
            />
            <div className="w-10 h-10 rounded-full bg-[#21262d] border border-[#30363d] flex items-center justify-center text-github-muted group-hover:text-white transition-colors">
              <FileJson className="w-5 h-5 text-[#58a6ff]" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-medium text-white">
                Drag and drop your <code className="text-[#58a6ff]">repos.json</code> here
              </p>
              <p className="text-[11px] text-github-muted mt-0.5">
                or click to browse from your device
              </p>
            </div>
          </div>

          {/* Error Message Alert */}
          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3 rounded-lg bg-[#f85149]/10 border border-[#f85149]/30 text-xs text-[#ff7b72] animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#f85149]" aria-hidden="true" />
              <div className="flex-1 leading-relaxed">
                <strong>Validation Error:</strong> {errorMessage}
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-github-muted hover:text-white p-0.5 rounded transition-colors"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Privacy & Schema Notice */}
          <div className="text-[11px] text-github-muted/80 leading-relaxed border-t border-[#30363d]/60 pt-3">
            <p>
              🔒 <strong>Session memory only:</strong> The imported dataset is validated and stored strictly in browser memory for this session. No data is uploaded or transmitted anywhere.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#30363d] bg-[#161b22]/50 text-xs">
          <span className="text-github-muted text-[11px]">
            Format: Standard <code className="text-white/80">repos.json</code> schema
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 font-medium text-github-muted hover:text-white rounded-md hover:bg-[#21262d] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
