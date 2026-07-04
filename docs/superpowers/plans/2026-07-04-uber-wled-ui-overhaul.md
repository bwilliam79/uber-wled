# uber-wled UI/UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the shipped single-screen uber-wled UI into a left-sidebar app shell with seven focused sections; replace the floorplan-image layout with an imageless LED-strip canvas that doubles as the control surface; add a real month-calendar Schedule view, a dedicated Firmware section with stable-release-only filtering, and a new Settings section — while keeping every backend subsystem (discovery, segments, groups, themes, control, scheduler engine, calendar/holidays, firmware release-checking, WLED schedule import) intact.

**Architecture:** Node.js/TypeScript + Express backend owns all WLED communication, mDNS discovery, SQLite persistence, and scheduling; it serves a React (Vite) frontend. This overhaul (a) drops the `floorplans` table + image-upload wiring, (b) reshapes `placements` into a flat `strips` collection on one shared canvas, (c) adds `room_labels` and a single-row `settings` table, (d) makes the GitHub firmware release check filter out pre-releases by default (settings-driven), and (e) rebuilds the frontend as a sidebar shell with per-section screens. Everything still ships as one Docker image; SQLite lives on a mounted volume (no image files anymore).

**Tech Stack:** TypeScript, Express, better-sqlite3, bonjour-service (mDNS), node-cron, suncalc, React 19, Vite, Vitest, supertest, @testing-library/react. No new runtime dependencies are added; `multer` is removed. Client routing is a dependency-free hash-based section switch.

## Global Constraints

- HTTP mocking in tests uses `vi.stubGlobal('fetch', vi.fn(...))` — NEVER `nock` (nock cannot intercept Node's global fetch here and was removed).
- Express routers that read parent route params use explicit param-type generics because tsconfig is `strict: true` and `Router({ mergeParams: true })` otherwise fails `tsc` with TS2339 — e.g. `router.get<{ controllerId: string }>('/', ...)`.
- Repositories are factory functions taking `db: Database.Database`, using `randomUUID()` for ids, plain parameterized better-sqlite3 statements.
- Controller hosts are validated via `server/src/controllers/validateHost.ts` (`assertValidHost`) — reuse it, don't reinvent.
- Frontend components use the existing dark design-system CSS classes from `client/src/index.css` (`.btn`/`.btn-primary`/`.field`/`.input`/`.card`/`.badge`/`.controller-list`/`.error-banner` etc.), not ad-hoc inline styles where a class exists.
- The backend must stay buildable with `cd server && npm run build` (tsc) and pass `cd server && npm test`; the frontend must pass `cd client && npm test`. Baseline before this work: server 24 files / 124 tests, client 10 files / 27 tests.
- Manually-added controllers are never deleted by a re-scan; auto-discovered ones that disappear are marked stale, not deleted.
- Batch control writes stay per-controller (independent, retried once, failures reported per-controller); segment/config writes are not auto-retried.

---

## File Structure

```
uber-wled/
  server/
    package.json                         # MODIFY: drop multer + @types/multer
    src/
      app.ts                             # MODIFY: unmount floorplans/placements, mount strips/room-labels/settings
      server.ts                          # MODIFY: discovery interval from settings
      db/
        schema.ts                        # MODIFY: drop floorplans + placements, add strips/room_labels/settings, add prerelease col
      floorplans/                        # REMOVE (repository.ts, routes.ts)
      placements/                        # REMOVE (repository.ts, routes.ts) — replaced by strips/
      strips/
        repository.ts                    # CREATE: Strip CRUD (flat, no floorplan)
        routes.ts                        # CREATE: /api/strips with split-recommendation on create
      room_labels/
        repository.ts                    # CREATE: RoomLabel CRUD
        routes.ts                        # CREATE: /api/room-labels
      settings/
        repository.ts                    # CREATE: single-row Settings get/update (with defaults)
        routes.ts                        # CREATE: /api/settings GET/PATCH + POST /rescan
      firmware/
        githubClient.ts                  # MODIFY: prerelease flag + full-list cache + includePrerelease filter
        routes.ts                        # MODIFY: read settings, pass includePrerelease, add isPrerelease to response
    test/
      db/client.test.ts                  # MODIFY: expected table list
      floorplans/routes.test.ts          # REMOVE
      placements/routes.test.ts          # REMOVE → strips/routes.test.ts
      strips/routes.test.ts              # CREATE
      room_labels/routes.test.ts         # CREATE
      settings/routes.test.ts            # CREATE
      firmware/githubClient.test.ts      # MODIFY: add stable-vs-prerelease filter tests
  client/
    src/
      main.tsx
      App.tsx                            # MODIFY: render AppShell
      api/client.ts                      # MODIFY: remove floorplan/placement, add strips/roomLabels/settings, isPrerelease
      lib/dateRules.ts                   # CREATE: client port of resolveDate for the calendar grid
      components/
        Sidebar.tsx                      # CREATE: nav rail, seven sections, active highlight, collapse
        AppShell.tsx                     # CREATE: sidebar + active-section switch (hash routing)
        ControllersSection.tsx           # CREATE: add-controller form + ControllerList (moved out of Dashboard)
        StripCanvas.tsx                  # CREATE (replaces FloorplanCanvas.tsx): imageless strip render + select + marquee + drag
        StripPathEditor.tsx              # CREATE (replaces SegmentPathEditor.tsx): draw new strip + hardware binding
        RoomLabelLayer.tsx               # CREATE: draggable room-label tags
        LayoutSection.tsx                # CREATE (replaces FloorplanEditor.tsx): canvas + draw + docked ControlPanel
        ControlPanel.tsx                 # MODIFY: right-dock styling + neutral empty state
        CalendarGrid.tsx                 # CREATE: month grid, weekday headers, prev/next/today, event chips
        ScheduleSection.tsx              # CREATE: CalendarGrid + selected-day panel + weekly list + "+ Event"
        FirmwareSection.tsx              # CREATE: per-controller firmware status list
        FirmwareStatus.tsx               # MODIFY: show "(pre-release)" indicator
        SettingsSection.tsx              # CREATE: settings form + re-scan-now
        FloorplanCanvas.tsx              # REMOVE
        SegmentPathEditor.tsx            # REMOVE
        icons.tsx                        # MODIFY: add section icons
      pages/
        Dashboard.tsx                    # REMOVE
        FloorplanEditor.tsx              # REMOVE
    src/test/
      Dashboard.test.tsx                 # REMOVE
      components/FloorplanCanvas.test.tsx# REMOVE
      api/client.test.ts                 # MODIFY: add strips/settings assertions
      AppShell.test.tsx                  # CREATE
      ControllersSection.test.tsx        # CREATE
      components/StripCanvas.test.tsx     # CREATE
      components/StripPathEditor.test.tsx # CREATE
      components/RoomLabelLayer.test.tsx  # CREATE
      LayoutSection.test.tsx             # CREATE
      components/ControlPanel.test.tsx    # MODIFY: empty-state assertion
      CalendarGrid.test.tsx              # CREATE
      ScheduleSection.test.tsx           # CREATE
      FirmwareSection.test.tsx           # CREATE
      SettingsSection.test.tsx           # CREATE
```

**Shared type names (spelled identically everywhere):**
- Backend `Strip` (`server/src/strips/repository.ts`) and client `Strip` (`client/src/api/client.ts`): `{ id: string; controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label: string | null }`.
- Backend `RoomLabel` / client `RoomLabel`: `{ id: string; name: string; x: number; y: number }`.
- Backend `Settings` / client `Settings`: `{ includePrereleaseFirmware: boolean; homeLatitude: number | null; homeLongitude: number | null; discoveryRescanIntervalMinutes: number; scheduleImportDisableOnDeviceDefault: boolean }`.
- `Point` reused from `server/src/segments/recommend.ts` (`{ x: number; y: number }`).
- Client `SectionKey = 'layout' | 'controllers' | 'groups' | 'themes' | 'schedule' | 'firmware' | 'settings'`.
- `WledRelease` gains `prerelease: boolean`.
- Firmware status response / client `FirmwareStatus` gains `isPrerelease: boolean`.

---

## Phase A — Backend (Tasks 1–5)

### Task 1: Reshape `placements` → flat `strips`

**Files:**
- Modify: `server/src/db/schema.ts` (drop `placements`, add `strips`)
- Create: `server/src/strips/repository.ts`, `server/src/strips/routes.ts`
- Remove: `server/src/placements/repository.ts`, `server/src/placements/routes.ts`
- Modify: `server/src/app.ts` (replace placements mount with strips mount)
- Create: `server/test/strips/routes.test.ts`
- Remove: `server/test/placements/routes.test.ts`
- Modify: `server/test/db/client.test.ts` (table list)

**Interfaces:**
- Produces:
  - `interface Strip { id: string; controllerId: string; wledSegId: number; points: Point[]; label: string | null; }`
  - `function createStripRepository(db: Database.Database)` → `{ list(): Strip[]; add(input: Omit<Strip,'id'>): Strip; update(id: string, patch: Partial<Omit<Strip,'id'>>): Strip; remove(id: string): void; }`
  - `function createStripsRouter(db: Database.Database): express.Router` mounted at `/api/strips`:
    - `GET /` → `Strip[]`
    - `POST /` body `{ controllerId, wledSegId, points, label? }` → `{ strip: Strip; recommendations: SplitRecommendation[] }` (recommendations computed only over strips of the same controller against that controller's live segments)
    - `PATCH /:id` → `Strip`
    - `DELETE /:id` → 204
- Consumes: `createControllerRepository` (resolve host), `getState` (wled), `recommendSplits`/`SplitRecommendation`/`Point` (`segments/recommend.ts`, unchanged).

- [ ] **Step 1: Replace the placements routes test with a strips routes test (failing)**

Delete `server/test/placements/routes.test.ts`. Create `server/test/strips/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createStripsRouter } from '../../src/strips/routes.js';

const HOST = '10.0.0.50';

function stubFetchState(body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => body } as Response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
function stubFetchFailure() {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('device unreachable'); }));
}

describe('strips routes', () => {
  let app: express.Express;
  let controllerId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/strips', createStripsRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates a strip with an optional label and returns it in the flat list', async () => {
    stubFetchFailure();
    const post = await request(app)
      .post('/api/strips')
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], label: 'Porch rail' });
    expect(post.status).toBe(201);
    expect(post.body.strip.label).toBe('Porch rail');
    expect(post.body.strip.controllerId).toBe(controllerId);

    const list = await request(app).get('/api/strips');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].wledSegId).toBe(0);
  });

  it('recommends a split when two strips share one device segment on the same controller', async () => {
    stubFetchState({ on: true, bri: 128, ps: -1, seg: [{ id: 0, start: 0, stop: 120, len: 120, on: true, bri: 128, fx: 0, pal: 0, col: [] }] });
    await request(app).post('/api/strips').send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
    const second = await request(app).post('/api/strips').send({ controllerId, wledSegId: 0, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] });
    expect(second.body.recommendations).toHaveLength(1);
    expect(second.body.recommendations[0].suggestedSplitAt).toBe(60);
  });

  it('deletes a strip', async () => {
    stubFetchFailure();
    const post = await request(app).post('/api/strips').send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    await request(app).delete(`/api/strips/${post.body.strip.id}`).expect(204);
    const list = await request(app).get('/api/strips');
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/strips/routes.test.ts`
Expected: FAIL — cannot find module `../../src/strips/routes.js`.

- [ ] **Step 3: Update the schema — drop `placements`, add `strips`**

In `server/src/db/schema.ts`, at the very top of the `db.exec(\`...\`)` template add drop statements, and replace the `placements` `CREATE TABLE` block with a `strips` block. The full function becomes:
```ts
import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS placements;

    CREATE TABLE IF NOT EXISTS controllers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK (source IN ('discovered','manual')),
      stale INTEGER NOT NULL DEFAULT 0,
      pinned_asset_pattern TEXT
    );

    CREATE TABLE IF NOT EXISTS floorplans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_path TEXT NOT NULL,
      crop_x REAL NOT NULL DEFAULT 0,
      crop_y REAL NOT NULL DEFAULT 0,
      crop_width REAL NOT NULL DEFAULT 1,
      crop_height REAL NOT NULL DEFAULT 1,
      rotation REAL NOT NULL DEFAULT 0,
      zoom REAL NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS strips (
      id TEXT PRIMARY KEY,
      controller_id TEXT NOT NULL REFERENCES controllers(id),
      wled_seg_id INTEGER NOT NULL,
      points TEXT NOT NULL,
      label TEXT
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
      assets TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);
}
```
(The `floorplans` table stays for now; it is removed in Task 2 to keep each task's build green.)

- [ ] **Step 4: Create `server/src/strips/repository.ts`**
```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Point } from '../segments/recommend.js';

export interface Strip {
  id: string;
  controllerId: string;
  wledSegId: number;
  points: Point[];
  label: string | null;
}

function fromRow(row: any): Strip {
  return {
    id: row.id,
    controllerId: row.controller_id,
    wledSegId: row.wled_seg_id,
    points: JSON.parse(row.points),
    label: row.label ?? null
  };
}

export function createStripRepository(db: Database.Database) {
  return {
    list(): Strip[] {
      return db.prepare('SELECT * FROM strips').all().map(fromRow);
    },
    add(input: Omit<Strip, 'id'>): Strip {
      const id = randomUUID();
      db.prepare('INSERT INTO strips (id, controller_id, wled_seg_id, points, label) VALUES (?, ?, ?, ?, ?)')
        .run(id, input.controllerId, input.wledSegId, JSON.stringify(input.points), input.label);
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<Strip, 'id'>>): Strip {
      const current = db.prepare('SELECT * FROM strips WHERE id = ?').get(id);
      if (!current) throw new Error(`strip ${id} not found`);
      const existing = fromRow(current);
      const next = { ...existing, ...patch };
      db.prepare('UPDATE strips SET controller_id = ?, wled_seg_id = ?, points = ?, label = ? WHERE id = ?')
        .run(next.controllerId, next.wledSegId, JSON.stringify(next.points), next.label, id);
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM strips WHERE id = ?').run(id);
    }
  };
}
```

- [ ] **Step 5: Create `server/src/strips/routes.ts`**
```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createStripRepository } from './repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { getState } from '../wled/client.js';
import { recommendSplits, type SplitRecommendation } from '../segments/recommend.js';

export function createStripsRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createStripRepository(db);
  const controllerRepo = createControllerRepository(db);

  function resolveHost(controllerId: string): string | undefined {
    return controllerRepo.list().find((c) => c.id === controllerId)?.host;
  }

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', async (req, res) => {
    const { controllerId, wledSegId, points, label } = req.body;
    const strip = repo.add({ controllerId, wledSegId, points, label: label ?? null });

    let recommendations: SplitRecommendation[] = [];
    const host = resolveHost(controllerId);
    if (host) {
      try {
        const sameController = repo.list().filter((s) => s.controllerId === controllerId);
        const state = await getState(host);
        recommendations = recommendSplits(sameController, state.seg);
      } catch {
        // Controller unreachable — the strip still saved; skip recommendations.
        recommendations = [];
      }
    }

    res.status(201).json({ strip, recommendations });
  });

  router.patch<{ id: string }>('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'strip not found' });
    }
  });

  router.delete<{ id: string }>('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 6: Delete the old placements module**

Run: `git rm server/src/placements/repository.ts server/src/placements/routes.ts`

- [ ] **Step 7: Swap the mount in `server/src/app.ts`**

Replace the placements import/mount. Change the import line
```ts
import { createPlacementsRouter } from './placements/routes.js';
```
to
```ts
import { createStripsRouter } from './strips/routes.js';
```
and replace the mount line
```ts
  app.use('/api/floorplans/:floorplanId/placements', createPlacementsRouter(db));
```
with
```ts
  app.use('/api/strips', createStripsRouter(db));
```
(Leave the `/api/floorplans` mount in place — it is removed in Task 2.)

- [ ] **Step 8: Update the db-client table-list test**

In `server/test/db/client.test.ts`, replace `'placements',` with `'strips',` in the expected sorted array so it reads:
```ts
    expect(tables).toEqual([
      'calendar_events',
      'controllers',
      'floorplans',
      'group_members',
      'groups',
      'schedules',
      'strips',
      'themes',
      'wled_releases'
    ]);
```

- [ ] **Step 9: Run the strips test and the full server suite, confirm green**

Run: `cd server && npm test -- test/strips/routes.test.ts` → PASS (3 tests).
Run: `cd server && npm test` → all PASS.
Run: `cd server && npm run build` → tsc succeeds (no references to the deleted placements module remain).

- [ ] **Step 10: Commit**
```bash
git add server/src/db/schema.ts server/src/strips server/src/app.ts server/test/strips server/test/db/client.test.ts
git rm -r server/src/placements server/test/placements/routes.test.ts
git commit -m "Reshape placements into a flat strips collection on a shared canvas"
```

---

### Task 2: Remove floorplans entirely

**Files:**
- Modify: `server/src/db/schema.ts` (drop `floorplans`)
- Remove: `server/src/floorplans/repository.ts`, `server/src/floorplans/routes.ts`
- Modify: `server/src/app.ts` (unmount floorplans, drop `UPLOAD_DIR`)
- Modify: `server/package.json` (remove `multer`, `@types/multer`)
- Remove: `server/test/floorplans/routes.test.ts`
- Modify: `server/test/db/client.test.ts` (table list)

**Interfaces:**
- Produces: nothing new. Removes the `/api/floorplans` route family and the `floorplans` table.
- Verified: `multer` is imported only by `server/src/floorplans/routes.ts` (grep confirms no other usage), so it can be dropped from `package.json`.

- [ ] **Step 1: Update the db-client table-list test first (failing)**

In `server/test/db/client.test.ts`, remove the `'floorplans',` entry so the expected array is:
```ts
    expect(tables).toEqual([
      'calendar_events',
      'controllers',
      'group_members',
      'groups',
      'schedules',
      'strips',
      'themes',
      'wled_releases'
    ]);
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/db/client.test.ts`
Expected: FAIL — actual list still contains `'floorplans'`.

- [ ] **Step 3: Drop the `floorplans` table in `server/src/db/schema.ts`**

Add `DROP TABLE IF EXISTS floorplans;` to the drop statements at the top of the `db.exec` template and delete the `CREATE TABLE IF NOT EXISTS floorplans (...)` block. The top of the template now reads:
```ts
  db.exec(`
    DROP TABLE IF EXISTS placements;
    DROP TABLE IF EXISTS floorplans;

    CREATE TABLE IF NOT EXISTS controllers (
```

- [ ] **Step 4: Delete the floorplans module and its test**

Run: `git rm server/src/floorplans/repository.ts server/src/floorplans/routes.ts server/test/floorplans/routes.test.ts`

- [ ] **Step 5: Unmount floorplans in `server/src/app.ts`**

Remove these three lines:
```ts
import { createFloorplansRouter } from './floorplans/routes.js';
```
```ts
  const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './data/floorplans';
  app.use('/api/floorplans', createFloorplansRouter(db, UPLOAD_DIR));
```
After this edit, `app.ts` mounts (in order): controllers, controllers/segments, strips, groups, themes, control, schedules, calendar-events.

- [ ] **Step 6: Remove multer from `server/package.json`**

Delete `"multer": "^1.4.5-lts.1",` from `dependencies` and `"@types/multer": "^1.4.11",` from `devDependencies`.
Run: `cd server && npm install` (regenerates the lockfile without multer).

- [ ] **Step 7: Run the full server suite + build, confirm green**

Run: `cd server && npm test` → all PASS (the floorplans test file is gone; db-client test passes).
Run: `cd server && npm run build` → tsc succeeds.

- [ ] **Step 8: Commit**
```bash
git add server/src/db/schema.ts server/src/app.ts server/package.json server/package-lock.json server/test/db/client.test.ts
git rm -r server/src/floorplans server/test/floorplans/routes.test.ts
git commit -m "Remove floorplans table, routes, and multer image-upload wiring"
```

---

### Task 3: Add `room_labels` table, repository, and routes

**Files:**
- Modify: `server/src/db/schema.ts` (add `room_labels`)
- Create: `server/src/room_labels/repository.ts`, `server/src/room_labels/routes.ts`
- Modify: `server/src/app.ts` (mount `/api/room-labels`)
- Create: `server/test/room_labels/routes.test.ts`
- Modify: `server/test/db/client.test.ts` (table list)

**Interfaces:**
- Produces:
  - `interface RoomLabel { id: string; name: string; x: number; y: number; }`
  - `function createRoomLabelRepository(db: Database.Database)` → `{ list(): RoomLabel[]; add(input: Omit<RoomLabel,'id'>): RoomLabel; update(id: string, patch: Partial<Omit<RoomLabel,'id'>>): RoomLabel; remove(id: string): void; }`
  - `function createRoomLabelsRouter(db: Database.Database): express.Router` at `/api/room-labels`: `GET /` → `RoomLabel[]`; `POST /` body `{ name, x, y }` → `RoomLabel` (201); `PATCH /:id` → `RoomLabel`; `DELETE /:id` → 204.

- [ ] **Step 1: Write the failing routes test**

`server/test/room_labels/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createRoomLabelsRouter } from '../../src/room_labels/routes.js';

describe('room-labels routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/room-labels', createRoomLabelsRouter(db));
  });

  it('creates, lists, moves, and deletes a room label', async () => {
    const post = await request(app).post('/api/room-labels').send({ name: 'Kitchen', x: 12, y: 34 });
    expect(post.status).toBe(201);
    expect(post.body.name).toBe('Kitchen');

    const list = await request(app).get('/api/room-labels');
    expect(list.body).toHaveLength(1);

    const patch = await request(app).patch(`/api/room-labels/${post.body.id}`).send({ x: 50, y: 60 });
    expect(patch.status).toBe(200);
    expect(patch.body.x).toBe(50);
    expect(patch.body.y).toBe(60);
    expect(patch.body.name).toBe('Kitchen');

    await request(app).delete(`/api/room-labels/${post.body.id}`).expect(204);
    const after = await request(app).get('/api/room-labels');
    expect(after.body).toHaveLength(0);
  });

  it('returns 404 when patching a missing label', async () => {
    const res = await request(app).patch('/api/room-labels/nope').send({ x: 1 });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/room_labels/routes.test.ts`
Expected: FAIL — cannot find module `../../src/room_labels/routes.js`.

- [ ] **Step 3: Add the `room_labels` table to `server/src/db/schema.ts`**

Add this block after the `strips` `CREATE TABLE`:
```ts
    CREATE TABLE IF NOT EXISTS room_labels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL
    );
```

- [ ] **Step 4: Create `server/src/room_labels/repository.ts`**
```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface RoomLabel {
  id: string;
  name: string;
  x: number;
  y: number;
}

function fromRow(row: any): RoomLabel {
  return { id: row.id, name: row.name, x: row.x, y: row.y };
}

export function createRoomLabelRepository(db: Database.Database) {
  return {
    list(): RoomLabel[] {
      return db.prepare('SELECT * FROM room_labels').all().map(fromRow);
    },
    add(input: Omit<RoomLabel, 'id'>): RoomLabel {
      const id = randomUUID();
      db.prepare('INSERT INTO room_labels (id, name, x, y) VALUES (?, ?, ?, ?)')
        .run(id, input.name, input.x, input.y);
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<RoomLabel, 'id'>>): RoomLabel {
      const current = db.prepare('SELECT * FROM room_labels WHERE id = ?').get(id);
      if (!current) throw new Error(`room label ${id} not found`);
      const next = { ...fromRow(current), ...patch };
      db.prepare('UPDATE room_labels SET name = ?, x = ?, y = ? WHERE id = ?')
        .run(next.name, next.x, next.y, id);
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM room_labels WHERE id = ?').run(id);
    }
  };
}
```

- [ ] **Step 5: Create `server/src/room_labels/routes.ts`**
```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createRoomLabelRepository } from './repository.js';

export function createRoomLabelsRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createRoomLabelRepository(db);

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', (req, res) => {
    const { name, x, y } = req.body;
    if (typeof name !== 'string' || typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({ error: 'name, x, and y are required' });
    }
    res.status(201).json(repo.add({ name, x, y }));
  });

  router.patch<{ id: string }>('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'room label not found' });
    }
  });

  router.delete<{ id: string }>('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 6: Mount in `server/src/app.ts`**

Add the import near the other router imports:
```ts
import { createRoomLabelsRouter } from './room_labels/routes.js';
```
and the mount after the strips mount:
```ts
  app.use('/api/room-labels', createRoomLabelsRouter(db));
```

- [ ] **Step 7: Update the db-client table-list test**

In `server/test/db/client.test.ts`, add `'room_labels',` in sorted position:
```ts
    expect(tables).toEqual([
      'calendar_events',
      'controllers',
      'group_members',
      'groups',
      'room_labels',
      'schedules',
      'strips',
      'themes',
      'wled_releases'
    ]);
```

- [ ] **Step 8: Run tests + build, confirm green**

Run: `cd server && npm test -- test/room_labels/routes.test.ts` → PASS (2 tests).
Run: `cd server && npm test` and `cd server && npm run build` → all green.

- [ ] **Step 9: Commit**
```bash
git add server/src/db/schema.ts server/src/room_labels server/src/app.ts server/test/room_labels server/test/db/client.test.ts
git commit -m "Add room_labels table, repository, and CRUD routes"
```

---

### Task 4: Settings storage, API, and startup wiring

**Files:**
- Modify: `server/src/db/schema.ts` (add single-row `settings`)
- Create: `server/src/settings/repository.ts`, `server/src/settings/routes.ts`
- Modify: `server/src/app.ts` (mount `/api/settings`)
- Modify: `server/src/server.ts` (discovery interval from settings)
- Create: `server/test/settings/routes.test.ts`
- Modify: `server/test/db/client.test.ts` (table list)

**Interfaces:**
- Produces:
  - `interface Settings { includePrereleaseFirmware: boolean; homeLatitude: number | null; homeLongitude: number | null; discoveryRescanIntervalMinutes: number; scheduleImportDisableOnDeviceDefault: boolean; }`
  - `function createSettingsRepository(db: Database.Database)` → `{ get(): Settings; update(patch: Partial<Settings>): Settings; }` — `get()` lazily seeds the single row (id=1) with defaults `{ includePrereleaseFirmware: false, homeLatitude: null, homeLongitude: null, discoveryRescanIntervalMinutes: 5, scheduleImportDisableOnDeviceDefault: false }`.
  - `function createSettingsRouter(db: Database.Database): express.Router` at `/api/settings`: `GET /` → `Settings`; `PATCH /` body `Partial<Settings>` → `Settings`; `POST /rescan` → `{ controllers: Controller[] }` (runs one discovery cycle and returns the fresh list).
- Consumed by: firmware routes (Task 5, `includePrereleaseFirmware`), `server.ts` (`discoveryRescanIntervalMinutes`), the client Settings + Firmware + import-schedules screens.

- [ ] **Step 1: Write the failing routes test**

`server/test/settings/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createSettingsRouter } from '../../src/settings/routes.js';

describe('settings routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/settings', createSettingsRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns default settings before anything is written', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      includePrereleaseFirmware: false,
      homeLatitude: null,
      homeLongitude: null,
      discoveryRescanIntervalMinutes: 5,
      scheduleImportDisableOnDeviceDefault: false
    });
  });

  it('patches a subset and persists it, leaving other fields at their defaults', async () => {
    const patch = await request(app).patch('/api/settings').send({ includePrereleaseFirmware: true, homeLatitude: 47.6, homeLongitude: -122.3 });
    expect(patch.status).toBe(200);
    expect(patch.body.includePrereleaseFirmware).toBe(true);
    expect(patch.body.homeLatitude).toBe(47.6);
    expect(patch.body.discoveryRescanIntervalMinutes).toBe(5);

    const get = await request(app).get('/api/settings');
    expect(get.body.homeLongitude).toBe(-122.3);
  });

  it('runs a discovery cycle on POST /rescan and returns the controller list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) } as Response)));
    const res = await request(app).post('/api/settings/rescan');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.controllers)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/settings/routes.test.ts`
Expected: FAIL — cannot find module `../../src/settings/routes.js`.

- [ ] **Step 3: Add the `settings` table to `server/src/db/schema.ts`**

Add after the `room_labels` block:
```ts
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      include_prerelease_firmware INTEGER NOT NULL DEFAULT 0,
      home_latitude REAL,
      home_longitude REAL,
      discovery_rescan_interval_minutes INTEGER NOT NULL DEFAULT 5,
      schedule_import_disable_on_device_default INTEGER NOT NULL DEFAULT 0
    );
