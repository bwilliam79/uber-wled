# Phase B — Server: Fan-out v2 + SSE Live + Device Management Routes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Ship the server half of the control plane: the abstract fan-out `POST /api/control/apply` v2 (targets + patch with per-device name resolution), the refcounted SSE live stream `GET /api/live`, device management routes (presets, config with dry-run diff, reboot), widened segments routes, and the groups/settings schema additions.

**Architecture:** All new code follows the existing Express + better-sqlite3 repository pattern: pure logic in dedicated modules (`control/applyV2.ts`, `live/sessions.ts`, `devices/configDiff.ts`, `devices/presets.ts`) with unit tests, thin routers with supertest tests, device I/O only through `server/src/wled/client.ts` (mocked via `vi.stubGlobal('fetch', …)` in route tests). Phase B consumes Phase A's capability cache strictly through the master plan's binding `controller_capabilities` table schema and the widened WLED client; each consuming task contains an "ensure present" step with the exact required code so drift from Phase A cannot strand an implementer.

**Tech Stack:** Node 20 + TypeScript (ESM, `.js` import suffixes) + Express 4 + better-sqlite3; Vitest + supertest. No new dependencies.

**Phase dependency:** Phase A (`01-server-wled-v2.md`, same directory). Phase A ships the widened wire types (`WledSegment`, `WledStatePatch`, `WledNightlight`, `WledUdpn`, `WledSegmentPatch`), the widened `setState(host, patch: WledStatePatch)`, the device ops (`patchConfig`, `savePreset`, `deletePreset`, `reboot`, `setNightlight`), the `controller_capabilities` table, and `createCapabilitiesRepository`. Everywhere Phase B touches those, this plan quotes Phase A's exact produced signature (verbatim from `01-server-wled-v2.md`) and includes an idempotent "verify/ensure" step so the task is executable even if Phase A's implementation drifted (per the master plan, contracts in `00-master.md` override everything).

## Global Constraints

- LAN-only: no external network calls at runtime from the client bundle
  (fonts self-hosted via @fontsource; the only GitHub calls stay in the
  existing server firmware module).
- Every fan-out write to a device includes `udpn: { nn: true }`.
- Real-hardware testing policy (from spec): state-level ops only, always
  capture-then-restore; NEVER config/preset/reboot/OTA writes against real
  devices autonomously.
- TDD per task; run the owning package's test suite before each commit; one
  commit per task minimum.
- All new UI must work at 390px and 1440px widths; touch targets ≥ 40px.
- Keep the existing v1 `POST /api/control/apply` action route working until
  Phase I migrates the scheduler + calendar to v2 and deletes v1.
- Versions: client and server both become `1.0.0` in Phase I (not before).

## Test commands

- Single file: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- <file>` (the `test` script is `vitest run`, so the extra arg is a vitest filename filter).
- Full suite (run before every commit): `cd /Users/bwwilliams/github/uber-wled/server && npm test`

## Real-device fixture provenance

All fixtures in this plan were probed read-only from the real controller at `http://192.168.1.86` on 2026-07-04 (WLED 16.0.0 "Niji", `vid` 2605030, ESP32, 48 LEDs in two segments 0–39 and 39–48, RGBW). Never POST to that device while implementing this plan.

---

## Task 1: Schema additions + `livePollIntervalSeconds` setting

**Files:**
- Modify: `server/src/db/schema.ts` (groups CREATE at lines 32–35, settings CREATE at lines 90–98, idempotent-ALTER block at lines 112–123)
- Modify: `server/src/settings/repository.ts` (whole file shown below)
- Test (create): `server/test/db/schema.test.ts`
- Test (modify): `server/test/settings/routes.test.ts` (default-settings expectation at lines 22–29)

**Interfaces:**
- Consumes: existing `runMigrations(db)` / `createDb(path)` (`server/src/db/client.ts:4`); master schema contract (binding):
  ```sql
  ALTER TABLE groups ADD COLUMN icon TEXT;                                   -- nullable
  ALTER TABLE groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE settings ADD COLUMN live_poll_interval_seconds INTEGER NOT NULL DEFAULT 2;
  CREATE TABLE IF NOT EXISTS controller_capabilities (
    controller_id TEXT PRIMARY KEY REFERENCES controllers(id) ON DELETE CASCADE,
    vid INTEGER NOT NULL,
    effects TEXT NOT NULL, palettes TEXT NOT NULL, fxdata TEXT NOT NULL,
    palette_previews TEXT NOT NULL, fetched_at TEXT NOT NULL
  );
  ```
- Produces: columns `groups.icon`, `groups.sort_order`, `settings.live_poll_interval_seconds`; `Settings.livePollIntervalSeconds: number` (default 2) on the object returned by `createSettingsRepository(db).get()/update()`.

**Steps:**

- [ ] Write the failing schema test at `server/test/db/schema.test.ts`:

  ```ts
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
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/db/schema.test.ts` — expect FAIL: `expected [...] to include 'icon'` (and, if Phase A did not ship yet, `no such table: controller_capabilities` from `PRAGMA` returning empty → arrayContaining failure).

