import { describe, it, expect } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/schema.js';

function columnNames(db: ReturnType<typeof createDb>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe('schema migrations (phase B additions)', () => {
  it('adds icon and sort_order columns to groups', () => {
    const db = createDb(':memory:');
    const cols = columnNames(db, 'groups');
    expect(cols).toContain('icon');
    expect(cols).toContain('sort_order');
  });

  it('adds live_poll_interval_seconds to settings with default 2', () => {
    const db = createDb(':memory:');
    expect(columnNames(db, 'settings')).toContain('live_poll_interval_seconds');
    db.prepare(
      `INSERT INTO settings (id, include_prerelease_firmware, home_latitude, home_longitude,
         discovery_rescan_interval_minutes, schedule_import_disable_on_device_default,
         controller_status_poll_interval_minutes)
       VALUES (1, 0, NULL, NULL, 5, 0, 5)`
    ).run();
    const row = db.prepare('SELECT live_poll_interval_seconds FROM settings WHERE id = 1').get() as any;
    expect(row.live_poll_interval_seconds).toBe(2);
  });

  it('has the controller_capabilities table from the binding master schema', () => {
    const db = createDb(':memory:');
    expect(columnNames(db, 'controller_capabilities')).toEqual(
      expect.arrayContaining(['controller_id', 'vid', 'effects', 'palettes', 'fxdata', 'palette_previews', 'fetched_at'])
    );
  });

  it('is idempotent: running migrations twice does not throw', () => {
    const db = createDb(':memory:');
    expect(() => runMigrations(db)).not.toThrow();
  });
});