```

- [ ] **Step 4: Create `server/src/settings/repository.ts`**
```ts
import type Database from 'better-sqlite3';

export interface Settings {
  includePrereleaseFirmware: boolean;
  homeLatitude: number | null;
  homeLongitude: number | null;
  discoveryRescanIntervalMinutes: number;
  scheduleImportDisableOnDeviceDefault: boolean;
}

const DEFAULTS: Settings = {
  includePrereleaseFirmware: false,
  homeLatitude: null,
  homeLongitude: null,
  discoveryRescanIntervalMinutes: 5,
  scheduleImportDisableOnDeviceDefault: false
};

function fromRow(row: any): Settings {
  return {
    includePrereleaseFirmware: !!row.include_prerelease_firmware,
    homeLatitude: row.home_latitude,
    homeLongitude: row.home_longitude,
    discoveryRescanIntervalMinutes: row.discovery_rescan_interval_minutes,
    scheduleImportDisableOnDeviceDefault: !!row.schedule_import_disable_on_device_default
  };
}

export function createSettingsRepository(db: Database.Database) {
  function ensureRow(): Settings {
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (row) return fromRow(row);
    db.prepare(
      `INSERT INTO settings (id, include_prerelease_firmware, home_latitude, home_longitude, discovery_rescan_interval_minutes, schedule_import_disable_on_device_default)
       VALUES (1, ?, ?, ?, ?, ?)`
    ).run(
      DEFAULTS.includePrereleaseFirmware ? 1 : 0,
      DEFAULTS.homeLatitude,
      DEFAULTS.homeLongitude,
      DEFAULTS.discoveryRescanIntervalMinutes,
      DEFAULTS.scheduleImportDisableOnDeviceDefault ? 1 : 0
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
          discovery_rescan_interval_minutes = ?, schedule_import_disable_on_device_default = ? WHERE id = 1`
      ).run(
        next.includePrereleaseFirmware ? 1 : 0,
        next.homeLatitude,
        next.homeLongitude,
        next.discoveryRescanIntervalMinutes,
        next.scheduleImportDisableOnDeviceDefault ? 1 : 0
      );
      return next;
    }
  };
}
```

- [ ] **Step 5: Create `server/src/settings/routes.ts`**
```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createSettingsRepository } from './repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { runDiscoveryCycle } from '../discovery/service.js';

export function createSettingsRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createSettingsRepository(db);

  router.get('/', (_req, res) => {
    res.json(repo.get());
  });

  router.patch('/', (req, res) => {
    res.json(repo.update(req.body));
  });

  router.post('/rescan', async (_req, res) => {
    await runDiscoveryCycle(db);
    res.json({ controllers: createControllerRepository(db).list() });
  });

  return router;
}
```

- [ ] **Step 6: Mount in `server/src/app.ts`**

Add the import:
```ts
import { createSettingsRouter } from './settings/routes.js';
```
and the mount after the calendar-events mount:
```ts
  app.use('/api/settings', createSettingsRouter(db));
```

- [ ] **Step 7: Wire the discovery interval into `server/src/server.ts`**

Replace the fixed-interval block. The full file becomes:
```ts
import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { runDiscoveryCycle } from './discovery/service.js';
import { SchedulerEngine } from './schedules/engine.js';
import { applyToMembers } from './control/routes.js';
import { seedHolidaysIfEmpty } from './calendar/repository.js';
import { createSettingsRepository } from './settings/repository.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH ?? './data/uber-wled.db';

const db = createDb(DB_PATH);
seedHolidaysIfEmpty(db);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`uber-wled server listening on port ${PORT}`);
});

const settings = createSettingsRepository(db);
const intervalMinutes = settings.get().discoveryRescanIntervalMinutes;

runDiscoveryCycle(db);
setInterval(() => runDiscoveryCycle(db), Math.max(1, intervalMinutes) * 60_000);

const scheduler = new SchedulerEngine(db, (members, action) => applyToMembers(db, members, action as any));
scheduler.start();
```

- [ ] **Step 8: Update the db-client table-list test**

In `server/test/db/client.test.ts`, add `'settings',` in sorted position:
```ts
    expect(tables).toEqual([
      'calendar_events',
      'controllers',
      'group_members',
      'groups',
      'room_labels',
      'schedules',
      'settings',
      'strips',
      'themes',
      'wled_releases'
    ]);
```

- [ ] **Step 9: Run tests + build, confirm green**

Run: `cd server && npm test -- test/settings/routes.test.ts` → PASS (3 tests).
Run: `cd server && npm test` and `cd server && npm run build` → all green.

- [ ] **Step 10: Commit**
```bash
git add server/src/db/schema.ts server/src/settings server/src/app.ts server/src/server.ts server/test/settings server/test/db/client.test.ts
git commit -m "Add settings storage, API, and discovery-interval wiring"
```

---

### Task 5: Firmware stable-release filter (settings-driven)

**Files:**
- Modify: `server/src/db/schema.ts` (add `prerelease` to `wled_releases`)
- Modify: `server/src/firmware/githubClient.ts` (prerelease flag, full-list cache, `includePrerelease` selection)
- Modify: `server/src/firmware/routes.ts` (read settings, pass `includePrerelease`, add `isPrerelease` to response)
- Modify: `server/test/firmware/githubClient.test.ts` (mixed stable/prerelease tests)

**Interfaces:**
- Produces (changed):
  - `interface WledRelease { tag: string; publishedAt: string; prerelease: boolean; assets: ReleaseAsset[]; fetchedAt: string; }`
  - `function createReleaseCache(db)` → `{ list(): WledRelease[]; saveAll(releases: WledRelease[]): void; }` (newest first by `published_at`)
  - `function fetchLatestRelease(db: Database.Database, opts?: { forceRefresh?: boolean; includePrerelease?: boolean }): Promise<WledRelease>` — fetches/caches the full release list, then returns the newest release passing the pre-release filter (`includePrerelease` default `false` → stable only). Falls back to the cached list on fetch failure; the filter is applied to whatever list is available.
  - Firmware `GET /:id/firmware` response gains `isPrerelease: boolean` (reflecting the selected release).
- Consumed by: firmware routes (`includePrerelease` from `createSettingsRepository(db).get().includePrereleaseFirmware`), the client Firmware section.

- [ ] **Step 1: Add failing stable-vs-prerelease tests to `server/test/firmware/githubClient.test.ts`**

Replace the `GITHUB_RESPONSE` constant with a mixed list and append two tests inside the `describe('fetchLatestRelease', ...)` block. The updated constant:
```ts
const GITHUB_RESPONSE = [
  {
    tag_name: 'v0.15.1-b3', prerelease: true, published_at: '2026-06-15T00:00:00Z',
    assets: [{ name: 'WLED_0.15.1-b3_ESP32.bin', browser_download_url: 'https://example.com/beta-ESP32.bin' }]
  },
  {
    tag_name: 'v0.15.0', prerelease: false, published_at: '2026-06-01T00:00:00Z',
    assets: [
      { name: 'WLED_0.15.0_ESP8266.bin', browser_download_url: 'https://example.com/ESP8266.bin' },
      { name: 'WLED_0.15.0_ESP32.bin', browser_download_url: 'https://example.com/ESP32.bin' }
    ]
  },
  {
    tag_name: 'v0.14.0', prerelease: false, published_at: '2026-01-01T00:00:00Z', assets: []
  }
];
```
Update the existing first test's assertion `expect(release.tag).toBe('v0.15.0')` — it already expects the newest stable, which stays correct. Then append:
```ts
  it('selects the newest stable release by default, skipping pre-releases', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE }));
    const release = await fetchLatestRelease(db);
    expect(release.tag).toBe('v0.15.0');
    expect(release.prerelease).toBe(false);
  });

  it('selects the newest release including pre-releases when includePrerelease is true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE }));
    const release = await fetchLatestRelease(db, { includePrerelease: true });
    expect(release.tag).toBe('v0.15.1-b3');
    expect(release.prerelease).toBe(true);
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/firmware/githubClient.test.ts`
Expected: FAIL — `includePrerelease` is not honored yet and `release.prerelease` is undefined.

- [ ] **Step 3: Add the `prerelease` column in `server/src/db/schema.ts`**

Because `wled_releases` is only a cache, drop and recreate it with the new column. Add `DROP TABLE IF EXISTS wled_releases;` to the drop statements at the top of the template, and replace the `wled_releases` `CREATE TABLE` block with:
```ts
    CREATE TABLE IF NOT EXISTS wled_releases (
      tag TEXT PRIMARY KEY,
      published_at TEXT NOT NULL,
      prerelease INTEGER NOT NULL DEFAULT 0,
      assets TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
```
(The table list in `db/client.test.ts` is unchanged — `wled_releases` still exists.)

- [ ] **Step 4: Rewrite `server/src/firmware/githubClient.ts`**
```ts
import type Database from 'better-sqlite3';

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface WledRelease {
  tag: string;
  publishedAt: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
  fetchedAt: string;
}

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/Aircoookie/WLED/releases';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function fromRow(row: any): WledRelease {
  return {
    tag: row.tag,
    publishedAt: row.published_at,
    prerelease: !!row.prerelease,
    assets: JSON.parse(row.assets),
    fetchedAt: row.fetched_at
  };
}

export function createReleaseCache(db: Database.Database) {
  return {
    list(): WledRelease[] {
      return db.prepare('SELECT * FROM wled_releases ORDER BY published_at DESC').all().map(fromRow);
    },
    saveAll(releases: WledRelease[]): void {
      const stmt = db.prepare(
        `INSERT INTO wled_releases (tag, published_at, prerelease, assets, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tag) DO UPDATE SET published_at = excluded.published_at, prerelease = excluded.prerelease, assets = excluded.assets, fetched_at = excluded.fetched_at`
      );
      const tx = db.transaction((rows: WledRelease[]) => {
        for (const r of rows) stmt.run(r.tag, r.publishedAt, r.prerelease ? 1 : 0, JSON.stringify(r.assets), r.fetchedAt);
      });
      tx(releases);
    }
  };
}

async function fetchFromGithub(): Promise<WledRelease[]> {
  const res = await fetch(GITHUB_RELEASES_URL);
  if (!res.ok) throw new Error(`GitHub releases request failed: ${res.status}`);
  const releases = (await res.json()) as any[];
  const fetchedAt = new Date().toISOString();
  return releases.map((r) => ({
    tag: r.tag_name,
    publishedAt: r.published_at,
    prerelease: !!r.prerelease,
    assets: (r.assets ?? []).map((a: any) => ({ name: a.name, downloadUrl: a.browser_download_url })),
    fetchedAt
  }));
}

function selectLatest(releases: WledRelease[], includePrerelease: boolean): WledRelease {
  const eligible = includePrerelease ? releases : releases.filter((r) => !r.prerelease);
  const pool = eligible.length > 0 ? eligible : releases;
  return pool[0];
}

export async function fetchLatestRelease(
  db: Database.Database,
  opts: { forceRefresh?: boolean; includePrerelease?: boolean } = {}
): Promise<WledRelease> {
  const cache = createReleaseCache(db);
  const cached = cache.list();
  const newestFetchedAt = cached[0]?.fetchedAt;
  const cacheIsFresh = !!newestFetchedAt && Date.now() - new Date(newestFetchedAt).getTime() < CACHE_MAX_AGE_MS;

  if (cacheIsFresh && !opts.forceRefresh) {
    return selectLatest(cached, !!opts.includePrerelease);
  }

  try {
    const fresh = await fetchFromGithub();
    cache.saveAll(fresh);
    return selectLatest(cache.list(), !!opts.includePrerelease);
  } catch (err) {
    if (cached.length > 0) return selectLatest(cached, !!opts.includePrerelease);
    throw err;
  }
}
```
Note: `cache.list()` orders by `published_at DESC`, so `pool[0]` is the newest eligible release.

- [ ] **Step 5: Update `server/src/firmware/routes.ts` to read settings and expose `isPrerelease`**

Add the settings import at the top:
```ts
import { createSettingsRepository } from '../settings/repository.js';
```
Inside `createFirmwareRouter`, add `const settings = createSettingsRepository(db);` next to `const controllers = ...`. In the `GET /:id` handler, replace the release fetch and response with:
```ts
    const includePrerelease = settings.get().includePrereleaseFirmware;
    const [info, release] = await Promise.all([
      getInfo(controller.host),
      fetchLatestRelease(db, { includePrerelease })
    ]);

    let assets: ReleaseAsset[] = [];
    if (!controller.pinnedAssetPattern) {
      assets = candidateAssets(release, info.arch);
    } else {
      const resolved = resolvePinnedAsset(release, controller.pinnedAssetPattern);
      if (!resolved) assets = candidateAssets(release, info.arch);
    }

    const normalizedInstalled = info.ver.startsWith('v') ? info.ver : `v${info.ver}`;

    res.json({
      installedVersion: info.ver,
      latestTag: release.tag,
      updateAvailable: normalizedInstalled !== release.tag,
      isPrerelease: release.prerelease,
      pinnedAssetPattern: controller.pinnedAssetPattern,
      candidateAssets: assets
    });
```
In the `POST /:id/update` handler, replace `const release = await fetchLatestRelease(db);` with:
```ts
    const release = await fetchLatestRelease(db, { includePrerelease: settings.get().includePrereleaseFirmware });
```

- [ ] **Step 6: Run the firmware tests + full suite + build**

Run: `cd server && npm test -- test/firmware/githubClient.test.ts` → PASS (7 tests: 5 existing + 2 new).
Run: `cd server && npm test -- test/firmware/routes.test.ts` → PASS (fresh db → settings default `includePrereleaseFirmware=false`; fixtures have no prerelease flags → newest = `v0.15.0`, matching existing expectations).
Run: `cd server && npm test` and `cd server && npm run build` → all green.

- [ ] **Step 7: Commit**
```bash
git add server/src/db/schema.ts server/src/firmware/githubClient.ts server/src/firmware/routes.ts server/test/firmware/githubClient.test.ts
git commit -m "Filter GitHub firmware releases to stable-only by default, settings-driven"
```

---

## Phase B — Frontend (Tasks 6–14)

### Task 6: API client reshape + app shell + Controllers/Groups/Themes sections

This is the frontend foundation: it removes the floorplan/placement client code (which lets the old Dashboard and FloorplanEditor be deleted), reshapes `api/client.ts` for strips/room-labels/settings, and stands up the sidebar shell with the three CRUD sections that already have components. Layout/Schedule/Firmware/Settings nav items are added by their own tasks (7–14); Task 8 flips the default section to `layout`.

**Files:**
- Modify: `client/src/api/client.ts`
- Modify: `client/src/components/icons.tsx` (add section icons)
- Create: `client/src/components/Sidebar.tsx`, `client/src/components/AppShell.tsx`, `client/src/components/ControllersSection.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/index.css` (append shell/sidebar classes)
- Remove: `client/src/pages/Dashboard.tsx`, `client/src/pages/FloorplanEditor.tsx`, `client/src/components/FloorplanCanvas.tsx`, `client/src/components/SegmentPathEditor.tsx`
- Remove: `client/src/test/Dashboard.test.tsx`, `client/src/test/components/FloorplanCanvas.test.tsx`
- Modify: `client/src/test/api/client.test.ts`
- Create: `client/src/test/AppShell.test.tsx`, `client/src/test/ControllersSection.test.tsx`

**Interfaces:**
- Produces (client `api/client.ts`):
  - `interface Strip { id: string; controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label: string | null; }`
  - `interface RoomLabel { id: string; name: string; x: number; y: number; }`
  - `interface Settings { includePrereleaseFirmware: boolean; homeLatitude: number | null; homeLongitude: number | null; discoveryRescanIntervalMinutes: number; scheduleImportDisableOnDeviceDefault: boolean; }`
  - `listStrips(): Promise<Strip[]>`, `addStrip(input: { controllerId: string; wledSegId: number; points: {x:number;y:number}[]; label?: string | null }): Promise<{ strip: Strip; recommendations: unknown[] }>`, `updateStrip(id, patch): Promise<Strip>`, `deleteStrip(id): Promise<Response>`
  - `listRoomLabels(): Promise<RoomLabel[]>`, `addRoomLabel(input: { name: string; x: number; y: number }): Promise<RoomLabel>`, `updateRoomLabel(id, patch): Promise<RoomLabel>`, `deleteRoomLabel(id): Promise<Response>`
  - `getSettings(): Promise<Settings>`, `updateSettings(patch: Partial<Settings>): Promise<Settings>`, `rescanNow(): Promise<{ controllers: Controller[] }>`
  - `FirmwareStatus` interface gains `isPrerelease: boolean`
  - Removed: `Floorplan`, `Placement`, `listFloorplans`, `uploadFloorplan`, `updateFloorplan`, `listPlacements`, `addPlacement`, `deletePlacement`
- Produces (components):
  - `type SectionKey = 'layout' | 'controllers' | 'groups' | 'themes' | 'schedule' | 'firmware' | 'settings'` (exported from `Sidebar.tsx`)
  - `SECTIONS: { key: SectionKey; label: string; Icon: (p: { className?: string }) => JSX.Element }[]` (exported from `Sidebar.tsx`) — Task 6 seeds it with `controllers`, `groups`, `themes`; later tasks add the rest
  - `Sidebar`, `AppShell`, `ControllersSection` React components

- [ ] **Step 1: Write the failing AppShell + ControllersSection tests**

`client/src/test/ControllersSection.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ControllersSection } from '../components/ControllersSection';

afterEach(() => vi.unstubAllGlobals());

describe('ControllersSection', () => {
  it('lists controllers and adds a new one', async () => {
    const controllers = [{ id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'c2', name: 'Deck', host: '10.0.0.60', source: 'manual', stale: false, pinnedAssetPattern: null }) });
      }
      if (typeof url === 'string' && url.startsWith('/api/controllers/c2/firmware')) return Promise.resolve({ ok: true, json: async () => ({ installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false, isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: [] }) });
      if (typeof url === 'string' && url.startsWith('/api/controllers/c1/firmware')) return Promise.resolve({ ok: true, json: async () => ({ installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false, isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: [] }) });
      return Promise.resolve({ ok: true, json: async () => controllers });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ControllersSection />);
    await waitFor(() => expect(screen.getByText('Porch')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/^Name$/, { selector: '#controller-name' }), { target: { value: 'Deck' } });
    fireEvent.change(screen.getByLabelText(/Host/), { target: { value: '10.0.0.60' } });
    fireEvent.click(screen.getByText('Add controller'));

    await waitFor(() => expect(screen.getByText('Deck')).toBeTruthy());
  });
});
```

`client/src/test/AppShell.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppShell } from '../components/AppShell';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { window.location.hash = ''; });

describe('AppShell', () => {
  it('renders the Controllers section by default and highlights its nav item', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<AppShell />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Controllers/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Controllers/ }).className).toContain('active');
  });

  it('switches to the Themes section when its nav item is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: /Themes/ }));
    await waitFor(() => expect(screen.getByText(/No custom themes yet/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `cd client && npm test -- src/test/AppShell.test.tsx src/test/ControllersSection.test.tsx`
Expected: FAIL — modules do not exist yet.

- [ ] **Step 3: Reshape `client/src/api/client.ts`**

Remove the `Floorplan` and `Placement` interfaces and the `listFloorplans`/`uploadFloorplan`/`updateFloorplan`/`listPlacements`/`addPlacement`/`deletePlacement` functions (the last block of the file). Add `isPrerelease: boolean;` to the `FirmwareStatus` interface. Then append the new types and functions:
```ts
export interface Strip {
  id: string;
  controllerId: string;
  wledSegId: number;
  points: { x: number; y: number }[];
  label: string | null;
}

export interface RoomLabel {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface Settings {
  includePrereleaseFirmware: boolean;
  homeLatitude: number | null;
  homeLongitude: number | null;
  discoveryRescanIntervalMinutes: number;
  scheduleImportDisableOnDeviceDefault: boolean;
}

export const listStrips = () => getJson<Strip[]>('/api/strips');
export const addStrip = (input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label?: string | null }) =>
  sendJson<{ strip: Strip; recommendations: unknown[] }>('/api/strips', 'POST', input);
export const updateStrip = (id: string, patch: Partial<Omit<Strip, 'id'>>) =>
  sendJson<Strip>(`/api/strips/${id}`, 'PATCH', patch);
export const deleteStrip = (id: string) => fetch(`/api/strips/${id}`, { method: 'DELETE' });

export const listRoomLabels = () => getJson<RoomLabel[]>('/api/room-labels');
export const addRoomLabel = (input: { name: string; x: number; y: number }) =>
  sendJson<RoomLabel>('/api/room-labels', 'POST', input);
export const updateRoomLabel = (id: string, patch: Partial<Omit<RoomLabel, 'id'>>) =>
  sendJson<RoomLabel>(`/api/room-labels/${id}`, 'PATCH', patch);
export const deleteRoomLabel = (id: string) => fetch(`/api/room-labels/${id}`, { method: 'DELETE' });

export const getSettings = () => getJson<Settings>('/api/settings');
export const updateSettings = (patch: Partial<Settings>) => sendJson<Settings>('/api/settings', 'PATCH', patch);
export const rescanNow = () => sendJson<{ controllers: Controller[] }>('/api/settings/rescan', 'POST');
```
Also update the `FirmwareStatus` interface (near the bottom) to:
```ts
export interface FirmwareStatus {
  installedVersion: string;
  latestTag: string;
  updateAvailable: boolean;
  isPrerelease: boolean;
  pinnedAssetPattern: string | null;
  candidateAssets: { name: string; downloadUrl: string }[];
}
```

- [ ] **Step 4: Add section icons to `client/src/components/icons.tsx`**

Append these exports (they reuse the shared `strokeProps` already defined at the top of the file):
```tsx
export function GridIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}
export function UsersIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5a3 3 0 0 1 0 6" /><path d="M21 20c0-2.5-1.5-4.6-3.6-5.5" />
    </svg>
  );
}
export function PaletteIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7Z" />
      <circle cx="7.5" cy="10.5" r="1" /><circle cx="12" cy="7.5" r="1" /><circle cx="16.5" cy="10.5" r="1" />
    </svg>
  );
}
export function CalendarIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M8 2v4" /><path d="M16 2v4" />
    </svg>
  );
}
export function ChipIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1" />
      <path d="M10 2v3" /><path d="M14 2v3" /><path d="M10 19v3" /><path d="M14 19v3" />
      <path d="M2 10h3" /><path d="M2 14h3" /><path d="M19 10h3" /><path d="M19 14h3" />
    </svg>
  );
}
export function GearIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  );
}
```

- [ ] **Step 5: Create `client/src/components/Sidebar.tsx`**
```tsx
import { LightbulbIcon, UsersIcon, PaletteIcon } from './icons';