- [ ] Implement in `server/src/db/schema.ts`. Replace the `groups` CREATE block (lines 32–35) with:

  ```sql
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
  ```

  Replace the `settings` CREATE block (lines 90–98) with:

  ```sql
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
  ```

  Ensure the master's `controller_capabilities` CREATE TABLE (verbatim SQL from Interfaces above) is present inside the `db.exec(...)` block — Phase A Task 6 adds it immediately after the `controller_status` table; add it if missing (CREATE TABLE IF NOT EXISTS is idempotent either way). Then append to the idempotent-ALTER section at the bottom of `runMigrations` (after line 123):

  ```ts
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
  ```

  (`settingsCols` already exists at line 120; reuse it.)

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/db/schema.test.ts` — expect PASS (4 tests).

- [ ] Write the failing settings-repo test by editing `server/test/settings/routes.test.ts`: change the default-settings expectation (lines 22–29) to include the new field, and add a persistence test after the existing patch test:

  ```ts
      expect(res.body).toEqual({
        includePrereleaseFirmware: false,
        homeLatitude: null,
        homeLongitude: null,
        discoveryRescanIntervalMinutes: 5,
        scheduleImportDisableOnDeviceDefault: false,
        controllerStatusPollIntervalMinutes: 5,
        livePollIntervalSeconds: 2
      });
  ```

  ```ts
    it('persists livePollIntervalSeconds', async () => {
      const patch = await request(app).patch('/api/settings').send({ livePollIntervalSeconds: 5 });
      expect(patch.status).toBe(200);
      expect(patch.body.livePollIntervalSeconds).toBe(5);

      const get = await request(app).get('/api/settings');
      expect(get.body.livePollIntervalSeconds).toBe(5);
    });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/settings/routes.test.ts` — expect FAIL: `expected { … } to deeply equal { … livePollIntervalSeconds: 2 }`.

- [ ] Implement by widening `server/src/settings/repository.ts` (full file):

  ```ts
  import type Database from 'better-sqlite3';

  export interface Settings {
    includePrereleaseFirmware: boolean;
    homeLatitude: number | null;
    homeLongitude: number | null;
    discoveryRescanIntervalMinutes: number;
    scheduleImportDisableOnDeviceDefault: boolean;
    controllerStatusPollIntervalMinutes: number;
    livePollIntervalSeconds: number;
  }

  const DEFAULTS: Settings = {
    includePrereleaseFirmware: false,
    homeLatitude: null,
    homeLongitude: null,
    discoveryRescanIntervalMinutes: 5,
    scheduleImportDisableOnDeviceDefault: false,
    controllerStatusPollIntervalMinutes: 5,
    livePollIntervalSeconds: 2
  };

  function fromRow(row: any): Settings {
    return {
      includePrereleaseFirmware: !!row.include_prerelease_firmware,
      homeLatitude: row.home_latitude,
      homeLongitude: row.home_longitude,
      discoveryRescanIntervalMinutes: row.discovery_rescan_interval_minutes,
      scheduleImportDisableOnDeviceDefault: !!row.schedule_import_disable_on_device_default,
      controllerStatusPollIntervalMinutes: row.controller_status_poll_interval_minutes,
      livePollIntervalSeconds: row.live_poll_interval_seconds
    };
  }

  export function createSettingsRepository(db: Database.Database) {
    function ensureRow(): Settings {
      const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
      if (row) return fromRow(row);
      db.prepare(
        `INSERT INTO settings (id, include_prerelease_firmware, home_latitude, home_longitude,
           discovery_rescan_interval_minutes, schedule_import_disable_on_device_default,
           controller_status_poll_interval_minutes, live_poll_interval_seconds)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        DEFAULTS.includePrereleaseFirmware ? 1 : 0,
        DEFAULTS.homeLatitude,
        DEFAULTS.homeLongitude,
        DEFAULTS.discoveryRescanIntervalMinutes,
        DEFAULTS.scheduleImportDisableOnDeviceDefault ? 1 : 0,
        DEFAULTS.controllerStatusPollIntervalMinutes,
        DEFAULTS.livePollIntervalSeconds
      );
      return { ...DEFAULTS };
    }

    return {
      get(): Settings {
        return ensureRow();
      },
      update(patch: Partial<Settings>): Settings {
        const next = { ...ensureRow(), ...patch };
        db.prepare(
          `UPDATE settings SET include_prerelease_firmware = ?, home_latitude = ?, home_longitude = ?,
            discovery_rescan_interval_minutes = ?, schedule_import_disable_on_device_default = ?,
            controller_status_poll_interval_minutes = ?, live_poll_interval_seconds = ? WHERE id = 1`
        ).run(
          next.includePrereleaseFirmware ? 1 : 0,
          next.homeLatitude,
          next.homeLongitude,
          next.discoveryRescanIntervalMinutes,
          next.scheduleImportDisableOnDeviceDefault ? 1 : 0,
          next.controllerStatusPollIntervalMinutes,
          next.livePollIntervalSeconds
        );
        return next;
      }
    };
  }
  ```

  `server/src/settings/routes.ts` needs no change (it passes `req.body` straight to `repo.update`).

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/settings/routes.test.ts` — expect PASS. Then full suite: `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect PASS (no other test asserts the exact settings shape; `test/db/client.test.ts` and repo tests are shape-agnostic).

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 1: schema adds (groups.icon/sort_order, settings.live_poll_interval_seconds) + livePollIntervalSeconds setting"`

---

## Task 2: Groups gain icon + sortOrder + `POST /api/groups/reorder`

**Files:**
- Modify: `server/src/groups/repository.ts` (full rewrite below)
- Modify: `server/src/groups/routes.ts` (POST body at lines 11–14; new `/reorder` route)
- Test (modify): `server/test/groups/routes.test.ts`

**Interfaces:**
- Consumes: `groups.icon` / `groups.sort_order` columns (Task 1).
- Produces (used by Phase E Home and Task 3's group expansion):
  ```ts
  export interface GroupMember { controllerId: string; wledSegId: number; }
  export interface Group { id: string; name: string; icon: string | null; sortOrder: number; members: GroupMember[]; }
  createGroupRepository(db).list(): Group[]                       // ordered by sort_order, then name
  createGroupRepository(db).add(input: { name: string; members: GroupMember[]; icon?: string | null; sortOrder?: number }): Group
  createGroupRepository(db).update(id, patch: { name?: string; members?: GroupMember[]; icon?: string | null; sortOrder?: number }): Group
  createGroupRepository(db).reorder(orderedIds: string[]): Group[]
  // Route: POST /api/groups/reorder  body { orderedIds: string[] } → 200 Group[] (400 on malformed body)
  ```

**Steps:**

- [ ] Add failing tests to `server/test/groups/routes.test.ts` (inside the existing `describe`):

  ```ts
    it('stores icon and sortOrder on create and returns them', async () => {
      const post = await request(app)
        .post('/api/groups')
        .send({ name: 'Kitchen', members: [], icon: 'lamp', sortOrder: 3 });
      expect(post.status).toBe(201);
      expect(post.body.icon).toBe('lamp');
      expect(post.body.sortOrder).toBe(3);
    });

    it('defaults icon to null and appends new groups at the end of the sort order', async () => {
      const a = await request(app).post('/api/groups').send({ name: 'A', members: [] });
      const b = await request(app).post('/api/groups').send({ name: 'B', members: [] });
      expect(a.body.icon).toBeNull();
      expect(a.body.sortOrder).toBe(0);
      expect(b.body.sortOrder).toBe(1);
    });

    it('updates icon via PATCH without touching other fields', async () => {
      const post = await request(app).post('/api/groups').send({ name: 'A', members: [] });
      const patch = await request(app).patch(`/api/groups/${post.body.id}`).send({ icon: 'sofa' });
      expect(patch.body.icon).toBe('sofa');
      expect(patch.body.name).toBe('A');
    });

    it('reorders groups via POST /reorder and lists in the new order', async () => {
      const a = await request(app).post('/api/groups').send({ name: 'A', members: [] });
      const b = await request(app).post('/api/groups').send({ name: 'B', members: [] });
      const c = await request(app).post('/api/groups').send({ name: 'C', members: [] });

      const res = await request(app)
        .post('/api/groups/reorder')
        .send({ orderedIds: [c.body.id, a.body.id, b.body.id] });

      expect(res.status).toBe(200);
      expect(res.body.map((g: any) => g.name)).toEqual(['C', 'A', 'B']);
      expect(res.body.map((g: any) => g.sortOrder)).toEqual([0, 1, 2]);

      const list = await request(app).get('/api/groups');
      expect(list.body.map((g: any) => g.name)).toEqual(['C', 'A', 'B']);
    });

    it('rejects reorder when orderedIds is not a string array', async () => {
      const res = await request(app).post('/api/groups/reorder').send({ orderedIds: 'nope' });
      expect(res.status).toBe(400);
    });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/groups/routes.test.ts` — expect FAIL: `expected undefined to be 'lamp'` (icon not returned) and `404`-shaped failures for `/reorder`.

- [ ] Implement — replace `server/src/groups/repository.ts` with:

  ```ts
  import type Database from 'better-sqlite3';
  import { randomUUID } from 'node:crypto';

  export interface GroupMember {
    controllerId: string;
    wledSegId: number;
  }

  export interface Group {
    id: string;
    name: string;
    icon: string | null;
    sortOrder: number;
    members: GroupMember[];
  }

  export function createGroupRepository(db: Database.Database) {
    function membersFor(groupId: string): GroupMember[] {
      return db
        .prepare('SELECT controller_id, wled_seg_id FROM group_members WHERE group_id = ?')
        .all(groupId)
        .map((r: any) => ({ controllerId: r.controller_id, wledSegId: r.wled_seg_id }));
    }

    function setMembers(groupId: string, members: GroupMember[]): void {
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId);
      const insert = db.prepare(
        'INSERT INTO group_members (group_id, controller_id, wled_seg_id) VALUES (?, ?, ?)'
      );
      for (const m of members) insert.run(groupId, m.controllerId, m.wledSegId);
    }

    function fromRow(row: any): Group {
      return {
        id: row.id,
        name: row.name,
        icon: row.icon ?? null,
        sortOrder: row.sort_order,
        members: membersFor(row.id)
      };
    }

    function list(): Group[] {
      return db.prepare('SELECT * FROM groups ORDER BY sort_order, name').all().map(fromRow);
    }

    return {
      list,
      add(input: { name: string; members: GroupMember[]; icon?: string | null; sortOrder?: number }): Group {
        const id = randomUUID();
        const sortOrder =
          input.sortOrder ??
          ((db.prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM groups').get() as any).next as number);
        db.prepare('INSERT INTO groups (id, name, icon, sort_order) VALUES (?, ?, ?, ?)').run(
          id,
          input.name,
          input.icon ?? null,
          sortOrder
        );
        setMembers(id, input.members);
        return { id, name: input.name, icon: input.icon ?? null, sortOrder, members: input.members };
      },
      update(
        id: string,
        patch: { name?: string; members?: GroupMember[]; icon?: string | null; sortOrder?: number }
      ): Group {
        const row: any = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
        if (!row) throw new Error(`group ${id} not found`);
        const name = patch.name ?? row.name;
        const icon = patch.icon !== undefined ? patch.icon : row.icon ?? null;
        const sortOrder = patch.sortOrder ?? row.sort_order;
        db.prepare('UPDATE groups SET name = ?, icon = ?, sort_order = ? WHERE id = ?').run(
          name,
          icon,
          sortOrder,
          id
        );
        if (patch.members) setMembers(id, patch.members);
        return { id, name, icon, sortOrder, members: membersFor(id) };
      },
      reorder(orderedIds: string[]): Group[] {
        const assign = db.prepare('UPDATE groups SET sort_order = ? WHERE id = ?');
        const tx = db.transaction((ids: string[]) => {
          ids.forEach((groupId, index) => assign.run(index, groupId));
        });
        tx(orderedIds);
        return list();
      },
      remove(id: string): void {
        db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
        db.prepare('DELETE FROM groups WHERE id = ?').run(id);
      }
    };
  }
  ```

- [ ] In `server/src/groups/routes.ts`, replace the POST handler (lines 11–14) and add `/reorder` immediately after it:

  ```ts
    router.post('/', (req, res) => {
      const created = repo.add({
        name: req.body.name,
        members: req.body.members ?? [],
        icon: req.body.icon ?? null,
        sortOrder: req.body.sortOrder
      });
      res.status(201).json(created);
    });

    router.post('/reorder', (req, res) => {
      const orderedIds = req.body?.orderedIds;
      if (!Array.isArray(orderedIds) || orderedIds.some((id: unknown) => typeof id !== 'string')) {
        return res.status(400).json({ error: 'orderedIds must be a string array' });
      }
      res.json(repo.reorder(orderedIds));
    });
  ```

  (PATCH already forwards `req.body`, which now carries `icon`/`sortOrder` through to `repo.update`.)

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/groups/routes.test.ts` — expect PASS (8 tests). Then the full suite: `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect PASS (schedules/calendar tests construct groups via `repo.add({name, members})`, which still type-checks since the new fields are optional).

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 2: groups icon + sortOrder + POST /api/groups/reorder"`

---

## Task 3: `applyV2.ts` — contract types, target expansion, name resolution

**Files:**
- Create: `server/src/control/applyV2.ts`
- Modify: `server/src/wled/types.ts` (widen `WledSegment` — ensure step below)
- Test (create): `server/test/control/applyV2.test.ts`

**Interfaces:**
- Consumes: `createGroupRepository` (Task 2), `createControllerRepository` (`server/src/controllers/repository.ts:24`), binding `controller_capabilities` table (Task 1 / Phase A Task 6). Reads the cache via direct SQL on the `effects`/`palettes` columns — deliberately NOT via Phase A's `createCapabilitiesRepository` (whose `get()` also JSON-parses `fxdata` and `palette_previews`, which name resolution never needs); the binding schema is the contract.
- Produces (BINDING, copied verbatim from `00-master.md`; also consumed by Task 4, Phase D client mirror, Phase I scheduler migration):

  ```ts
  export type Target =
    | { kind: 'controller'; controllerId: string }
    | { kind: 'segment'; controllerId: string; wledSegId: number }
    | { kind: 'group'; groupId: string };

  export interface SegPatch {
    fxName?: string; fxId?: number;      // name wins if both; resolved per device
    palName?: string; palId?: number;
    col?: number[][];                    // up to 3 slots, each [r,g,b] or [r,g,b,w]
    sx?: number; ix?: number; c1?: number; c2?: number; c3?: number;
    o1?: boolean; o2?: boolean; o3?: boolean;
    cct?: number;
    on?: boolean; bri?: number;
  }

  export interface ControlPatch {
    on?: boolean;
    bri?: number;                        // 1-255
    transition?: number;                 // WLED units (100ms)
    ps?: number;                         // apply device preset id (device-local ids —
                                         // client restricts to single-controller selections)
    nl?: { on?: boolean; dur?: number; mode?: 0|1|2|3; tbri?: number };
    seg?: SegPatch;
  }

  export interface ApplyResult {
    controllerId: string;
    wledSegId: number | null;            // null = whole-controller target
    ok: boolean;
    error?: string;
  }
  ```

  Plus this task's helpers (consumed by Task 4):
  ```ts
  export class GroupNotFoundError extends Error { constructor(groupId: string); }
  export interface ResolvedTarget { controllerId: string; wledSegId: number | null; }
  export function expandTargets(db: Database.Database, targets: Target[]): ResolvedTarget[];  // throws GroupNotFoundError
  export function resolveNameToId(names: string[] | undefined, name: string): number | undefined;
  export type BuildSegPatchResult = { seg: Partial<WledSegment> } | { error: string };
  export function buildSegPatch(db: Database.Database, controllerId: string, patch: SegPatch): BuildSegPatchResult;
  ```

**Semantics being implemented (binding, from master):** groups expand to segment targets; duplicate `(controller, seg)` pairs dedupe; a whole-controller target subsumes (drops) segment targets for the same controller; name matching is case-insensitive exact match against the cached name list; unresolved name → per-target failure `effect not found: <name>` / `palette not found: <name>` (a missing cache row resolves nothing, producing the same message); batch continues.

**Steps:**

- [ ] Verify `server/src/wled/types.ts` contains the widened `WledSegment` that Phase A Task 1 ships (reproduced verbatim from `01-server-wled-v2.md` below). If any member is missing, add it — the new fields MUST stay optional so existing fixtures still type-check; do not remove existing exports:

  ```ts
  export interface WledSegment {
    id: number;
    start: number;
    stop: number;
    len: number;
    on: boolean;
    bri: number;
    fx: number;
    pal: number;
    col: number[][];
    // Full per-segment field set (spec "verified device facts"). Optional:
    // older firmware or partial state responses may omit any of them.
    grp?: number;
    spc?: number;
    of?: number;
    frz?: boolean;
    cct?: number;
    set?: number;
    n?: string;
    sx?: number;
    ix?: number;
    c1?: number;
    c2?: number;
    c3?: number;
    sel?: boolean;
    rev?: boolean;
    mi?: boolean;
    o1?: boolean;
    o2?: boolean;
    o3?: boolean;
    /** Light-capabilities bitmask in state responses: 1=RGB, 2=white, 4=CCT. */
    lc?: number;
  }
  ```

- [ ] Write the failing test `server/test/control/applyV2.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { createDb } from '../../src/db/client.js';
  import { createControllerRepository } from '../../src/controllers/repository.js';
  import { createGroupRepository } from '../../src/groups/repository.js';
  import {
    expandTargets,
    resolveNameToId,
    buildSegPatch,
    GroupNotFoundError,
    type Target
  } from '../../src/control/applyV2.js';

  // First 16 effect names and first 12 palette names probed live from the real
  // controller at 192.168.1.86 (WLED 16.0.0 "Niji", vid 2605030).
  export const EFFECTS = [
    'Solid', 'Blink', 'Breathe', 'Wipe', 'Wipe Random', 'Random Colors', 'Sweep', 'Dynamic',
    'Colorloop', 'Rainbow', 'Scan', 'Scan Dual', 'Fade', 'Theater', 'Theater Rainbow', 'Running'
  ];
  export const PALETTES = [
    'Default', '* Random Cycle', '* Color 1', '* Colors 1&2', '* Color Gradient', '* Colors Only',
    'Party', 'Cloud', 'Lava', 'Ocean', 'Forest', 'Rainbow'
  ];

  export function seedCapabilities(db: ReturnType<typeof createDb>, controllerId: string): void {
    db.prepare(
      `INSERT INTO controller_capabilities (controller_id, vid, effects, palettes, fxdata, palette_previews, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(controllerId, 2605030, JSON.stringify(EFFECTS), JSON.stringify(PALETTES), '[]', '{}', new Date().toISOString());
  }

  describe('resolveNameToId', () => {
    it('matches case-insensitively and exactly', () => {
      expect(resolveNameToId(EFFECTS, 'theater')).toBe(13);
      expect(resolveNameToId(EFFECTS, 'THEATER RAINBOW')).toBe(14);
      expect(resolveNameToId(PALETTES, 'rainbow')).toBe(11);
    });

    it('does not partial-match', () => {
      expect(resolveNameToId(EFFECTS, 'Theat')).toBeUndefined();
    });

    it('returns undefined when the name list is missing (no cache row)', () => {
      expect(resolveNameToId(undefined, 'Solid')).toBeUndefined();
    });
  });

  describe('expandTargets', () => {
    function setup() {
      const db = createDb(':memory:');
      const controllers = createControllerRepository(db);
      const a = controllers.add({ name: 'A', host: '10.0.0.50', source: 'manual' }).id;
      const b = controllers.add({ name: 'B', host: '10.0.0.51', source: 'manual' }).id;
      return { db, a, b };
    }

    it('expands a group into its segment members, preserving order', () => {
      const { db, a, b } = setup();
      const group = createGroupRepository(db).add({
        name: 'Front',
        members: [
          { controllerId: a, wledSegId: 0 },
          { controllerId: b, wledSegId: 1 }
        ]
      });
      expect(expandTargets(db, [{ kind: 'group', groupId: group.id }])).toEqual([
        { controllerId: a, wledSegId: 0 },
        { controllerId: b, wledSegId: 1 }
      ]);
    });

    it('dedupes identical (controller, segment) pairs and identical controller targets', () => {
      const { db, a } = setup();
      const targets: Target[] = [
        { kind: 'segment', controllerId: a, wledSegId: 0 },
        { kind: 'segment', controllerId: a, wledSegId: 0 },
        { kind: 'segment', controllerId: a, wledSegId: 1 }
      ];
      expect(expandTargets(db, targets)).toEqual([
        { controllerId: a, wledSegId: 0 },
        { controllerId: a, wledSegId: 1 }
      ]);
    });

    it('a whole-controller target subsumes segment targets for the same controller', () => {
      const { db, a, b } = setup();
      const targets: Target[] = [
        { kind: 'segment', controllerId: a, wledSegId: 0 },
        { kind: 'controller', controllerId: a },
        { kind: 'segment', controllerId: b, wledSegId: 2 }
      ];
      expect(expandTargets(db, targets)).toEqual([
        { controllerId: a, wledSegId: null },
        { controllerId: b, wledSegId: 2 }
      ]);
    });

    it('throws GroupNotFoundError for an unknown group id', () => {
      const { db } = setup();
      expect(() => expandTargets(db, [{ kind: 'group', groupId: 'nope' }])).toThrow(GroupNotFoundError);
      expect(() => expandTargets(db, [{ kind: 'group', groupId: 'nope' }])).toThrow('group not found: nope');
    });
  });

  describe('buildSegPatch', () => {
    function setup() {
      const db = createDb(':memory:');
      const id = createControllerRepository(db).add({ name: 'A', host: '10.0.0.50', source: 'manual' }).id;
      return { db, id };
    }

    it('resolves fxName and palName to per-device ids from the capability cache', () => {
      const { db, id } = setup();
      seedCapabilities(db, id);
      expect(buildSegPatch(db, id, { fxName: 'theater', palName: 'Rainbow' })).toEqual({
        seg: { fx: 13, pal: 11 }
      });
    });

    it('name wins over id when both are provided', () => {
      const { db, id } = setup();
      seedCapabilities(db, id);
      expect(buildSegPatch(db, id, { fxName: 'Colorloop', fxId: 3 })).toEqual({ seg: { fx: 8 } });
    });

    it('fails with "effect not found" for an unresolvable effect name', () => {
      const { db, id } = setup();
      seedCapabilities(db, id);
      expect(buildSegPatch(db, id, { fxName: 'Sparkle Fairy' })).toEqual({
        error: 'effect not found: Sparkle Fairy'
      });
    });

    it('fails with "palette not found" for an unresolvable palette name', () => {
      const { db, id } = setup();
      seedCapabilities(db, id);
      expect(buildSegPatch(db, id, { palName: 'Nonexistent' })).toEqual({
        error: 'palette not found: Nonexistent'
      });
    });

    it('fails the same way when the controller has no capability cache row', () => {
      const { db, id } = setup();
      expect(buildSegPatch(db, id, { fxName: 'Solid' })).toEqual({ error: 'effect not found: Solid' });
    });

    it('passes raw ids and all other segment fields through', () => {
      const { db, id } = setup();
      expect(
        buildSegPatch(db, id, {
          fxId: 9, palId: 6, col: [[255, 0, 0], [0, 0, 0], [0, 0, 255]],
          sx: 200, ix: 100, c1: 1, c2: 2, c3: 3,
          o1: true, o2: false, o3: true, cct: 127, on: true, bri: 64
        })
      ).toEqual({
        seg: {
          fx: 9, pal: 6, col: [[255, 0, 0], [0, 0, 0], [0, 0, 255]],
          sx: 200, ix: 100, c1: 1, c2: 2, c3: 3,
          o1: true, o2: false, o3: true, cct: 127, on: true, bri: 64
        }
      });
    });
  });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/control/applyV2.test.ts` — expect FAIL: `Cannot find module '.../src/control/applyV2.js'`.

- [ ] Create `server/src/control/applyV2.ts` (Task 4 appends the write path to this same file):

  ```ts
  import type Database from 'better-sqlite3';
  import { createGroupRepository } from '../groups/repository.js';
  import type { WledSegment } from '../wled/types.js';

  export type Target =
    | { kind: 'controller'; controllerId: string }
    | { kind: 'segment'; controllerId: string; wledSegId: number }
    | { kind: 'group'; groupId: string };

  export interface SegPatch {
    fxName?: string; fxId?: number;      // name wins if both; resolved per device
    palName?: string; palId?: number;
    col?: number[][];                    // up to 3 slots, each [r,g,b] or [r,g,b,w]
    sx?: number; ix?: number; c1?: number; c2?: number; c3?: number;
    o1?: boolean; o2?: boolean; o3?: boolean;
    cct?: number;
    on?: boolean; bri?: number;
  }

  export interface ControlPatch {
    on?: boolean;
    bri?: number;                        // 1-255
    transition?: number;                 // WLED units (100ms)
    ps?: number;                         // apply device preset id (device-local ids —
                                         // client restricts to single-controller selections)
    nl?: { on?: boolean; dur?: number; mode?: 0 | 1 | 2 | 3; tbri?: number };
    seg?: SegPatch;
  }

  export interface ApplyResult {
    controllerId: string;
    wledSegId: number | null;            // null = whole-controller target
    ok: boolean;
    error?: string;
  }

  export class GroupNotFoundError extends Error {
    constructor(groupId: string) {
      super(`group not found: ${groupId}`);
      this.name = 'GroupNotFoundError';
    }
  }

  export interface ResolvedTarget {
    controllerId: string;
    wledSegId: number | null;
  }

  export function expandTargets(db: Database.Database, targets: Target[]): ResolvedTarget[] {
    const groups = createGroupRepository(db);
    const flat: ResolvedTarget[] = [];
    for (const target of targets) {
      if (target.kind === 'controller') {
        flat.push({ controllerId: target.controllerId, wledSegId: null });
      } else if (target.kind === 'segment') {
        flat.push({ controllerId: target.controllerId, wledSegId: target.wledSegId });
      } else {
        const group = groups.list().find((g) => g.id === target.groupId);
        if (!group) throw new GroupNotFoundError(target.groupId);
        for (const member of group.members) {
          flat.push({ controllerId: member.controllerId, wledSegId: member.wledSegId });
        }
      }
    }

    const controllerLevel = new Set(
      flat.filter((t) => t.wledSegId === null).map((t) => t.controllerId)
    );
    const seen = new Set<string>();
    const result: ResolvedTarget[] = [];
    for (const t of flat) {
      // A whole-controller target already patches every segment of that
      // controller, so segment targets for it are subsumed.
      if (t.wledSegId !== null && controllerLevel.has(t.controllerId)) continue;
      const key = `${t.controllerId}:${t.wledSegId ?? '*'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(t);
    }
    return result;
  }

  export function resolveNameToId(names: string[] | undefined, name: string): number | undefined {
    if (!names) return undefined;
    const wanted = name.trim().toLowerCase();
    const index = names.findIndex((n) => n.trim().toLowerCase() === wanted);
    return index === -1 ? undefined : index;
  }

  interface CachedNames {
    effects: string[];
    palettes: string[];
  }

  function getCachedNames(db: Database.Database, controllerId: string): CachedNames | undefined {
    const row = db
      .prepare('SELECT effects, palettes FROM controller_capabilities WHERE controller_id = ?')
      .get(controllerId) as { effects: string; palettes: string } | undefined;
    if (!row) return undefined;
    return { effects: JSON.parse(row.effects), palettes: JSON.parse(row.palettes) };
  }

  export type BuildSegPatchResult = { seg: Partial<WledSegment> } | { error: string };

  export function buildSegPatch(
    db: Database.Database,
    controllerId: string,
    patch: SegPatch
  ): BuildSegPatchResult {
    const seg: Partial<WledSegment> = {};
    const needsNames = patch.fxName !== undefined || patch.palName !== undefined;
    const names = needsNames ? getCachedNames(db, controllerId) : undefined;

    if (patch.fxName !== undefined) {
      const fx = resolveNameToId(names?.effects, patch.fxName);
      if (fx === undefined) return { error: `effect not found: ${patch.fxName}` };
      seg.fx = fx;
    } else if (patch.fxId !== undefined) {
      seg.fx = patch.fxId;
    }

    if (patch.palName !== undefined) {
      const pal = resolveNameToId(names?.palettes, patch.palName);
      if (pal === undefined) return { error: `palette not found: ${patch.palName}` };
      seg.pal = pal;
    } else if (patch.palId !== undefined) {
      seg.pal = patch.palId;
    }

    if (patch.col !== undefined) seg.col = patch.col;
    if (patch.sx !== undefined) seg.sx = patch.sx;
    if (patch.ix !== undefined) seg.ix = patch.ix;
    if (patch.c1 !== undefined) seg.c1 = patch.c1;
    if (patch.c2 !== undefined) seg.c2 = patch.c2;
    if (patch.c3 !== undefined) seg.c3 = patch.c3;
    if (patch.o1 !== undefined) seg.o1 = patch.o1;
    if (patch.o2 !== undefined) seg.o2 = patch.o2;
    if (patch.o3 !== undefined) seg.o3 = patch.o3;
    if (patch.cct !== undefined) seg.cct = patch.cct;
    if (patch.on !== undefined) seg.on = patch.on;
    if (patch.bri !== undefined) seg.bri = patch.bri;
    return { seg };
  }
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/control/applyV2.test.ts` — expect PASS (13 tests).

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 3: applyV2 contract types, target expansion, per-device name resolution"`

---

## Task 4: `applyControlPatch` device writes + v2/v1 route discrimination

**Files:**
- Modify: `server/src/control/applyV2.ts` (append write path)
- Modify: `server/src/control/routes.ts` (POST `/apply` handler at lines 79–83)
- Modify: `server/src/wled/types.ts` + `server/src/wled/client.ts` (ensure widened `setState` — step below; current narrow signature is at `client.ts:30-35`)
- Test (modify): `server/test/control/applyV2.test.ts`, `server/test/control/routes.test.ts`

**Interfaces:**
- Consumes: Task 3 exports; `getState` (`server/src/wled/client.ts:26`); widened `setState`/`WledStatePatch` (Phase A Task 1; verified below).
- Produces (consumed by the route here, and by Phase I's scheduler/calendar migration):
  ```ts
  export async function applyControlPatch(
    db: Database.Database,
    targets: Target[],
    patch: ControlPatch
  ): Promise<ApplyResult[]>;   // throws GroupNotFoundError before any device I/O
  // Route: POST /api/control/apply
  //   v2 body { targets: Target[], patch: ControlPatch } → 200 { results: ApplyResult[] } (200 even with partial failures)
  //   unknown group id → 400 { error: 'group not found: <id>' }
  //   v1 body { members, action } → unchanged v1 behavior
  //   neither shape → 400
  ```

**Binding semantics (master):** controller-kind targets patch ALL segments of that controller — enumerated via one live `getState` per controller per apply (only needed when `patch.seg` is present); every device write includes `udpn: { nn: true }`; per-target isolation with exactly one retry (matches v1's pattern at `control/routes.ts:61-71`). Top-level `on`/`bri`/`transition`/`ps`/`nl` are always written at device level regardless of target kind — a client wanting per-segment power/brightness uses `patch.seg.on`/`patch.seg.bri` (SegPatch has them for exactly this reason). `patch.ps` is how preset APPLY works: the master defines no dedicated preset-apply route — clients (and Phase I's scheduler migration of v1 'preset' actions) send `{ targets, patch: { ps } }` to this route; preset ids are device-local, so the client restricts `ps` to single-controller selections.

**Steps:**

- [ ] Verify `server/src/wled/types.ts` exports Phase A Task 1's write types (reproduced verbatim from `01-server-wled-v2.md`; add whatever is missing, keep existing exports):

  ```ts
  export interface WledNightlight {
    on: boolean;
    dur: number;
    mode: 0 | 1 | 2 | 3;
    tbri: number;
    rem?: number;
  }

  export interface WledUdpn {
    send?: boolean;
    recv?: boolean;
    sgrp?: number;
    rgrp?: number;
    /** Per-request "no notify": suppresses UDP sync echo for this one write. */
    nn?: boolean;
  }

  /** Partial segment for writes: any subset of segment fields (plus id). */
  export type WledSegmentPatch = Partial<WledSegment>;

  /** Body accepted by POST /json/state (the fields uber-wled writes). */
  export interface WledStatePatch {
    on?: boolean;
    bri?: number;
    transition?: number;
    ps?: number;
    pl?: number;
    nl?: Partial<WledNightlight>;
    udpn?: WledUdpn;
    lor?: 0 | 1 | 2;
    mainseg?: number;
    seg?: WledSegmentPatch[];
  }
  ```

  and verify `server/src/wled/client.ts` has Phase A's widened `setState` (replacing the narrow `Partial<Pick<WledState, 'on' | 'bri' | 'ps'>>` version at `client.ts:30-35` if Phase A has not already done so — all existing call sites pass subsets of `WledStatePatch`, so this compiles everywhere):

  ```ts
  export function setState(host: string, patch: WledStatePatch): Promise<WledState> {
    return postJson<WledState>(host, '/json/state', patch);
  }
  ```

  (`ControlPatch.nl` — all-optional — assigns cleanly to `nl?: Partial<WledNightlight>`, and `{ nn: true }` to `WledUdpn`; no adapter code is needed.)

- [ ] Append failing write-path tests to `server/test/control/applyV2.test.ts` (add `vi`, `afterEach` to the vitest import; add `applyControlPatch` to the applyV2 import):

  ```ts
  // -- device write path -------------------------------------------------

  function stubFetchByHost(
    handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
  ) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const host = new URL(url).host;
      const handler = handlers[host];
      if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
      const { status, body } = handler(url, init);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  // Real two-segment layout probed from 192.168.1.86 (segments 0-39 and 39-48).
  const LIVE_STATE = {
    on: true, bri: 9, ps: -1,
    seg: [
      { id: 0, start: 0, stop: 39, len: 39, on: true, bri: 255, fx: 0, pal: 0, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
      { id: 1, start: 39, stop: 48, len: 9, on: true, bri: 255, fx: 0, pal: 0, col: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }
    ]
  };

  describe('applyControlPatch', () => {
    const HOST = '10.0.0.50';
    afterEach(() => vi.unstubAllGlobals());

    function setup() {
      const db = createDb(':memory:');
      const id = createControllerRepository(db).add({ name: 'Cab', host: HOST, source: 'manual' }).id;
      return { db, id };
    }

    it('segment target: single POST with udpn nn:true, no state enumeration', async () => {
      const { db, id } = setup();
      const posts: unknown[] = [];
      const fetchMock = stubFetchByHost({
        [HOST]: (_url, init) => {
          posts.push(JSON.parse(init?.body as string));
          return { status: 200, body: LIVE_STATE };
        }
      });
      const results = await applyControlPatch(
        db,
        [{ kind: 'segment', controllerId: id, wledSegId: 1 }],
        { bri: 120, seg: { fxId: 9 } }
      );
      expect(results).toEqual([{ controllerId: id, wledSegId: 1, ok: true }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(posts).toEqual([{ udpn: { nn: true }, bri: 120, seg: [{ id: 1, fx: 9 }] }]);
    });

    it('controller target with a seg patch: one GET to enumerate segments, then one POST patching all of them', async () => {
      const { db, id } = setup();
      seedCapabilities(db, id);
      const posts: unknown[] = [];
      stubFetchByHost({
        [HOST]: (_url, init) => {
          if (!init || init.method === undefined) return { status: 200, body: LIVE_STATE }; // GET /json/state
          posts.push(JSON.parse(init.body as string));
          return { status: 200, body: LIVE_STATE };
        }
      });
      const results = await applyControlPatch(
        db,
        [{ kind: 'controller', controllerId: id }],
        { seg: { fxName: 'Theater' } }
      );
      expect(results).toEqual([{ controllerId: id, wledSegId: null, ok: true }]);
      expect(posts).toEqual([{ udpn: { nn: true }, seg: [{ id: 0, fx: 13 }, { id: 1, fx: 13 }] }]);
    });

    it('controller target with only top-level fields: no GET, one POST', async () => {
      const { db, id } = setup();
      const posts: unknown[] = [];
      const fetchMock = stubFetchByHost({
        [HOST]: (_url, init) => {
          posts.push(JSON.parse(init?.body as string));
          return { status: 200, body: LIVE_STATE };
        }
      });
      const results = await applyControlPatch(db, [{ kind: 'controller', controllerId: id }], {
        on: true, bri: 200, transition: 7, nl: { on: true, dur: 30, mode: 1, tbri: 0 }
      });
      expect(results[0].ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(posts).toEqual([
        { udpn: { nn: true }, on: true, bri: 200, transition: 7, nl: { on: true, dur: 30, mode: 1, tbri: 0 } }
      ]);
    });

    it('applies a device preset via patch.ps at device level (preset apply has no dedicated route)', async () => {
      const { db, id } = setup();
      const posts: unknown[] = [];
      const fetchMock = stubFetchByHost({
        [HOST]: (_url, init) => {
          posts.push(JSON.parse(init?.body as string));
          return { status: 200, body: LIVE_STATE };
        }
      });
      const results = await applyControlPatch(db, [{ kind: 'controller', controllerId: id }], { ps: 3 });
      expect(results).toEqual([{ controllerId: id, wledSegId: null, ok: true }]);
      expect(fetchMock).toHaveBeenCalledTimes(1); // no state enumeration for a device-level preset
      expect(posts).toEqual([{ udpn: { nn: true }, ps: 3 }]);
    });

    it('unresolved effect name fails that target without any device I/O, and other targets continue', async () => {
      const { db, id } = setup();
      seedCapabilities(db, id);
      const db2Controller = createControllerRepository(db).add({ name: 'B', host: '10.0.0.51', source: 'manual' }).id;
      seedCapabilities(db, db2Controller);
      const fetchMock = stubFetchByHost({
        '10.0.0.51': () => ({ status: 200, body: LIVE_STATE })
      });
      const results = await applyControlPatch(
        db,
        [
          { kind: 'segment', controllerId: id, wledSegId: 0 },
          { kind: 'segment', controllerId: db2Controller, wledSegId: 0 }
        ],
        { seg: { fxName: 'Theater' } }
      );
      // make controller A's cache useless for this name instead: use a name only B has
      expect(results[1]).toEqual({ controllerId: db2Controller, wledSegId: 0, ok: true });
      expect(fetchMock.mock.calls.every(([url]) => new URL(url as string).host === '10.0.0.51')).toBe(false);
    });

    it('retries exactly once on write failure, then reports the error', async () => {
      const { db, id } = setup();
      const fetchMock = stubFetchByHost({ [HOST]: () => ({ status: 500, body: {} }) });
      const results = await applyControlPatch(db, [{ kind: 'segment', controllerId: id, wledSegId: 0 }], { on: false });
      expect(results[0].ok).toBe(false);
      expect(results[0].error).toContain('500');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports controller not found without device I/O', async () => {
      const { db } = setup();
      const fetchMock = stubFetchByHost({});
      const results = await applyControlPatch(db, [{ kind: 'segment', controllerId: 'ghost', wledSegId: 0 }], { on: true });
      expect(results).toEqual([{ controllerId: 'ghost', wledSegId: 0, ok: false, error: 'controller not found' }]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
  ```

  Then fix the fourth test to be what it means (unresolved on one device only, resolved on the other) — replace its body with:

  ```ts
    it('unresolved effect name fails that target without any device I/O, and other targets continue', async () => {
      const { db, id } = setup();
      const other = createControllerRepository(db).add({ name: 'B', host: '10.0.0.51', source: 'manual' }).id;
      seedCapabilities(db, other); // only controller B has a capability cache
      const fetchMock = stubFetchByHost({
        '10.0.0.51': (_url, init) => {
          expect(JSON.parse(init?.body as string)).toEqual({ udpn: { nn: true }, seg: [{ id: 0, fx: 13 }] });
          return { status: 200, body: LIVE_STATE };
        }
      });
      const results = await applyControlPatch(
        db,
        [
          { kind: 'segment', controllerId: id, wledSegId: 0 },
          { kind: 'segment', controllerId: other, wledSegId: 0 }
        ],
        { seg: { fxName: 'Theater' } }
      );
      expect(results[0]).toEqual({ controllerId: id, wledSegId: 0, ok: false, error: 'effect not found: Theater' });
      expect(results[1]).toEqual({ controllerId: other, wledSegId: 0, ok: true });
      expect(fetchMock.mock.calls.every(([url]) => new URL(url as string).host === '10.0.0.51')).toBe(true);
    });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/control/applyV2.test.ts` — expect FAIL: `applyControlPatch` is not exported.

- [ ] Append to `server/src/control/applyV2.ts`:

  ```ts
  import { createControllerRepository } from '../controllers/repository.js';
  import { getState, setState } from '../wled/client.js';
  import type { WledStatePatch } from '../wled/types.js';
  ```

  (merge these into the existing import block at the top of the file), then:

  ```ts
  async function writeTarget(
    host: string,
    target: ResolvedTarget,
    patch: ControlPatch,
    segPatch: Partial<WledSegment> | undefined
  ): Promise<void> {
    const body: WledStatePatch = { udpn: { nn: true } };
    if (patch.on !== undefined) body.on = patch.on;
    if (patch.bri !== undefined) body.bri = patch.bri;
    if (patch.transition !== undefined) body.transition = patch.transition;
    if (patch.ps !== undefined) body.ps = patch.ps;
    if (patch.nl !== undefined) body.nl = patch.nl;
    if (segPatch) {
      if (target.wledSegId === null) {
        // Whole-controller target: enumerate the device's current segment ids
        // (one GET per controller per apply, per the master contract).
        const state = await getState(host);
        body.seg = state.seg.map((s) => ({ id: s.id, ...segPatch }));
      } else {
        body.seg = [{ id: target.wledSegId, ...segPatch }];
      }
    }
    await setState(host, body);
  }

  export async function applyControlPatch(
    db: Database.Database,
    targets: Target[],
    patch: ControlPatch
  ): Promise<ApplyResult[]> {
    const controllers = new Map(createControllerRepository(db).list().map((c) => [c.id, c]));
    const resolved = expandTargets(db, targets); // GroupNotFoundError propagates to the route

    return Promise.all(
      resolved.map(async (target): Promise<ApplyResult> => {
        const controller = controllers.get(target.controllerId);
        if (!controller) {
          return { controllerId: target.controllerId, wledSegId: target.wledSegId, ok: false, error: 'controller not found' };
        }

        let segPatch: Partial<WledSegment> | undefined;
        if (patch.seg) {
          const built = buildSegPatch(db, target.controllerId, patch.seg);
          if ('error' in built) {
            return { controllerId: target.controllerId, wledSegId: target.wledSegId, ok: false, error: built.error };
          }
          segPatch = built.seg;
        }

        try {
          await writeTarget(controller.host, target, patch, segPatch);
          return { controllerId: target.controllerId, wledSegId: target.wledSegId, ok: true };
        } catch {
          // Per-target isolation with exactly one retry (matches v1 behavior).
          try {
            await writeTarget(controller.host, target, patch, segPatch);
            return { controllerId: target.controllerId, wledSegId: target.wledSegId, ok: true };
          } catch (secondError: any) {
            return {
              controllerId: target.controllerId,
              wledSegId: target.wledSegId,
              ok: false,
              error: secondError?.message ?? 'unknown error'
            };
          }
        }
      })
    );
  }
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/control/applyV2.test.ts` — expect PASS (20 tests).

- [ ] Add failing route tests to `server/test/control/routes.test.ts`. First hoist the db so new tests can seed groups — change the `beforeEach` (lines 37–45): declare `let db: ReturnType<typeof createDb>;` next to `let app` and change `const db = createDb(':memory:');` to `db = createDb(':memory:');`. Add `import { createGroupRepository } from '../../src/groups/repository.js';`. Then append inside the describe:

  ```ts
    it('discriminates a v2 {targets,patch} body and writes with udpn nn:true', async () => {
      stubFetchByHost({
        [HOST_A]: (_url, init) => {
          expect(JSON.parse(init?.body as string)).toEqual({ udpn: { nn: true }, on: true, bri: 120 });
          return { status: 200, body: { on: true, bri: 120, ps: -1, seg: [] } };
        }
      });
      const res = await request(app).post('/api/control/apply').send({
        targets: [{ kind: 'segment', controllerId: controllerA, wledSegId: 0 }],
        patch: { on: true, bri: 120 }
      });
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([{ controllerId: controllerA, wledSegId: 0, ok: true }]);
    });

    it('expands a v2 group target to its segment members', async () => {
      const group = createGroupRepository(db).add({
        name: 'Front',
        members: [
          { controllerId: controllerA, wledSegId: 0 },
          { controllerId: controllerB, wledSegId: 1 }
        ]
      });
      stubFetchByHost({
        [HOST_A]: (_url, init) => {
          expect(JSON.parse(init?.body as string)).toEqual({ udpn: { nn: true }, on: false });
          return { status: 200, body: { on: false, bri: 0, ps: -1, seg: [] } };
        },
        [HOST_B]: () => ({ status: 200, body: { on: false, bri: 0, ps: -1, seg: [] } })
      });
      const res = await request(app).post('/api/control/apply').send({
        targets: [{ kind: 'group', groupId: group.id }],
        patch: { on: false }
      });
      expect(res.body.results).toEqual([
        { controllerId: controllerA, wledSegId: 0, ok: true },
        { controllerId: controllerB, wledSegId: 1, ok: true }
      ]);
    });

    it('returns 400 for a v2 body naming an unknown group', async () => {
      const res = await request(app).post('/api/control/apply').send({
        targets: [{ kind: 'group', groupId: 'nope' }],
        patch: { on: true }
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('group not found: nope');
    });

    it('returns 400 when the body is neither v1 nor v2', async () => {
      const res = await request(app).post('/api/control/apply').send({ hello: 'world' });
      expect(res.status).toBe(400);
    });
  ```

  The four existing v1 tests are NOT modified — they are the v1-behavior-unchanged regression gate.

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/control/routes.test.ts` — expect FAIL: v2 body falls into the v1 destructuring and 500s/misbehaves (`Cannot read properties of undefined` or empty results).

- [ ] Implement the discriminating route in `server/src/control/routes.ts` — replace the POST handler (lines 79–83) with:

  ```ts
    router.post('/apply', async (req, res) => {
      const body = req.body ?? {};

      if (Array.isArray(body.targets)) {
        // v2: { targets: Target[], patch: ControlPatch }
        if (typeof body.patch !== 'object' || body.patch === null) {
          return res.status(400).json({ error: 'patch is required' });
        }
        try {
          const results = await applyControlPatch(db, body.targets as Target[], body.patch as ControlPatch);
          return res.json({ results });
        } catch (err) {
          if (err instanceof GroupNotFoundError) {
            return res.status(400).json({ error: err.message });
          }
          throw err;
        }
      }

      if (Array.isArray(body.members)) {
        // v1: { members: Member[], action: ControlAction } — unchanged until Phase I
        const results = await applyToMembers(db, body.members as Member[], body.action as ControlAction);
        return res.json({ results });
      }

      return res.status(400).json({ error: 'body must be {targets,patch} (v2) or {members,action} (v1)' });
    });
  ```

  and add to the imports at the top of the file:

  ```ts
  import { applyControlPatch, GroupNotFoundError, type Target, type ControlPatch } from './applyV2.js';
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/control/routes.test.ts` — expect PASS (8 tests: 4 v1 + 4 v2). Full suite: `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect PASS (schedules engine/calendar drive `applyToMembers` directly and are untouched).

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 4: fan-out v2 applyControlPatch + POST /api/control/apply v2/v1 discrimination"`

---

## Task 5: Refcounted live fast-poll session manager

**Files:**
- Create: `server/src/live/sessions.ts`
- Test (create): `server/test/live/sessions.test.ts`

**Interfaces:**
- Consumes: `createControllerRepository` (`controllers/repository.ts:24`), `Settings.livePollIntervalSeconds` (Task 1), `getState`/`getInfo` (`wled/client.ts:22-28`, injectable for tests).
- Produces (consumed by Task 6 and, via SSE, Phase D's `useLiveStatus`):
  ```ts
  export interface LiveEvent { controllerId: string; reachable: boolean; state?: WledState; info?: WledInfo; }
  export type LiveListener = (event: LiveEvent) => void;
  export interface WledLiveClient { getState(host: string): Promise<WledState>; getInfo(host: string): Promise<WledInfo>; }
  export function createLiveSessionManager(db: Database.Database, wled?: WledLiveClient): {
    subscribe(controllerIds: string[], listener: LiveListener): () => void;  // returns unsubscribe
    activeSessionCount(): number;
  };
  export type LiveSessionManager = ReturnType<typeof createLiveSessionManager>;
  ```

**Binding semantics (master):** one refcounted fast-poll session per controller; interval = `settings.live_poll_interval_seconds` (default 2), read at session start; `/json/info` refreshed every 10th tick (tick 0 — the immediate first poll — counts, so subscribers get info right away); session stops when its last subscriber disconnects. Per the vitest-testing-gotchas skill, these are fake-timer tests against direct unit calls — no sockets involved.

**Steps:**

- [ ] Write the failing test `server/test/live/sessions.test.ts`:

  ```ts
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
  import { createDb } from '../../src/db/client.js';
  import { createControllerRepository } from '../../src/controllers/repository.js';
  import { createSettingsRepository } from '../../src/settings/repository.js';
  import { createLiveSessionManager, type LiveEvent } from '../../src/live/sessions.js';
  import type { WledInfo, WledState } from '../../src/wled/types.js';

  // Real shapes probed from 192.168.1.86 (WLED 16.0.0).
  const STATE: WledState = {
    on: true, bri: 9, ps: -1,
    seg: [{ id: 0, start: 0, stop: 39, len: 39, on: true, bri: 255, fx: 0, pal: 0, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }]
  };
  const INFO: WledInfo = { name: 'Cabinet Lights', ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' };

  describe('live session manager', () => {
    let db: ReturnType<typeof createDb>;
    let controllerId: string;
    let wled: { getState: ReturnType<typeof vi.fn>; getInfo: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      vi.useFakeTimers();
      db = createDb(':memory:');
      controllerId = createControllerRepository(db).add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' }).id;
      wled = { getState: vi.fn(async () => STATE), getInfo: vi.fn(async () => INFO) };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('polls immediately on first subscribe and includes info on the first tick', async () => {
      const manager = createLiveSessionManager(db, wled);
      const events: LiveEvent[] = [];
      manager.subscribe([controllerId], (e) => events.push(e));
      await vi.advanceTimersByTimeAsync(0); // flush the immediate first poll
      expect(wled.getState).toHaveBeenCalledTimes(1);
      expect(wled.getInfo).toHaveBeenCalledTimes(1);
      expect(events[0]).toEqual({ controllerId, reachable: true, state: STATE, info: INFO });
    });

    it('polls at the interval from settings.livePollIntervalSeconds', async () => {
      createSettingsRepository(db).update({ livePollIntervalSeconds: 5 });
      const manager = createLiveSessionManager(db, wled);
      manager.subscribe([controllerId], () => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(wled.getState).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(wled.getState).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(wled.getState).toHaveBeenCalledTimes(2);
    });

    it('refreshes info only every 10th tick', async () => {
      const manager = createLiveSessionManager(db, wled); // default interval 2s
      manager.subscribe([controllerId], () => {});
      await vi.advanceTimersByTimeAsync(0);          // tick 0 (info)
      await vi.advanceTimersByTimeAsync(9 * 2_000);  // ticks 1-9 (no info)
      expect(wled.getState).toHaveBeenCalledTimes(10);
      expect(wled.getInfo).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);      // tick 10 (info again)
      expect(wled.getInfo).toHaveBeenCalledTimes(2);
    });

    it('refcounts: two subscribers share one session; polling stops after the last unsubscribes', async () => {
      const manager = createLiveSessionManager(db, wled);
      const unsubA = manager.subscribe([controllerId], () => {});
      const unsubB = manager.subscribe([controllerId], () => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.activeSessionCount()).toBe(1);
      unsubA();
      expect(manager.activeSessionCount()).toBe(1);
      unsubB();
      expect(manager.activeSessionCount()).toBe(0);
      const calls = wled.getState.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(wled.getState).toHaveBeenCalledTimes(calls); // no polls after teardown
    });

    it('unsubscribe is idempotent', async () => {
      const manager = createLiveSessionManager(db, wled);
      const unsubA = manager.subscribe([controllerId], () => {});
      const unsubB = manager.subscribe([controllerId], () => {});
      unsubA();
      unsubA(); // double-call must not steal B's refcount
      expect(manager.activeSessionCount()).toBe(1);
      unsubB();
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('emits reachable:false when the device errors, then keeps polling', async () => {
      wled.getState.mockRejectedValueOnce(new Error('timeout'));
      const manager = createLiveSessionManager(db, wled);
      const events: LiveEvent[] = [];
      manager.subscribe([controllerId], (e) => events.push(e));
      await vi.advanceTimersByTimeAsync(0);
      expect(events[0]).toEqual({ controllerId, reachable: false });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(events[1].reachable).toBe(true);
    });

    it('emits a single reachable:false for an unknown controller id without starting a session', () => {
      const manager = createLiveSessionManager(db, wled);
      const events: LiveEvent[] = [];
      manager.subscribe(['ghost'], (e) => events.push(e));
      expect(events).toEqual([{ controllerId: 'ghost', reachable: false }]);
      expect(manager.activeSessionCount()).toBe(0);
    });
  });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/live/sessions.test.ts` — expect FAIL: `Cannot find module '.../src/live/sessions.js'`.

- [ ] Create `server/src/live/sessions.ts`:

  ```ts
  import type Database from 'better-sqlite3';
  import { createControllerRepository } from '../controllers/repository.js';
  import { createSettingsRepository } from '../settings/repository.js';
  import { getInfo, getState } from '../wled/client.js';
  import type { WledInfo, WledState } from '../wled/types.js';

  export interface LiveEvent {
    controllerId: string;
    reachable: boolean;
    state?: WledState;
    info?: WledInfo;
  }

  export type LiveListener = (event: LiveEvent) => void;

  export interface WledLiveClient {
    getState(host: string): Promise<WledState>;
    getInfo(host: string): Promise<WledInfo>;
  }

  interface Session {
    controllerId: string;
    host: string;
    timer: ReturnType<typeof setInterval>;
    tick: number;
    refCount: number;
    listeners: Set<LiveListener>;
  }

  const INFO_EVERY_N_TICKS = 10;

  export function createLiveSessionManager(
    db: Database.Database,
    wled: WledLiveClient = { getState, getInfo }
  ) {
    const sessions = new Map<string, Session>();
    const controllers = createControllerRepository(db);
    const settings = createSettingsRepository(db);

    async function poll(session: Session): Promise<void> {
      const includeInfo = session.tick % INFO_EVERY_N_TICKS === 0;
      session.tick += 1;
      let event: LiveEvent;
      try {
        const state = await wled.getState(session.host);
        event = { controllerId: session.controllerId, reachable: true, state };
        if (includeInfo) event.info = await wled.getInfo(session.host);
      } catch {
        event = { controllerId: session.controllerId, reachable: false };
      }
      for (const listener of session.listeners) listener(event);
    }

    function startSession(controllerId: string, host: string): Session {
      const intervalMs = settings.get().livePollIntervalSeconds * 1000;
      const session: Session = {
        controllerId,
        host,
        tick: 0,
        refCount: 0,
        listeners: new Set(),
        timer: setInterval(() => {
          void poll(session);
        }, intervalMs)
      };
      sessions.set(controllerId, session);
      // Immediate first poll so subscribers see data (and info) right away.
      queueMicrotask(() => {
        void poll(session);
      });
      return session;
    }

    return {
      subscribe(controllerIds: string[], listener: LiveListener): () => void {
        const known = new Map(controllers.list().map((c) => [c.id, c]));
        const joined: Session[] = [];
        for (const id of controllerIds) {
          const controller = known.get(id);
          if (!controller) {
            listener({ controllerId: id, reachable: false });
            continue;
          }
          const session = sessions.get(id) ?? startSession(id, controller.host);
          session.refCount += 1;
          session.listeners.add(listener);
          joined.push(session);
        }
        let closed = false;
        return () => {
          if (closed) return;
          closed = true;
          for (const session of joined) {
            session.refCount -= 1;
            session.listeners.delete(listener);
            if (session.refCount <= 0) {
              clearInterval(session.timer);
              sessions.delete(session.controllerId);
            }
          }
        };
      },
      activeSessionCount(): number {
        return sessions.size;
      }
    };
  }

  export type LiveSessionManager = ReturnType<typeof createLiveSessionManager>;
  ```

  Note: the immediate first poll goes through `queueMicrotask` so `subscribe` stays synchronous; under fake timers `await vi.advanceTimersByTimeAsync(0)` flushes it.

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/live/sessions.test.ts` — expect PASS (7 tests).

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 5: refcounted live fast-poll session manager"`

---

## Task 6: `GET /api/live` SSE route + app mount

**Files:**
- Create: `server/src/live/routes.ts`
- Modify: `server/src/app.ts` (imports at lines 4–13; mounts at lines 23–33)
- Test (create): `server/test/live/routes.test.ts`

**Interfaces:**
- Consumes: `LiveSessionManager` (Task 5).
- Produces (BINDING route shape from master; consumed by Phase D `api/live.ts`):
  ```
  GET /api/live?controllers=<id>,<id>   (SSE)
  event: status
  data: { "controllerId": string, "reachable": boolean, "state"?: WledState, "info"?: WledInfo }
  ```
  Missing/empty `controllers` → 400 JSON. Heartbeat comment `: heartbeat` every 15s. On client disconnect: heartbeat cleared + manager unsubscribed.
  ```ts
  export function createLiveRouter(db: Database.Database, manager?: LiveSessionManager, heartbeatMs?: number): Router; // heartbeatMs default 15_000
  ```
  (`heartbeatMs` is injectable because fake timers deadlock under real sockets — see vitest-testing-gotchas trap 2.)

**Steps:**

- [ ] Write the failing test `server/test/live/routes.test.ts` (real HTTP server + streamed fetch; the manager is faked, so no device polling and no fake timers):

  ```ts
  import { describe, it, expect, afterEach, vi } from 'vitest';
  import express from 'express';
  import type { Server } from 'node:http';
  import type { AddressInfo } from 'node:net';
  import { createDb } from '../../src/db/client.js';
  import { createLiveRouter } from '../../src/live/routes.js';
  import type { LiveEvent, LiveListener, LiveSessionManager } from '../../src/live/sessions.js';
  import type { WledState } from '../../src/wled/types.js';

  const STATE: WledState = { on: true, bri: 9, ps: -1, seg: [] };

  function makeFakeManager(initialEvents: LiveEvent[]) {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((_ids: string[], listener: LiveListener) => {
      for (const event of initialEvents) listener(event);
      return unsubscribe;
    });
    const manager = { subscribe, activeSessionCount: () => 0 } as unknown as LiveSessionManager;
    return { manager, subscribe, unsubscribe };
  }

  describe('live SSE route', () => {
    const servers: Server[] = [];

    afterEach(async () => {
      for (const server of servers.splice(0)) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    async function startServer(manager: LiveSessionManager, heartbeatMs?: number): Promise<number> {
      const app = express();
      app.use('/api/live', createLiveRouter(createDb(':memory:'), manager, heartbeatMs));
      const server = app.listen(0);
      servers.push(server);
      await new Promise((resolve) => server.once('listening', resolve));
      return (server.address() as AddressInfo).port;
    }

    it('400s without a controllers query param', async () => {
      const { manager } = makeFakeManager([]);
      const port = await startServer(manager);
      const res = await fetch(`http://127.0.0.1:${port}/api/live`);
      expect(res.status).toBe(400);
    });

    it('streams status events with SSE headers', async () => {
      const { manager, subscribe } = makeFakeManager([{ controllerId: 'c1', reachable: true, state: STATE }]);
      const port = await startServer(manager);
      const abort = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/live?controllers=c1,c2`, { signal: abort.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');

      const reader = res.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('event: status\n');
      expect(text).toContain('"controllerId":"c1"');
      expect(text).toContain('"reachable":true');
      expect(subscribe).toHaveBeenCalledWith(['c1', 'c2'], expect.any(Function));
      abort.abort();
    });

    it('unsubscribes from the session manager when the client disconnects', async () => {
      const { manager, unsubscribe } = makeFakeManager([{ controllerId: 'c1', reachable: false }]);
      const port = await startServer(manager);
      const abort = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/live?controllers=c1`, { signal: abort.signal });
      await res.body!.getReader().read();
      abort.abort();
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    });

    it('writes heartbeat comments on the configured interval', async () => {
      const { manager } = makeFakeManager([]); // no events → first bytes must be the heartbeat
      const port = await startServer(manager, 25);
      const abort = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/live?controllers=c1`, { signal: abort.signal });
      const { value } = await res.body!.getReader().read();
      expect(new TextDecoder().decode(value)).toContain(': heartbeat');
      abort.abort();
    });
  });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/live/routes.test.ts` — expect FAIL: `Cannot find module '.../src/live/routes.js'`.

- [ ] Create `server/src/live/routes.ts`:

  ```ts
  import { Router } from 'express';
  import type Database from 'better-sqlite3';
  import { createLiveSessionManager, type LiveSessionManager } from './sessions.js';

  export function createLiveRouter(
    db: Database.Database,
    manager: LiveSessionManager = createLiveSessionManager(db),
    heartbeatMs = 15_000
  ): Router {
    const router = Router();

    router.get('/', (req, res) => {
      const raw = typeof req.query.controllers === 'string' ? req.query.controllers : '';
      const controllerIds = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (controllerIds.length === 0) {
        return res.status(400).json({ error: 'controllers query parameter is required' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const unsubscribe = manager.subscribe(controllerIds, (event) => {
        res.write(`event: status\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, heartbeatMs);

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    });

    return router;
  }
  ```

- [ ] Mount it in `server/src/app.ts` — add to the import block:

  ```ts
  import { createLiveRouter } from './live/routes.js';
  ```

  and after the `/api/settings` mount (line 33):

  ```ts
    app.use('/api/live', createLiveRouter(db));
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/live/routes.test.ts` — expect PASS (4 tests). Full suite: `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect PASS.

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 6: GET /api/live SSE stream with heartbeat and disconnect cleanup"`

---

## Task 7: Preset list parser (pure module)

**Files:**
- Create: `server/src/devices/presets.ts`
- Test (create): `server/test/devices/presets.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (consumed by Task 9; response item shape is BINDING from master's presets route contract):
  ```ts
  export interface DevicePreset {
    id: number;
    name: string;
    isPlaylist: boolean;
    quicklook?: { fx?: number; pal?: number; on?: boolean; bri?: number };
  }
  export function parsePresetsJson(raw: Record<string, unknown>): DevicePreset[];  // sorted by id; skips empty/unnamed slots
  ```
  (No slot picker here: the "next free slot 1-250 when id omitted" rule lives inside Phase A's `savePreset` — see Task 9 — so this module stays a pure read-side parser.)

**Steps:**

- [ ] Write the failing test `server/test/devices/presets.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { parsePresetsJson } from '../../src/devices/presets.js';

  // A fresh WLED 16.0.0 device serves {"0":{}} (probed live at 192.168.1.86).
  // Saved presets store a full state snapshot with `n`; playlists store a
  // `playlist` object; WLED pads deleted slots as {} or omits them.
  const RAW: Record<string, unknown> = {
    '0': {},
    '1': {
      n: 'Warm White', on: true, bri: 128, transition: 7, mainseg: 0,
      seg: [
        {
          id: 0, start: 0, stop: 39, grp: 1, spc: 0, of: 0, on: true, frz: false, bri: 255, cct: 127,
          col: [[255, 197, 143, 0], [0, 0, 0, 0], [0, 0, 0, 0]], fx: 0, sx: 128, ix: 128, pal: 0,
          c1: 128, c2: 128, c3: 16, sel: true, rev: false, mi: false, o1: false, o2: false, o3: false
        },
        { stop: 0 }
      ]
    },
    '3': {
      n: 'Party Mix', on: true, bri: 200,
      seg: [{ id: 0, start: 0, stop: 48, fx: 9, pal: 6, col: [[255, 0, 0], [0, 255, 0], [0, 0, 255]] }]
    },
    '7': {
      n: 'Evening Playlist', on: true,
      playlist: { ps: [1, 3], dur: [300, 300], transition: [7, 7], repeat: 0, end: 0 }
    }
  };

  describe('parsePresetsJson', () => {
    it('skips slot 0 and unnamed slots, sorts by id, and extracts quicklook fields', () => {
      expect(parsePresetsJson(RAW)).toEqual([
        { id: 1, name: 'Warm White', isPlaylist: false, quicklook: { on: true, bri: 128, fx: 0, pal: 0 } },
        { id: 3, name: 'Party Mix', isPlaylist: false, quicklook: { on: true, bri: 200, fx: 9, pal: 6 } },
        { id: 7, name: 'Evening Playlist', isPlaylist: true, quicklook: { on: true } }
      ]);
    });

    it('returns [] for a fresh device ({"0":{}})', () => {
      expect(parsePresetsJson({ '0': {} })).toEqual([]);
    });

    it('omits quicklook entirely when a preset has no recognizable fields', () => {
      expect(parsePresetsJson({ '2': { n: 'Opaque' } })).toEqual([
        { id: 2, name: 'Opaque', isPlaylist: false }
      ]);
    });
  });

  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/devices/presets.test.ts` — expect FAIL: `Cannot find module '.../src/devices/presets.js'`.

- [ ] Create `server/src/devices/presets.ts`:

  ```ts
  export interface DevicePreset {
    id: number;
    name: string;
    isPlaylist: boolean;
    quicklook?: { fx?: number; pal?: number; on?: boolean; bri?: number };
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  export function parsePresetsJson(raw: Record<string, unknown>): DevicePreset[] {
    const presets: DevicePreset[] = [];
    for (const [key, value] of Object.entries(raw)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 1) continue; // slot 0 is WLED's empty placeholder
      if (!isRecord(value)) continue;
      if (typeof value.n !== 'string' || value.n.length === 0) continue;

      const preset: DevicePreset = { id, name: value.n, isPlaylist: 'playlist' in value };

      const quicklook: NonNullable<DevicePreset['quicklook']> = {};
      if (typeof value.on === 'boolean') quicklook.on = value.on;
      if (typeof value.bri === 'number') quicklook.bri = value.bri;
      const firstSeg = Array.isArray(value.seg)
        ? value.seg.find((s): s is Record<string, unknown> => isRecord(s) && typeof s.fx === 'number')
        : undefined;
      if (firstSeg) {
        quicklook.fx = firstSeg.fx as number;
        if (typeof firstSeg.pal === 'number') quicklook.pal = firstSeg.pal;
      }
      if (Object.keys(quicklook).length > 0) preset.quicklook = quicklook;

      presets.push(preset);
    }
    return presets.sort((a, b) => a.id - b.id);
  }
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/devices/presets.test.ts` — expect PASS (3 tests).

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 7: device preset list parser (isPlaylist + quicklook)"`

---

## Task 8: Config diff builder (pure module)

**Files:**
- Create: `server/src/devices/configDiff.ts`
- Test (create): `server/test/devices/configDiff.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (consumed by Task 10; diff entry shape and rebootRequired rule are BINDING from master):
  ```ts
  export interface ConfigDiffEntry { path: string; from: unknown; to: unknown; }
  export function buildConfigDiff(current: unknown, patch: unknown): ConfigDiffEntry[]; // dot-joined paths e.g. hw.led.ins.0.pin.0
  export function rebootRequired(diff: ConfigDiffEntry[]): boolean; // true iff any path starts with hw. / nw. / ap. / eth.
  ```

**Chosen diff semantics** (matches WLED's cfg merge-patch behavior): plain objects MERGE — only keys present in the patch are compared; arrays REPLACE — compared index-by-index across the longer of the two, so indexes dropped by the patch are reported as removals (`to: undefined`) and indexes added by the patch as additions (`from: undefined`). Scalars compare with `Object.is`.

**Steps:**

- [ ] Write the failing test `server/test/devices/configDiff.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { buildConfigDiff, rebootRequired } from '../../src/devices/configDiff.js';

  // Subset of the real /json/cfg probed live from 192.168.1.86 (WLED 16.0.0).
  const CURRENT = {
    id: { mdns: 'cabinet-lights', name: 'Cabinet Lights', inv: 'Cabinet Lights', sui: false },
    nw: { ins: [{ ssid: 'Williams', pskl: 10, ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] }] },
    ap: { ssid: 'WLED-AP', pskl: 8, chan: 1, hide: 0 },
    hw: {
      led: {
        total: 48, maxpwr: 0, fps: 42,
        ins: [
          { start: 0, len: 39, pin: [16], order: 34, rev: true, skip: 0, type: 30 },
          { start: 39, len: 9, pin: [3], order: 34, rev: true, skip: 0, type: 30 }
        ]
      }
    },
    def: { ps: 1, on: true, bri: 128 }
  };

  describe('buildConfigDiff', () => {
    it('reports a changed nested scalar with a dot path', () => {
      expect(buildConfigDiff(CURRENT, { id: { name: 'Kitchen Cabinets' } })).toEqual([
        { path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen Cabinets' }
      ]);
    });

    it('returns [] when the patch matches current values (including equal arrays)', () => {
      expect(buildConfigDiff(CURRENT, { ap: { ssid: 'WLED-AP' } })).toEqual([]);
      expect(buildConfigDiff(CURRENT, { nw: { ins: [{ ip: [0, 0, 0, 0] }] } })).toEqual([]);
    });

    it('diffs arrays by index down to the changed leaf', () => {
      const patch = {
        hw: { led: { ins: [
          { start: 0, len: 39, pin: [17], order: 34, rev: true, skip: 0, type: 30 },
          { start: 39, len: 9, pin: [3], order: 34, rev: true, skip: 0, type: 30 }
        ] } }
      };
      expect(buildConfigDiff(CURRENT, patch)).toEqual([
        { path: 'hw.led.ins.0.pin.0', from: 16, to: 17 }
      ]);
    });

    it('reports array elements dropped by the patch as removals', () => {
      const patch = { hw: { led: { ins: [{ start: 0, len: 48, pin: [16], order: 34, rev: true, skip: 0, type: 30 }] } } };
      const diff = buildConfigDiff(CURRENT, patch);
      expect(diff).toContainEqual({ path: 'hw.led.ins.0.len', from: 39, to: 48 });
      expect(diff).toContainEqual({
        path: 'hw.led.ins.1',
        from: { start: 39, len: 9, pin: [3], order: 34, rev: true, skip: 0, type: 30 },
        to: undefined
      });
    });

    it('reports keys added by the patch with from: undefined', () => {
      expect(buildConfigDiff(CURRENT, { nw: { ins: [{ psk: 'hunter2' }] } })).toEqual([
        { path: 'nw.ins.0.psk', from: undefined, to: 'hunter2' }
      ]);
    });

    it('recurses into structures the current config lacks entirely', () => {
      expect(buildConfigDiff(CURRENT, { eth: { pin: [5] } })).toEqual([
        { path: 'eth.pin.0', from: undefined, to: 5 }
      ]);
    });
  });

  describe('rebootRequired', () => {
    it('is true iff any path starts with hw., nw., ap., or eth.', () => {
      expect(rebootRequired([{ path: 'id.name', from: 'a', to: 'b' }])).toBe(false);
      expect(rebootRequired([{ path: 'def.ps', from: 1, to: 2 }])).toBe(false);
      expect(rebootRequired([{ path: 'hw.led.ins.0.pin.0', from: 16, to: 17 }])).toBe(true);
      expect(rebootRequired([{ path: 'nw.ins.0.psk', from: undefined, to: 'x' }])).toBe(true);
      expect(rebootRequired([{ path: 'ap.ssid', from: 'a', to: 'b' }])).toBe(true);
      expect(rebootRequired([{ path: 'eth.pin.0', from: undefined, to: 5 }])).toBe(true);
      expect(rebootRequired([])).toBe(false);
    });
  });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/devices/configDiff.test.ts` — expect FAIL: `Cannot find module '.../src/devices/configDiff.js'`.

- [ ] Create `server/src/devices/configDiff.ts`:

  ```ts
  export interface ConfigDiffEntry {
    path: string;
    from: unknown;
    to: unknown;
  }

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function join(path: string, key: string | number): string {
    return path ? `${path}.${key}` : String(key);
  }

  function walk(current: unknown, patch: unknown, path: string, out: ConfigDiffEntry[]): void {
    if (isPlainObject(patch)) {
      // Objects merge: only keys present in the patch are compared.
      const base = isPlainObject(current) ? current : undefined;
      for (const key of Object.keys(patch)) {
        walk(base?.[key], patch[key], join(path, key), out);
      }
      return;
    }
    if (Array.isArray(patch)) {
      // Arrays replace: compare index-by-index across the longer array.
      const base = Array.isArray(current) ? current : [];
      const max = Math.max(patch.length, base.length);
      for (let i = 0; i < max; i += 1) {
        if (i >= patch.length) {
          out.push({ path: join(path, i), from: base[i], to: undefined }); // removed by the patch
        } else {
          walk(base[i], patch[i], join(path, i), out);
        }
      }
      return;
    }
    // Scalar leaf (string/number/boolean/null).
    if (!Object.is(current, patch)) {
      out.push({ path, from: current, to: patch });
    }
  }

  export function buildConfigDiff(current: unknown, patch: unknown): ConfigDiffEntry[] {
    const out: ConfigDiffEntry[] = [];
    walk(current, patch, '', out);
    return out;
  }

  export function rebootRequired(diff: ConfigDiffEntry[]): boolean {
    return diff.some((entry) => /^(hw|nw|ap|eth)\./.test(entry.path));
  }
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/devices/configDiff.test.ts` — expect PASS (7 tests).

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 8: flat config diff builder + rebootRequired rule"`

---

## Task 9: Device presets routes (`GET/POST /presets`, `DELETE /presets/:pid`) + app mount

**Files:**
- Create: `server/src/devices/routes.ts`
- Modify: `server/src/wled/client.ts` (ensure preset calls — step below)
- Modify: `server/src/app.ts` (mount)
- Test (create): `server/test/devices/routes.test.ts`

**Interfaces:**
- Consumes: `parsePresetsJson` (Task 7); Phase A Task 5's `savePreset` / `deletePreset` (the next-free-slot rule lives INSIDE `savePreset`); `getPresetsRaw` (added in this task — below).
- Produces (BINDING route shapes from master):
  ```
  GET    /api/controllers/:id/presets      → 200 { presets: DevicePreset[] } | 404 | 502
  POST   /api/controllers/:id/presets      → body { id?:number, name:string, includeBrightness:boolean, saveSegmentBounds:boolean }
                                             (id omitted = next free slot 1-250) → 201 { id, name } | 400 | 404 | 502
  DELETE /api/controllers/:id/presets/:pid → 204 | 404 | 502
  ```
  ```ts
  export function createDevicesRouter(db: Database.Database): Router;  // mounted at /api/controllers/:controllerId
  ```

**Steps:**

- [ ] Verify `server/src/wled/client.ts` has Phase A Task 5's preset ops (reproduced verbatim from `01-server-wled-v2.md`; device protocol verified against the spec's probed facts — save = `{psave,n,ib,sb}`, delete = `{pdel}`). The next-free-slot pick (1-250, slot 0 reserved) lives INSIDE `savePreset` — do NOT duplicate it in the route. If missing, add using the file's existing `getJson`/`postJson` helpers:

  ```ts
  export async function savePreset(
    host: string,
    opts: { id?: number; name: string; includeBrightness: boolean; saveSegmentBounds: boolean }
  ): Promise<{ id: number }> {
    let id = opts.id;
    if (id === undefined) {
      // Next free slot 1-250 (slot 0 is reserved by the device).
      const taken = new Set((await getPresets(host)).map((p) => p.id));
      id = 1;
      while (id <= 250 && taken.has(id)) id++;
      if (id > 250) throw new Error('no free preset slot (1-250)');
    }
    await postJson(host, '/json/state', {
      psave: id,
      n: opts.name,
      ib: opts.includeBrightness,
      sb: opts.saveSegmentBounds
    });
    return { id };
  }

  export async function deletePreset(host: string, presetId: number): Promise<void> {
    await postJson(host, '/json/state', { pdel: presetId });
  }
  ```

  Then ADD the raw-presets read (new in this task — Phase A only exposes the id/name-mapped `getPresets`, but the list route needs the raw slot objects for `isPlaylist`/`quicklook`):

  ```ts
  export function getPresetsRaw(host: string): Promise<Record<string, unknown>> {
    return getJson<Record<string, unknown>>(host, '/presets.json');
  }
  ```

- [ ] Write the failing test `server/test/devices/routes.test.ts`:

  ```ts
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
  import request from 'supertest';
  import express from 'express';
  import { createDb } from '../../src/db/client.js';
  import { createControllerRepository } from '../../src/controllers/repository.js';
  import { createDevicesRouter } from '../../src/devices/routes.js';

  const HOST = '10.0.0.50';

  function stubFetchByHost(
    handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
  ) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const host = new URL(url).host;
      const handler = handlers[host];
      if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
      const { status, body } = handler(url, init);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  // Same fixture family as test/devices/presets.test.ts — WLED presets.json
  // with a normal preset (1), a gap (2), a second preset (3), and a playlist (7).
  const RAW_PRESETS: Record<string, unknown> = {
    '0': {},
    '1': { n: 'Warm White', on: true, bri: 128, seg: [{ id: 0, start: 0, stop: 39, fx: 0, pal: 0, col: [[255, 197, 143, 0]] }] },
    '3': { n: 'Party Mix', on: true, bri: 200, seg: [{ id: 0, start: 0, stop: 48, fx: 9, pal: 6, col: [[255, 0, 0]] }] },
    '7': { n: 'Evening Playlist', on: true, playlist: { ps: [1, 3], dur: [300, 300], transition: [7, 7], repeat: 0, end: 0 } }
  };

  describe('device management routes', () => {
    let app: express.Express;
    let controllerId: string;

    beforeEach(() => {
      const db = createDb(':memory:');
      controllerId = createControllerRepository(db).add({ name: 'Cabinet', host: HOST, source: 'manual' }).id;
      app = express();
      app.use(express.json());
      app.use('/api/controllers/:controllerId', createDevicesRouter(db));
    });

    afterEach(() => vi.unstubAllGlobals());

    describe('presets', () => {
      it('GET lists parsed device presets', async () => {
        stubFetchByHost({
          [HOST]: (url) => {
            expect(url).toBe(`http://${HOST}/presets.json`);
            return { status: 200, body: RAW_PRESETS };
          }
        });
        const res = await request(app).get(`/api/controllers/${controllerId}/presets`);
        expect(res.status).toBe(200);
        expect(res.body.presets.map((p: any) => p.id)).toEqual([1, 3, 7]);
        expect(res.body.presets[2]).toEqual({
          id: 7, name: 'Evening Playlist', isPlaylist: true, quicklook: { on: true }
        });
      });

      it('POST saves into the next free slot when id is omitted', async () => {
        const posts: unknown[] = [];
        stubFetchByHost({
          [HOST]: (url, init) => {
            if (url.endsWith('/presets.json')) return { status: 200, body: RAW_PRESETS };
            posts.push(JSON.parse(init?.body as string));
            return { status: 200, body: { success: true } };
          }
        });
        const res = await request(app)
          .post(`/api/controllers/${controllerId}/presets`)
          .send({ name: 'Movie Night', includeBrightness: true, saveSegmentBounds: false });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ id: 2, name: 'Movie Night' });
        expect(posts).toEqual([{ psave: 2, n: 'Movie Night', ib: true, sb: false }]);
      });

      it('POST with an explicit id skips slot discovery', async () => {
        const posts: unknown[] = [];
        const fetchMock = stubFetchByHost({
          [HOST]: (_url, init) => {
            posts.push(JSON.parse(init?.body as string));
            return { status: 200, body: { success: true } };
          }
        });
        const res = await request(app)
          .post(`/api/controllers/${controllerId}/presets`)
          .send({ id: 42, name: 'Pinned', includeBrightness: false, saveSegmentBounds: true });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ id: 42, name: 'Pinned' });
        expect(fetchMock).toHaveBeenCalledTimes(1); // no presets.json fetch
        expect(posts).toEqual([{ psave: 42, n: 'Pinned', ib: false, sb: true }]);
      });

      it('POST without a name is a 400', async () => {
        const res = await request(app)
          .post(`/api/controllers/${controllerId}/presets`)
          .send({ includeBrightness: true, saveSegmentBounds: true });
        expect(res.status).toBe(400);
      });

      it('DELETE sends pdel and returns 204', async () => {
        const posts: unknown[] = [];
        stubFetchByHost({
          [HOST]: (_url, init) => {
            posts.push(JSON.parse(init?.body as string));
            return { status: 200, body: { success: true } };
          }
        });
        const res = await request(app).delete(`/api/controllers/${controllerId}/presets/3`);
        expect(res.status).toBe(204);
        expect(posts).toEqual([{ pdel: 3 }]);
      });

      it('404s for an unknown controller', async () => {
        const res = await request(app).get('/api/controllers/ghost/presets');
        expect(res.status).toBe(404);
      });

      it('502s when the device is unreachable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }));
        const res = await request(app).get(`/api/controllers/${controllerId}/presets`);
        expect(res.status).toBe(502);
        expect(res.body.error).toContain('ECONNREFUSED');
      });
    });
  });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/devices/routes.test.ts` — expect FAIL: `Cannot find module '.../src/devices/routes.js'`.

- [ ] Create `server/src/devices/routes.ts`:

  ```ts
  import { Router } from 'express';
  import type Database from 'better-sqlite3';
  import { createControllerRepository } from '../controllers/repository.js';
  import { getPresetsRaw, savePreset, deletePreset } from '../wled/client.js';
  import { parsePresetsJson } from './presets.js';

  export function createDevicesRouter(db: Database.Database): Router {
    const router = Router({ mergeParams: true });
    const repo = createControllerRepository(db);

    function resolveHost(controllerId: string): string | undefined {
      return repo.list().find((c) => c.id === controllerId)?.host;
    }

    router.get<{ controllerId: string }>('/presets', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });
      try {
        res.json({ presets: parsePresetsJson(await getPresetsRaw(host)) });
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    });

    router.post<{ controllerId: string }>('/presets', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });
      const { id, name, includeBrightness, saveSegmentBounds } = req.body ?? {};
      if (typeof name !== 'string' || name.length === 0) {
        return res.status(400).json({ error: 'name is required' });
      }
      try {
        // Slot picking (id omitted → next free 1-250) happens inside savePreset (Phase A).
        const saved = await savePreset(host, {
          id: typeof id === 'number' ? id : undefined,
          name,
          includeBrightness: !!includeBrightness,
          saveSegmentBounds: !!saveSegmentBounds
        });
        res.status(201).json({ id: saved.id, name });
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    });

    router.delete<{ controllerId: string; presetId: string }>('/presets/:presetId', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });
      try {
        await deletePreset(host, Number(req.params.presetId));
        res.status(204).end();
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    });

    return router;
  }
  ```

- [ ] Mount in `server/src/app.ts` — add import `import { createDevicesRouter } from './devices/routes.js';` and, directly below the segments mount (line 24), add:

  ```ts
    app.use('/api/controllers/:controllerId', createDevicesRouter(db));
  ```

  (Express falls through: paths the controllers/segments routers don't define reach this router; its own unmatched paths fall through harmlessly.)

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/devices/routes.test.ts` — expect PASS (7 tests). Full suite: `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect PASS (confirms the new mount steals no existing controller routes).

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 9: device preset routes (list/save-with-slot/delete)"`

