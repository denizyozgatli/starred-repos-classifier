export type ActivityLogKind = 'info' | 'warn' | 'error' | 'success';

export interface ActivityLogEntry {
  ts: number;
  text: string;
  kind: ActivityLogKind;
}

export interface ActivityLog {
  add(entry: { text: string; kind?: ActivityLogKind; ts?: number }): void;
  entries(): ReadonlyArray<ActivityLogEntry>;
  clear(): void;
  size(): number;
}

/**
 * Creates a bounded ring buffer for tracking live activity events.
 * Newest entries are appended to the end. When capacity is exceeded,
 * the oldest entry is silently dropped.
 */
export function createActivityLog(capacity: number = 50): ActivityLog {
  const maxCap = Math.max(1, capacity);
  let buffer: ActivityLogEntry[] = [];

  return {
    add(entry: { text: string; kind?: ActivityLogKind; ts?: number }): void {
      const item: ActivityLogEntry = {
        ts: entry.ts ?? Date.now(),
        text: entry.text,
        kind: entry.kind ?? 'info',
      };
      if (buffer.length >= maxCap) {
        buffer.shift();
      }
      buffer.push(item);
    },
    entries(): ReadonlyArray<ActivityLogEntry> {
      return buffer.slice();
    },
    clear(): void {
      buffer = [];
    },
    size(): number {
      return buffer.length;
    },
  };
}