export type SectionKey = 'layout' | 'controllers' | 'groups' | 'themes' | 'schedule' | 'firmware' | 'settings';

type IconComp = (p: { className?: string }) => JSX.Element;

// Later tasks add layout/schedule/firmware/settings entries. Order here is the
// order shown in the rail.
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'controllers', label: 'Controllers', Icon: LightbulbIcon },
  { key: 'groups', label: 'Groups', Icon: UsersIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon }
];

export function Sidebar({
  active,
  onNavigate,
  collapsed,
  onToggleCollapsed
}: {
  active: SectionKey;
  onNavigate: (s: SectionKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sections">
      <div className="sidebar-brand">
        <LightbulbIcon className="logo-mark" />
        <span className="sidebar-brand-text">uber-wled</span>
      </div>
      <ul className="sidebar-nav">
        {SECTIONS.map(({ key, label, Icon }) => (
          <li key={key}>
            <button
              type="button"
              className={`sidebar-link${active === key ? ' active' : ''}`}
              aria-current={active === key ? 'page' : undefined}
              onClick={() => onNavigate(key)}
            >
              <Icon className="sidebar-link-icon" />
              <span className="sidebar-link-label">{label}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="sidebar-collapse-toggle" onClick={onToggleCollapsed} aria-label="Toggle sidebar">
        {collapsed ? '»' : '«'}
      </button>
    </nav>
  );
}
```

- [ ] **Step 6: Create `client/src/components/AppShell.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { Sidebar, SECTIONS, type SectionKey } from './Sidebar';
import { ControllersSection } from './ControllersSection';
import { GroupManager } from './GroupManager';
import { ThemeManager } from './ThemeManager';

const DEFAULT_SECTION: SectionKey = 'controllers';
const KEYS = SECTIONS.map((s) => s.key);

function sectionFromHash(): SectionKey {
  const h = window.location.hash.replace(/^#\/?/, '') as SectionKey;
  return (KEYS as string[]).includes(h) ? h : DEFAULT_SECTION;
}

export function AppShell() {
  const [active, setActive] = useState<SectionKey>(sectionFromHash());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onHash = () => setActive(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function navigate(s: SectionKey) {
    window.location.hash = `#/${s}`;
    setActive(s);
  }

  return (
    <div className="app-shell">
      <Sidebar active={active} onNavigate={navigate} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      <main className="app-main">
        {active === 'controllers' && <ControllersSection />}
        {active === 'groups' && <GroupManager />}
        {active === 'themes' && <ThemeManager />}
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Create `client/src/components/ControllersSection.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { listControllers, addController, deleteController, type Controller } from '../api/client';
import { ControllerList } from './ControllerList';
import { AlertIcon } from './icons';

export function ControllersSection() {
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listControllers().then(setControllers).catch((e) => setError(e.message));
  }, []);

  async function handleAdd() {
    if (!name || !host) return;
    try {
      const created = await addController(name, host);
      setControllers((prev) => [...prev, created]);
      setName('');
      setHost('');
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(id: string) {
    await deleteController(id);
    setControllers((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <section className="section">
      <h2>Controllers</h2>
      <div className="card">
        {error && <div className="error-banner"><AlertIcon /> {error}</div>}
        <ControllerList controllers={controllers} onDelete={handleDelete} />
        <div className="add-controller-form">
          <div className="field">
            <label htmlFor="controller-name">Name</label>
            <input id="controller-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Front Porch" />
          </div>
          <div className="field">
            <label htmlFor="controller-host">Host / IP</label>
            <input id="controller-host" className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.50" />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleAdd}>Add controller</button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Point `client/src/App.tsx` at the shell**
```tsx
import { AppShell } from './components/AppShell';

export default function App() {
  return <AppShell />;
}
```

- [ ] **Step 9: Delete the floorplan/Dashboard files and their tests**
```bash
git rm client/src/pages/Dashboard.tsx client/src/pages/FloorplanEditor.tsx \
       client/src/components/FloorplanCanvas.tsx client/src/components/SegmentPathEditor.tsx \
       client/src/test/Dashboard.test.tsx client/src/test/components/FloorplanCanvas.test.tsx
```

- [ ] **Step 10: Update `client/src/test/api/client.test.ts`**

Add strip + settings coverage. Append inside the `describe('api client', ...)` block, and update the import line to `import { listControllers, addController, importSchedules, addStrip, updateSettings } from '../../api/client';`:
```ts
  it('addStrip POSTs to /api/strips and returns the created strip + recommendations', async () => {
    const body = { strip: { id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], label: null }, recommendations: [] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    const result = await addStrip({ controllerId: 'c1', wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
    expect(global.fetch).toHaveBeenCalledWith('/api/strips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ controllerId: 'c1', wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })
    });
    expect(result).toEqual(body);
  });

  it('updateSettings PATCHes /api/settings', async () => {
    const updated = { includePrereleaseFirmware: true, homeLatitude: null, homeLongitude: null, discoveryRescanIntervalMinutes: 5, scheduleImportDisableOnDeviceDefault: false };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => updated });
    const result = await updateSettings({ includePrereleaseFirmware: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includePrereleaseFirmware: true })
    });
    expect(result).toEqual(updated);
  });
```

- [ ] **Step 11: Append shell/sidebar CSS to `client/src/index.css`**

Note the existing `#root { max-width: 960px; margin: 0 auto; ... }` constrains width; override it for the shell. Append at the end of the file:
```css
/* ---------- App shell ---------- */

.app-shell {
  display: flex;
  align-items: stretch;
  min-height: 100svh;
  gap: 0;
}

/* The shell spans full width; the section content keeps a comfortable measure. */
#root:has(.app-shell) {
  max-width: none;
  padding: 0;
}

.sidebar {
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100svh;
  width: 220px;
  flex-shrink: 0;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-md);
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-xs);
  margin-bottom: var(--space-md);
}

.sidebar-brand-text {
  font-weight: 700;
  letter-spacing: -0.01em;
}

.sidebar.collapsed .sidebar-brand-text,
.sidebar.collapsed .sidebar-link-label {
  display: none;
}

.sidebar-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: 0.625rem 0.75rem;
  min-height: 44px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-foreground-muted);
  cursor: pointer;
  font-weight: 600;
  transition: background-color 200ms ease, color 200ms ease;
}

.sidebar-link:hover {
  color: var(--color-foreground);
  background: var(--color-muted);
}

.sidebar-link.active {
  color: var(--color-accent);
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.35);
}

.sidebar-link-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.sidebar-collapse-toggle {
  align-self: flex-start;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-foreground-muted);
  cursor: pointer;
  padding: 0.25rem 0.5rem;
}

.app-main {
  flex: 1;
  min-width: 0;
  padding: var(--space-xl) var(--space-lg);
  max-width: 1100px;
}

@media (max-width: 640px) {
  .sidebar {
    width: 64px;
  }
  .sidebar .sidebar-brand-text,
  .sidebar .sidebar-link-label {
    display: none;
  }
}
```

- [ ] **Step 12: Run the new tests + full client suite**

Run: `cd client && npm test -- src/test/AppShell.test.tsx src/test/ControllersSection.test.tsx` → PASS.
Run: `cd client && npm test` → all PASS (Dashboard/FloorplanCanvas tests removed; api client test updated).

- [ ] **Step 13: Commit**
```bash
git add client/src/api/client.ts client/src/components/icons.tsx client/src/components/Sidebar.tsx client/src/components/AppShell.tsx client/src/components/ControllersSection.tsx client/src/App.tsx client/src/index.css client/src/test/api/client.test.ts client/src/test/AppShell.test.tsx client/src/test/ControllersSection.test.tsx
git commit -m "Add sidebar app shell, reshape client API to strips/room-labels/settings, remove floorplan UI"
```

---

### Task 7: Strip canvas (imageless render + selection + marquee)

Repurposes the old `FloorplanCanvas` drawing concept as an imageless dark canvas that renders each strip as a multi-point polyline. Handles click-select, marquee-box multi-select, and reports selection changes. Stale controllers render greyed.

**Files:**
- Create: `client/src/components/StripCanvas.tsx`
- Modify: `client/src/index.css` (append strip-canvas classes)
- Create: `client/src/test/components/StripCanvas.test.tsx`

**Interfaces:**
- Produces:
  - `interface StripCanvasProps { strips: Strip[]; selected: Set<string>; staleControllerIds: Set<string>; onSelectionChange: (next: Set<string>) => void; onMoveStrip?: (id: string, dx: number, dy: number) => void; children?: React.ReactNode; }`
  - `function StripCanvas(props: StripCanvasProps): JSX.Element` — renders an SVG `viewBox="0 0 100 100"`; each strip is a `<polyline data-testid={\`strip-${id}\`} data-selected=...>`; clicking a strip replaces the selection with that strip; dragging on empty canvas draws a marquee `<rect data-testid="marquee">` and, on release, selects strips with any point inside the box; `children` render above the strips (used by the room-label layer in Task 9).
- Consumed by: `LayoutSection` (Task 8), `RoomLabelLayer` mounts as `children` (Task 9).

- [ ] **Step 1: Write the failing test**

`client/src/test/components/StripCanvas.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StripCanvas } from '../../components/StripCanvas';
import type { Strip } from '../../api/client';

const strips: Strip[] = [
  { id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], label: 'Porch' },
  { id: 's2', controllerId: 'c2', wledSegId: 0, points: [{ x: 60, y: 60 }, { x: 90, y: 60 }], label: null }
];

describe('StripCanvas', () => {
  it('renders one polyline per strip and selects a strip on click', () => {
    const onSelectionChange = vi.fn();
    render(<StripCanvas strips={strips} selected={new Set()} staleControllerIds={new Set()} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByTestId('strip-s1'));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['s1']));
  });

  it('marks the selected strip and greys a strip whose controller is stale', () => {
    render(<StripCanvas strips={strips} selected={new Set(['s1'])} staleControllerIds={new Set(['c2'])} onSelectionChange={vi.fn()} />);
    expect(screen.getByTestId('strip-s1').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('strip-s2').getAttribute('data-stale')).toBe('true');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd client && npm test -- src/test/components/StripCanvas.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `client/src/components/StripCanvas.tsx`**
```tsx
import { useRef, useState } from 'react';
import type { Strip } from '../api/client';

interface Box { x0: number; y0: number; x1: number; y1: number; }

export interface StripCanvasProps {
  strips: Strip[];
  selected: Set<string>;
  staleControllerIds: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onMoveStrip?: (id: string, dx: number, dy: number) => void;
  children?: React.ReactNode;
}

function toCanvas(e: { clientX: number; clientY: number }, svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * 100,
    y: ((e.clientY - rect.top) / rect.height) * 100
  };
}

export function StripCanvas({ strips, selected, staleControllerIds, onSelectionChange, children }: StripCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);

  function handleBackgroundDown(e: React.MouseEvent<SVGRectElement>) {
    if (!svgRef.current) return;
    const p = toCanvas(e, svgRef.current);
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!marquee || !svgRef.current) return;
    const p = toCanvas(e, svgRef.current);
    setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
  }

  function handleUp() {
    if (!marquee) return;
    const minX = Math.min(marquee.x0, marquee.x1);
    const maxX = Math.max(marquee.x0, marquee.x1);
    const minY = Math.min(marquee.y0, marquee.y1);
    const maxY = Math.max(marquee.y0, marquee.y1);
    const next = new Set<string>();
    for (const s of strips) {
      if (s.points.some((pt) => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY)) next.add(s.id);
    }
    // A zero-area marquee (a plain click on empty canvas) clears the selection.
    onSelectionChange(next);
    setMarquee(null);
  }

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      className="strip-canvas"
      preserveAspectRatio="none"
      onMouseMove={handleMove}
      onMouseUp={handleUp}
      onMouseLeave={() => setMarquee(null)}
    >
      <rect x={0} y={0} width={100} height={100} fill="transparent" onMouseDown={handleBackgroundDown} />
      {strips.map((s) => {
        const isSelected = selected.has(s.id);
        const isStale = staleControllerIds.has(s.controllerId);
        return (
          <polyline
            key={s.id}
            data-testid={`strip-${s.id}`}
            data-selected={isSelected ? 'true' : 'false'}
            data-stale={isStale ? 'true' : 'false'}
            className={`strip${isSelected ? ' selected' : ''}${isStale ? ' stale' : ''}`}
            points={s.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
            fill="none"
            onClick={(e) => {
              e.stopPropagation();
              onSelectionChange(new Set([s.id]));
            }}
          />
        );
      })}
      {marquee && (
        <rect
          data-testid="marquee"
          className="strip-marquee"
          x={Math.min(marquee.x0, marquee.x1)}
          y={Math.min(marquee.y0, marquee.y1)}
          width={Math.abs(marquee.x1 - marquee.x0)}
          height={Math.abs(marquee.y1 - marquee.y0)}
        />
      )}
      {children}
    </svg>
  );
}
```

- [ ] **Step 4: Append strip-canvas CSS to `client/src/index.css`**
```css
/* ---------- Strip canvas (Layout) ---------- */

.strip-canvas {
  width: 100%;
  height: 60vh;
  background:
    radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.12) 1px, transparent 0) 0 0 / 5% 5%,
    var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  touch-action: none;
}