---

## Task 10: Config get / dry-run / apply + reboot routes

**Files:**
- Modify: `server/src/devices/routes.ts` (append routes)
- Modify: `server/src/wled/client.ts` (ensure config/reboot calls — step below)
- Test (modify): `server/test/devices/routes.test.ts` (append describe blocks)

**Interfaces:**
- Consumes: `buildConfigDiff` / `rebootRequired` (Task 8); WLED client config calls (below).
- Produces (BINDING route shapes from master):
  ```
  GET  /api/controllers/:id/config          → 200 raw cfg.json passthrough | 404 | 502
  POST /api/controllers/:id/config?dryRun=1 → body { patch: object } → 200 { diff: ConfigDiffEntry[], rebootRequired: boolean } (no device write)
  POST /api/controllers/:id/config          → body { patch: object } → 200 { ok: true, rebootRequired: boolean } | 400 | 404 | 502
  POST /api/controllers/:id/reboot          → 200 { ok: true } | 404 | 502
  ```

**Steps:**

- [ ] Verify `server/src/wled/client.ts` exports Phase A's config/reboot calls (Tasks 4-5 of `01-server-wled-v2.md`, reproduced verbatim; add whatever is missing):

  ```ts
  export function getConfig(host: string): Promise<Record<string, unknown>> {
    return getJson<Record<string, unknown>>(host, '/json/cfg');
  }

  export function patchConfig(
    host: string,
    patch: Record<string, unknown>
  ): Promise<{ success?: boolean }> {
    return postJson<{ success?: boolean }>(host, '/json/cfg', patch);
  }

  export async function reboot(host: string): Promise<void> {
    await postJson(host, '/json/state', { rb: true });
  }
  ```

