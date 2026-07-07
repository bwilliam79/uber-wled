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

  it('adds target_controller_id/target_wled_seg_id to calendar_events', () => {
    const db = createDb(':memory:');
    expect(columnNames(db, 'calendar_events')).toEqual(
      expect.arrayContaining(['target_controller_id', 'target_wled_seg_id'])
    );
  });

  it('rebuilds a pre-existing schedules table with a NOT NULL group_id: relaxes the constraint, adds the new target columns, and preserves existing rows', () => {
    const db = createDb(':memory:'); // migrations already ran; drop and recreate the OLD shape
    db.exec(`
      DROP TABLE schedules;
      CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron','sunrise','sunset','weekly')),
        cron_expr TEXT,
        days_of_week TEXT,
        time_of_day TEXT,
        offset_minutes INTEGER NOT NULL DEFAULT 0,
        latitude REAL,
        longitude REAL,
        group_id TEXT NOT NULL REFERENCES groups(id),
        action_type TEXT NOT NULL CHECK (action_type IN ('preset','theme','power','brightness')),
        action_payload TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      );
    `);
    db.prepare('INSERT INTO groups (id, name, sort_order) VALUES (?, ?, 0)').run('g1', 'Front porch');
    db.prepare(
      `INSERT INTO schedules (id, name, trigger_type, days_of_week, time_of_day, offset_minutes, group_id, action_type, action_payload, enabled)
       VALUES ('s1', 'Evening', 'weekly', '[1,2,3]', '18:00', 0, 'g1', 'power', '{"on":true}', 1)`
    ).run();

    const beforeCols = db.prepare('PRAGMA table_info(schedules)').all() as { name: string; notnull: number }[];
    expect(beforeCols.find((c) => c.name === 'group_id')!.notnull).toBe(1);

    runMigrations(db);

    const afterCols = db.prepare('PRAGMA table_info(schedules)').all() as { name: string; notnull: number }[];
    expect(afterCols.find((c) => c.name === 'group_id')!.notnull).toBe(0);
    expect(afterCols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['target_controller_id', 'target_wled_seg_id'])
    );

    const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get('s1') as any;
    expect(row.name).toBe('Evening');
    expect(row.group_id).toBe('g1');
    expect(row.target_controller_id).toBeNull();

    // The relaxed constraint actually accepts a NULL group_id now.
    db.prepare(
      "INSERT INTO controllers (id, name, host, source) VALUES ('c1', 'Cabinet', '10.0.0.5', 'manual')"
    ).run();
    expect(() =>
      db.prepare(
        `INSERT INTO schedules (id, name, trigger_type, days_of_week, time_of_day, offset_minutes, target_controller_id, action_type, action_payload, enabled)
         VALUES ('s2', 'Direct', 'weekly', '[1]', '08:00', 0, 'c1', 'power', '{"on":true}', 1)`
      ).run()
    ).not.toThrow();
  });

  it('adds target_controllers to schedules and calendar_events', () => {
    const db = createDb(':memory:');
    expect(columnNames(db, 'schedules')).toContain('target_controllers');
    expect(columnNames(db, 'calendar_events')).toContain('target_controllers');
  });

  it('backfills target_controllers from a pre-existing single target_controller_id/target_wled_seg_id row', () => {
    const db = createDb(':memory:'); // migrations already ran; simulate the OLD (pre-list) shape
    db.exec(`
      CREATE TABLE schedules_old (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron','sunrise','sunset','weekly')),
        cron_expr TEXT, days_of_week TEXT, time_of_day TEXT, offset_minutes INTEGER NOT NULL DEFAULT 0,
        latitude REAL, longitude REAL, group_id TEXT REFERENCES groups(id),
        target_controller_id TEXT REFERENCES controllers(id), target_wled_seg_id INTEGER,
        action_type TEXT NOT NULL CHECK (action_type IN ('preset','theme','power','brightness')),
        action_payload TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
      );
      DROP TABLE schedules;
      ALTER TABLE schedules_old RENAME TO schedules;
    `);
    db.prepare("INSERT INTO controllers (id, name, host, source) VALUES ('c1', 'Cabinet', '10.0.0.5', 'manual')").run();
    db.prepare(
      `INSERT INTO schedules (id, name, trigger_type, days_of_week, time_of_day, offset_minutes, target_controller_id, target_wled_seg_id, action_type, action_payload, enabled)
       VALUES ('s1', 'Direct segment', 'weekly', '[1]', '08:00', 0, 'c1', 2, 'power', '{"on":true}', 1)`
    ).run();
    expect(columnNames(db, 'schedules')).not.toContain('target_controllers');

    runMigrations(db);

    expect(columnNames(db, 'schedules')).toContain('target_controllers');
    const row = db.prepare('SELECT target_controllers FROM schedules WHERE id = ?').get('s1') as any;
    expect(JSON.parse(row.target_controllers)).toEqual([{ controllerId: 'c1', wledSegId: 2 }]);
  });
});
