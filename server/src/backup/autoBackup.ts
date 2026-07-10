import { mkdirSync, readdirSync, writeFileSync, unlinkSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type Database from 'better-sqlite3';
import { buildBackup, restoreBackup } from './service.js';

const PREFIX = 'uber-wled-backup-';
export const DEFAULT_RETENTION = 14;

/** Auto-backups live next to the SQLite DB, in a `backups/` sibling folder. */
export function autoBackupDir(dbPath: string): string {
  return join(dirname(dbPath), 'backups');
}

/** Reject anything that isn't a plain auto-backup filename (no path traversal). */
export function isAutoBackupName(name: string): boolean {
  return /^uber-wled-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name);
}

export interface AutoBackupEntry {
  name: string;
  size: number;
  createdAt: string;
}

export function listAutoBackups(dir: string): AutoBackupEntry[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return []; // dir not created yet
  }
  return files
    .filter(isAutoBackupName)
    .sort()
    .reverse() // newest first (filenames are date-sorted)
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString() };
    });
}

export function readAutoBackup(dir: string, name: string): string {
  if (!isAutoBackupName(name)) throw new Error('invalid backup name');
  return readFileSync(join(dir, name), 'utf-8');
}

export function restoreAutoBackup(db: Database.Database, dir: string, name: string) {
  const payload = JSON.parse(readAutoBackup(dir, name));
  return restoreBackup(db, payload);
}

/**
 * Write today's snapshot if one doesn't already exist, then prune to the newest
 * `retention` files. Idempotent and cheap — safe to call on startup and hourly;
 * it only writes once per calendar day. Returns true if a file was created.
 */
export function runAutoBackupIfDue(
  db: Database.Database,
  dir: string,
  retention = DEFAULT_RETENTION,
  now = new Date()
): boolean {
  mkdirSync(dir, { recursive: true });
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const todaysFile = `${PREFIX}${date}.json`;

  const existing = readdirSync(dir).filter(isAutoBackupName);
  let created = false;
  if (!existing.includes(todaysFile)) {
    const backup = buildBackup(db, now.toISOString());
    writeFileSync(join(dir, todaysFile), JSON.stringify(backup));
    created = true;
  }

  // Prune oldest beyond retention (ascending sort → oldest first).
  const all = readdirSync(dir).filter(isAutoBackupName).sort();
  for (const f of all.slice(0, Math.max(0, all.length - retention))) {
    unlinkSync(join(dir, f));
  }
  return created;
}