- [ ] Append failing tests to the outer describe in `server/test/devices/routes.test.ts`:

  ```ts
    // Subset of the real /json/cfg probed from 192.168.1.86.
    const CFG: Record<string, unknown> = {
      id: { mdns: 'cabinet-lights', name: 'Cabinet Lights', inv: 'Cabinet Lights', sui: false },
      ap: { ssid: 'WLED-AP', pskl: 8, chan: 1, hide: 0 },
      hw: { led: { total: 48, maxpwr: 0, fps: 42, ins: [{ start: 0, len: 39, pin: [16], order: 34, rev: true, skip: 0, type: 30 }] } },
      def: { ps: 1, on: true, bri: 128 }
    };

    describe('config', () => {
      it('GET passes the device cfg.json through', async () => {
        stubFetchByHost({
          [HOST]: (url) => {
            expect(url).toBe(`http://${HOST}/json/cfg`);
            return { status: 200, body: CFG };
          }
        });
        const res = await request(app).get(`/api/controllers/${controllerId}/config`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual(CFG);
      });

      it('POST ?dryRun=1 returns the flat diff + rebootRequired and never writes to the device', async () => {
        const fetchMock = stubFetchByHost({
          [HOST]: (url, init) => {
            expect(init?.method).toBeUndefined(); // GETs only
            expect(url).toBe(`http://${HOST}/json/cfg`);
            return { status: 200, body: CFG };
          }
        });
        const res = await request(app)
          .post(`/api/controllers/${controllerId}/config?dryRun=1`)
          .send({ patch: { id: { name: 'Kitchen Cabinets' }, hw: { led: { ins: [{ pin: [17] }] } } } });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          diff: [
            { path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen Cabinets' },
            { path: 'hw.led.ins.0.pin.0', from: 16, to: 17 }
          ],
          rebootRequired: true
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it('POST applies the patch and reports rebootRequired', async () => {
        const posts: { url: string; body: unknown }[] = [];
        stubFetchByHost({
          [HOST]: (url, init) => {
            if (!init || init.method === undefined) return { status: 200, body: CFG };
            posts.push({ url, body: JSON.parse(init.body as string) });
            return { status: 200, body: { success: true } };
          }
        });
        const res = await request(app)
          .post(`/api/controllers/${controllerId}/config`)
          .send({ patch: { def: { ps: 3 } } });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, rebootRequired: false });
        expect(posts).toEqual([{ url: `http://${HOST}/json/cfg`, body: { def: { ps: 3 } } }]);
      });

      it('POST without a patch object is a 400', async () => {
        const res = await request(app).post(`/api/controllers/${controllerId}/config`).send({});
        expect(res.status).toBe(400);
      });
    });

    describe('reboot', () => {
      it('POST sends rb:true and returns ok', async () => {
        const posts: unknown[] = [];
        stubFetchByHost({
          [HOST]: (url, init) => {
            expect(url).toBe(`http://${HOST}/json/state`);
            posts.push(JSON.parse(init?.body as string));
            return { status: 200, body: { on: true, bri: 9, ps: -1, seg: [] } };
          }
        });
        const res = await request(app).post(`/api/controllers/${controllerId}/reboot`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        expect(posts).toEqual([{ rb: true }]);
      });

      it('404s for an unknown controller', async () => {
        const res = await request(app).post('/api/controllers/ghost/reboot');
        expect(res.status).toBe(404);
      });
    });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/devices/routes.test.ts` — expect FAIL: `404` (routes not defined yet — the router falls through).

- [ ] Append to `server/src/devices/routes.ts` (before `return router;`), and extend the client import line with `getConfig, patchConfig, reboot` plus add `import { buildConfigDiff, rebootRequired } from './configDiff.js';`:

  ```ts
    router.get<{ controllerId: string }>('/config', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });
      try {
        res.json(await getConfig(host));
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    });

    router.post<{ controllerId: string }>('/config', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });
      const patch = req.body?.patch;
      if (typeof patch !== 'object' || patch === null) {
        return res.status(400).json({ error: 'patch is required' });
      }
      try {
        const current = await getConfig(host);
        const diff = buildConfigDiff(current, patch);
        const needsReboot = rebootRequired(diff);
        if (req.query.dryRun === '1') {
          return res.json({ diff, rebootRequired: needsReboot });
        }
        await patchConfig(host, patch);
        res.json({ ok: true, rebootRequired: needsReboot });
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    });

    router.post<{ controllerId: string }>('/reboot', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });
      try {
        await reboot(host);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/devices/routes.test.ts` — expect PASS (13 tests). Full suite: `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect PASS.

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 10: config get/dry-run-diff/apply + reboot routes"`

---

## Task 11: Widen segments routes to the full field set + create/delete

**Files:**
- Modify: `server/src/segments/routes.ts` (PUT at lines 21–27; new POST and DELETE)
- Test (modify): `server/test/segments/routes.test.ts` (PUT expectation at lines 53–66; new tests)

**Interfaces:**
- Consumes: widened `setState`/`WledStatePatch` (Phase A Task 1, verified in Task 4), `getState`, widened `WledSegment` (Phase A Task 1, verified in Task 3).
- Produces (consumed by Phase F Devices → Segments tab):
  ```
  GET    /api/controllers/:id/segments        → 200 WledSegment[] (unchanged)
  PUT    /api/controllers/:id/segments/:segId → body { start?, stop?, grp?, spc?, of?, rev?, mi?, name?, on?, bri? } → 200 WledSegment[]
  POST   /api/controllers/:id/segments        → body { start:number, stop:number } → 201 WledSegment[] (next free seg id)
  DELETE /api/controllers/:id/segments/:segId → 200 WledSegment[]  (WLED deletes a segment via stop:0)
  ```
  All writes include `udpn: { nn: true }` (global constraint). Note: the master says "Segment CRUD already exists; widen" but the existing router only has GET+PUT — POST/DELETE are added here because Phase F requires them and no other phase provides server support.

**Steps:**

- [ ] Update the existing PUT test in `server/test/segments/routes.test.ts` (lines 53–66) — the expected device body gains `udpn`:

  ```ts
    it('PUT pushes a new boundary to the device and returns updated segments', async () => {
      stubFetchOnce(
        { url: `http://${HOST}/json/state`, method: 'POST', body: { udpn: { nn: true }, seg: [{ id: 0, start: 0, stop: 90 }] } },
        {
          on: true, bri: 128, ps: -1,
          seg: [{ id: 0, start: 0, stop: 90, len: 90, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
        }
      );
      const res = await request(app)
        .put(`/api/controllers/${controllerId}/segments/0`)
        .send({ start: 0, stop: 90 });
      expect(res.status).toBe(200);
      expect(res.body[0].stop).toBe(90);
    });
  ```

  and add new failing tests after it:

  ```ts
    it('PUT accepts the full widened field set and maps name → n', async () => {
      stubFetchOnce(
        {
          url: `http://${HOST}/json/state`,
          method: 'POST',
          body: {
            udpn: { nn: true },
            seg: [{ id: 1, grp: 2, spc: 1, of: 3, rev: true, mi: false, n: 'Under-cabinet', on: false, bri: 96 }]
          }
        },
        {
          on: true, bri: 128, ps: -1,
          seg: [
            { id: 0, start: 0, stop: 39, len: 39, on: true, bri: 128, fx: 0, pal: 0, col: [] },
            { id: 1, start: 39, stop: 48, len: 9, on: false, bri: 96, fx: 0, pal: 0, col: [] }
          ]
        }
      );
      const res = await request(app)
        .put(`/api/controllers/${controllerId}/segments/1`)
        .send({ grp: 2, spc: 1, of: 3, rev: true, mi: false, name: 'Under-cabinet', on: false, bri: 96 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('POST creates a segment at the next free id', async () => {
      // Two-segment layout probed from the real controller (ids 0 and 1).
      const existing = {
        on: true, bri: 128, ps: -1,
        seg: [
          { id: 0, start: 0, stop: 39, len: 39, on: true, bri: 128, fx: 0, pal: 0, col: [] },
          { id: 1, start: 39, stop: 48, len: 9, on: true, bri: 128, fx: 0, pal: 0, col: [] }
        ]
      };
      const posts: unknown[] = [];
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (!init || init.method === undefined) {
          return { ok: true, json: async () => existing } as Response;
        }
        posts.push(JSON.parse(init.body as string));
        return {
          ok: true,
          json: async () => ({
            ...existing,
            seg: [...existing.seg, { id: 2, start: 48, stop: 60, len: 12, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
          })
        } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await request(app)
        .post(`/api/controllers/${controllerId}/segments`)
        .send({ start: 48, stop: 60 });
      expect(res.status).toBe(201);
      expect(posts).toEqual([{ udpn: { nn: true }, seg: [{ id: 2, start: 48, stop: 60 }] }]);
      expect(res.body).toHaveLength(3);
    });

    it('POST without numeric start/stop is a 400', async () => {
      const res = await request(app).post(`/api/controllers/${controllerId}/segments`).send({ start: 'a' });
      expect(res.status).toBe(400);
    });

    it('DELETE removes a segment via stop:0 and returns the remaining segments', async () => {
      stubFetchOnce(
        { url: `http://${HOST}/json/state`, method: 'POST', body: { udpn: { nn: true }, seg: [{ id: 1, stop: 0 }] } },
        {
          on: true, bri: 128, ps: -1,
          seg: [{ id: 0, start: 0, stop: 39, len: 39, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
        }
      );
      const res = await request(app).delete(`/api/controllers/${controllerId}/segments/1`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  ```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/segments/routes.test.ts` — expect FAIL: existing PUT test fails on the body mismatch (no `udpn`), new routes 404.

- [ ] Implement — replace `server/src/segments/routes.ts` with:

  ```ts
  import { Router } from 'express';
  import type Database from 'better-sqlite3';
  import { createControllerRepository } from '../controllers/repository.js';
  import { getState, setState } from '../wled/client.js';
  import type { WledSegment } from '../wled/types.js';

  export function createSegmentsRouter(db: Database.Database): Router {
    const router = Router({ mergeParams: true });
    const repo = createControllerRepository(db);

    function resolveHost(controllerId: string): string | undefined {
      return repo.list().find((c) => c.id === controllerId)?.host;
    }

    router.get<{ controllerId: string }>('/', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });
      const state = await getState(host);
      res.json(state.seg);
    });

    router.put<{ controllerId: string; segId: string }>('/:segId', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });

      const body = req.body ?? {};
      const seg: Partial<WledSegment> = { id: Number(req.params.segId) };
      if (body.start !== undefined) seg.start = Number(body.start);
      if (body.stop !== undefined) seg.stop = Number(body.stop);
      if (body.grp !== undefined) seg.grp = Number(body.grp);
      if (body.spc !== undefined) seg.spc = Number(body.spc);
      if (body.of !== undefined) seg.of = Number(body.of);
      if (body.bri !== undefined) seg.bri = Number(body.bri);
      if (body.on !== undefined) seg.on = !!body.on;
      if (body.rev !== undefined) seg.rev = !!body.rev;
      if (body.mi !== undefined) seg.mi = !!body.mi;
      if (body.name !== undefined) seg.n = String(body.name);
      if (body.n !== undefined) seg.n = String(body.n);

      const state = await setState(host, { udpn: { nn: true }, seg: [seg] });
      res.json(state.seg);
    });

    router.post<{ controllerId: string }>('/', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });
      const { start, stop } = req.body ?? {};
      if (typeof start !== 'number' || typeof stop !== 'number') {
        return res.status(400).json({ error: 'start and stop are required numbers' });
      }
      const current = await getState(host);
      const nextId = current.seg.length === 0 ? 0 : Math.max(...current.seg.map((s) => s.id)) + 1;
      const state = await setState(host, { udpn: { nn: true }, seg: [{ id: nextId, start, stop }] });
      res.status(201).json(state.seg);
    });

    router.delete<{ controllerId: string; segId: string }>('/:segId', async (req, res) => {
      const host = resolveHost(req.params.controllerId);
      if (!host) return res.status(404).json({ error: 'controller not found' });
      // WLED deletes a segment when it receives stop: 0 for that id.
      const state = await setState(host, { udpn: { nn: true }, seg: [{ id: Number(req.params.segId), stop: 0 }] });
      res.json(state.seg);
    });

    return router;
  }
  ```

  (`setSegment` in `wled/client.ts` becomes unused by routes; leave it — Phase I owns dead-code cleanup.)

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/segments/routes.test.ts` — expect PASS (8 tests).

- [ ] Phase gate: `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect ALL PASS — and `cd /Users/bwwilliams/github/uber-wled/server && npm run build` — expect a clean tsc build.

- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server && git commit -m "Phase B task 11: segments routes widened to full field set + create/delete with udpn nn"`

---

## Contract self-check (for the reviewer)

- `Target` / `SegPatch` / `ControlPatch` / `ApplyResult` in Task 3 are byte-for-byte the master's fan-out contract — including `ControlPatch.ps?: number` for device-preset apply (the master defines no dedicated preset-apply route: `{ targets, patch: { ps } }` goes through `POST /api/control/apply`, written at device level with `udpn:{nn:true}`); the route accepts `{ targets, patch }` and returns `{ results }` with HTTP 200 on partial failure.
- SSE emits `event: status` with `{ controllerId, reachable, state?, info? }`; sessions are per-controller, refcounted, interval from `settings.live_poll_interval_seconds`, info every 10th tick, stopped on last unsubscribe (`server/src/live/sessions.ts` + `server/src/live/routes.ts`, exactly the module paths the master names).
- Device routes match the master's list verbatim, including `rebootRequired` = any dot path starting `hw.` / `nw.` / `ap.` / `eth.`, preset save slot 1–250 (the pick lives inside Phase A's `savePreset`; the route stays thin), and quicklook `{fx,pal,on,bri}`.
- Every Phase A signature this phase consumes (`setState(host, WledStatePatch)`, `savePreset` with optional id returning `{id}`, `deletePreset`/`reboot` returning `void`, `patchConfig` returning `{success?}`) is quoted verbatim from `01-server-wled-v2.md` in the task that touches it.
- Schema adds are the master's four statements, implemented via the existing idempotent PRAGMA-guarded ALTER pattern.
- v1 `{members, action}` behavior is bit-identical (its four pre-existing tests are untouched and must stay green through Task 4).
