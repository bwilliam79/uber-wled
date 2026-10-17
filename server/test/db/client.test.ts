import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb } from '../../src/db/client.js';

describe('createDb', () => {
  it('creates all expected tables', () => {
    const db = createDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name)
      .sort();
    expect(tables).toEqual([
      'app_update_cache',
      'calendar_events',
      'controller_active_look',
      'controller_capabilities',
      'controller_status',
      'controllers',
      'group_members',
      'groups',
      'room_labels',
      'schedules',
      'settings',
      'strips',
      'sync_group_members',
      'sync_groups',
      'themes',
      'wled_releases'
    ]);
  });

  it('is idempotent: createDb twice on a file keeps controller_active_look and its rows', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'uber-wled-looks-'));
    const file = path.join(dir, 'test.db');
    try {
      const first = createDb(file);
      first.prepare(
        `INSERT INTO controllers (id, name, host, source) VALUES ('c1', 'Cabinet', '10.0.0.1', 'manual')`
      ).run();
      first.prepare(
        `INSERT INTO controller_active_look
           (controller_id, theme_id, source, source_id, applied_at, expires_at)
         VALUES ('c1', 'theme-1', 'manual', NULL, '2026-10-31T18:00:00.000Z', NULL)`
      ).run();
      first.close();

      const second = createDb(file);
      const row = second.prepare(
        'SELECT theme_id, source FROM controller_active_look WHERE controller_id = ?'
      ).get('c1') as { theme_id: string; source: string };
      expect(row).toEqual({ theme_id: 'theme-1', source: 'manual' });
      const cols = (second.prepare('PRAGMA table_info(controller_active_look)').all() as { name: string }[]).map(
        (c) => c.name
      );
      expect(cols).toEqual(['controller_id', 'theme_id', 'source', 'source_id', 'applied_at', 'expires_at']);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