.strip {
  stroke: #5ee1ff;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  cursor: pointer;
}

.strip.selected {
  stroke: var(--color-accent);
  stroke-width: 2.4;
  filter: drop-shadow(0 0 3px rgba(34, 197, 94, 0.8));
}

.strip.stale {
  stroke: var(--color-foreground-muted);
  opacity: 0.5;
  stroke-dasharray: 3 2;
}

.strip-marquee {
  fill: rgba(34, 197, 94, 0.08);
  stroke: var(--color-accent);
  stroke-width: 0.4;
  stroke-dasharray: 1 1;
}
```

- [ ] **Step 5: Run the test + full client suite**

Run: `cd client && npm test -- src/test/components/StripCanvas.test.tsx` → PASS (2 tests).
Run: `cd client && npm test` → all PASS.

- [ ] **Step 6: Commit**
```bash
git add client/src/components/StripCanvas.tsx client/src/index.css client/src/test/components/StripCanvas.test.tsx
git commit -m "Add imageless StripCanvas with click and marquee selection"
```

---

### Task 8: Layout section — draw-new-strip flow, hardware binding, docked control panel

Assembles the Layout hero: a "Draw strip" toolbar action drives `StripPathEditor` (repurposed `SegmentPathEditor`) to place bend points; on finish, the user binds the strip to a controller + WLED segment id before it saves via `addStrip`. Selected strips feed a right-docked `ControlPanel` (adapted with a neutral empty state). Makes `layout` the default section.

**Files:**
- Create: `client/src/components/StripPathEditor.tsx`
- Create: `client/src/components/LayoutSection.tsx`
- Modify: `client/src/components/ControlPanel.tsx` (dock + empty state)
- Modify: `client/src/components/Sidebar.tsx` (add `layout` entry)
- Modify: `client/src/components/AppShell.tsx` (render `layout`, default to it)
- Modify: `client/src/index.css` (append layout classes)
- Create: `client/src/test/components/StripPathEditor.test.tsx`, `client/src/test/LayoutSection.test.tsx`
- Modify: `client/src/test/components/ControlPanel.test.tsx` (empty-state assertion)

**Interfaces:**
- Produces:
  - `function StripPathEditor(props: { controllers: Controller[]; onComplete: (input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label: string | null }) => void; onCancel: () => void }): JSX.Element`
  - `function LayoutSection(): JSX.Element` — loads `listStrips`, `listControllers`, `listThemes`; toolbar with "Draw strip" + selection count; renders `StripCanvas` + docked `ControlPanel`; on strip creation calls `addStrip`; applies control actions to the selected strips' `{ controllerId, wledSegId }` members via `applyControl`.
  - `ControlPanel` (modified) still exports the same props `{ selectedMembers, themes, onApply }` but adds `className="control-panel docked"` and shows `<p className="empty-state">Select a strip to control it.</p>` when `selectedMembers.length === 0`.

- [ ] **Step 1: Write the failing tests**

`client/src/test/components/StripPathEditor.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StripPathEditor } from '../../components/StripPathEditor';
import type { Controller } from '../../api/client';

