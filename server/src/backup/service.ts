import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/**
 * Config backup / restore. Deliberately generic and column-agnostic: it
 * SELECTs whole rows and re-INSERTs them by their own keys, so it survives
 * schema evolution (migration-added columns like schedules.target_controllers
 * or the nullable group_id round-trip without this module knowing about them)
 * and preserves primary keys exactly. Preserving ids is the whole point of a
 * full restore — a rebuilt instance re-discovers controllers under NEW ids,
 * so schedules/groups/sync-groups that reference the OLD ids would dangle
 * unless the controllers come back with their original ids too. That's why
 * "everything" includes controllers.
 *
 * Runtime/derived tables are intentionally excluded: wled_releases and
 * app_update_cache (GitHub caches), and controller_status /
 * controller_capabilities (re-polled from the live devices, and cascade-
 * deleted when their controller row is wiped anyway).
 */

// Parent tables first so a plain forward insert never references a not-yet-
// inserted row. (FK enforcement is off in this DB, but keeping the order
// correct means a restore also works if it's ever turned on.)
const BACKUP_TABLES = [
  'controllers',
  'groups',
  'sync_groups',
  'themes',
  'room_labels',
  'settings',
  'strips',
  'group_members',
  'sync_group_members',
  'schedules',
  'calendar_events'
] as const;

export const BACKUP_KIND = 'uber-wled-backup';
export const THEMES_KIND = 'uber-wled-themes';
export const SCHEDULES_KIND = 'uber-wled-schedules';
export const BACKUP_VERSION = 1;

type Row = Record<string, unknown>;

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: number;
  exportedAt: string;
  tables: Record<string, Row[]>;
}

function selectAll(db: Database.Database, table: string): Row[] {
  return db.prepare(`SELECT * FROM ${table}`).all() as Row[];
}

function insertRow(db: Database.Database, table: string, row: Row): void {
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  const placeholders = cols.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`).run(
    ...cols.map((c) => row[c])
  );
}

export function buildBackup(db: Database.Database, exportedAt: string): BackupFile {
  const tables: Record<string, Row[]> = {};
  for (const t of BACKUP_TABLES) tables[t] = selectAll(db, t);
  return { kind: BACKUP_KIND, version: BACKUP_VERSION, exportedAt, tables };
}

export class BackupFormatError extends Error {}

export function restoreBackup(db: Database.Database, payload: unknown): { restored: Record<string, number> } {
  if (!payload || typeof payload !== 'object') throw new BackupFormatError('not a backup file');
  const p = payload as Partial<BackupFile>;
  if (p.kind !== BACKUP_KIND) throw new BackupFormatError(`not an uber-wled backup (kind: ${String(p.kind)})`);
  if (!p.tables || typeof p.tables !== 'object') throw new BackupFormatError('backup has no tables');

  const restored: Record<string, number> = {};
  const tx = db.transaction(() => {
    // Wipe children-first so the delete order is valid under FK enforcement.
    for (const t of [...BACKUP_TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
    for (const t of BACKUP_TABLES) {
      const rows = (p.tables as Record<string, Row[]>)[t] ?? [];
      for (const row of rows) insertRow(db, t, row);
      restored[t] = rows.length;
    }
  });
  tx();
  return { restored };
}

// --- Themes-only export/import (themes have no foreign keys) ---

export function buildThemesExport(db: Database.Database, exportedAt: string) {
  return { kind: THEMES_KIND, version: BACKUP_VERSION, exportedAt, themes: selectAll(db, 'themes') };
}

/** Appends imported themes under fresh ids (so re-importing into the same
 *  instance never collides on primary key). */
export function importThemes(db: Database.Database, payload: unknown): { imported: number } {
  const p = payload as { kind?: string; themes?: Row[] };
  if (!p || p.kind !== THEMES_KIND || !Array.isArray(p.themes)) {
    throw new BackupFormatError('not an uber-wled themes export');
  }
  const tx = db.transaction((themes: Row[]) => {
    for (const t of themes) insertRow(db, 'themes', { ...t, id: randomUUID() });
  });
  tx(p.themes);
  return { imported: p.themes.length };
}

// --- Schedules + calendar-events export/import ---

export function buildSchedulesExport(db: Database.Database, exportedAt: string) {
  return {
    kind: SCHEDULES_KIND,
    version: BACKUP_VERSION,
    exportedAt,
    schedules: selectAll(db, 'schedules'),
    calendarEvents: selectAll(db, 'calendar_events')
  };
}

/**
 * Appends imported schedules and calendar events under fresh ids, preserving
 * their group_id / target-controller references. Foreign keys ARE enforced in
 * this DB, so a row whose referenced room/controller doesn't exist on this
 * instance would otherwise fail the whole import — instead each row is
 * inserted independently and any that reference something missing are skipped
 * and counted. Re-importing into the same instance (or one restored from a
 * full backup, where ids are preserved) imports everything; sharing a
 * schedules file into a different instance imports whatever lines up. The
 * rebuild-an-instance case is better served by a full backup, which brings
 * the referenced controllers/rooms along with it.
 */
export function importSchedules(
  db: Database.Database,
  payload: unknown
): { schedules: number; calendarEvents: number; skipped: number } {
  const p = payload as { kind?: string; schedules?: Row[]; calendarEvents?: Row[] };
  if (!p || p.kind !== SCHEDULES_KIND || !Array.isArray(p.schedules) || !Array.isArray(p.calendarEvents)) {
    throw new BackupFormatError('not an uber-wled schedules export');
  }
  // Deliberately NOT one transaction: a single dangling FK reference should
  // skip just that row, not roll back the whole import.
  const tryInsert = (table: string, row: Row): boolean => {
    try {
      insertRow(db, table, { ...row, id: randomUUID() });
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return false;
      throw err;
    }
  };

  let schedules = 0;
  let calendarEvents = 0;
  let skipped = 0;
  for (const s of p.schedules) tryInsert('schedules', s) ? schedules++ : skipped++;
  for (const e of p.calendarEvents) tryInsert('calendar_events', e) ? calendarEvents++ : skipped++;
  return { schedules, calendarEvents, skipped };
}
