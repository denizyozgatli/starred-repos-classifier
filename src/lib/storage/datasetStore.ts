import type { DatasetEnvelope } from '../../types/repo.ts';
import type { ClassificationCache } from '../../core/classify-repos.ts';
import type { ActivityLogEntry } from '../activityLog.ts';

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export type StoreKeyMap = {
  dataset: DatasetEnvelope;
  classificationCache: ClassificationCache;
  lastSyncAt: string;
  viewerLogin: string;
  syncLog: ActivityLogEntry[];
};

export const DB_NAME = 'starred-repos-classifier';
export const OBJECT_STORE_NAME = 'kv';
export const DB_VERSION = 1;

export class IndexedDbStore implements KeyValueStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not supported in this environment'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          db.createObjectStore(OBJECT_STORE_NAME);
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error || new Error('Failed to open IndexedDB'));
      };

      request.onblocked = () => {
        this.dbPromise = null;
        reject(new Error('IndexedDB open blocked'));
      };
    });

    return this.dbPromise;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECT_STORE_NAME, 'readonly');
      const store = tx.objectStore(OBJECT_STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        resolve(req.result !== undefined ? (req.result as T) : null);
      };

      req.onerror = () => {
        reject(req.error || new Error(`IndexedDB get failed for key: ${key}`));
      };
    });
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(OBJECT_STORE_NAME);
      const req = store.put(value, key);

      req.onsuccess = () => {
        resolve();
      };

      req.onerror = () => {
        reject(req.error || new Error(`IndexedDB set failed for key: ${key}`));
      };
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(OBJECT_STORE_NAME);
      const req = store.delete(key);

      req.onsuccess = () => {
        resolve();
      };

      req.onerror = () => {
        reject(req.error || new Error(`IndexedDB delete failed for key: ${key}`));
      };
    });
  }
}

export class MemoryStore implements KeyValueStore {
  private store = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const val = this.store.get(key);
    return val !== undefined ? (val as T) : null;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export function createDefaultStore(): KeyValueStore {
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbStore();
  }
  return new MemoryStore();
}

export const SYNC_LOG_KEY = 'syncLog';
export const SYNC_LOG_CAPACITY = 500;

export function sanitizeLogEntry(
  entry: ActivityLogEntry,
  redactKeys: string[] = []
): ActivityLogEntry | null {
  const text = entry.text;
  if (!text) return null;

  // Defensive secret-filter: drop any entry containing 'Bearer '
  if (/Bearer\s+/i.test(text)) {
    return null;
  }

  // Drop entry if it contains any configured key or token
  for (const key of redactKeys) {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (trimmed.length >= 6 && text.includes(trimmed)) {
      return null;
    }
  }

  // Defensive check for common secret patterns (GitHub PATs, OpenAI/Anthropic/Google keys)
  if (/(?:ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|sk-(?:proj-|ant-)?[a-zA-Z0-9_-]{20,}|(?:AIza|AQ\.)[a-zA-Z0-9_-]{20,})/i.test(text)) {
    return null;
  }

  return entry;
}

let syncLogWriteQueue: Promise<void> = Promise.resolve();

export async function flushSyncLog(): Promise<void> {
  await syncLogWriteQueue;
}

export async function getSyncLog(store: KeyValueStore = createDefaultStore()): Promise<ActivityLogEntry[]> {
  await syncLogWriteQueue;
  const entries = await store.get<ActivityLogEntry[]>(SYNC_LOG_KEY);
  return Array.isArray(entries) ? entries : [];
}

export function appendSyncLog(
  entry: ActivityLogEntry,
  options: {
    store?: KeyValueStore;
    storedKeys?: string[];
    capacity?: number;
  } = {}
): Promise<void> {
  const store = options.store ?? createDefaultStore();
  const capacity = options.capacity ?? SYNC_LOG_CAPACITY;
  const storedKeys = options.storedKeys ?? [];

  const sanitized = sanitizeLogEntry(entry, storedKeys);
  if (!sanitized) {
    return Promise.resolve();
  }

  syncLogWriteQueue = syncLogWriteQueue
    .then(async () => {
      const existing = (await store.get<ActivityLogEntry[]>(SYNC_LOG_KEY)) || [];
      const updated = [...(Array.isArray(existing) ? existing : []), sanitized];
      const capped = updated.length > capacity ? updated.slice(updated.length - capacity) : updated;
      await store.set(SYNC_LOG_KEY, capped);
    })
    .catch(() => {});

  return syncLogWriteQueue;
}

export async function clearSyncLog(store: KeyValueStore = createDefaultStore()): Promise<void> {
  await syncLogWriteQueue;
  await store.delete(SYNC_LOG_KEY);
}