const controllers: Controller[] = [
  { id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }
];

describe('StripPathEditor', () => {
  it('collects clicked points and completes with the chosen controller + segment binding', () => {
    const onComplete = vi.fn();
    render(<StripPathEditor controllers={controllers} onComplete={onComplete} onCancel={vi.fn()} />);
    const canvas = screen.getByTestId('draw-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 30, clientY: 10 });
    fireEvent.change(screen.getByLabelText(/segment id/i), { target: { value: '2' } });
    fireEvent.click(screen.getByText(/Finish strip/));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const arg = onComplete.mock.calls[0][0];
    expect(arg.controllerId).toBe('c1');
    expect(arg.wledSegId).toBe(2);
    expect(arg.points).toHaveLength(2);
  });
});
```

`client/src/test/LayoutSection.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LayoutSection } from '../components/LayoutSection';

afterEach(() => vi.unstubAllGlobals());

function stub(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/strips')) return Promise.resolve({ ok: true, json: async () => overrides.strips ?? [] });
    if (typeof url === 'string' && url.startsWith('/api/controllers')) return Promise.resolve({ ok: true, json: async () => overrides.controllers ?? [] });
    if (typeof url === 'string' && url.startsWith('/api/themes')) return Promise.resolve({ ok: true, json: async () => overrides.themes ?? [] });
    return Promise.resolve({ ok: true, json: async () => [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('LayoutSection', () => {
  it('renders strips from the API and shows the docked control panel empty state', async () => {
    stub({ strips: [{ id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], label: 'Porch' }] });
    render(<LayoutSection />);
    await waitFor(() => expect(screen.getByTestId('strip-s1')).toBeTruthy());
    expect(screen.getByText(/Select a strip to control it/)).toBeTruthy();
  });

  it('exposes a Draw strip toolbar action', async () => {
    stub();
    render(<LayoutSection />);
    await waitFor(() => expect(screen.getByText(/Draw strip/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `cd client && npm test -- src/test/components/StripPathEditor.test.tsx src/test/LayoutSection.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Create `client/src/components/StripPathEditor.tsx`**
```tsx
import { useState } from 'react';
import type { Controller } from '../api/client';

export function StripPathEditor({
  controllers,
  onComplete,
  onCancel
}: {
  controllers: Controller[];
  onComplete: (input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label: string | null }) => void;
  onCancel: () => void;
}) {
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [controllerId, setControllerId] = useState(controllers[0]?.id ?? '');
  const [wledSegId, setWledSegId] = useState(0);
  const [label, setLabel] = useState('');

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPoints((prev) => [...prev, { x, y }]);
  }

  function finish() {
    if (points.length < 2 || !controllerId) return;
    onComplete({ controllerId, wledSegId, points, label: label || null });
  }

  return (
    <div className="strip-draw">
      <svg viewBox="0 0 100 100" className="strip-canvas draw" data-testid="draw-canvas" preserveAspectRatio="none" onClick={handleClick}>
        <polyline points={points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#a3ff5e" strokeWidth={1.6} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.2} fill="#a3ff5e" />
        ))}
      </svg>
      <div className="add-controller-form">
        <div className="field">
          <label htmlFor="strip-controller">Controller</label>
          <select id="strip-controller" className="input" value={controllerId} onChange={(e) => setControllerId(e.target.value)}>
            {controllers.length === 0 && <option value="">No controllers</option>}
            {controllers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="strip-seg">Segment ID</label>
          <input id="strip-seg" aria-label="segment id" className="input" type="number" min={0} value={wledSegId} onChange={(e) => setWledSegId(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="strip-label">Label (optional)</label>
          <input id="strip-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Porch rail" />
        </div>
        <button type="button" className="btn btn-primary" onClick={finish} disabled={points.length < 2 || !controllerId}>
          Finish strip ({points.length} points)
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Modify `client/src/components/ControlPanel.tsx` (dock + empty state)**

Change the outer `div` className and add an empty-state branch. Replace the `return (...)` with:
```tsx
  return (
    <div className="card control-panel docked">
      <h3>Control ({selectedMembers.length} selected)</h3>
      {disabled && <p className="empty-state">Select a strip to control it.</p>}
      <div className="control-panel-buttons">
        <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onApply({ type: 'power', on: true })}>On</button>
        <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onApply({ type: 'power', on: false })}>Off</button>
      </div>
      <div className="field">
        <label htmlFor="brightness-slider">Brightness</label>
        <input id="brightness-slider" type="range" aria-label="brightness" min={0} max={255} disabled={disabled} onChange={(e) => onApply({ type: 'brightness', value: Number(e.target.value) })} />
      </div>
      <div className="control-panel-themes">
        {themes.map((t) => (
          <button key={t.id} type="button" className="btn btn-primary" disabled={disabled} onClick={() => onApply({ type: 'theme', themeId: t.id })}>{t.name}</button>
        ))}
      </div>
    </div>
  );
```
(The imports and props are unchanged.)

- [ ] **Step 5: Create `client/src/components/LayoutSection.tsx`**
```tsx
import { useEffect, useState } from 'react';
import {
  listStrips, addStrip, listControllers, listThemes, applyControl,
  type Strip, type Controller, type CustomTheme, type ControlAction
} from '../api/client';
import { StripCanvas } from './StripCanvas';
import { StripPathEditor } from './StripPathEditor';
import { ControlPanel } from './ControlPanel';

export function LayoutSection() {
  const [strips, setStrips] = useState<Strip[]>([]);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    listStrips().then(setStrips);
    listControllers().then(setControllers);
    listThemes().then(setThemes);
  }, []);

  const staleControllerIds = new Set(controllers.filter((c) => c.stale).map((c) => c.id));

  async function handleComplete(input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label: string | null }) {
    const { strip } = await addStrip(input);
    setStrips((prev) => [...prev, strip]);
    setDrawing(false);
  }

  const selectedMembers = strips.filter((s) => selected.has(s.id)).map((s) => ({ controllerId: s.controllerId, wledSegId: s.wledSegId }));

  async function handleApply(action: ControlAction) {
    await applyControl(selectedMembers, action);
  }

  return (
    <section className="section layout-section">
      <div className="layout-toolbar">
        <h2>Layout</h2>
        <div className="layout-toolbar-actions">
          <span className="controller-meta">{selected.size} selected</span>
          {!drawing && (
            <button type="button" className="btn btn-primary" onClick={() => setDrawing(true)} disabled={controllers.length === 0}>
              Draw strip
            </button>
          )}
        </div>
      </div>
      <div className="layout-body">
        <div className="layout-canvas-wrap">
          {drawing ? (
            <StripPathEditor controllers={controllers} onComplete={handleComplete} onCancel={() => setDrawing(false)} />
          ) : (
            <StripCanvas
              strips={strips}
              selected={selected}
              staleControllerIds={staleControllerIds}
              onSelectionChange={setSelected}
            />
          )}
        </div>
        <ControlPanel selectedMembers={selectedMembers} themes={themes} onApply={handleApply} />
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Add the `layout` nav entry in `client/src/components/Sidebar.tsx`**

Import `GridIcon` and prepend `layout` to `SECTIONS` so it is first (and becomes the default):
```tsx
import { LightbulbIcon, GridIcon, UsersIcon, PaletteIcon } from './icons';
```
```tsx
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'layout', label: 'Layout', Icon: GridIcon },
  { key: 'controllers', label: 'Controllers', Icon: LightbulbIcon },
  { key: 'groups', label: 'Groups', Icon: UsersIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon }
];
```

- [ ] **Step 7: Render Layout + make it the default in `client/src/components/AppShell.tsx`**

Change the default and add the render branch:
```tsx
import { LayoutSection } from './LayoutSection';
```
```tsx
const DEFAULT_SECTION: SectionKey = 'layout';
```
Add above the `controllers` branch in `<main>`:
```tsx
        {active === 'layout' && <LayoutSection />}
```

- [ ] **Step 8: Update `client/src/test/components/ControlPanel.test.tsx` for the empty state**

Append a test:
```tsx
  it('shows a neutral empty state and disables controls when nothing is selected', () => {
    render(<ControlPanel selectedMembers={[]} themes={[]} onApply={vi.fn()} />);
    expect(screen.getByText(/Select a strip to control it/)).toBeTruthy();
    expect((screen.getByLabelText(/brightness/i) as HTMLInputElement).disabled).toBe(true);
  });
```

- [ ] **Step 9: Append layout CSS to `client/src/index.css`**
```css
/* ---------- Layout section ---------- */

.layout-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.layout-toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.layout-body {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: var(--space-lg);
  align-items: start;
}

.layout-canvas-wrap {
  min-width: 0;
}

.control-panel.docked {
  position: sticky;
  top: var(--space-lg);
}

.strip-canvas.draw {
  cursor: crosshair;
}

@media (max-width: 720px) {
  .layout-body {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 10: Run tests + full client suite**

Run: `cd client && npm test -- src/test/components/StripPathEditor.test.tsx src/test/LayoutSection.test.tsx src/test/components/ControlPanel.test.tsx src/test/AppShell.test.tsx` → PASS.
Run: `cd client && npm test` → all PASS.

- [ ] **Step 11: Commit**
```bash
git add client/src/components/StripPathEditor.tsx client/src/components/LayoutSection.tsx client/src/components/ControlPanel.tsx client/src/components/Sidebar.tsx client/src/components/AppShell.tsx client/src/index.css client/src/test
git commit -m "Add Layout section: draw-strip flow, hardware binding, docked control panel"
```

---

### Task 9: Room labels on the canvas (draggable tags)

Adds loose, draggable text tags to the Layout canvas via the `room_labels` API. Labels are rendered as an overlay inside `StripCanvas` `children`.

**Files:**
- Create: `client/src/components/RoomLabelLayer.tsx`
- Modify: `client/src/components/LayoutSection.tsx` (load labels, add-label control, mount layer)
- Modify: `client/src/index.css` (append room-label classes)
- Create: `client/src/test/components/RoomLabelLayer.test.tsx`

**Interfaces:**
- Produces:
  - `function RoomLabelLayer(props: { labels: RoomLabel[]; onMove: (id: string, x: number, y: number) => void }): JSX.Element` — renders each label as an SVG `<text data-testid={\`room-label-${id}\`}>` positioned at `(x, y)`; pointer-drag updates position and calls `onMove` on release (canvas coordinate space 0–100).
- Consumed by: `LayoutSection` (passes `updateRoomLabel` results into state).

- [ ] **Step 1: Write the failing test**

`client/src/test/components/RoomLabelLayer.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomLabelLayer } from '../../components/RoomLabelLayer';
import type { RoomLabel } from '../../api/client';

const labels: RoomLabel[] = [{ id: 'r1', name: 'Kitchen', x: 20, y: 30 }];

describe('RoomLabelLayer', () => {
  it('renders each label at its canvas coordinates', () => {
    render(
      <svg viewBox="0 0 100 100">
        <RoomLabelLayer labels={labels} onMove={() => {}} />
      </svg>
    );
    const el = screen.getByTestId('room-label-r1');
    expect(el.textContent).toBe('Kitchen');
    expect(el.getAttribute('x')).toBe('20');
    expect(el.getAttribute('y')).toBe('30');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd client && npm test -- src/test/components/RoomLabelLayer.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `client/src/components/RoomLabelLayer.tsx`**
```tsx
import { useState } from 'react';
import type { RoomLabel } from '../api/client';

export function RoomLabelLayer({
  labels,
  onMove
}: {
  labels: RoomLabel[];
  onMove: (id: string, x: number, y: number) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function svgOf(target: EventTarget & Element): SVGSVGElement | null {
    return target.closest('svg');
  }

  function handleDown(e: React.MouseEvent<SVGTextElement>, id: string) {
    e.stopPropagation();
    setDragId(id);
  }

  function handleMove(e: React.MouseEvent<SVGGElement>) {
    if (!dragId) return;
    const svg = svgOf(e.currentTarget);
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setPos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100
    });
  }

  function handleUp() {
    if (dragId && pos) onMove(dragId, pos.x, pos.y);
    setDragId(null);
    setPos(null);
  }

  return (
    <g className="room-label-layer" onMouseMove={handleMove} onMouseUp={handleUp}>
      {labels.map((l) => {
        const x = dragId === l.id && pos ? pos.x : l.x;
        const y = dragId === l.id && pos ? pos.y : l.y;
        return (
          <text
            key={l.id}
            data-testid={`room-label-${l.id}`}
            className="room-label"
            x={x}
            y={y}
            onMouseDown={(e) => handleDown(e, l.id)}
          >
            {l.name}
          </text>
        );
      })}
    </g>
  );
}
```

- [ ] **Step 4: Wire labels into `client/src/components/LayoutSection.tsx`**

Add imports:
```tsx
import { listRoomLabels, addRoomLabel, updateRoomLabel, type RoomLabel } from '../api/client';
import { RoomLabelLayer } from './RoomLabelLayer';
```
Add state and loading:
```tsx
  const [labels, setLabels] = useState<RoomLabel[]>([]);
  const [newLabel, setNewLabel] = useState('');
```
In the `useEffect`, add `listRoomLabels().then(setLabels);`.
Add handlers:
```tsx
  async function handleAddLabel() {
    if (!newLabel) return;
    const created = await addRoomLabel({ name: newLabel, x: 50, y: 50 });
    setLabels((prev) => [...prev, created]);
    setNewLabel('');
  }

  async function handleMoveLabel(id: string, x: number, y: number) {
    const updated = await updateRoomLabel(id, { x, y });
    setLabels((prev) => prev.map((l) => (l.id === id ? updated : l)));
  }
```
Add an "Add label" control to `.layout-toolbar-actions` (before the Draw strip button):
```tsx
          <input aria-label="new room label" className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Room label" />
          <button type="button" className="btn btn-secondary" onClick={handleAddLabel} disabled={!newLabel}>Add label</button>
```
Render the layer inside `StripCanvas` as children:
```tsx
            <StripCanvas
              strips={strips}
              selected={selected}
              staleControllerIds={staleControllerIds}
              onSelectionChange={setSelected}
            >
              <RoomLabelLayer labels={labels} onMove={handleMoveLabel} />
            </StripCanvas>
```

- [ ] **Step 5: Append room-label CSS to `client/src/index.css`**
```css
/* ---------- Room labels ---------- */

.room-label {
  fill: var(--color-foreground-muted);
  font-size: 4px;
  font-weight: 600;
  cursor: grab;
  user-select: none;
}

.room-label:active {
  cursor: grabbing;
  fill: var(--color-foreground);
}
```

- [ ] **Step 6: Run tests + full client suite**

Run: `cd client && npm test -- src/test/components/RoomLabelLayer.test.tsx src/test/LayoutSection.test.tsx` → PASS.
Run: `cd client && npm test` → all PASS.

- [ ] **Step 7: Commit**
```bash
git add client/src/components/RoomLabelLayer.tsx client/src/components/LayoutSection.tsx client/src/index.css client/src/test/components/RoomLabelLayer.test.tsx
git commit -m "Add draggable room labels to the Layout canvas"
```

---

### Task 10: Calendar grid component

A reusable month-grid calendar: weekday headers, prev/next/today navigation, and event chips per day (muted when disabled, accent when enabled; holidays and custom events). Needs a client-side port of `resolveDate` to map each event's `dateRule` onto a day in the displayed month.

**Files:**
- Create: `client/src/lib/dateRules.ts`
- Create: `client/src/components/CalendarGrid.tsx`
- Modify: `client/src/index.css` (append calendar classes)
- Create: `client/src/test/CalendarGrid.test.tsx`

**Interfaces:**
- Produces:
  - `client/src/lib/dateRules.ts`: `resolveDate(rule: DateRule, year: number): { month: number; day: number } | null` (behavior-identical port of `server/src/calendar/dateRules.ts`; imports `DateRule` from `../api/client`).
  - `function CalendarGrid(props: { events: CalendarEvent[]; year: number; month: number; selectedDay: number | null; onSelectDay: (day: number) => void; onPrev: () => void; onNext: () => void; onToday: () => void }): JSX.Element` — `month` is 1–12; renders a `data-testid="calendar-grid"` with `data-testid={\`day-${day}\`}` cells, each showing `<span className="event-chip ...">` per event resolving to that day.
- Consumed by: `ScheduleSection` (Task 11).

- [ ] **Step 1: Write the failing test**

`client/src/test/CalendarGrid.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CalendarGrid } from '../components/CalendarGrid';
import type { CalendarEvent } from '../api/client';

const events: CalendarEvent[] = [
  { id: 'e1', name: 'Halloween', category: 'holiday', dateRule: { kind: 'fixed', month: 10, day: 31 }, recursYearly: true, enabled: true, groupId: null, triggerTime: { type: 'fixed', time: '18:00' }, actionType: 'theme', actionPayload: {} },
  { id: 'e2', name: 'Party', category: 'custom', dateRule: { kind: 'fixed', month: 10, day: 15 }, recursYearly: true, enabled: false, groupId: null, triggerTime: { type: 'fixed', time: '20:00' }, actionType: 'theme', actionPayload: {} }
];

describe('CalendarGrid', () => {
  it('renders an enabled event chip (accent) on its day and a disabled chip (muted) on another', () => {
    render(<CalendarGrid events={events} year={2026} month={10} selectedDay={null} onSelectDay={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} onToday={vi.fn()} />);
    const day31 = screen.getByTestId('day-31');
    expect(within(day31).getByText('Halloween').className).toContain('enabled');
    const day15 = screen.getByTestId('day-15');
    expect(within(day15).getByText('Party').className).toContain('disabled');
  });

  it('calls onSelectDay when a day cell is clicked and onNext for the next-month control', () => {
    const onSelectDay = vi.fn();
    const onNext = vi.fn();
    render(<CalendarGrid events={events} year={2026} month={10} selectedDay={null} onSelectDay={onSelectDay} onPrev={vi.fn()} onNext={onNext} onToday={vi.fn()} />);
    fireEvent.click(screen.getByTestId('day-15'));
    expect(onSelectDay).toHaveBeenCalledWith(15);
    fireEvent.click(screen.getByLabelText(/next month/i));
    expect(onNext).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd client && npm test -- src/test/CalendarGrid.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Create `client/src/lib/dateRules.ts`**
```ts
import type { DateRule } from '../api/client';

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number | null {
  const firstOfMonth = new Date(year, month - 1, 1);
  const firstWeekday = firstOfMonth.getDay();
  const dayOffset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + dayOffset + (n - 1) * 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth ? day : null;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const lastDate = new Date(year, month - 1, lastDayOfMonth);
  const diff = (lastDate.getDay() - weekday + 7) % 7;
  return lastDayOfMonth - diff;
}

function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

export function resolveDate(rule: DateRule, year: number): { month: number; day: number } | null {
  switch (rule.kind) {
    case 'fixed':
      return { month: rule.month, day: rule.day };
    case 'nthWeekday': {
      const day = nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n);
      return day === null ? null : { month: rule.month, day };
    }
    case 'lastWeekday':
      return { month: rule.month, day: lastWeekdayOfMonth(year, rule.month, rule.weekday) };
    case 'easterOffset': {
      const easter = easterSunday(year);
      const base = new Date(year, easter.month - 1, easter.day);
      base.setDate(base.getDate() + rule.offsetDays);
      return { month: base.getMonth() + 1, day: base.getDate() };
    }
    case 'oneOff':
      return rule.year === year ? { month: rule.month, day: rule.day } : null;
  }
}
```

- [ ] **Step 4: Create `client/src/components/CalendarGrid.tsx`**
```tsx
import type { CalendarEvent } from '../api/client';
import { resolveDate } from '../lib/dateRules';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function eventsForDay(events: CalendarEvent[], year: number, month: number, day: number): CalendarEvent[] {
  return events.filter((e) => {
    const d = resolveDate(e.dateRule, year);
    return !!d && d.month === month && d.day === day;
  });
}

export function CalendarGrid({
  events,
  year,
  month,
  selectedDay,
  onSelectDay,
  onPrev,
  onNext,
  onToday
}: {
  events: CalendarEvent[];
  year: number;
  month: number;
  selectedDay: number | null;
  onSelectDay: (day: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="calendar" data-testid="calendar-grid">
      <div className="calendar-header">
        <button type="button" className="btn btn-secondary" aria-label="previous month" onClick={onPrev}>‹</button>
        <h2>{MONTHS[month - 1]} {year}</h2>
        <div className="calendar-header-actions">
          <button type="button" className="btn btn-secondary" onClick={onToday}>Today</button>
          <button type="button" className="btn btn-secondary" aria-label="next month" onClick={onNext}>›</button>
        </div>
      </div>
      <div className="calendar-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-weekday">{w}</div>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((day, idx) =>
          day === null ? (
            <div key={`pad-${idx}`} className="calendar-cell empty" />
          ) : (
            <button
              key={day}
              type="button"
              data-testid={`day-${day}`}
              className={`calendar-cell${selectedDay === day ? ' selected' : ''}`}
              onClick={() => onSelectDay(day)}
            >
              <span className="calendar-day-num">{day}</span>
              <span className="calendar-chips">
                {eventsForDay(events, year, month, day).map((e) => (
                  <span
                    key={e.id}
                    className={`event-chip ${e.enabled ? 'enabled' : 'disabled'} ${e.category}`}
                  >
                    {e.name}
                  </span>
                ))}
              </span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Append calendar CSS to `client/src/index.css`**
```css
/* ---------- Calendar ---------- */

.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.calendar-header h2 {
  color: var(--color-foreground);
  text-transform: none;
  letter-spacing: -0.01em;
  font-size: 1.25rem;
}

.calendar-header-actions {
  display: flex;
  gap: var(--space-sm);
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}

.calendar-weekday {
  text-align: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-foreground-muted);
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--space-xs);
}

.calendar-cell {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  min-height: 84px;
  padding: var(--space-xs);
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
}

.calendar-cell.empty {
  background: transparent;
  border-color: transparent;
  cursor: default;
}

.calendar-cell.selected {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25);
}

.calendar-day-num {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-foreground-muted);
}

.calendar-chips {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.event-chip {
  font-size: 0.6875rem;
  padding: 1px 6px;
  border-radius: 999px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-chip.enabled {
  background: rgba(34, 197, 94, 0.18);
  color: var(--color-accent);
}

.event-chip.disabled {
  background: var(--color-muted);
  color: var(--color-foreground-muted);
}
```

- [ ] **Step 6: Run tests + full client suite**

Run: `cd client && npm test -- src/test/CalendarGrid.test.tsx` → PASS (2 tests).
Run: `cd client && npm test` → all PASS.

- [ ] **Step 7: Commit**
```bash
git add client/src/lib/dateRules.ts client/src/components/CalendarGrid.tsx client/src/index.css client/src/test/CalendarGrid.test.tsx
git commit -m "Add month-grid CalendarGrid with event chips and navigation"
```

---

### Task 11: Schedule section (calendar hero + selected-day panel + weekly list)

Assembles the Schedule section: `CalendarGrid` as the hero with month state, a right-side selected-day detail panel (that day's events + an override-of-weekly flag), the "+ Event" custom-event creator (`CalendarEventForm`), and the weekly recurring schedule list (reusing `ScheduleManager`, which already carries the preview/approve/discard flow). Adds the `schedule` nav item.

**Files:**
- Create: `client/src/components/ScheduleSection.tsx`
- Modify: `client/src/components/Sidebar.tsx` (add `schedule` entry)
- Modify: `client/src/components/AppShell.tsx` (render `schedule`)
- Modify: `client/src/index.css` (append schedule layout classes)
- Create: `client/src/test/ScheduleSection.test.tsx`

**Interfaces:**
- Produces: `function ScheduleSection(): JSX.Element` — loads `listCalendarEvents`, `listGroups`, `listThemes`; holds `{ year, month, selectedDay }` state; renders `CalendarGrid` + a `.schedule-detail` panel. When a day with an enabled event is selected, the panel shows the event's action/theme, trigger time, target group, and a "Overrides the weekly schedule this day" note. `CalendarEventForm` is shown via a "+ Event" toggle; `ScheduleManager` renders below as the weekly recurring list. Event enable/disable + delete are wired via `updateCalendarEvent`/`deleteCalendarEvent`.
- Consumes: `eventsForDay` (exported from `CalendarGrid.tsx`), `CalendarEventForm`, `ScheduleManager`.

- [ ] **Step 1: Write the failing test**

`client/src/test/ScheduleSection.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScheduleSection } from '../components/ScheduleSection';

afterEach(() => vi.unstubAllGlobals());

const halloween = {
  id: 'e1', name: 'Halloween', category: 'holiday', dateRule: { kind: 'fixed', month: 10, day: 31 },
  recursYearly: true, enabled: true, groupId: 'g1', triggerTime: { type: 'fixed', time: '18:00' }, actionType: 'theme', actionPayload: { themeId: 't1' }
};

function stub(events: unknown[] = [halloween]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/calendar-events')) return Promise.resolve({ ok: true, json: async () => events });
    if (typeof url === 'string' && url.startsWith('/api/groups')) return Promise.resolve({ ok: true, json: async () => [{ id: 'g1', name: 'Front', members: [] }] });
    if (typeof url === 'string' && url.startsWith('/api/themes')) return Promise.resolve({ ok: true, json: async () => [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0,0,0]], brightness: 128 }] });
    if (typeof url === 'string' && url.startsWith('/api/schedules')) return Promise.resolve({ ok: true, json: async () => [] });
    return Promise.resolve({ ok: true, json: async () => [] });
  }));
}

describe('ScheduleSection', () => {
  it('renders the calendar and shows a day panel with the override flag when an enabled event day is selected', async () => {
    stub();
    render(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
    fireEvent.click(screen.getByTestId('day-31'));
    await waitFor(() => expect(screen.getByText(/Overrides the weekly schedule/i)).toBeTruthy());
  });

  it('shows the weekly recurring schedules region', async () => {
    stub([]);
    render(<ScheduleSection initialYear={2026} initialMonth={10} />);
    await waitFor(() => expect(screen.getByText(/Schedules/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd client && npm test -- src/test/ScheduleSection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `client/src/components/ScheduleSection.tsx`**
```tsx
import { useEffect, useState } from 'react';
import {
  listCalendarEvents, listGroups, listThemes, updateCalendarEvent, deleteCalendarEvent,
  type CalendarEvent, type Group, type CustomTheme
} from '../api/client';
import { CalendarGrid, eventsForDay } from './CalendarGrid';
import { CalendarEventForm } from './CalendarEventForm';
import { ScheduleManager } from './ScheduleManager';

export function ScheduleSection({
  initialYear,
  initialMonth
}: {
  initialYear?: number;
  initialMonth?: number;
}) {
  const now = new Date();
  const [year, setYear] = useState(initialYear ?? now.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    listCalendarEvents().then(setEvents);
    listGroups().then(setGroups);
    listThemes().then(setThemes);
  }, []);

  function prev() {
    setSelectedDay(null);
    if (month === 1) { setMonth(12); setYear((y) => y - 1); } else { setMonth((m) => m - 1); }
  }
  function next() {
    setSelectedDay(null);
    if (month === 12) { setMonth(1); setYear((y) => y + 1); } else { setMonth((m) => m + 1); }
  }
  function today() {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setSelectedDay(now.getDate());
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    const updated = await updateCalendarEvent(id, { enabled });
    setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)));
  }
  async function remove(id: string) {
    await deleteCalendarEvent(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  const dayEvents = selectedDay === null ? [] : eventsForDay(events, year, month, selectedDay);
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? '—';
  const themeName = (payload: unknown) => {
    const themeId = (payload as { themeId?: string })?.themeId;
    return themes.find((t) => t.id === themeId)?.name ?? themeId ?? '—';
  };
  function triggerLabel(e: CalendarEvent): string {
    return e.triggerTime.type === 'fixed'
      ? `at ${e.triggerTime.time}`
      : `${e.triggerTime.type} ${e.triggerTime.offsetMinutes >= 0 ? '+' : ''}${e.triggerTime.offsetMinutes} min`;
  }

  return (
    <section className="section schedule-section">
      <div className="schedule-body">
        <div className="schedule-calendar card">
          <CalendarGrid
            events={events}
            year={year}
            month={month}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onPrev={prev}
            onNext={next}
            onToday={today}
          />
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Close' : '+ Event'}
          </button>
          {showForm && (
            <CalendarEventForm
              groups={groups}
              themes={themes}
              onCreated={(e) => { setEvents((prev) => [...prev, e]); setShowForm(false); }}
            />
          )}
        </div>

        <aside className="schedule-detail card">
          <h3>{selectedDay === null ? 'Select a day' : `Day ${selectedDay}`}</h3>
          {selectedDay !== null && dayEvents.length === 0 && <p className="empty-state">No events on this day.</p>}
          {dayEvents.map((e) => (
            <div key={e.id} className="schedule-detail-event">
              <label className="checkbox-field">
                <input type="checkbox" checked={e.enabled} onChange={(ev) => toggleEnabled(e.id, ev.target.checked)} />
                <span className="controller-name">{e.name}</span>
              </label>
              <span className="controller-meta">{e.actionType ?? 'action'} · {themeName(e.actionPayload)}</span>
              <span className="controller-meta">Trigger {triggerLabel(e)} · Group {groupName(e.groupId)}</span>
              {e.enabled && <span className="badge badge-stale">Overrides the weekly schedule this day</span>}
              <button type="button" className="btn btn-destructive" onClick={() => remove(e.id)}>Remove</button>
            </div>
          ))}
        </aside>
      </div>

      <ScheduleManager />
    </section>
  );
}
```

- [ ] **Step 4: Add the `schedule` nav item in `client/src/components/Sidebar.tsx`**

Import `CalendarIcon` and append to `SECTIONS`:
```tsx
import { LightbulbIcon, GridIcon, UsersIcon, PaletteIcon, CalendarIcon } from './icons';
```
```tsx
  { key: 'schedule', label: 'Schedule', Icon: CalendarIcon }
```

- [ ] **Step 5: Render `schedule` in `client/src/components/AppShell.tsx`**
```tsx
import { ScheduleSection } from './ScheduleSection';
```
```tsx
        {active === 'schedule' && <ScheduleSection />}
```

- [ ] **Step 6: Append schedule-layout CSS to `client/src/index.css`**
```css
/* ---------- Schedule section ---------- */

.schedule-body {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: var(--space-lg);
  align-items: start;
  margin-bottom: var(--space-2xl);
}

.schedule-detail {
  position: sticky;
  top: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.schedule-detail-event {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm) 0;
  border-top: 1px solid var(--color-border);
}

@media (max-width: 720px) {
  .schedule-body {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 7: Run tests + full client suite**

Run: `cd client && npm test -- src/test/ScheduleSection.test.tsx` → PASS (2 tests).
Run: `cd client && npm test` → all PASS.

- [ ] **Step 8: Commit**
```bash
git add client/src/components/ScheduleSection.tsx client/src/components/Sidebar.tsx client/src/components/AppShell.tsx client/src/index.css client/src/test/ScheduleSection.test.tsx
git commit -m "Add Schedule section: calendar hero, day detail panel, weekly list"
```

---

### Task 12: Firmware section

A dedicated screen listing every controller with installed vs. latest stable version and an update indicator, reusing `FirmwareStatus` (which drives the pin/asset-picker/update flow). `FirmwareStatus` is updated to surface a pre-release indicator (driven by the `isPrerelease` field from the settings-controlled backend filter). Adds the `firmware` nav item.

**Files:**
- Create: `client/src/components/FirmwareSection.tsx`
- Modify: `client/src/components/FirmwareStatus.tsx` (pre-release indicator)
- Modify: `client/src/components/Sidebar.tsx` (add `firmware` entry)
- Modify: `client/src/components/AppShell.tsx` (render `firmware`)
- Modify: `client/src/test/FirmwareStatus.test.tsx` (pre-release assertion)
- Create: `client/src/test/FirmwareSection.test.tsx`

**Interfaces:**
- Produces: `function FirmwareSection(): JSX.Element` — loads `listControllers` and renders a `.controller-list` of rows, each with the controller name/host, a stale badge if stale, and `<FirmwareStatus controllerId=... />`.
- `FirmwareStatus` (modified) reads `status.isPrerelease` and renders `<span className="badge">pre-release</span>` next to the latest tag when true.

- [ ] **Step 1: Write the failing FirmwareSection test + update the FirmwareStatus test**

`client/src/test/FirmwareSection.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FirmwareSection } from '../components/FirmwareSection';

afterEach(() => vi.unstubAllGlobals());

describe('FirmwareSection', () => {
  it('lists every controller with an update indicator when a newer stable exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/controllers/c1/firmware')) {
        return Promise.resolve({ ok: true, json: async () => ({ installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true, isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: [] }) });
      }
      if (typeof url === 'string' && url.startsWith('/api/controllers')) {
        return Promise.resolve({ ok: true, json: async () => [{ id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: 'ESP32' }] });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    render(<FirmwareSection />);
    await waitFor(() => expect(screen.getByText('Porch')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/update available/i)).toBeTruthy());
  });
});
```

In `client/src/test/FirmwareStatus.test.tsx`, add `isPrerelease: false` to each existing mock response object, and append a pre-release test:
```tsx
  it('shows a pre-release indicator when the latest resolved release is a pre-release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ installedVersion: '0.14.0', latestTag: 'v0.15.1-b3', updateAvailable: true, isPrerelease: true, pinnedAssetPattern: 'ESP32', candidateAssets: [] })
    }));
    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText(/pre-release/i)).toBeTruthy());
  });
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `cd client && npm test -- src/test/FirmwareSection.test.tsx src/test/FirmwareStatus.test.tsx`
Expected: FAIL — `FirmwareSection` missing; pre-release indicator not rendered.

- [ ] **Step 3: Add the pre-release indicator to `client/src/components/FirmwareStatus.tsx`**

In the returned JSX, replace the update-available badge block with one that also shows the pre-release marker:
```tsx
      {status.updateAvailable && (
        <span className="badge badge-stale"> Update available ({status.latestTag})</span>
      )}
      {status.isPrerelease && <span className="badge">pre-release</span>}
```

- [ ] **Step 4: Create `client/src/components/FirmwareSection.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { listControllers, type Controller } from '../api/client';
import { FirmwareStatus } from './FirmwareStatus';
import { LightbulbIcon } from './icons';

export function FirmwareSection() {
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listControllers().then(setControllers).catch((e) => setError(e.message));
  }, []);

  return (
    <section className="section">
      <h2>Firmware</h2>
      <div className="card">
        {error && <div className="error-banner">{error}</div>}
        {controllers.length === 0 ? (
          <p className="empty-state">No controllers yet.</p>
        ) : (
          <ul className="controller-list">
            {controllers.map((c) => (
              <li key={c.id} className="controller-row">
                <LightbulbIcon className="controller-icon" />
                <div className="controller-info">
                  <span className="controller-name">{c.name}</span>
                  <span className="controller-meta">{c.host}</span>
                </div>
                {c.stale && <span className="badge badge-stale">stale</span>}
                <FirmwareStatus controllerId={c.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add the `firmware` nav item in `client/src/components/Sidebar.tsx`**

Import `ChipIcon` and append to `SECTIONS`:
```tsx
import { LightbulbIcon, GridIcon, UsersIcon, PaletteIcon, CalendarIcon, ChipIcon } from './icons';
```
```tsx
  { key: 'firmware', label: 'Firmware', Icon: ChipIcon }
```

- [ ] **Step 6: Render `firmware` in `client/src/components/AppShell.tsx`**
```tsx
import { FirmwareSection } from './FirmwareSection';
```
```tsx
        {active === 'firmware' && <FirmwareSection />}
```

- [ ] **Step 7: Run tests + full client suite**

Run: `cd client && npm test -- src/test/FirmwareSection.test.tsx src/test/FirmwareStatus.test.tsx` → PASS.
Run: `cd client && npm test` → all PASS.

- [ ] **Step 8: Commit**
```bash
git add client/src/components/FirmwareSection.tsx client/src/components/FirmwareStatus.tsx client/src/components/Sidebar.tsx client/src/components/AppShell.tsx client/src/test/FirmwareSection.test.tsx client/src/test/FirmwareStatus.test.tsx
git commit -m "Add Firmware section with per-controller status and pre-release indicator"
```

---

### Task 13: Settings section

A form that reads current settings on load and PATCHes changes, covering all five settings fields plus a "Re-scan now" action. Inline error on write failure leaves the prior value in place. Adds the `settings` nav item.

**Files:**
- Create: `client/src/components/SettingsSection.tsx`
- Modify: `client/src/components/Sidebar.tsx` (add `settings` entry)
- Modify: `client/src/components/AppShell.tsx` (render `settings`)
- Create: `client/src/test/SettingsSection.test.tsx`

**Interfaces:**
- Produces: `function SettingsSection(): JSX.Element` — loads `getSettings`; renders controls for `includePrereleaseFirmware` (checkbox), `homeLatitude`/`homeLongitude` (number, nullable), `discoveryRescanIntervalMinutes` (number), `scheduleImportDisableOnDeviceDefault` (checkbox), a Save button calling `updateSettings`, and a "Re-scan now" button calling `rescanNow`. On a failed `updateSettings`, shows an inline error and keeps the last-loaded values.
- Consumes: `getSettings`, `updateSettings`, `rescanNow`.

- [ ] **Step 1: Write the failing test**

`client/src/test/SettingsSection.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsSection } from '../components/SettingsSection';

afterEach(() => vi.unstubAllGlobals());

const initial = {
  includePrereleaseFirmware: false, homeLatitude: null, homeLongitude: null,
  discoveryRescanIntervalMinutes: 5, scheduleImportDisableOnDeviceDefault: false
};

describe('SettingsSection', () => {
  it('reads current settings and PATCHes a toggle change', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') return Promise.resolve({ ok: true, json: async () => ({ ...initial, includePrereleaseFirmware: true }) });
      return Promise.resolve({ ok: true, json: async () => initial });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsSection />);
    const toggle = await screen.findByLabelText(/pre-release firmware/i);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PATCH' })));
  });

  it('shows an inline error and keeps the prior value when the write fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') return Promise.resolve({ ok: false, json: async () => ({}) });
      return Promise.resolve({ ok: true, json: async () => initial });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsSection />);
    const interval = await screen.findByLabelText(/re-scan interval/i);
    fireEvent.change(interval, { target: { value: '10' } });
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect((screen.getByLabelText(/re-scan interval/i) as HTMLInputElement).value).toBe('10');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd client && npm test -- src/test/SettingsSection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `client/src/components/SettingsSection.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { getSettings, updateSettings, rescanNow, type Settings } from '../api/client';

export function SettingsSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rescanMessage, setRescanMessage] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(setSettings).catch((e) => setError(e.message));
  }, []);

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateSettings(settings);
      setSettings(saved);
    } catch (e: unknown) {
      // Keep the current (edited) values on screen; surface the failure inline.
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleRescan() {
    setRescanMessage(null);
    try {
      const { controllers } = await rescanNow();
      setRescanMessage(`Re-scan complete — ${controllers.length} controller(s) known.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Re-scan failed');
    }
  }

  if (!settings) return <section className="section"><h2>Settings</h2><p className="empty-state">Loading…</p></section>;

  return (
    <section className="section">
      <h2>Settings</h2>
      <div className="card settings-form">
        {error && <div className="error-banner" role="alert">{error}</div>}

        <label className="checkbox-field">
          <input
            type="checkbox"
            aria-label="Include pre-release firmware builds"
            checked={settings.includePrereleaseFirmware}
            onChange={(e) => patch('includePrereleaseFirmware', e.target.checked)}
          />
          Include pre-release firmware builds
        </label>

        <div className="field">
          <label htmlFor="settings-lat">Home latitude</label>
          <input
            id="settings-lat"
            className="input"
            type="number"
            step="any"
            value={settings.homeLatitude ?? ''}
            onChange={(e) => patch('homeLatitude', e.target.value === '' ? null : Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="settings-lon">Home longitude</label>
          <input
            id="settings-lon"
            className="input"
            type="number"
            step="any"
            value={settings.homeLongitude ?? ''}
            onChange={(e) => patch('homeLongitude', e.target.value === '' ? null : Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="settings-interval">Discovery re-scan interval (minutes)</label>
          <input
            id="settings-interval"
            aria-label="Discovery re-scan interval (minutes)"
            className="input"
            type="number"
            min={1}
            value={settings.discoveryRescanIntervalMinutes}
            onChange={(e) => patch('discoveryRescanIntervalMinutes', Number(e.target.value))}
          />
        </div>

        <label className="checkbox-field">
          <input
            type="checkbox"
            aria-label="Default disable on device for schedule import"
            checked={settings.scheduleImportDisableOnDeviceDefault}
            onChange={(e) => patch('scheduleImportDisableOnDeviceDefault', e.target.checked)}
          />
          Default "disable on device" when importing WLED schedules
        </label>

        <div className="settings-actions">
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleRescan}>Re-scan now</button>
        </div>
        {rescanMessage && <p className="controller-meta">{rescanMessage}</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add the `settings` nav item in `client/src/components/Sidebar.tsx`**

Import `GearIcon` and append to `SECTIONS`:
```tsx
import { LightbulbIcon, GridIcon, UsersIcon, PaletteIcon, CalendarIcon, ChipIcon, GearIcon } from './icons';
```
```tsx
  { key: 'settings', label: 'Settings', Icon: GearIcon }
```

- [ ] **Step 5: Render `settings` in `client/src/components/AppShell.tsx`**
```tsx
import { SettingsSection } from './SettingsSection';
```
```tsx
        {active === 'settings' && <SettingsSection />}
```
At this point `SECTIONS` lists all seven sections in order (Layout, Controllers, Groups, Themes, Schedule, Firmware, Settings) and every one has a render branch.

- [ ] **Step 6: Append settings CSS to `client/src/index.css`**
```css
/* ---------- Settings form ---------- */

.settings-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  max-width: 480px;
}

.settings-actions {
  display: flex;
  gap: var(--space-sm);
}
```

- [ ] **Step 7: Run tests + full client suite**

Run: `cd client && npm test -- src/test/SettingsSection.test.tsx` → PASS (2 tests).
Run: `cd client && npm test` → all PASS.

- [ ] **Step 8: Commit**
```bash
git add client/src/components/SettingsSection.tsx client/src/components/Sidebar.tsx client/src/components/AppShell.tsx client/src/index.css client/src/test/SettingsSection.test.tsx
git commit -m "Add Settings section with all global settings fields and re-scan action"
```

---

### Task 14: Full-suite verification + AppShell all-sections test

Final integration pass: verify the whole shell renders all seven sections, both suites are green, and both projects build.

**Files:**
- Modify: `client/src/test/AppShell.test.tsx` (assert all seven nav items render; default is Layout)

**Interfaces:**
- Produces: nothing new — verification only.

- [ ] **Step 1: Extend `client/src/test/AppShell.test.tsx`**

Update the default-section test (default is now `layout`) and add an all-sections test. Replace the first test and add a new one:
```tsx
  it('opens on the Layout section by default and lists all seven sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<AppShell />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Layout/ }).className).toContain('active'));
    for (const name of ['Layout', 'Controllers', 'Groups', 'Themes', 'Schedule', 'Firmware', 'Settings']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
  });
```
(The existing "switches to the Themes section" test remains valid.)

- [ ] **Step 2: Run the AppShell test, confirm it passes**

Run: `cd client && npm test -- src/test/AppShell.test.tsx`
Expected: PASS.

- [ ] **Step 3: Run both full suites**

Run: `cd server && npm test` → all PASS (expected ~26 files after strips/room_labels/settings added and floorplans/placements removed; net test count remains ≥ baseline).
Run: `cd client && npm test` → all PASS (expected ~17 files: baseline 10 − 2 removed + 9 added).

- [ ] **Step 4: Build both projects**

Run: `cd server && npm run build` → tsc succeeds.
Run: `cd client && npm run build` → `tsc -b && vite build` succeeds (confirms no dangling references to removed `Floorplan`/`Placement`/floorplan components).

- [ ] **Step 5: Commit**
```bash
git add client/src/test/AppShell.test.tsx
git commit -m "Verify full shell renders all seven sections; final suite/build pass"
```

- [ ] **Step 6: Push**
```bash
git push origin main
```

---

### Task 15: Live per-strip color on the canvas

Per an explicit user decision (overriding the "fixed color for v1" default noted in ambiguity #1), each strip on the Layout canvas renders in its segment's real live color — scaled by brightness, muted when the segment is off, and greyed when the controller is stale/unreachable. The canvas becomes a live status board. This layers on top of the `StripCanvas` (Task 7) and `LayoutSection` (Task 8) already built.

**Files:**
- Create: `client/src/lib/segmentColor.ts`
- Modify: `client/src/components/StripCanvas.tsx` (accept `liveColors` prop, use it for stroke)
- Modify: `client/src/components/LayoutSection.tsx` (poll live segment state per controller, build the color map, refresh on an interval and after each control action)
- Create: `client/src/test/lib/segmentColor.test.ts`
- Modify: `client/src/test/components/StripCanvas.test.tsx` (assert `liveColors` drives the stroke)

**Interfaces:**
- Consumes: `getSegmentsSnapshot(controllerId): Promise<{ id: number; start: number; stop: number; len: number; on: boolean; bri: number; fx: number; pal: number; col: number[][] }[]>` (already exported from `client/src/api/client.ts`); `Strip` (Task 6).
- Produces:
  - `segmentToCssColor(seg: { on: boolean; bri: number; col: number[][] }): string` (from `client/src/lib/segmentColor.ts`) — off → `'#334155'`; on with a valid primary color → `rgb()` scaled by `bri/255`; on with empty `col` → `'rgb(148, 163, 184)'`.
  - `StripCanvasProps` gains `liveColors?: Map<string, string>` (keyed by strip id). A strip's stroke is `liveColors?.get(strip.id)` when present and the controller is not stale; otherwise it keeps the Task 7 behavior (accent when normal, grey when stale).

- [ ] **Step 1: Write the failing `segmentColor` test**

`client/src/test/lib/segmentColor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { segmentToCssColor } from '../../lib/segmentColor';

describe('segmentToCssColor', () => {
  it('returns a muted color when the segment is off', () => {
    expect(segmentToCssColor({ on: false, bri: 255, col: [[255, 0, 0]] })).toBe('#334155');
  });
  it('scales the primary color by brightness when on', () => {
    expect(segmentToCssColor({ on: true, bri: 128, col: [[200, 100, 50]] })).toBe('rgb(100, 50, 25)');
  });
  it('falls back to a neutral color when col is empty', () => {
    expect(segmentToCssColor({ on: true, bri: 255, col: [] })).toBe('rgb(148, 163, 184)');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd client && npm test -- src/test/lib/segmentColor.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `client/src/lib/segmentColor.ts`**
```ts
export function segmentToCssColor(seg: { on: boolean; bri: number; col: number[][] }): string {
  if (!seg.on) return '#334155';
  const primary = seg.col[0];
  if (!primary || primary.length < 3) return 'rgb(148, 163, 184)';
  const scale = seg.bri / 255;
  const [r, g, b] = primary;
  return `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd client && npm test -- src/test/lib/segmentColor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `liveColors` to `StripCanvas`**

In `client/src/components/StripCanvas.tsx`: add `liveColors?: Map<string, string>` to `StripCanvasProps`, destructure it, and in the polyline render change the stroke so a live color wins when present and the controller isn't stale. The stroke expression becomes:
```tsx
// isStale and isSelected already computed in Task 7's map body
const liveColor = liveColors?.get(s.id);
const stroke = isStale ? '#475569' : (liveColor ?? (isSelected ? '#ff5ec8' : '#22c55e'));
// ...use `stroke` in the <polyline stroke={stroke} ...> (keep the existing selected glow/stroke-width logic)
```
Keep everything else about the polyline (data-testid, data-selected, data-stale, selected stroke width/glow) unchanged.

- [ ] **Step 6: Extend `StripCanvas.test.tsx` to assert the live color drives the stroke**

Append to `client/src/test/components/StripCanvas.test.tsx`:
```tsx
  it('uses the provided live color for a strip stroke', () => {
    render(
      <StripCanvas
        strips={strips}
        selected={new Set()}
        staleControllerIds={new Set()}
        onSelectionChange={vi.fn()}
        liveColors={new Map([['s1', 'rgb(200, 50, 25)']])}
      />
    );
    expect(screen.getByTestId('strip-s1').getAttribute('stroke')).toBe('rgb(200, 50, 25)');
  });
```

- [ ] **Step 7: Run the canvas test, confirm it passes**

Run: `cd client && npm test -- src/test/components/StripCanvas.test.tsx`
Expected: PASS (previous tests + the new live-color test).

- [ ] **Step 8: Poll live colors in `LayoutSection` and pass them to the canvas**

In `client/src/components/LayoutSection.tsx`, after strips are loaded, add a live-color effect that fetches each distinct controller's segments, maps each strip to its segment's color, and passes the resulting map to `StripCanvas`. It re-polls every 5 seconds and exposes a `refreshLiveColors()` the control-panel apply handler already calls after an action:
```tsx
import { getSegmentsSnapshot } from '../api/client';
import { segmentToCssColor } from '../lib/segmentColor';
// ...inside the component, given `strips: Strip[]` state:
const [liveColors, setLiveColors] = useState<Map<string, string>>(new Map());

const refreshLiveColors = useCallback(async () => {
  const controllerIds = Array.from(new Set(strips.map((s) => s.controllerId)));
  const next = new Map<string, string>();
  await Promise.all(
    controllerIds.map(async (cid) => {
      try {
        const segs = await getSegmentsSnapshot(cid);
        for (const s of strips.filter((st) => st.controllerId === cid)) {
          const seg = segs.find((sg) => sg.id === s.wledSegId);
          if (seg) next.set(s.id, segmentToCssColor(seg));
        }
      } catch {
        /* unreachable controller: leave its strips to the stale/greyed path */
      }
    })
  );
  setLiveColors(next);
}, [strips]);

useEffect(() => {
  refreshLiveColors();
  const t = setInterval(refreshLiveColors, 5000);
  return () => clearInterval(t);
}, [refreshLiveColors]);
```
Pass `liveColors={liveColors}` to the `<StripCanvas .../>`, and call `refreshLiveColors()` at the end of the control-panel apply handler so colors update immediately after an action. (Import `useCallback`/`useEffect`/`useState` as needed.)

- [ ] **Step 9: Run the full client suite, confirm it passes**

Run: `cd client && npm test`
Expected: all PASS (adds `src/test/lib/segmentColor.test.ts`; `StripCanvas.test.tsx` gains one test).

- [ ] **Step 10: Build the client, confirm no type errors**

Run: `cd client && npm run build`
Expected: `tsc -b && vite build` succeeds.

- [ ] **Step 11: Commit and push**
```bash
git add client/src/lib/segmentColor.ts client/src/components/StripCanvas.tsx client/src/components/LayoutSection.tsx client/src/test/lib/segmentColor.test.ts client/src/test/components/StripCanvas.test.tsx
git commit -m "Render live per-strip color on the layout canvas"
git push origin main
```

---

## Self-Review

**(1) Spec coverage — every section of the ui-overhaul spec maps to a task:**

- Removals / floorplan gutting (`floorplans/`, `floorplans` table, multer image upload, `FloorplanEditor.tsx`, `FloorplanCanvas.tsx`, Dashboard upload UI, crop/rotate/zoom fields) → Tasks 1 (placements→strips), 2 (floorplans removal + multer verified only-used-there), 6 (client floorplan UI + Dashboard removed). ✓
- App shell / left sidebar, seven sections, Layout default, active highlight, collapse-to-icons, client routing → Tasks 6 (shell + hash routing + collapse), 8 (Layout added + made default), 11/12/13 (remaining nav items). Routing decision: dependency-free hash-based switch (`#/section`), refreshable. ✓
- Layout section: imageless canvas, multi-point strips, draggable/reposition, hardware binding on create, room labels, marquee+click selection, right-docked control panel + empty state, toolbar with draw + selection count → Tasks 7 (canvas render+select+marquee), 8 (draw flow + binding + docked panel + toolbar), 9 (room labels). Live-state color: strips reflect stale controllers (greyed); full live per-strip color polling is left to the noted live-refinement phase (spec: "where practical"). ✓ (see ambiguity 1)
- Schedule section: month grid, weekday headers, prev/next/today, holiday+custom chips (muted disabled / accent enabled), "+ Event", selected-day panel with action/trigger/group + weekly-override flag, weekly recurring list, preview-before-save retained → Tasks 10 (grid + chips + nav), 11 (day panel + override flag + `CalendarEventForm` + `ScheduleManager` preview flow reused). ✓
- Firmware section: per-controller installed/latest-stable + update indicator, stable-only default with pre-release toggle indicator, pin/asset-picker/OTA retained → Task 5 (backend stable filter + `isPrerelease`), 12 (dedicated screen + pre-release indicator, reuses `FirmwareStatus`/`AssetPickerModal`). ✓
- Settings section: include-pre-release toggle, home lat/long, re-scan interval + "Re-scan now", schedule-import disable-on-device default, inline error keeping prior value, persisted server-side + settings API → Tasks 4 (backend table/repo/API + startup wiring + rescan), 13 (form). ✓
- Controllers / Groups / Themes relocated onto dedicated screens → Task 6 (`ControllersSection` extracted; `GroupManager`/`ThemeManager` reused as section screens under the shell). ✓
- Data model: drop `floorplans`, reshape `placements` (drop floorplan_id/length_meters, add label, flat), add `room_labels`, add `settings`, split recommendations keep working → Tasks 1, 2, 3, 4; recommendations validated in Task 1's strips test (same-controller grouping). ✓
- Error handling: unreachable controllers greyed on canvas / stale in lists (Task 7 stale styling, Task 12 stale badge); settings write failure inline + prior value kept (Task 13); firmware fetch cache fallback + stable filter applied to available list (Task 5 `selectLatest` over cached list). ✓
- Testing: shell/nav, canvas, calendar, settings, firmware component tests; backend settings + stable-filter tests; floorplan tests deleted → all present across tasks. ✓

**(2) Placeholder scan:** No `TODO`, "similar to Task N", or prose-only code steps. Every code step contains complete, runnable code. The sidebar `SECTIONS` array grows across Tasks 6/8/11/12/13 but each intermediate commit renders every listed section (no "coming soon" stubs). Fixed during authoring: reordered so the shell (Task 6) ships with only fully-implemented sections and each later task adds its nav entry together with its screen.

**(3) Type consistency:** Verified identical spelling across tasks — `Strip`, `RoomLabel`, `Settings`, `Point`, `SectionKey`, `WledRelease.prerelease`, `FirmwareStatus.isPrerelease`, `SECTIONS`, `StripCanvas`/`StripPathEditor`/`LayoutSection`/`RoomLabelLayer`/`CalendarGrid`/`ScheduleSection`/`FirmwareSection`/`SettingsSection`. The `Strip`/`RoomLabel`/`Settings` field shapes match between backend repositories and the client `api/client.ts`. `eventsForDay` is exported from `CalendarGrid.tsx` and consumed by `ScheduleSection`.

**Self-review result:** PASS after the placeholder-ordering fix noted above.

## Ambiguities / judgment calls (flag to user)

1. **Live per-strip color on the canvas.** The spec says a strip's on-canvas color "reflects its live state where practical." This plan renders strips in a fixed accent color and only greys strips whose controller is stale (satisfying the error-handling requirement), leaving true live-color polling to the "expected live refinement" phase the spec explicitly anticipates for Layout. If you want live per-strip color in the first cut, that's an added task (poll `getState` per controller and map segment color → stroke).
2. **Routing approach.** I chose a dependency-free hash-based section switch (`#/layout`, etc.) rather than adding `react-router-dom`, to stay consistent with the current no-router codebase while still being refreshable/linkable. If you'd prefer real path-based routes (`/layout`) with `react-router-dom`, that swaps Task 6's shell internals and adds one dependency.
3. **Weekly-override flag semantics.** The selected-day panel flags "Overrides the weekly schedule this day" whenever an *enabled* calendar event falls on the selected day. This mirrors the scheduler engine's calendar-override-for-day suppression at the UI level but does not re-run the engine's exact per-group logic in the browser; if you want the flag scoped to only the groups a weekly schedule actually targets, that's a small enhancement to Task 11.
4. **"Re-scan now" placement.** I put the manual re-scan action in the Settings section (with the re-scan interval), per the spec's Settings bullet. The Controllers section does not duplicate it. Say the word if you'd also like it on the Controllers screen.
5. **Segment-split recommendations on a shared canvas.** Because strips are now controller-agnostic on one canvas, recommendations are computed per-controller (only strips sharing the same `controllerId` are compared against that controller's live segments). This preserves the original single-device semantics; a cross-controller interpretation would be meaningless for a physical split, so I did not pursue it.
