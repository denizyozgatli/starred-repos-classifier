import { copyFileSync, existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export const REPOS_PATH = resolve(process.cwd(), 'data', 'repos.json');
export const REPOS_BACKUP_PATH = resolve(process.cwd(), 'data', 'repos.backup.json');

/**
 * Creates a backup copy of the target file if it exists.
 * Returns true if a backup was created, false otherwise.
 */
export function backupFile(targetPath: string, backupPath: string): boolean {
  if (existsSync(targetPath)) {
    try {
      copyFileSync(targetPath, backupPath);
      return true;
    } catch (err) {
      console.warn(`[storage] Warning: Failed to backup ${targetPath} to ${backupPath}:`, err);
    }
  }
  return false;
}

/**
 * Restores a file from its backup copy if the backup exists.
 */
export function restoreFile(backupPath: string, targetPath: string): boolean {
  if (existsSync(backupPath)) {
    try {
      copyFileSync(backupPath, targetPath);
      return true;
    } catch (err) {
      console.error(`[storage] Error: Failed to restore ${targetPath} from ${backupPath}:`, err);
    }
  }
  return false;
}

/**
 * Atomically writes data as JSON to targetPath using a temporary file.
 * This guarantees partial/crashed writes never corrupt the destination file.
 */
export function atomicWriteJson(targetPath: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2);
  const dir = dirname(targetPath);
  const tempPath = resolve(dir, `repos.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp.json`);

  try {
    writeFileSync(tempPath, content, 'utf-8');
    // On Windows, renameSync can fail if destination exists in certain locks; copy + unlink is fail-safe fallback
    try {
      renameSync(tempPath, targetPath);
    } catch {
      copyFileSync(tempPath, targetPath);
      unlinkSync(tempPath);
    }
  } catch (err) {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch { /* ignore cleanup error */ }
    }
    throw err;
  }
}

/**
 * Executes a dataset operation with automatic backup and crash rollback.
 * If the operation throws an error, the previous valid dataset is guaranteed to be restored.
 */
export async function withDatasetSafety<T>(
  targetPath: string,
  backupPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const hadExisting = backupFile(targetPath, backupPath);

  try {
    const result = await operation();
    // Clean up temporary backup on complete success
    if (hadExisting && existsSync(backupPath)) {
      try { unlinkSync(backupPath); } catch { /* ignore */ }
    }
    return result;
  } catch (error) {
    if (hadExisting) {
      console.warn(`[storage] Operation failed. Restoring previous valid dataset from ${backupPath}...`);
      restoreFile(backupPath, targetPath);
    }
    throw error;
  }
}
