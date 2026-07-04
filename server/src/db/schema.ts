import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS placements;
    DROP TABLE IF EXISTS floorplans;
    DROP TABLE IF EXISTS wled_releases;

    CREATE TABLE IF NOT EXISTS controllers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK (source IN ('discovered','manual')),
      stale INTEGER NOT NULL DEFAULT 0,
      pinned_asset_pattern TEXT
    );

    CREATE TABLE IF NOT EXISTS strips (
      id TEXT PRIMARY KEY,
      controller_id TEXT NOT NULL REFERENCES controllers(id),
      wled_seg_id INTEGER NOT NULL,
      points TEXT NOT NULL,
      label TEXT
    );

    CREATE TABLE IF NOT EXISTS room_labels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL REFERENCES groups(id),
      controller_id TEXT NOT NULL REFERENCES controllers(id),
      wled_seg_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, controller_id, wled_seg_id)
    );

    CREATE TABLE IF NOT EXISTS themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      effect INTEGER NOT NULL,
      palette INTEGER NOT NULL,
      colors TEXT NOT NULL,
      brightness INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
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

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('holiday','custom')),
      date_rule TEXT NOT NULL,
      recurs_yearly INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 0,
      group_id TEXT REFERENCES groups(id),
      trigger_time TEXT NOT NULL,
      action_type TEXT CHECK (action_type IN ('preset','theme','power','brightness')),
      action_payload TEXT
    );

    CREATE TABLE IF NOT EXISTS wled_releases (
      tag TEXT PRIMARY KEY,
      published_at TEXT NOT NULL,
      prerelease INTEGER NOT NULL DEFAULT 0,
      assets TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      include_prerelease_firmware INTEGER NOT NULL DEFAULT 0,
      home_latitude REAL,
      home_longitude REAL,
      discovery_rescan_interval_minutes INTEGER NOT NULL DEFAULT 5,
      schedule_import_disable_on_device_default INTEGER NOT NULL DEFAULT 0
    );
  `);
}
