import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../../src/db/client.js';
import { runAutoBackupIfDue, listAutoBackups, isAutoBackupName } from '../../src/backup/autoBackup.js';

describe('autoBackup', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'uwled-bak-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('writes one snapshot per calendar day (idempotent) and lists it', () => {
    const db = createDb(':memory:');
    const dir = tmp();
    const day = new Date('2026-07-10T03:30:00Z');
    expect(runAutoBackupIfDue(db, dir, 14, day)).toBe(true); // created
    expect(runAutoBackupIfDue(db, dir, 14, day)).toBe(false); // same day → no-op
    const list = listAutoBackups(dir);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('uber-wled-backup-2026-07-10.json');
    expect(list[0].size).toBeGreaterThan(0);
  });

  it('prunes to the retention limit, keeping the newest', () => {
    const db = createDb(':memory:');
    const dir = tmp();
    for (let d = 1; d <= 5; d++) {
      runAutoBackupIfDue(db, dir, 3, new Date(`2026-07-0${d}T03:00:00Z`));
    }
    expect(listAutoBackups(dir).map((e) => e.name)).toEqual([
      'uber-wled-backup-2026-07-05.json',
      'uber-wled-backup-2026-07-04.json',
      'uber-wled-backup-2026-07-03.json'
    ]);
  });

  it('rejects non-auto-backup / path-traversal names', () => {
    expect(isAutoBackupName('uber-wled-backup-2026-07-10.json')).toBe(true);
    expect(isAutoBackupName('../secret.json')).toBe(false);
    expect(isAutoBackupName('uber-wled-backup-nope.json')).toBe(false);
    expect(isAutoBackupName('uber-wled-backup-2026-07-10.json/../x')).toBe(false);
  });
});
