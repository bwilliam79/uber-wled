import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS placements;
    DROP TABLE IF EXISTS floorplans;

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
      name TEXT NOT NULL,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
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
      schedule_import_disable_on_device_default INTEGER NOT NULL DEFAULT 0,
      controller_status_poll_interval_minutes INTEGER NOT NULL DEFAULT 5,
      live_poll_interval_seconds INTEGER NOT NULL DEFAULT 2
    );

    CREATE TABLE IF NOT EXISTS controller_status (
      controller_id TEXT PRIMARY KEY REFERENCES controllers(id) ON DELETE CASCADE,
      reachable INTEGER NOT NULL,
      info TEXT,
      state TEXT,
      polled_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS controller_capabilities (
      controller_id TEXT PRIMARY KEY REFERENCES controllers(id) ON DELETE CASCADE,
      vid INTEGER NOT NULL,
      effects TEXT NOT NULL, palettes TEXT NOT NULL, fxdata TEXT NOT NULL,
      palette_previews TEXT NOT NULL, fetched_at TEXT NOT NULL
    );

    -- Sync groups are a distinct concept from "groups" (rooms, above): a room
    -- is a Home-page organizational label with no bearing on real-time
    -- playback; a sync group is a set of controllers wired together via
    -- WLED's own native UDP sync (broadcast on LAN port 21324) so their
    -- effects/colors play in lockstep, entirely independent of room
    -- membership. "active" + "bitmask" track which of WLED's 8 native sync
    -- "group" bits (1,2,4,...,128) this sync group currently owns on the
    -- wire — null/0 when inactive. Only one sync group may hold a given bit
    -- at a time (enforced in the repository, not the schema).
    CREATE TABLE IF NOT EXISTS sync_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      bitmask INTEGER
    );

    CREATE TABLE IF NOT EXISTS sync_group_members (
      sync_group_id TEXT NOT NULL REFERENCES sync_groups(id),
      controller_id TEXT NOT NULL REFERENCES controllers(id),
      PRIMARY KEY (sync_group_id, controller_id)
    );
  `);

  // Idempotent column add for wled_releases caches created before the
  // `prerelease` column existed. We no longer DROP the cache on startup
  // (that wiped it every restart and forced a GitHub re-fetch); instead we
  // preserve the cache and add the missing column once if needed.
  const releaseCols = db.prepare('PRAGMA table_info(wled_releases)').all() as { name: string }[];
  if (!releaseCols.some((c) => c.name === 'prerelease')) {
    db.exec('ALTER TABLE wled_releases ADD COLUMN prerelease INTEGER NOT NULL DEFAULT 0');
  }

  // Idempotent column add for controllers rows created before the firmware
  // update feature existed. This one was missed when the feature shipped —
  // it was only ever added to the CREATE TABLE statement above, which is a
  // no-op for a controllers table that already existed (as production's
  // did) — so every pin attempt against a pre-existing install has always
  // failed with "no such column: pinned_asset_pattern", silently, until a
  // client-side fix started surfacing the error instead of swallowing it.
  const controllerCols = db.prepare('PRAGMA table_info(controllers)').all() as { name: string }[];
  if (!controllerCols.some((c) => c.name === 'pinned_asset_pattern')) {
    db.exec('ALTER TABLE controllers ADD COLUMN pinned_asset_pattern TEXT');
  }

  // Idempotent column add for settings rows created before the controller
  // status poll interval existed.
  const settingsCols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[];
  if (!settingsCols.some((c) => c.name === 'controller_status_poll_interval_minutes')) {
    db.exec('ALTER TABLE settings ADD COLUMN controller_status_poll_interval_minutes INTEGER NOT NULL DEFAULT 5');
  }

  // Idempotent column adds for groups/settings rows created before phase B
  // (control plane redesign): room icons, Home tile ordering, and the SSE
  // fast-poll interval.
  const groupCols = db.prepare('PRAGMA table_info(groups)').all() as { name: string }[];
  if (!groupCols.some((c) => c.name === 'icon')) {
    db.exec('ALTER TABLE groups ADD COLUMN icon TEXT');
  }
  if (!groupCols.some((c) => c.name === 'sort_order')) {
    db.exec('ALTER TABLE groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }
  if (!settingsCols.some((c) => c.name === 'live_poll_interval_seconds')) {
    db.exec('ALTER TABLE settings ADD COLUMN live_poll_interval_seconds INTEGER NOT NULL DEFAULT 2');
  }

  // Schedules/calendar events could only ever target a Room group. Widen
  // both to optionally target a specific controller (whole-device or one
  // segment) instead, matching the Target union Control's /api/control/apply
  // already uses (control/applyV2.ts) — engine.ts now resolves either shape
  // through the same expandTargets() rather than duplicating group-lookup
  // logic. Exactly one of group_id / target_controller_id should be set;
  // enforced in the repository layer, not a CHECK constraint (keeping this
  // migration a plain additive column set on calendar_events, which already
  // had a nullable group_id).
  const calendarCols = db.prepare('PRAGMA table_info(calendar_events)').all() as { name: string }[];
  if (!calendarCols.some((c) => c.name === 'target_controller_id')) {
    db.exec('ALTER TABLE calendar_events ADD COLUMN target_controller_id TEXT REFERENCES controllers(id)');
    db.exec('ALTER TABLE calendar_events ADD COLUMN target_wled_seg_id INTEGER');
  }

  // schedules.group_id was NOT NULL — SQLite can't relax a column
  // constraint via ALTER, so this rebuilds the table (create new schema,
  // copy rows, swap in) the one time it's still NOT NULL, wrapped in a
  // transaction so a crash mid-migration can't leave a half-renamed table.
  const scheduleCols = db.prepare('PRAGMA table_info(schedules)').all() as { name: string; notnull: number }[];
  if (scheduleCols.some((c) => c.name === 'group_id' && c.notnull === 1)) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE schedules_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron','sunrise','sunset','weekly')),
          cron_expr TEXT,
          days_of_week TEXT,
          time_of_day TEXT,
          offset_minutes INTEGER NOT NULL DEFAULT 0,
          latitude REAL,
          longitude REAL,
          group_id TEXT REFERENCES groups(id),
          target_controller_id TEXT REFERENCES controllers(id),
          target_wled_seg_id INTEGER,
          action_type TEXT NOT NULL CHECK (action_type IN ('preset','theme','power','brightness')),
          action_payload TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO schedules_new (
          id, name, trigger_type, cron_expr, days_of_week, time_of_day, offset_minutes,
          latitude, longitude, group_id, target_controller_id, target_wled_seg_id,
          action_type, action_payload, enabled
        )
        SELECT
          id, name, trigger_type, cron_expr, days_of_week, time_of_day, offset_minutes,
          latitude, longitude, group_id, NULL, NULL,
          action_type, action_payload, enabled
        FROM schedules;
        DROP TABLE schedules;
        ALTER TABLE schedules_new RENAME TO schedules;
      `);
    })();
  }

  // Widen controller-direct targeting from a single controller to a list —
  // picking several individual controllers on one schedule/event shouldn't
  // require first creating a Room group for them. target_controller_id/
  // target_wled_seg_id become unused legacy columns (left in place; SQLite
  // doesn't need them dropped) once this backfill runs; the repository
  // layer only reads/writes target_controllers going forward.
  for (const table of ['schedules', 'calendar_events']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some((c) => c.name === 'target_controllers')) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN target_controllers TEXT`);
    const rows = db.prepare(
      `SELECT id, target_controller_id, target_wled_seg_id FROM ${table} WHERE target_controller_id IS NOT NULL`
    ).all() as { id: string; target_controller_id: string; target_wled_seg_id: number | null }[];
    const update = db.prepare(`UPDATE ${table} SET target_controllers = ? WHERE id = ?`);
    for (const row of rows) {
      const json = JSON.stringify([{ controllerId: row.target_controller_id, wledSegId: row.target_wled_seg_id }]);
      update.run(json, row.id);
    }
  }
}
