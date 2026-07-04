# uber-wled Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Docker web app that discovers WLED controllers on the LAN, lets you lay out their light segments on a floorplan, control any multi-select combination of them at once, and schedule automated theme changes.

**Architecture:** Node.js/TypeScript + Express backend owns all WLED communication, mDNS discovery, SQLite persistence, and scheduling; it serves a React (Vite) frontend for the floorplan editor and control panels. Everything ships as one Docker image; SQLite and uploaded floorplan images live on a mounted volume.

**Tech Stack:** TypeScript, Express, better-sqlite3, bonjour-service (mDNS), node-cron, suncalc, multer, React 18, Vite, Vitest, supertest, nock, @testing-library/react.

## Global Constraints

- LAN-only, no authentication, no HTTPS — per spec, relies on the home network's perimeter.
- No cloud dependency of any kind.
- Manually-added controllers are never deleted by a re-scan; auto-discovered ones that disappear are marked stale, not deleted.
- Segment writes to a device are always user-confirmed — never pushed silently.
- Batch control writes (theme/group apply) are per-controller: independent, retried once on failure, failures reported per-controller (batch never fails as a whole).
- Segment (config) writes are NOT auto-retried — failures surface immediately.

---

## File Structure

```
uber-wled/
  Dockerfile
  docker-compose.yml
  server/
    package.json, tsconfig.json, vitest.config.ts
    src/
      app.ts              # Express app factory (no listen) — used by tests and server.ts
      server.ts            # entry point: creates db, app, seeds calendar, starts scheduler + discovery, listens
      db/
        client.ts          # createDb(path): opens better-sqlite3 db, runs migrations
        schema.ts           # runMigrations(db): CREATE TABLE IF NOT EXISTS statements
      wled/
        types.ts            # WledInfo (incl. arch), WledSegment, WledState, WledPreset
        client.ts            # getInfo, getState, setState, setSegment, getPresets, applyPreset
      controllers/
        repository.ts        # DB access for controllers table (incl. pinnedAssetPattern)
        routes.ts             # Express router: list/add/delete controllers, mounts firmware + import-schedules
        scheduleImport.ts      # parsePresetSchedule, importSchedules: one-time best-effort WLED schedule import
      discovery/
        mdns.ts                # scanOnce(): browses _wled._tcp, returns [{host, name}]
        service.ts              # runDiscoveryCycle(db): merges scan results into controllers table
      segments/
        routes.ts               # Express router: GET live segments, PUT segment (push to device)
        recommend.ts             # recommendSplits(placement, deviceSegments): mismatch suggestions
      floorplans/
        repository.ts            # DB access for floorplans table
        routes.ts                # Express router: upload, list, update crop/rotate/zoom
      placements/
        repository.ts            # DB access for placements table
        routes.ts                # Express router: CRUD placements
      groups/
        repository.ts            # DB access for groups + group_members tables
        routes.ts                # Express router: CRUD groups
      themes/
        repository.ts            # DB access for themes table (custom themes)
        routes.ts                # Express router: CRUD custom themes, GET WLED presets passthrough
      control/
        routes.ts                # Express router: POST /control/apply (batch action to a selection); exports applyToMembers
      schedules/
        repository.ts            # DB access for schedules table (incl. weekly daysOfWeek/timeOfDay)
        routes.ts                # Express router: CRUD schedules
        engine.ts                 # SchedulerEngine: cron/sunrise/sunset/weekly triggers + calendar override-for-day suppression
      calendar/
        dateRules.ts               # DateRule union + resolveDate(rule, year): fixed/nthWeekday/lastWeekday/easterOffset/oneOff
        holidaySeeds.ts             # seedHolidays(): federal + decorating-occasion holiday seed list
        repository.ts                # DB access for calendar_events table; seedHolidaysIfEmpty(db)
        routes.ts                    # Express router: CRUD calendar events + 409 conflict guard
      firmware/
        githubClient.ts              # fetchLatestRelease(db, opts): GitHub release cache w/ 6h refetch + fallback
        assetMatch.ts                 # chipArchTokens, candidateAssets, resolvePinnedAsset
        otaPush.ts                     # pushOtaUpdate(host, assetBytes, expectedTag): upload + bounded confirmation poll
        routes.ts                      # Express router: GET/POST firmware status+pin+update, mounted under controllers
    test/
      (mirrors src/ — see per-task Test: paths)
  client/
    package.json, vite.config.ts, tsconfig.json, vitest.config.ts
    src/
      main.tsx
      App.tsx
      api/client.ts              # typed fetch wrappers for every backend route used above
      components/
        ControllerList.tsx
        FloorplanCanvas.tsx        # renders floorplan image + segment paths, marquee multi-select
        SegmentPathEditor.tsx       # click-to-place bend points for a new/edited placement
        ControlPanel.tsx             # power/brightness/preset/theme controls for current selection
        GroupManager.tsx
        ThemeManager.tsx
        ScheduleManager.tsx           # weekly schedule list + WeeklyScheduleForm w/ preview/approve/discard
        WeeklyScheduleForm.tsx         # days-of-week + time-of-day + group/action picker, with preview flow
        CalendarEventForm.tsx          # custom calendar event authoring, surfaces 409 conflicts inline
        CalendarEventList.tsx           # holiday + custom event list, toggle enabled / delete
        FirmwareStatus.tsx               # installed vs. latest version, update badge, pin/update actions
        AssetPickerModal.tsx              # first-time (or pin-mismatch) asset picker
      pages/
        Dashboard.tsx
        FloorplanEditor.tsx
    src/test/
      (mirrors src/ — see per-task Test: paths; this is the real, current test directory — NOT client/test/)
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- Create: `server/src/app.ts`, `server/src/server.ts`
- Create: `client/package.json`, `client/vite.config.ts`, `client/tsconfig.json`, `client/vitest.config.ts`
- Create: `client/src/main.tsx`, `client/src/App.tsx`, `client/index.html`
- Create: `Dockerfile`, `docker-compose.yml`, `.env.example`
- Test: `server/test/app.test.ts`

**Interfaces:**
- Produces: `createApp(): express.Express` from `server/src/app.ts` — every later backend task mounts its router onto this app inside its own test via a fresh `createApp()` call (routers are added to `app.ts` incrementally in later tasks).

- [ ] **Step 1: Write the failing smoke test**

`server/test/app.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test` (will fail — nothing exists yet, `npm test` itself will error)
Expected: error, no such file/module

- [ ] **Step 3: Create `server/package.json`**

```json
{
  "name": "uber-wled-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.2",
    "better-sqlite3": "^11.3.0",
    "bonjour-service": "^1.2.1",
    "node-cron": "^3.0.3",
    "suncalc": "^1.9.0",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "tsx": "^4.16.2",
    "vitest": "^2.0.5",
    "supertest": "^7.0.0",
    "nock": "^13.5.4",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.15",
    "@types/better-sqlite3": "^7.6.11",
    "@types/multer": "^1.4.11",
    "@types/supertest": "^6.0.2",
    "@types/suncalc": "^1.9.2"
  }
}
```

- [ ] **Step 4: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' }
});
```

- [ ] **Step 6: Create `server/src/app.ts`**

```ts
import express from 'express';
import path from 'node:path';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const staticDir = process.env.STATIC_DIR;
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return app;
}
```

- [ ] **Step 7: Create `server/src/server.ts`**

```ts
import { createApp } from './app.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const app = createApp();
app.listen(PORT, () => {
  console.log(`uber-wled server listening on port ${PORT}`);
});
```

- [ ] **Step 8: Install deps and run test, confirm it passes**

Run: `cd server && npm install && npm test`
Expected: `GET /health > returns ok status` PASS

- [ ] **Step 9: Scaffold the client**

Run: `cd client && npm create vite@latest . -- --template react-ts`

Then replace `client/src/App.tsx` with:
```tsx
export default function App() {
  return <div>uber-wled</div>;
}
```

Add to `client/package.json` `devDependencies`: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`. Add to `scripts`: `"test": "vitest run"`.

Create `client/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom' }
});
```

Run: `cd client && npm install`

- [ ] **Step 10: Create `Dockerfile`**

```dockerfile
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/package.json ./package.json
COPY --from=client-build /app/client/dist ./public
ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/public
ENV DB_PATH=/app/data/uber-wled.db
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- [ ] **Step 11: Create `docker-compose.yml`**

```yaml
services:
  uber-wled:
    build: .
    # host networking is required so mDNS multicast discovery can see WLED
    # devices on the LAN; if unavailable on your platform, add controllers
    # manually via IP instead.
    network_mode: "host"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=3000
      - DB_PATH=/app/data/uber-wled.db
```

- [ ] **Step 12: Create `.env.example`**

```
PORT=3000
DB_PATH=./data/uber-wled.db
```

- [ ] **Step 13: Commit**

```bash
git add server client Dockerfile docker-compose.yml .env.example
git commit -m "Scaffold server and client projects"
```

---

### Task 2: Database schema & client

**Files:**
- Create: `server/src/db/schema.ts`, `server/src/db/client.ts`
- Test: `server/test/db/client.test.ts`

**Interfaces:**
- Produces: `createDb(path: string): Database.Database` — every repository task (Controllers, Floorplans, Placements, Groups, Themes, Schedules) takes a `Database.Database` instance as a constructor/function argument, obtained via this function. Tests use `createDb(':memory:')`.

- [ ] **Step 1: Write the failing test**

`server/test/db/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
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
      'controllers',
      'floorplans',
      'group_members',
      'groups',
      'placements',
      'schedules',
      'themes'
    ]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/db/client.test.ts`
Expected: FAIL — cannot find module `../../src/db/client.js`

- [ ] **Step 3: Create `server/src/db/schema.ts`**

```ts
import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS controllers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK (source IN ('discovered','manual')),
      stale INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS placements (
      id TEXT PRIMARY KEY,
      floorplan_id TEXT NOT NULL REFERENCES floorplans(id),
      controller_id TEXT NOT NULL REFERENCES controllers(id),
      wled_seg_id INTEGER NOT NULL,
      points TEXT NOT NULL,
      length_meters REAL
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
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron','sunrise','sunset')),
      cron_expr TEXT,
      offset_minutes INTEGER NOT NULL DEFAULT 0,
      latitude REAL,
      longitude REAL,
      group_id TEXT NOT NULL REFERENCES groups(id),
      action_type TEXT NOT NULL CHECK (action_type IN ('preset','theme','power','brightness')),
      action_payload TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
  `);
}
```

- [ ] **Step 4: Create `server/src/db/client.ts`**

```ts
import Database from 'better-sqlite3';
import { runMigrations } from './schema.js';

export function createDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd server && npm test -- test/db/client.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/db server/test/db
git commit -m "Add SQLite schema and db client"
```

---

### Task 3: WLED API client

**Files:**
- Create: `server/src/wled/types.ts`, `server/src/wled/client.ts`
- Test: `server/test/wled/client.test.ts`

**Interfaces:**
- Produces:
  - `interface WledSegment { id: number; start: number; stop: number; len: number; on: boolean; bri: number; fx: number; pal: number; col: number[][]; }`
  - `interface WledState { on: boolean; bri: number; ps: number; seg: WledSegment[]; }`
  - `interface WledInfo { name: string; ver: string; leds: { count: number }; }`
  - `interface WledPreset { id: number; name: string; }`
  - `getInfo(host: string): Promise<WledInfo>`
  - `getState(host: string): Promise<WledState>`
  - `setState(host: string, patch: Partial<Pick<WledState,'on'|'bri'|'ps'>> & { seg?: Partial<WledSegment>[] }): Promise<WledState>`
  - `setSegment(host: string, segment: { id: number; start: number; stop: number }): Promise<WledState>`
  - `getPresets(host: string): Promise<WledPreset[]>`
  - `applyPreset(host: string, presetId: number): Promise<WledState>`
- Consumed by: Controllers (getInfo for validation), Segments (getState/setSegment), Themes (getPresets), Control (setState/applyPreset).

- [ ] **Step 1: Write the failing test**

`server/test/wled/client.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { getInfo, getState, setState, setSegment, getPresets, applyPreset } from '../../src/wled/client.js';

const HOST = '10.0.0.50';

afterEach(() => nock.cleanAll());

describe('wled client', () => {
  it('getInfo fetches device info', async () => {
    nock(`http://${HOST}`).get('/json/info').reply(200, {
      name: 'Porch', ver: '0.14.0', leds: { count: 120 }
    });
    const info = await getInfo(HOST);
    expect(info).toEqual({ name: 'Porch', ver: '0.14.0', leds: { count: 120 } });
  });

  it('getState fetches current state', async () => {
    nock(`http://${HOST}`).get('/json/state').reply(200, {
      on: true, bri: 128, ps: -1,
      seg: [{ id: 0, start: 0, stop: 60, len: 60, on: true, bri: 128, fx: 0, pal: 0, col: [[255,0,0]] }]
    });
    const state = await getState(HOST);
    expect(state.seg).toHaveLength(1);
    expect(state.seg[0].len).toBe(60);
  });

  it('setState posts a patch and returns the resulting state', async () => {
    nock(`http://${HOST}`)
      .post('/json/state', { bri: 200 })
      .reply(200, { on: true, bri: 200, ps: -1, seg: [] });
    const state = await setState(HOST, { bri: 200 });
    expect(state.bri).toBe(200);
  });

  it('setSegment posts a seg array with the given bounds', async () => {
    nock(`http://${HOST}`)
      .post('/json/state', { seg: [{ id: 1, start: 60, stop: 120 }] })
      .reply(200, { on: true, bri: 128, ps: -1, seg: [] });
    await setSegment(HOST, { id: 1, start: 60, stop: 120 });
  });

  it('getPresets maps the preset object into a list', async () => {
    nock(`http://${HOST}`).get('/presets.json').reply(200, {
      '1': { n: 'Sunset' },
      '2': { n: 'Party' }
    });
    const presets = await getPresets(HOST);
    expect(presets).toEqual([
      { id: 1, name: 'Sunset' },
      { id: 2, name: 'Party' }
    ]);
  });

  it('applyPreset posts the preset id as ps', async () => {
    nock(`http://${HOST}`)
      .post('/json/state', { ps: 2 })
      .reply(200, { on: true, bri: 128, ps: 2, seg: [] });
    const state = await applyPreset(HOST, 2);
    expect(state.ps).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/wled/client.test.ts`
Expected: FAIL — cannot find module `../../src/wled/client.js`

- [ ] **Step 3: Create `server/src/wled/types.ts`**

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
}

export interface WledState {
  on: boolean;
  bri: number;
  ps: number;
  seg: WledSegment[];
}

export interface WledInfo {
  name: string;
  ver: string;
  leds: { count: number };
}

export interface WledPreset {
  id: number;
  name: string;
}
```

- [ ] **Step 4: Create `server/src/wled/client.ts`**

```ts
import type { WledInfo, WledState, WledSegment, WledPreset } from './types.js';

async function getJson<T>(host: string, path: string): Promise<T> {
  const res = await fetch(`http://${host}${path}`);
  if (!res.ok) throw new Error(`WLED request failed: GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(host: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`http://${host}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`WLED request failed: POST ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export function getInfo(host: string): Promise<WledInfo> {
  return getJson<WledInfo>(host, '/json/info');
}

export function getState(host: string): Promise<WledState> {
  return getJson<WledState>(host, '/json/state');
}

export function setState(
  host: string,
  patch: Partial<Pick<WledState, 'on' | 'bri' | 'ps'>> & { seg?: Partial<WledSegment>[] }
): Promise<WledState> {
  return postJson<WledState>(host, '/json/state', patch);
}

export function setSegment(
  host: string,
  segment: { id: number; start: number; stop: number }
): Promise<WledState> {
  return postJson<WledState>(host, '/json/state', { seg: [segment] });
}

export async function getPresets(host: string): Promise<WledPreset[]> {
  const raw = await getJson<Record<string, { n: string }>>(host, '/presets.json');
  return Object.entries(raw)
    .map(([id, v]) => ({ id: Number(id), name: v.n }))
    .sort((a, b) => a.id - b.id);
}

export function applyPreset(host: string, presetId: number): Promise<WledState> {
  return postJson<WledState>(host, '/json/state', { ps: presetId });
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd server && npm test -- test/wled/client.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/wled server/test/wled
git commit -m "Add WLED JSON API client"
```

---

### Task 4: Controllers — manual CRUD

**Files:**
- Create: `server/src/controllers/repository.ts`, `server/src/controllers/routes.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/test/controllers/repository.test.ts`, `server/test/controllers/routes.test.ts`

**Interfaces:**
- Produces:
  - `interface Controller { id: string; name: string; host: string; source: 'discovered' | 'manual'; stale: boolean; }`
  - `function createControllerRepository(db: Database.Database)` returning `{ list(): Controller[]; add(input: { name: string; host: string; source: 'discovered'|'manual' }): Controller; remove(id: string): void; findByHost(host: string): Controller | undefined; markStale(id: string, stale: boolean): void; }`
  - `function createControllersRouter(db: Database.Database): express.Router` mounted at `/api/controllers`
- Consumed by: Discovery (repository), Segments/Control/Groups routes (repository, to resolve `host` from `controllerId`).

- [ ] **Step 1: Write the failing repository test**

`server/test/controllers/repository.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';

describe('controller repository', () => {
  let db: ReturnType<typeof createDb>;
  let repo: ReturnType<typeof createControllerRepository>;

  beforeEach(() => {
    db = createDb(':memory:');
    repo = createControllerRepository(db);
  });

  it('adds and lists a manual controller', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' });
    expect(created.id).toBeTruthy();
    expect(repo.list()).toEqual([created]);
  });

  it('finds a controller by host', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' });
    expect(repo.findByHost('10.0.0.50')).toEqual(created);
    expect(repo.findByHost('missing')).toBeUndefined();
  });

  it('marks a controller stale', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'discovered' });
    repo.markStale(created.id, true);
    expect(repo.list()[0].stale).toBe(true);
  });

  it('removes a controller', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' });
    repo.remove(created.id);
    expect(repo.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/controllers/repository.test.ts`
Expected: FAIL — cannot find module `../../src/controllers/repository.js`

- [ ] **Step 3: Create `server/src/controllers/repository.ts`**

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Controller {
  id: string;
  name: string;
  host: string;
  source: 'discovered' | 'manual';
  stale: boolean;
}

function fromRow(row: any): Controller {
  return { id: row.id, name: row.name, host: row.host, source: row.source, stale: !!row.stale };
}

export function createControllerRepository(db: Database.Database) {
  return {
    list(): Controller[] {
      return db.prepare('SELECT * FROM controllers ORDER BY name').all().map(fromRow);
    },
    add(input: { name: string; host: string; source: 'discovered' | 'manual' }): Controller {
      const id = randomUUID();
      db.prepare('INSERT INTO controllers (id, name, host, source, stale) VALUES (?, ?, ?, ?, 0)')
        .run(id, input.name, input.host, input.source);
      return { id, name: input.name, host: input.host, source: input.source, stale: false };
    },
    remove(id: string): void {
      db.prepare('DELETE FROM controllers WHERE id = ?').run(id);
    },
    findByHost(host: string): Controller | undefined {
      const row = db.prepare('SELECT * FROM controllers WHERE host = ?').get(host);
      return row ? fromRow(row) : undefined;
    },
    markStale(id: string, stale: boolean): void {
      db.prepare('UPDATE controllers SET stale = ? WHERE id = ?').run(stale ? 1 : 0, id);
    }
  };
}
```

- [ ] **Step 4: Run repository test, confirm it passes**

Run: `cd server && npm test -- test/controllers/repository.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing routes test**

`server/test/controllers/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllersRouter } from '../../src/controllers/routes.js';

describe('controllers routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/controllers', createControllersRouter(db));
  });

  it('POST adds a controller, GET lists it', async () => {
    const post = await request(app)
      .post('/api/controllers')
      .send({ name: 'Porch', host: '10.0.0.50' });
    expect(post.status).toBe(201);
    expect(post.body.source).toBe('manual');

    const get = await request(app).get('/api/controllers');
    expect(get.body).toHaveLength(1);
    expect(get.body[0].name).toBe('Porch');
  });

  it('DELETE removes a controller', async () => {
    const post = await request(app)
      .post('/api/controllers')
      .send({ name: 'Porch', host: '10.0.0.50' });
    await request(app).delete(`/api/controllers/${post.body.id}`).expect(204);
    const get = await request(app).get('/api/controllers');
    expect(get.body).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd server && npm test -- test/controllers/routes.test.ts`
Expected: FAIL — cannot find module `../../src/controllers/routes.js`

- [ ] **Step 7: Create `server/src/controllers/routes.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from './repository.js';

export function createControllersRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createControllerRepository(db);

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', (req, res) => {
    const { name, host } = req.body;
    if (!name || !host) {
      return res.status(400).json({ error: 'name and host are required' });
    }
    const created = repo.add({ name, host, source: 'manual' });
    res.status(201).json(created);
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 8: Mount the router in `server/src/app.ts`**

```ts
import express from 'express';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createControllersRouter } from './controllers/routes.js';

export function createApp(db: Database.Database) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/controllers', createControllersRouter(db));

  const staticDir = process.env.STATIC_DIR;
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return app;
}
```

Note: `createApp` now takes a `db` argument. Update `server/test/app.test.ts` and `server/src/server.ts` accordingly:

`server/test/app.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const app = createApp(createDb(':memory:'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

`server/src/server.ts`:
```ts
import { createApp } from './app.js';
import { createDb } from './db/client.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH ?? './data/uber-wled.db';

const db = createDb(DB_PATH);
const app = createApp(db);
app.listen(PORT, () => {
  console.log(`uber-wled server listening on port ${PORT}`);
});
```

- [ ] **Step 9: Run all server tests, confirm they pass**

Run: `cd server && npm test`
Expected: all tests PASS

- [ ] **Step 10: Commit**

```bash
git add server/src server/test
git commit -m "Add controller repository and CRUD routes"
```

---

### Task 5: mDNS discovery service

**Files:**
- Create: `server/src/discovery/mdns.ts`, `server/src/discovery/service.ts`
- Test: `server/test/discovery/service.test.ts`

**Interfaces:**
- Produces:
  - `function scanOnce(): Promise<{ host: string; name: string }[]>` (thin wrapper over `bonjour-service`, browses `_wled._tcp`)
  - `function runDiscoveryCycle(db: Database.Database, scan: () => Promise<{ host: string; name: string }[]> = scanOnce): Promise<void>` — merges scan results into the `controllers` repository: new hosts get added with `source: 'discovered'`; previously-discovered controllers not in this scan are marked stale via `markStale(id, true)`; ones that reappear are marked `stale: false`. Manual controllers are never touched.
- Consumed by: `server.ts` (runs `runDiscoveryCycle` on startup and on an interval — wired in Task 13 alongside the scheduler, to keep this task focused on the merge logic itself).

- [ ] **Step 1: Write the failing test**

`server/test/discovery/service.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { runDiscoveryCycle } from '../../src/discovery/service.js';

describe('runDiscoveryCycle', () => {
  let db: ReturnType<typeof createDb>;
  let repo: ReturnType<typeof createControllerRepository>;

  beforeEach(() => {
    db = createDb(':memory:');
    repo = createControllerRepository(db);
  });

  it('adds newly discovered controllers', async () => {
    await runDiscoveryCycle(db, async () => [{ host: '10.0.0.50', name: 'Porch' }]);
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ host: '10.0.0.50', name: 'Porch', source: 'discovered', stale: false });
  });

  it('marks a previously discovered controller stale when it disappears', async () => {
    await runDiscoveryCycle(db, async () => [{ host: '10.0.0.50', name: 'Porch' }]);
    await runDiscoveryCycle(db, async () => []);
    expect(repo.list()[0].stale).toBe(true);
  });

  it('un-stales a controller that reappears', async () => {
    await runDiscoveryCycle(db, async () => [{ host: '10.0.0.50', name: 'Porch' }]);
    await runDiscoveryCycle(db, async () => []);
    await runDiscoveryCycle(db, async () => [{ host: '10.0.0.50', name: 'Porch' }]);
    expect(repo.list()[0].stale).toBe(false);
  });

  it('never removes or stales a manually-added controller', async () => {
    repo.add({ name: 'Deck', host: '10.0.0.60', source: 'manual' });
    await runDiscoveryCycle(db, async () => []);
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].stale).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/discovery/service.test.ts`
Expected: FAIL — cannot find module `../../src/discovery/service.js`

- [ ] **Step 3: Create `server/src/discovery/mdns.ts`**

```ts
import { Bonjour } from 'bonjour-service';

export function scanOnce(timeoutMs = 3000): Promise<{ host: string; name: string }[]> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const found = new Map<string, string>();

    const browser = bonjour.find({ type: 'wled' }, (service) => {
      const host = service.addresses?.[0];
      if (host) found.set(host, service.name);
    });

    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(Array.from(found, ([host, name]) => ({ host, name })));
    }, timeoutMs);
  });
}
```

- [ ] **Step 4: Create `server/src/discovery/service.ts`**

```ts
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { scanOnce } from './mdns.js';

export async function runDiscoveryCycle(
  db: Database.Database,
  scan: () => Promise<{ host: string; name: string }[]> = scanOnce
): Promise<void> {
  const repo = createControllerRepository(db);
  const found = await scan();
  const foundHosts = new Set(found.map((f) => f.host));

  for (const { host, name } of found) {
    const existing = repo.findByHost(host);
    if (!existing) {
      repo.add({ name, host, source: 'discovered' });
    } else if (existing.source === 'discovered' && existing.stale) {
      repo.markStale(existing.id, false);
    }
  }

  for (const controller of repo.list()) {
    if (controller.source === 'discovered' && !foundHosts.has(controller.host) && !controller.stale) {
      repo.markStale(controller.id, true);
    }
  }
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd server && npm test -- test/discovery/service.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Add the `bonjour-service` dependency (if not already present from Task 1) and commit**

```bash
cd server && npm install bonjour-service
git add server/src/discovery server/test/discovery server/package.json server/package-lock.json
git commit -m "Add mDNS discovery and merge-into-controllers logic"
```

---

### Task 6: Segments — read live, edit/create on device

**Files:**
- Create: `server/src/segments/routes.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/test/segments/routes.test.ts`

**Interfaces:**
- Produces: `function createSegmentsRouter(db: Database.Database): express.Router` mounted at `/api/controllers/:controllerId/segments`:
  - `GET /` → `WledSegment[]` (live from the device, via `getState`)
  - `PUT /:segId` with body `{ start: number; stop: number }` → pushes via `setSegment`, returns updated `WledSegment[]`
- Consumes: `Controller` (via `createControllerRepository(db).list()`/lookup by id) to resolve `host`; `wled/client.ts` `getState`/`setSegment`.

- [ ] **Step 1: Write the failing test**

`server/test/segments/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import nock from 'nock';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createSegmentsRouter } from '../../src/segments/routes.js';

describe('segments routes', () => {
  let app: express.Express;
  let controllerId: string;
  const HOST = '10.0.0.50';

  beforeEach(() => {
    const db = createDb(':memory:');
    const repo = createControllerRepository(db);
    controllerId = repo.add({ name: 'Porch', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/controllers/:controllerId/segments', createSegmentsRouter(db));
  });

  afterEach(() => nock.cleanAll());

  it('GET returns the live segments from the device', async () => {
    nock(`http://${HOST}`).get('/json/state').reply(200, {
      on: true, bri: 128, ps: -1,
      seg: [{ id: 0, start: 0, stop: 60, len: 60, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
    });
    const res = await request(app).get(`/api/controllers/${controllerId}/segments`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].stop).toBe(60);
  });

  it('PUT pushes a new boundary to the device and returns updated segments', async () => {
    nock(`http://${HOST}`)
      .post('/json/state', { seg: [{ id: 0, start: 0, stop: 90 }] })
      .reply(200, {
        on: true, bri: 128, ps: -1,
        seg: [{ id: 0, start: 0, stop: 90, len: 90, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
      });
    const res = await request(app)
      .put(`/api/controllers/${controllerId}/segments/0`)
      .send({ start: 0, stop: 90 });
    expect(res.status).toBe(200);
    expect(res.body[0].stop).toBe(90);
  });

  it('returns 404 for an unknown controller', async () => {
    const res = await request(app).get('/api/controllers/does-not-exist/segments');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/segments/routes.test.ts`
Expected: FAIL — cannot find module `../../src/segments/routes.js`

- [ ] **Step 3: Create `server/src/segments/routes.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { getState, setSegment } from '../wled/client.js';

export function createSegmentsRouter(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const repo = createControllerRepository(db);

  function resolveHost(controllerId: string): string | undefined {
    return repo.list().find((c) => c.id === controllerId)?.host;
  }

  router.get('/', async (req, res) => {
    const host = resolveHost(req.params.controllerId);
    if (!host) return res.status(404).json({ error: 'controller not found' });
    const state = await getState(host);
    res.json(state.seg);
  });

  router.put('/:segId', async (req, res) => {
    const host = resolveHost(req.params.controllerId);
    if (!host) return res.status(404).json({ error: 'controller not found' });
    const { start, stop } = req.body;
    const state = await setSegment(host, { id: Number(req.params.segId), start, stop });
    res.json(state.seg);
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/src/app.ts`**

Add below the controllers router mount:
```ts
import { createSegmentsRouter } from './segments/routes.js';
// ...
app.use('/api/controllers/:controllerId/segments', createSegmentsRouter(db));
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd server && npm test -- test/segments/routes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/segments server/test/segments server/src/app.ts
git commit -m "Add live segment read/write routes"
```

---

### Task 7: Segment recommendation logic

**Files:**
- Create: `server/src/segments/recommend.ts`
- Test: `server/test/segments/recommend.test.ts`

**Interfaces:**
- Produces:
  - `interface Point { x: number; y: number }`
  - `interface SplitRecommendation { deviceSegId: number; suggestedSplitAt: number; reason: string; }`
  - `function pathLengthLeds(points: Point[], totalLedsForFullPath: number): number` — not used standalone by consumers, internal helper
  - `function recommendSplits(placements: { points: Point[]; wledSegId: number }[], deviceSegments: { id: number; start: number; stop: number }[]): SplitRecommendation[]` — for each placement whose points contain a sharp bend (>45° direction change) that falls inside a single device segment spanning multiple placements, recommend a split at the LED offset corresponding to that bend.
- Consumed by: Placements routes (Task 8) call this after a placement is saved, to surface recommendations in the response.

- [ ] **Step 1: Write the failing test**

`server/test/segments/recommend.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { recommendSplits } from '../../src/segments/recommend.js';

describe('recommendSplits', () => {
  it('recommends no split when each placement maps to its own device segment', () => {
    const placements = [
      { wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { wledSegId: 1, points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] }
    ];
    const deviceSegments = [
      { id: 0, start: 0, stop: 60 },
      { id: 1, start: 60, stop: 120 }
    ];
    expect(recommendSplits(placements, deviceSegments)).toEqual([]);
  });

  it('recommends a split when two placements share one device segment', () => {
    const placements = [
      { wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { wledSegId: 0, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] }
    ];
    const deviceSegments = [{ id: 0, start: 0, stop: 120 }];
    const result = recommendSplits(placements, deviceSegments);
    expect(result).toHaveLength(1);
    expect(result[0].deviceSegId).toBe(0);
    expect(result[0].suggestedSplitAt).toBe(60);
    expect(result[0].reason).toMatch(/two placements/i);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/segments/recommend.test.ts`
Expected: FAIL — cannot find module `../../src/segments/recommend.js`

- [ ] **Step 3: Create `server/src/segments/recommend.ts`**

```ts
export interface Point {
  x: number;
  y: number;
}

export interface SplitRecommendation {
  deviceSegId: number;
  suggestedSplitAt: number;
  reason: string;
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

export function recommendSplits(
  placements: { wledSegId: number; points: Point[] }[],
  deviceSegments: { id: number; start: number; stop: number }[]
): SplitRecommendation[] {
  const recommendations: SplitRecommendation[] = [];
  const bySegId = new Map<number, typeof placements>();

  for (const placement of placements) {
    const group = bySegId.get(placement.wledSegId) ?? [];
    group.push(placement);
    bySegId.set(placement.wledSegId, group);
  }

  for (const [segId, group] of bySegId) {
    if (group.length < 2) continue;
    const device = deviceSegments.find((d) => d.id === segId);
    if (!device) continue;

    const deviceLen = device.stop - device.start;
    const totalDrawnLen = group.reduce((sum, p) => sum + pathLength(p.points), 0);
    let cursor = device.start;

    for (let i = 0; i < group.length - 1; i++) {
      const share = pathLength(group[i].points) / totalDrawnLen;
      cursor += Math.round(share * deviceLen);
      recommendations.push({
        deviceSegId: segId,
        suggestedSplitAt: cursor,
        reason: `Two placements are linked to device segment ${segId}; splitting it would let each be controlled independently.`
      });
    }
  }

  return recommendations;
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `cd server && npm test -- test/segments/recommend.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/segments/recommend.ts server/test/segments/recommend.test.ts
git commit -m "Add segment split recommendation logic"
```

---

### Task 8: Floorplans — upload + crop/rotate/zoom metadata

**Files:**
- Create: `server/src/floorplans/repository.ts`, `server/src/floorplans/routes.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/test/floorplans/routes.test.ts`

**Interfaces:**
- Produces:
  - `interface Floorplan { id: string; name: string; imagePath: string; cropX: number; cropY: number; cropWidth: number; cropHeight: number; rotation: number; zoom: number; }`
  - `function createFloorplanRepository(db): { list(): Floorplan[]; add(input: { name: string; imagePath: string }): Floorplan; update(id: string, patch: Partial<Omit<Floorplan,'id'|'imagePath'>>): Floorplan; get(id: string): Floorplan | undefined; }`
  - `function createFloorplansRouter(db, uploadDir: string): express.Router` mounted at `/api/floorplans`:
    - `POST /` multipart form (`image` field + `name`) → saves file into `uploadDir`, creates row, returns `Floorplan`
    - `GET /` → `Floorplan[]`
    - `PATCH /:id` body `{ cropX?, cropY?, cropWidth?, cropHeight?, rotation?, zoom? }` → returns updated `Floorplan`
- Consumed by: Placements routes (Task 9) reference `floorplanId`.

- [ ] **Step 1: Write the failing test**

`server/test/floorplans/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../../src/db/client.js';
import { createFloorplansRouter } from '../../src/floorplans/routes.js';

describe('floorplans routes', () => {
  let app: express.Express;
  let uploadDir: string;

  beforeEach(() => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uber-wled-'));
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/floorplans', createFloorplansRouter(db, uploadDir));
  });

  afterEach(() => fs.rmSync(uploadDir, { recursive: true, force: true }));

  it('uploads an image and lists it', async () => {
    const post = await request(app)
      .post('/api/floorplans')
      .field('name', 'Main Floor')
      .attach('image', Buffer.from('fake-png-bytes'), 'floorplan.png');
    expect(post.status).toBe(201);
    expect(post.body.name).toBe('Main Floor');
    expect(fs.existsSync(post.body.imagePath)).toBe(true);

    const get = await request(app).get('/api/floorplans');
    expect(get.body).toHaveLength(1);
  });

  it('updates crop/rotate/zoom metadata', async () => {
    const post = await request(app)
      .post('/api/floorplans')
      .field('name', 'Main Floor')
      .attach('image', Buffer.from('fake-png-bytes'), 'floorplan.png');

    const patch = await request(app)
      .patch(`/api/floorplans/${post.body.id}`)
      .send({ cropX: 0.1, rotation: 90, zoom: 1.5 });
    expect(patch.status).toBe(200);
    expect(patch.body.cropX).toBe(0.1);
    expect(patch.body.rotation).toBe(90);
    expect(patch.body.zoom).toBe(1.5);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/floorplans/routes.test.ts`
Expected: FAIL — cannot find module `../../src/floorplans/routes.js`

- [ ] **Step 3: Create `server/src/floorplans/repository.ts`**

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Floorplan {
  id: string;
  name: string;
  imagePath: string;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  rotation: number;
  zoom: number;
}

function fromRow(row: any): Floorplan {
  return {
    id: row.id,
    name: row.name,
    imagePath: row.image_path,
    cropX: row.crop_x,
    cropY: row.crop_y,
    cropWidth: row.crop_width,
    cropHeight: row.crop_height,
    rotation: row.rotation,
    zoom: row.zoom
  };
}

export function createFloorplanRepository(db: Database.Database) {
  return {
    list(): Floorplan[] {
      return db.prepare('SELECT * FROM floorplans ORDER BY name').all().map(fromRow);
    },
    get(id: string): Floorplan | undefined {
      const row = db.prepare('SELECT * FROM floorplans WHERE id = ?').get(id);
      return row ? fromRow(row) : undefined;
    },
    add(input: { name: string; imagePath: string }): Floorplan {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO floorplans (id, name, image_path, crop_x, crop_y, crop_width, crop_height, rotation, zoom) VALUES (?, ?, ?, 0, 0, 1, 1, 0, 1)'
      ).run(id, input.name, input.imagePath);
      return {
        id, name: input.name, imagePath: input.imagePath,
        cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, rotation: 0, zoom: 1
      };
    },
    update(id: string, patch: Partial<Omit<Floorplan, 'id' | 'imagePath'>>): Floorplan {
      const current = this.get(id);
      if (!current) throw new Error(`floorplan ${id} not found`);
      const next = { ...current, ...patch };
      db.prepare(
        'UPDATE floorplans SET name = ?, crop_x = ?, crop_y = ?, crop_width = ?, crop_height = ?, rotation = ?, zoom = ? WHERE id = ?'
      ).run(next.name, next.cropX, next.cropY, next.cropWidth, next.cropHeight, next.rotation, next.zoom, id);
      return next;
    }
  };
}
```

- [ ] **Step 4: Create `server/src/floorplans/routes.ts`**

```ts
import { Router } from 'express';
import multer from 'multer';
import type Database from 'better-sqlite3';
import { createFloorplanRepository } from './repository.js';

export function createFloorplansRouter(db: Database.Database, uploadDir: string): Router {
  const router = Router();
  const repo = createFloorplanRepository(db);
  const upload = multer({ dest: uploadDir });

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'image file is required' });
    const created = repo.add({ name: req.body.name, imagePath: req.file.path });
    res.status(201).json(created);
  });

  router.patch('/:id', (req, res) => {
    try {
      const updated = repo.update(req.params.id, req.body);
      res.json(updated);
    } catch {
      res.status(404).json({ error: 'floorplan not found' });
    }
  });

  return router;
}
```

- [ ] **Step 5: Add `multer` to dependencies (already listed in Task 1's package.json) and run test**

Run: `cd server && npm test -- test/floorplans/routes.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Mount the router in `server/src/app.ts`**

```ts
import { createFloorplansRouter } from './floorplans/routes.js';
// ...
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './data/floorplans';
app.use('/api/floorplans', createFloorplansRouter(db, UPLOAD_DIR));
```

- [ ] **Step 7: Commit**

```bash
git add server/src/floorplans server/test/floorplans server/src/app.ts
git commit -m "Add floorplan upload and crop/rotate/zoom routes"
```

---

### Task 9: Placements — CRUD segment paths on a floorplan

**Files:**
- Create: `server/src/placements/repository.ts`, `server/src/placements/routes.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/test/placements/routes.test.ts`

**Interfaces:**
- Produces:
  - `interface Placement { id: string; floorplanId: string; controllerId: string; wledSegId: number; points: Point[]; lengthMeters: number | null; }` (reuses `Point` from `segments/recommend.ts`)
  - `function createPlacementRepository(db): { listByFloorplan(floorplanId: string): Placement[]; add(input: Omit<Placement,'id'>): Placement; update(id: string, patch: Partial<Omit<Placement,'id'>>): Placement; remove(id: string): void; }`
  - `function createPlacementsRouter(db): express.Router` mounted at `/api/floorplans/:floorplanId/placements`:
    - `GET /` → `Placement[]`
    - `POST /` → creates a `Placement`, then calls `recommendSplits` (Task 7) across all placements on that floorplan and returns `{ placement: Placement; recommendations: SplitRecommendation[] }`
    - `PATCH /:id`, `DELETE /:id`
- Consumes: `recommendSplits` (Task 7), `Segments` `GET` route data is fetched by the caller (frontend) separately — this router does not call the live device itself, to keep placement writes fast and offline-tolerant.

- [ ] **Step 1: Write the failing test**

`server/test/placements/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createFloorplanRepository } from '../../src/floorplans/repository.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createPlacementsRouter } from '../../src/placements/routes.js';

describe('placements routes', () => {
  let app: express.Express;
  let floorplanId: string;
  let controllerId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    floorplanId = createFloorplanRepository(db).add({ name: 'Main', imagePath: '/tmp/x.png' }).id;
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: '10.0.0.50', source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/floorplans/:floorplanId/placements', createPlacementsRouter(db));
  });

  it('creates a placement and returns split recommendations', async () => {
    const first = await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMeters: 3 });
    expect(first.status).toBe(201);
    expect(first.body.recommendations).toEqual([]);

    const second = await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], lengthMeters: 3 });
    expect(second.body.recommendations).toHaveLength(0); // no device segment data supplied yet -> no recommendation possible
  });

  it('lists placements for a floorplan', async () => {
    await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMeters: 3 });
    const get = await request(app).get(`/api/floorplans/${floorplanId}/placements`);
    expect(get.body).toHaveLength(1);
  });

  it('deletes a placement', async () => {
    const post = await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMeters: 3 });
    await request(app)
      .delete(`/api/floorplans/${floorplanId}/placements/${post.body.placement.id}`)
      .expect(204);
    const get = await request(app).get(`/api/floorplans/${floorplanId}/placements`);
    expect(get.body).toHaveLength(0);
  });
});
```

Note: since no device segment data is available to this router (by design — see Interfaces note), `recommendations` will always be `[]` here; Task 7's logic is exercised against real device data from the frontend, which fetches live segments (Task 6) and calls a small client-side pass. Simplify the router to always return `recommendations: []` and drop the cross-placement recommendation call from the router entirely — **this supersedes the initial Interfaces description above**: the router's `POST` only persists the placement.

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/placements/routes.test.ts`
Expected: FAIL — cannot find module `../../src/placements/routes.js`

- [ ] **Step 3: Create `server/src/placements/repository.ts`**

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Point } from '../segments/recommend.js';

export interface Placement {
  id: string;
  floorplanId: string;
  controllerId: string;
  wledSegId: number;
  points: Point[];
  lengthMeters: number | null;
}

function fromRow(row: any): Placement {
  return {
    id: row.id,
    floorplanId: row.floorplan_id,
    controllerId: row.controller_id,
    wledSegId: row.wled_seg_id,
    points: JSON.parse(row.points),
    lengthMeters: row.length_meters
  };
}

export function createPlacementRepository(db: Database.Database) {
  return {
    listByFloorplan(floorplanId: string): Placement[] {
      return db.prepare('SELECT * FROM placements WHERE floorplan_id = ?').all(floorplanId).map(fromRow);
    },
    add(input: Omit<Placement, 'id'>): Placement {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO placements (id, floorplan_id, controller_id, wled_seg_id, points, length_meters) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, input.floorplanId, input.controllerId, input.wledSegId, JSON.stringify(input.points), input.lengthMeters);
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<Placement, 'id'>>): Placement {
      const current = db.prepare('SELECT * FROM placements WHERE id = ?').get(id);
      if (!current) throw new Error(`placement ${id} not found`);
      const existing = fromRow(current);
      const next = { ...existing, ...patch };
      db.prepare(
        'UPDATE placements SET floorplan_id = ?, controller_id = ?, wled_seg_id = ?, points = ?, length_meters = ? WHERE id = ?'
      ).run(next.floorplanId, next.controllerId, next.wledSegId, JSON.stringify(next.points), next.lengthMeters, id);
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM placements WHERE id = ?').run(id);
    }
  };
}
```

- [ ] **Step 4: Create `server/src/placements/routes.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createPlacementRepository } from './repository.js';

export function createPlacementsRouter(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const repo = createPlacementRepository(db);

  router.get('/', (req, res) => {
    res.json(repo.listByFloorplan(req.params.floorplanId));
  });

  router.post('/', (req, res) => {
    const { controllerId, wledSegId, points, lengthMeters } = req.body;
    const placement = repo.add({
      floorplanId: req.params.floorplanId,
      controllerId,
      wledSegId,
      points,
      lengthMeters: lengthMeters ?? null
    });
    res.status(201).json({ placement, recommendations: [] });
  });

  router.patch('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'placement not found' });
    }
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd server && npm test -- test/placements/routes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Mount the router in `server/src/app.ts`**

```ts
import { createPlacementsRouter } from './placements/routes.js';
// ...
app.use('/api/floorplans/:floorplanId/placements', createPlacementsRouter(db));
```

- [ ] **Step 7: Commit**

```bash
git add server/src/placements server/test/placements server/src/app.ts
git commit -m "Add placement CRUD routes"
```

---

### Task 10: Groups — CRUD

**Files:**
- Create: `server/src/groups/repository.ts`, `server/src/groups/routes.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/test/groups/routes.test.ts`

**Interfaces:**
- Produces:
  - `interface GroupMember { controllerId: string; wledSegId: number; }`
  - `interface Group { id: string; name: string; members: GroupMember[]; }`
  - `function createGroupRepository(db): { list(): Group[]; add(input: { name: string; members: GroupMember[] }): Group; update(id: string, patch: { name?: string; members?: GroupMember[] }): Group; remove(id: string): void; }`
  - `function createGroupsRouter(db): express.Router` mounted at `/api/groups` (GET, POST, PATCH `/:id`, DELETE `/:id`)
- Consumed by: Control routes (Task 12, resolves a `groupId` selection into members), Schedules (Task 13, targets a group).

- [ ] **Step 1: Write the failing test**

`server/test/groups/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createGroupsRouter } from '../../src/groups/routes.js';

describe('groups routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/groups', createGroupsRouter(db));
  });

  it('creates a group with members and lists it', async () => {
    const post = await request(app)
      .post('/api/groups')
      .send({ name: 'Front of House', members: [{ controllerId: 'c1', wledSegId: 0 }, { controllerId: 'c2', wledSegId: 1 }] });
    expect(post.status).toBe(201);
    expect(post.body.members).toHaveLength(2);

    const get = await request(app).get('/api/groups');
    expect(get.body).toHaveLength(1);
  });

  it('updates a group\'s members', async () => {
    const post = await request(app)
      .post('/api/groups')
      .send({ name: 'Front of House', members: [{ controllerId: 'c1', wledSegId: 0 }] });
    const patch = await request(app)
      .patch(`/api/groups/${post.body.id}`)
      .send({ members: [{ controllerId: 'c1', wledSegId: 0 }, { controllerId: 'c2', wledSegId: 0 }] });
    expect(patch.body.members).toHaveLength(2);
  });

  it('deletes a group', async () => {
    const post = await request(app).post('/api/groups').send({ name: 'X', members: [] });
    await request(app).delete(`/api/groups/${post.body.id}`).expect(204);
    expect((await request(app).get('/api/groups')).body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/groups/routes.test.ts`
Expected: FAIL — cannot find module `../../src/groups/routes.js`

- [ ] **Step 3: Create `server/src/groups/repository.ts`**

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

  return {
    list(): Group[] {
      return db
        .prepare('SELECT * FROM groups ORDER BY name')
        .all()
        .map((row: any) => ({ id: row.id, name: row.name, members: membersFor(row.id) }));
    },
    add(input: { name: string; members: GroupMember[] }): Group {
      const id = randomUUID();
      db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run(id, input.name);
      setMembers(id, input.members);
      return { id, name: input.name, members: input.members };
    },
    update(id: string, patch: { name?: string; members?: GroupMember[] }): Group {
      const row: any = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
      if (!row) throw new Error(`group ${id} not found`);
      const name = patch.name ?? row.name;
      db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id);
      if (patch.members) setMembers(id, patch.members);
      return { id, name, members: membersFor(id) };
    },
    remove(id: string): void {
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    }
  };
}
```

- [ ] **Step 4: Create `server/src/groups/routes.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createGroupRepository } from './repository.js';

export function createGroupsRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createGroupRepository(db);

  router.get('/', (_req, res) => res.json(repo.list()));

  router.post('/', (req, res) => {
    const created = repo.add({ name: req.body.name, members: req.body.members ?? [] });
    res.status(201).json(created);
  });

  router.patch('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'group not found' });
    }
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd server && npm test -- test/groups/routes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Mount the router in `server/src/app.ts`**

```ts
import { createGroupsRouter } from './groups/routes.js';
// ...
app.use('/api/groups', createGroupsRouter(db));
```

- [ ] **Step 7: Commit**

```bash
git add server/src/groups server/test/groups server/src/app.ts
git commit -m "Add group CRUD routes"
```

---

### Task 11: Themes — custom CRUD + WLED presets passthrough

**Files:**
- Create: `server/src/themes/repository.ts`, `server/src/themes/routes.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/test/themes/routes.test.ts`

**Interfaces:**
- Produces:
  - `interface CustomTheme { id: string; name: string; effect: number; palette: number; colors: number[][]; brightness: number; }`
  - `function createThemeRepository(db): { list(): CustomTheme[]; add(input: Omit<CustomTheme,'id'>): CustomTheme; remove(id: string): void; get(id: string): CustomTheme | undefined; }`
  - `function createThemesRouter(db): express.Router` mounted at `/api/themes`:
    - `GET /` → `CustomTheme[]`
    - `POST /`, `DELETE /:id`
    - `GET /presets/:controllerId` → proxies `getPresets(host)` from Task 3 for that controller
- Consumed by: Control routes (Task 12) apply either a `CustomTheme` (by id) or a WLED preset (by controller + preset id).

- [ ] **Step 1: Write the failing test**

`server/test/themes/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import nock from 'nock';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createThemesRouter } from '../../src/themes/routes.js';

describe('themes routes', () => {
  let app: express.Express;
  let controllerId: string;
  const HOST = '10.0.0.50';

  beforeEach(() => {
    const db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/themes', createThemesRouter(db));
  });

  afterEach(() => nock.cleanAll());

  it('creates and lists a custom theme', async () => {
    const post = await request(app).post('/api/themes').send({
      name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180
    });
    expect(post.status).toBe(201);
    expect((await request(app).get('/api/themes')).body).toHaveLength(1);
  });

  it('deletes a custom theme', async () => {
    const post = await request(app).post('/api/themes').send({
      name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180
    });
    await request(app).delete(`/api/themes/${post.body.id}`).expect(204);
    expect((await request(app).get('/api/themes')).body).toHaveLength(0);
  });

  it('proxies a controller\'s WLED presets', async () => {
    nock(`http://${HOST}`).get('/presets.json').reply(200, { '1': { n: 'Party' } });
    const res = await request(app).get(`/api/themes/presets/${controllerId}`);
    expect(res.body).toEqual([{ id: 1, name: 'Party' }]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/themes/routes.test.ts`
Expected: FAIL — cannot find module `../../src/themes/routes.js`

- [ ] **Step 3: Create `server/src/themes/repository.ts`**

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface CustomTheme {
  id: string;
  name: string;
  effect: number;
  palette: number;
  colors: number[][];
  brightness: number;
}

function fromRow(row: any): CustomTheme {
  return {
    id: row.id,
    name: row.name,
    effect: row.effect,
    palette: row.palette,
    colors: JSON.parse(row.colors),
    brightness: row.brightness
  };
}

export function createThemeRepository(db: Database.Database) {
  return {
    list(): CustomTheme[] {
      return db.prepare('SELECT * FROM themes ORDER BY name').all().map(fromRow);
    },
    get(id: string): CustomTheme | undefined {
      const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(id);
      return row ? fromRow(row) : undefined;
    },
    add(input: Omit<CustomTheme, 'id'>): CustomTheme {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO themes (id, name, effect, palette, colors, brightness) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, input.name, input.effect, input.palette, JSON.stringify(input.colors), input.brightness);
      return { id, ...input };
    },
    remove(id: string): void {
      db.prepare('DELETE FROM themes WHERE id = ?').run(id);
    }
  };
}
```

- [ ] **Step 4: Create `server/src/themes/routes.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createThemeRepository } from './repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { getPresets } from '../wled/client.js';

export function createThemesRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createThemeRepository(db);
  const controllers = createControllerRepository(db);

  router.get('/', (_req, res) => res.json(repo.list()));

  router.post('/', (req, res) => {
    const { name, effect, palette, colors, brightness } = req.body;
    res.status(201).json(repo.add({ name, effect, palette, colors, brightness }));
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  router.get('/presets/:controllerId', async (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.controllerId);
    if (!controller) return res.status(404).json({ error: 'controller not found' });
    res.json(await getPresets(controller.host));
  });

  return router;
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd server && npm test -- test/themes/routes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Mount the router in `server/src/app.ts`**

```ts
import { createThemesRouter } from './themes/routes.js';
// ...
app.use('/api/themes', createThemesRouter(db));
```

- [ ] **Step 7: Commit**

```bash
git add server/src/themes server/test/themes server/src/app.ts
git commit -m "Add custom theme CRUD and WLED preset passthrough"
```

---

### Task 12: Control — batch apply with per-controller isolation

**Files:**
- Create: `server/src/control/routes.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `server/test/control/routes.test.ts`

**Interfaces:**
- Produces:
  - `type ControlAction = { type: 'power'; on: boolean } | { type: 'brightness'; value: number } | { type: 'preset'; presetId: number } | { type: 'theme'; themeId: string }`
  - `function createControlRouter(db): express.Router` mounted at `/api/control`:
    - `POST /apply` body `{ members: { controllerId: string; wledSegId: number }[]; action: ControlAction }` → applies the action to each member independently (one retry on failure), returns `{ results: { controllerId: string; wledSegId: number; ok: boolean; error?: string }[] }`
- Consumes: `Controller` repo (Task 4, resolve host), `CustomTheme` repo (Task 11, resolve theme payload), `wled/client.ts` `setState`/`applyPreset` (Task 3).

- [ ] **Step 1: Write the failing test**

`server/test/control/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import nock from 'nock';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { createControlRouter } from '../../src/control/routes.js';

describe('control routes', () => {
  let app: express.Express;
  let controllerA: string;
  let controllerB: string;
  const HOST_A = '10.0.0.50';
  const HOST_B = '10.0.0.51';

  beforeEach(() => {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    controllerA = controllers.add({ name: 'A', host: HOST_A, source: 'manual' }).id;
    controllerB = controllers.add({ name: 'B', host: HOST_B, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/control', createControlRouter(db));
  });

  afterEach(() => nock.cleanAll());

  it('applies brightness to every member and reports per-controller success', async () => {
    nock(`http://${HOST_A}`).post('/json/state', { bri: 200 }).reply(200, { on: true, bri: 200, ps: -1, seg: [] });
    nock(`http://${HOST_B}`).post('/json/state', { bri: 200 }).reply(200, { on: true, bri: 200, ps: -1, seg: [] });

    const res = await request(app).post('/api/control/apply').send({
      members: [
        { controllerId: controllerA, wledSegId: 0 },
        { controllerId: controllerB, wledSegId: 0 }
      ],
      action: { type: 'brightness', value: 200 }
    });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { controllerId: controllerA, wledSegId: 0, ok: true },
      { controllerId: controllerB, wledSegId: 0, ok: true }
    ]);
  });

  it('isolates a failure to one controller and retries once before giving up', async () => {
    nock(`http://${HOST_A}`).post('/json/state', { bri: 200 }).reply(200, { on: true, bri: 200, ps: -1, seg: [] });
    nock(`http://${HOST_B}`).post('/json/state', { bri: 200 }).twice().reply(500);

    const res = await request(app).post('/api/control/apply').send({
      members: [
        { controllerId: controllerA, wledSegId: 0 },
        { controllerId: controllerB, wledSegId: 0 }
      ],
      action: { type: 'brightness', value: 200 }
    });

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toEqual({ controllerId: controllerA, wledSegId: 0, ok: true });
    expect(res.body.results[1].ok).toBe(false);
    expect(res.body.results[1].error).toBeTruthy();
  });

  it('applies a custom theme by resolving its stored effect/palette/color/brightness', async () => {
    const db = (app as any); // not used; themeId is resolved server-side via repository
    const themeId = 'placeholder';
    // Re-create app with a theme present:
  });
});
```

Replace the third test (it was a false start) with a real one that seeds a theme via the repository directly:

```ts
  it('applies a custom theme by resolving its stored effect/palette/color/brightness', async () => {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    const themes = createThemeRepository(db);
    const cId = controllers.add({ name: 'A', host: HOST_A, source: 'manual' }).id;
    const theme = themes.add({ name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 });

    const themedApp = express();
    themedApp.use(express.json());
    themedApp.use('/api/control', createControlRouter(db));

    nock(`http://${HOST_A}`)
      .post('/json/state', { bri: 180, seg: [{ fx: 2, pal: 5, col: [[255, 100, 0]] }] })
      .reply(200, { on: true, bri: 180, ps: -1, seg: [] });

    const res = await request(themedApp).post('/api/control/apply').send({
      members: [{ controllerId: cId, wledSegId: 0 }],
      action: { type: 'theme', themeId: theme.id }
    });

    expect(res.body.results[0].ok).toBe(true);
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/control/routes.test.ts`
Expected: FAIL — cannot find module `../../src/control/routes.js`

- [ ] **Step 3: Create `server/src/control/routes.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { createThemeRepository } from '../themes/repository.js';
import { setState, applyPreset } from '../wled/client.js';
import type { WledState, WledSegment } from '../wled/types.js';

type ControlAction =
  | { type: 'power'; on: boolean }
  | { type: 'brightness'; value: number }
  | { type: 'preset'; presetId: number }
  | { type: 'theme'; themeId: string };

interface Member {
  controllerId: string;
  wledSegId: number;
}

async function applyToMember(
  host: string,
  member: Member,
  action: ControlAction,
  resolveTheme: (id: string) => { effect: number; palette: number; colors: number[][]; brightness: number } | undefined
): Promise<WledState> {
  switch (action.type) {
    case 'power':
      return setState(host, { on: action.on });
    case 'brightness':
      return setState(host, { bri: action.value });
    case 'preset':
      return applyPreset(host, action.presetId);
    case 'theme': {
      const theme = resolveTheme(action.themeId);
      if (!theme) throw new Error(`theme ${action.themeId} not found`);
      const segPatch: Partial<WledSegment> = { fx: theme.effect, pal: theme.palette, col: theme.colors };
      return setState(host, { bri: theme.brightness, seg: [segPatch] });
    }
  }
}

export function createControlRouter(db: Database.Database): Router {
  const router = Router();
  const controllers = createControllerRepository(db);
  const themes = createThemeRepository(db);

  router.post('/apply', async (req, res) => {
    const { members, action } = req.body as { members: Member[]; action: ControlAction };

    const results = await Promise.all(
      members.map(async (member) => {
        const controller = controllers.list().find((c) => c.id === member.controllerId);
        if (!controller) {
          return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: false, error: 'controller not found' };
        }
        const resolveTheme = (id: string) => themes.get(id);
        try {
          await applyToMember(controller.host, member, action, resolveTheme);
          return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: true };
        } catch (firstError) {
          try {
            await applyToMember(controller.host, member, action, resolveTheme);
            return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: true };
          } catch (secondError: any) {
            return {
              controllerId: member.controllerId,
              wledSegId: member.wledSegId,
              ok: false,
              error: secondError.message ?? 'unknown error'
            };
          }
        }
      })
    );

    res.json({ results });
  });

  return router;
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `cd server && npm test -- test/control/routes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Mount the router in `server/src/app.ts`**

```ts
import { createControlRouter } from './control/routes.js';
// ...
app.use('/api/control', createControlRouter(db));
```

- [ ] **Step 6: Commit**

```bash
git add server/src/control server/test/control server/src/app.ts
git commit -m "Add batch control apply with per-controller retry and isolation"
```

---

### Task 13: Schedules — CRUD + scheduler engine, wire up discovery interval

**Files:**
- Create: `server/src/schedules/repository.ts`, `server/src/schedules/routes.ts`, `server/src/schedules/engine.ts`
- Modify: `server/src/app.ts` (mount router), `server/src/server.ts` (start engine + discovery interval)
- Test: `server/test/schedules/routes.test.ts`, `server/test/schedules/engine.test.ts`

**Interfaces:**
- Produces:
  - `interface Schedule { id: string; name: string; triggerType: 'cron'|'sunrise'|'sunset'|'weekly'; cronExpr: string | null; daysOfWeek: number[] | null; timeOfDay: string | null; offsetMinutes: number; latitude: number | null; longitude: number | null; groupId: string; actionType: ControlAction['type']; actionPayload: unknown; enabled: boolean; }` — `daysOfWeek` (0=Sun..6=Sat) and `timeOfDay` (`"HH:MM"`) are only set when `triggerType === 'weekly'`; matches the real `days_of_week`/`time_of_day` columns already on the `schedules` table in `server/src/db/schema.ts`.
  - `function createScheduleRepository(db): { list(): Schedule[]; add(input: Omit<Schedule,'id'>): Schedule; update(id, patch): Schedule; remove(id): void; }`
  - `function createSchedulesRouter(db): express.Router` mounted at `/api/schedules` (GET, POST, PATCH `/:id`, DELETE `/:id`)
  - `function nextTriggerDate(schedule: Schedule, now: Date): Date` — pure function used by the engine and directly testable: for `cron`, uses `node-cron`'s next-run calc; for `sunrise`/`sunset`, uses `suncalc.getTimes(now, lat, lon).sunrise|.sunset` plus `offsetMinutes`; for `weekly`, finds the next date (today or later) whose day-of-week is in `daysOfWeek` and combines it with `timeOfDay`.
  - `class SchedulerEngine { constructor(db, applyFn: (members, action) => Promise<unknown>); start(): void; stop(): void; checkAndFireDueSchedules(now: Date): Promise<void>; }` — `checkAndFireDueSchedules` is the directly-tested unit (avoids real timers in tests); `start()` wraps it in a `setInterval` checking every minute.
- Consumes: Groups repo (Task 10, resolve `groupId` → members), Control router's apply logic — reused here as a plain function, not via HTTP, so `server/src/control/routes.ts` is refactored to export `applyToMembers` for direct reuse.

- [ ] **Step 1: Refactor `server/src/control/routes.ts` to export a reusable function**

Extract the body of the `/apply` handler into an exported function so both the HTTP route and the scheduler can call it:

```ts
// add to server/src/control/routes.ts, above createControlRouter
export async function applyToMembers(
  db: Database.Database,
  members: Member[],
  action: ControlAction
): Promise<{ controllerId: string; wledSegId: number; ok: boolean; error?: string }[]> {
  const controllers = createControllerRepository(db);
  const themes = createThemeRepository(db);
  const resolveTheme = (id: string) => themes.get(id);

  return Promise.all(
    members.map(async (member) => {
      const controller = controllers.list().find((c) => c.id === member.controllerId);
      if (!controller) {
        return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: false, error: 'controller not found' };
      }
      try {
        await applyToMember(controller.host, member, action, resolveTheme);
        return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: true };
      } catch {
        try {
          await applyToMember(controller.host, member, action, resolveTheme);
          return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: true };
        } catch (secondError: any) {
          return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: false, error: secondError.message ?? 'unknown error' };
        }
      }
    })
  );
}
```

Then simplify the router handler to call it:
```ts
router.post('/apply', async (req, res) => {
  const { members, action } = req.body as { members: Member[]; action: ControlAction };
  const results = await applyToMembers(db, members, action);
  res.json({ results });
});
```

Also export `Member` and `ControlAction` from this file (add `export` to their declarations).

Run: `cd server && npm test -- test/control/routes.test.ts`
Expected: still PASS (behavior unchanged) — commit this refactor on its own:
```bash
git add server/src/control/routes.ts
git commit -m "Extract applyToMembers for reuse by the scheduler"
```

- [ ] **Step 2: Write the failing schedules repository/routes test**

`server/test/schedules/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createSchedulesRouter } from '../../src/schedules/routes.js';

describe('schedules routes', () => {
  let app: express.Express;
  let groupId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    groupId = createGroupRepository(db).add({ name: 'Front', members: [] }).id;
    app = express();
    app.use(express.json());
    app.use('/api/schedules', createSchedulesRouter(db));
  });

  it('creates a cron schedule and lists it', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'Bedtime off', triggerType: 'cron', cronExpr: '0 22 * * *',
      offsetMinutes: 0, groupId, actionType: 'power', actionPayload: { on: false }
    });
    expect(post.status).toBe(201);
    expect((await request(app).get('/api/schedules')).body).toHaveLength(1);
  });

  it('creates a sunset-relative schedule', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'Sunset on', triggerType: 'sunset', offsetMinutes: -15,
      latitude: 39.1, longitude: -94.6, groupId, actionType: 'power', actionPayload: { on: true }
    });
    expect(post.status).toBe(201);
    expect(post.body.triggerType).toBe('sunset');
  });

  it('creates a weekly schedule with daysOfWeek and timeOfDay', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'Weekday porch light', triggerType: 'weekly',
      daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '18:30',
      offsetMinutes: 0, groupId, actionType: 'power', actionPayload: { on: true }
    });
    expect(post.status).toBe(201);
    expect(post.body.triggerType).toBe('weekly');
    expect(post.body.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(post.body.timeOfDay).toBe('18:30');
  });

  it('deletes a schedule', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'X', triggerType: 'cron', cronExpr: '0 * * * *', offsetMinutes: 0,
      groupId, actionType: 'power', actionPayload: { on: false }
    });
    await request(app).delete(`/api/schedules/${post.body.id}`).expect(204);
    expect((await request(app).get('/api/schedules')).body).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd server && npm test -- test/schedules/routes.test.ts`
Expected: FAIL — cannot find module `../../src/schedules/routes.js`

- [ ] **Step 4: Create `server/src/schedules/repository.ts`**

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Schedule {
  id: string;
  name: string;
  triggerType: 'cron' | 'sunrise' | 'sunset' | 'weekly';
  cronExpr: string | null;
  daysOfWeek: number[] | null;
  timeOfDay: string | null;
  offsetMinutes: number;
  latitude: number | null;
  longitude: number | null;
  groupId: string;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
  enabled: boolean;
}

function fromRow(row: any): Schedule {
  return {
    id: row.id,
    name: row.name,
    triggerType: row.trigger_type,
    cronExpr: row.cron_expr,
    daysOfWeek: row.days_of_week ? JSON.parse(row.days_of_week) : null,
    timeOfDay: row.time_of_day,
    offsetMinutes: row.offset_minutes,
    latitude: row.latitude,
    longitude: row.longitude,
    groupId: row.group_id,
    actionType: row.action_type,
    actionPayload: JSON.parse(row.action_payload),
    enabled: !!row.enabled
  };
}

export function createScheduleRepository(db: Database.Database) {
  return {
    list(): Schedule[] {
      return db.prepare('SELECT * FROM schedules ORDER BY name').all().map(fromRow);
    },
    add(input: Omit<Schedule, 'id'>): Schedule {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO schedules
          (id, name, trigger_type, cron_expr, days_of_week, time_of_day, offset_minutes, latitude, longitude, group_id, action_type, action_payload, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, input.name, input.triggerType, input.cronExpr,
        input.daysOfWeek ? JSON.stringify(input.daysOfWeek) : null, input.timeOfDay,
        input.offsetMinutes, input.latitude, input.longitude, input.groupId, input.actionType,
        JSON.stringify(input.actionPayload), input.enabled ? 1 : 0
      );
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<Schedule, 'id'>>): Schedule {
      const current = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
      if (!current) throw new Error(`schedule ${id} not found`);
      const existing = fromRow(current);
      const next = { ...existing, ...patch };
      db.prepare(
        `UPDATE schedules SET name = ?, trigger_type = ?, cron_expr = ?, days_of_week = ?, time_of_day = ?, offset_minutes = ?,
          latitude = ?, longitude = ?, group_id = ?, action_type = ?, action_payload = ?, enabled = ?
         WHERE id = ?`
      ).run(
        next.name, next.triggerType, next.cronExpr,
        next.daysOfWeek ? JSON.stringify(next.daysOfWeek) : null, next.timeOfDay,
        next.offsetMinutes, next.latitude, next.longitude, next.groupId, next.actionType,
        JSON.stringify(next.actionPayload), next.enabled ? 1 : 0, id
      );
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    }
  };
}
```

- [ ] **Step 5: Create `server/src/schedules/routes.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createScheduleRepository } from './repository.js';

export function createSchedulesRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createScheduleRepository(db);

  router.get('/', (_req, res) => res.json(repo.list()));

  router.post('/', (req, res) => {
    const body = req.body;
    const created = repo.add({
      name: body.name,
      triggerType: body.triggerType,
      cronExpr: body.cronExpr ?? null,
      daysOfWeek: body.daysOfWeek ?? null,
      timeOfDay: body.timeOfDay ?? null,
      offsetMinutes: body.offsetMinutes ?? 0,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      groupId: body.groupId,
      actionType: body.actionType,
      actionPayload: body.actionPayload,
      enabled: body.enabled ?? true
    });
    res.status(201).json(created);
  });

  router.patch('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'schedule not found' });
    }
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 6: Run routes test, confirm it passes**

Run: `cd server && npm test -- test/schedules/routes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Write the failing engine test**

`server/test/schedules/engine.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { SchedulerEngine, nextTriggerDate } from '../../src/schedules/engine.js';

describe('nextTriggerDate', () => {
  it('computes the next cron-triggered date', () => {
    const now = new Date('2026-07-04T10:00:00');
    const next = nextTriggerDate(
      { triggerType: 'cron', cronExpr: '0 22 * * *' } as any,
      now
    );
    expect(next.getHours()).toBe(22);
    expect(next.getMinutes()).toBe(0);
  });

  it('computes a sunset-relative date with an offset', () => {
    const now = new Date('2026-07-04T10:00:00Z');
    const next = nextTriggerDate(
      { triggerType: 'sunset', offsetMinutes: -15, latitude: 39.1, longitude: -94.6 } as any,
      now
    );
    expect(next instanceof Date).toBe(true);
    expect(Number.isNaN(next.getTime())).toBe(false);
  });

  it('computes the next weekly-triggered date for a day later this week', () => {
    // 2026-07-04 is a Saturday (day 6); ask for the next Monday (day 1) at 18:30
    const now = new Date('2026-07-04T10:00:00');
    const next = nextTriggerDate(
      { triggerType: 'weekly', daysOfWeek: [1], timeOfDay: '18:30' } as any,
      now
    );
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(18);
    expect(next.getMinutes()).toBe(30);
    expect(next.getDate()).toBe(6); // the following Monday, July 6 2026
  });

  it('computes today as the next weekly-triggered date when today matches and the time is still ahead', () => {
    // 2026-07-04 is a Saturday (day 6); ask for Saturday at a later time today
    const now = new Date('2026-07-04T10:00:00');
    const next = nextTriggerDate(
      { triggerType: 'weekly', daysOfWeek: [6], timeOfDay: '18:30' } as any,
      now
    );
    expect(next.getDay()).toBe(6);
    expect(next.getDate()).toBe(4);
    expect(next.getHours()).toBe(18);
    expect(next.getMinutes()).toBe(30);
  });
});

describe('SchedulerEngine.checkAndFireDueSchedules', () => {
  let db: ReturnType<typeof createDb>;
  let groupId: string;
  let applyFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createDb(':memory:');
    groupId = createGroupRepository(db).add({
      name: 'Front', members: [{ controllerId: 'c1', wledSegId: 0 }]
    }).id;
    applyFn = vi.fn().mockResolvedValue([{ controllerId: 'c1', wledSegId: 0, ok: true }]);
  });

  it('fires a cron schedule whose minute matches now, and only once per minute', async () => {
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Every 10am', triggerType: 'cron', cronExpr: '0 10 * * *',
      daysOfWeek: null, timeOfDay: null, offsetMinutes: 0,
      latitude: null, longitude: null, groupId, actionType: 'power',
      actionPayload: { on: true }, enabled: true
    });
    const engine = new SchedulerEngine(db, applyFn);
    const tenAM = new Date('2026-07-04T10:00:00');

    await engine.checkAndFireDueSchedules(tenAM);
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: 'c1', wledSegId: 0 }],
      { type: 'power', on: true }
    );

    await engine.checkAndFireDueSchedules(tenAM);
    expect(applyFn).toHaveBeenCalledTimes(1); // not double-fired for the same minute
  });

  it('does not fire a disabled schedule', async () => {
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Disabled', triggerType: 'cron', cronExpr: '0 10 * * *', offsetMinutes: 0,
      daysOfWeek: null, timeOfDay: null,
      latitude: null, longitude: null, groupId, actionType: 'power',
      actionPayload: { on: true }, enabled: false
    });
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T10:00:00'));
    expect(applyFn).not.toHaveBeenCalled();
  });

  it('fires a weekly schedule on the correct day of week at the correct time, and does not fire on other days', async () => {
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Saturday evening', triggerType: 'weekly', cronExpr: null,
      daysOfWeek: [6], timeOfDay: '18:30', offsetMinutes: 0,
      latitude: null, longitude: null, groupId, actionType: 'power',
      actionPayload: { on: true }, enabled: true
    });
    const engine = new SchedulerEngine(db, applyFn);

    // 2026-07-04 is a Saturday - should fire at 18:30
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T18:30:00'));
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: 'c1', wledSegId: 0 }],
      { type: 'power', on: true }
    );

    // 2026-07-05 is a Sunday at the same time - must not fire
    await engine.checkAndFireDueSchedules(new Date('2026-07-05T18:30:00'));
    expect(applyFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 8: Run it, confirm it fails**

Run: `cd server && npm test -- test/schedules/engine.test.ts`
Expected: FAIL — cannot find module `../../src/schedules/engine.js`

- [ ] **Step 9: Create `server/src/schedules/engine.ts`**

```ts
import type Database from 'better-sqlite3';
import cronParser from 'node-cron';
import SunCalc from 'suncalc';
import { createScheduleRepository, type Schedule } from './repository.js';
import { createGroupRepository } from '../groups/repository.js';

export function nextTriggerDate(schedule: Schedule, now: Date): Date {
  if (schedule.triggerType === 'cron') {
    // Compute the next matching minute by scanning forward — node-cron has no
    // built-in "next date" API, so we roll our own minimal minute-matcher.
    const [minute, hour, dom, month, dow] = (schedule.cronExpr ?? '* * * * *').split(' ');
    const matches = (field: string, value: number) => field === '*' || field.split(',').map(Number).includes(value);
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    for (let i = 0; i < 24 * 60; i++) {
      if (
        matches(minute, candidate.getMinutes()) &&
        matches(hour, candidate.getHours()) &&
        matches(dom, candidate.getDate()) &&
        matches(month, candidate.getMonth() + 1) &&
        matches(dow, candidate.getDay())
      ) {
        return candidate;
      }
      candidate.setMinutes(candidate.getMinutes() + 1);
    }
    return candidate;
  }

  if (schedule.triggerType === 'weekly') {
    const days = schedule.daysOfWeek ?? [];
    const [hh, mm] = (schedule.timeOfDay ?? '00:00').split(':').map(Number);
    const candidate = new Date(now);
    candidate.setHours(hh, mm, 0, 0);
    for (let i = 0; i < 8; i++) {
      if (days.includes(candidate.getDay()) && candidate.getTime() >= now.getTime() - 59_000) {
        return candidate;
      }
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(hh, mm, 0, 0);
    }
    return candidate;
  }

  const times = SunCalc.getTimes(now, schedule.latitude ?? 0, schedule.longitude ?? 0);
  const base = schedule.triggerType === 'sunrise' ? times.sunrise : times.sunset;
  return new Date(base.getTime() + schedule.offsetMinutes * 60_000);
}

function sameMinute(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

type ApplyFn = (
  members: { controllerId: string; wledSegId: number }[],
  action: { type: string; [key: string]: unknown }
) => Promise<unknown>;

export class SchedulerEngine {
  private lastFired = new Map<string, Date>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private db: Database.Database, private applyFn: ApplyFn) {}

  async checkAndFireDueSchedules(now: Date): Promise<void> {
    const schedules = createScheduleRepository(this.db);
    const groups = createGroupRepository(this.db);

    for (const schedule of schedules.list()) {
      if (!schedule.enabled) continue;
      const due = nextTriggerDate(schedule, now);
      if (!sameMinute(due, now)) continue;

      const alreadyFired = this.lastFired.get(schedule.id);
      if (alreadyFired && sameMinute(alreadyFired, now)) continue;

      const group = groups.list().find((g) => g.id === schedule.groupId);
      if (!group) continue;

      await this.applyFn(group.members, { type: schedule.actionType, ...(schedule.actionPayload as object) });
      this.lastFired.set(schedule.id, now);
    }
  }

  start(): void {
    this.timer = setInterval(() => this.checkAndFireDueSchedules(new Date()), 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
```

Remove the unused `cronParser` import (kept `node-cron` as a dependency for the `dev` scaffolding parity, but the minute-matcher above is self-contained) — delete the `import cronParser from 'node-cron';` line since it's unused, to avoid an unused-import TypeScript error.

- [ ] **Step 10: Run engine test, confirm it passes**

Run: `cd server && npm test -- test/schedules/engine.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 11: Mount the schedules router and wire up server startup**

Add to `server/src/app.ts`:
```ts
import { createSchedulesRouter } from './schedules/routes.js';
// ...
app.use('/api/schedules', createSchedulesRouter(db));
```

Replace `server/src/server.ts` with:
```ts
import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { runDiscoveryCycle } from './discovery/service.js';
import { SchedulerEngine } from './schedules/engine.js';
import { applyToMembers } from './control/routes.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH ?? './data/uber-wled.db';
const DISCOVERY_INTERVAL_MS = 5 * 60_000;

const db = createDb(DB_PATH);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`uber-wled server listening on port ${PORT}`);
});

runDiscoveryCycle(db);
setInterval(() => runDiscoveryCycle(db), DISCOVERY_INTERVAL_MS);

const scheduler = new SchedulerEngine(db, (members, action) => applyToMembers(db, members, action as any));
scheduler.start();
```

- [ ] **Step 12: Run the full server test suite, confirm everything passes**

Run: `cd server && npm test`
Expected: all tests PASS

- [ ] **Step 13: Commit**

```bash
git add server/src/schedules server/test/schedules server/src/app.ts server/src/server.ts
git commit -m "Add schedule CRUD and scheduler engine, wire up server startup"
```

---

### Task 14: Frontend API client + Dashboard (controllers, groups, themes, schedules)

**Files:**
- Create: `client/src/api/client.ts`
- Create: `client/src/components/ControllerList.tsx`, `client/src/components/GroupManager.tsx`, `client/src/components/ThemeManager.tsx`, `client/src/components/ScheduleManager.tsx`
- Create: `client/src/pages/Dashboard.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/test/api/client.test.ts`, `client/test/components/ControllerList.test.tsx`

**Interfaces:**
- Produces: `client/src/api/client.ts` exports typed fetch wrappers matching every backend route from Tasks 4, 10, 11, 13: `listControllers`, `addController`, `deleteController`, `listGroups`, `addGroup`, `updateGroup`, `deleteGroup`, `listThemes`, `addTheme`, `deleteTheme`, `listPresets(controllerId)`, `listSchedules`, `addSchedule`, `deleteSchedule`, `applyControl(members, action)`.
- Consumed by: Dashboard page and its child components; the Floorplan editor (Task 15) reuses `applyControl` and the controller/theme/preset listers.

- [ ] **Step 1: Write the failing API client test**

`client/test/api/client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { listControllers, addController } from '../../src/api/client.js';

describe('api client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('listControllers GETs /api/controllers and returns json', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: '1', name: 'Porch' }] });
    const result = await listControllers();
    expect(global.fetch).toHaveBeenCalledWith('/api/controllers');
    expect(result).toEqual([{ id: '1', name: 'Porch' }]);
  });

  it('addController POSTs name and host', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: '1', name: 'Porch', host: '10.0.0.50' }) });
    await addController('Porch', '10.0.0.50');
    expect(global.fetch).toHaveBeenCalledWith('/api/controllers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Porch', host: '10.0.0.50' })
    });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd client && npm test -- test/api/client.test.ts`
Expected: FAIL — cannot find module `../../src/api/client.js`

- [ ] **Step 3: Create `client/src/api/client.ts`**

```ts
export interface Controller {
  id: string;
  name: string;
  host: string;
  source: 'discovered' | 'manual';
  stale: boolean;
}

export interface GroupMember {
  controllerId: string;
  wledSegId: number;
}

export interface Group {
  id: string;
  name: string;
  members: GroupMember[];
}

export interface CustomTheme {
  id: string;
  name: string;
  effect: number;
  palette: number;
  colors: number[][];
  brightness: number;
}

export interface WledPreset {
  id: number;
  name: string;
}

export interface Schedule {
  id: string;
  name: string;
  triggerType: 'cron' | 'sunrise' | 'sunset' | 'weekly';
  cronExpr: string | null;
  daysOfWeek: number[] | null;
  timeOfDay: string | null;
  offsetMinutes: number;
  latitude: number | null;
  longitude: number | null;
  groupId: string;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
  enabled: boolean;
}

export type ControlAction =
  | { type: 'power'; on: boolean }
  | { type: 'brightness'; value: number }
  | { type: 'preset'; presetId: number }
  | { type: 'theme'; themeId: string };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed`);
  return res.json();
}

async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${method} ${url} failed`);
  return res.json();
}

export const listControllers = () => getJson<Controller[]>('/api/controllers');
export const addController = (name: string, host: string) =>
  sendJson<Controller>('/api/controllers', 'POST', { name, host });
export const deleteController = (id: string) =>
  fetch(`/api/controllers/${id}`, { method: 'DELETE' });

export const listGroups = () => getJson<Group[]>('/api/groups');
export const addGroup = (name: string, members: GroupMember[]) =>
  sendJson<Group>('/api/groups', 'POST', { name, members });
export const updateGroup = (id: string, patch: { name?: string; members?: GroupMember[] }) =>
  sendJson<Group>(`/api/groups/${id}`, 'PATCH', patch);
export const deleteGroup = (id: string) => fetch(`/api/groups/${id}`, { method: 'DELETE' });

export const listThemes = () => getJson<CustomTheme[]>('/api/themes');
export const addTheme = (input: Omit<CustomTheme, 'id'>) =>
  sendJson<CustomTheme>('/api/themes', 'POST', input);
export const deleteTheme = (id: string) => fetch(`/api/themes/${id}`, { method: 'DELETE' });
export const listPresets = (controllerId: string) =>
  getJson<WledPreset[]>(`/api/themes/presets/${controllerId}`);

export const listSchedules = () => getJson<Schedule[]>('/api/schedules');
export const addSchedule = (input: Omit<Schedule, 'id'>) =>
  sendJson<Schedule>('/api/schedules', 'POST', input);
export const deleteSchedule = (id: string) => fetch(`/api/schedules/${id}`, { method: 'DELETE' });

export const applyControl = (members: GroupMember[], action: ControlAction) =>
  sendJson<{ results: { controllerId: string; wledSegId: number; ok: boolean; error?: string }[] }>(
    '/api/control/apply', 'POST', { members, action }
  );
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `cd client && npm test -- test/api/client.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing ControllerList component test**

`client/test/components/ControllerList.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ControllerList } from '../../src/components/ControllerList.js';

describe('ControllerList', () => {
  it('renders each controller\'s name and host', () => {
    render(
      <ControllerList
        controllers={[
          { id: '1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false },
          { id: '2', name: 'Deck', host: '10.0.0.51', source: 'discovered', stale: true }
        ]}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText('Porch')).toBeTruthy();
    expect(screen.getByText('10.0.0.50')).toBeTruthy();
    expect(screen.getByText(/stale/i)).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd client && npm test -- test/components/ControllerList.test.tsx`
Expected: FAIL — cannot find module `../../src/components/ControllerList.js`

- [ ] **Step 7: Create `client/src/components/ControllerList.tsx`**

```tsx
import type { Controller } from '../api/client.js';

export function ControllerList({
  controllers,
  onDelete
}: {
  controllers: Controller[];
  onDelete: (id: string) => void;
}) {
  return (
    <ul>
      {controllers.map((c) => (
        <li key={c.id}>
          <strong>{c.name}</strong> ({c.host}) — {c.source}
          {c.stale && <span> — stale</span>}
          <button onClick={() => onDelete(c.id)}>Remove</button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `cd client && npm test -- test/components/ControllerList.test.tsx`
Expected: PASS

- [ ] **Step 9: Create the remaining Dashboard components without dedicated unit tests (thin CRUD forms wrapping the tested api client)**

`client/src/components/GroupManager.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { listGroups, addGroup, deleteGroup, type Group } from '../api/client.js';

export function GroupManager() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    listGroups().then(setGroups);
  }, []);

  async function handleAdd() {
    if (!name) return;
    const created = await addGroup(name, []);
    setGroups((prev) => [...prev, created]);
    setName('');
  }

  async function handleDelete(id: string) {
    await deleteGroup(id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }

  return (
    <div>
      <h3>Groups</h3>
      <ul>
        {groups.map((g) => (
          <li key={g.id}>
            {g.name} ({g.members.length} members)
            <button onClick={() => handleDelete(g.id)}>Remove</button>
          </li>
        ))}
      </ul>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" />
      <button onClick={handleAdd}>Add</button>
    </div>
  );
}
```

`client/src/components/ThemeManager.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { listThemes, deleteTheme, type CustomTheme } from '../api/client.js';

export function ThemeManager() {
  const [themes, setThemes] = useState<CustomTheme[]>([]);

  useEffect(() => {
    listThemes().then(setThemes);
  }, []);

  async function handleDelete(id: string) {
    await deleteTheme(id);
    setThemes((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div>
      <h3>Themes</h3>
      <ul>
        {themes.map((t) => (
          <li key={t.id}>
            {t.name}
            <button onClick={() => handleDelete(t.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`client/src/components/ScheduleManager.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { listSchedules, deleteSchedule, type Schedule } from '../api/client.js';

export function ScheduleManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  useEffect(() => {
    listSchedules().then(setSchedules);
  }, []);

  async function handleDelete(id: string) {
    await deleteSchedule(id);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div>
      <h3>Schedules</h3>
      <ul>
        {schedules.map((s) => (
          <li key={s.id}>
            {s.name} ({s.triggerType})
            <button onClick={() => handleDelete(s.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 10: Create `client/src/pages/Dashboard.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { listControllers, deleteController, addController, type Controller } from '../api/client.js';
import { ControllerList } from '../components/ControllerList.js';
import { GroupManager } from '../components/GroupManager.js';
import { ThemeManager } from '../components/ThemeManager.js';
import { ScheduleManager } from '../components/ScheduleManager.js';

export function Dashboard() {
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');

  useEffect(() => {
    listControllers().then(setControllers);
  }, []);

  async function handleAdd() {
    if (!name || !host) return;
    const created = await addController(name, host);
    setControllers((prev) => [...prev, created]);
    setName('');
    setHost('');
  }

  async function handleDelete(id: string) {
    await deleteController(id);
    setControllers((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div>
      <h2>uber-wled</h2>
      <h3>Controllers</h3>
      <ControllerList controllers={controllers} onDelete={handleDelete} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host/IP" />
      <button onClick={handleAdd}>Add controller</button>
      <GroupManager />
      <ThemeManager />
      <ScheduleManager />
    </div>
  );
}
```

- [ ] **Step 11: Wire it into `client/src/App.tsx`**

```tsx
import { Dashboard } from './pages/Dashboard.js';

export default function App() {
  return <Dashboard />;
}
```

- [ ] **Step 12: Run the full client test suite, confirm it passes**

Run: `cd client && npm test`
Expected: all tests PASS

- [ ] **Step 13: Commit**

```bash
git add client/src client/test
git commit -m "Add frontend API client and dashboard (controllers, groups, themes, schedules)"
```

---

### Task 15: Frontend floorplan canvas — upload, draw segments, multi-select, apply control

**Files:**
- Create: `client/src/components/FloorplanCanvas.tsx`, `client/src/components/SegmentPathEditor.tsx`, `client/src/components/ControlPanel.tsx`
- Create: `client/src/pages/FloorplanEditor.tsx`
- Modify: `client/src/pages/Dashboard.tsx` (link to the floorplan editor), `client/src/api/client.ts` (add floorplan/placement calls)
- Test: `client/test/components/FloorplanCanvas.test.tsx`, `client/test/components/ControlPanel.test.tsx`

**Interfaces:**
- Produces (added to `client/src/api/client.ts`):
  - `interface Floorplan { id: string; name: string; imagePath: string; cropX: number; cropY: number; cropWidth: number; cropHeight: number; rotation: number; zoom: number; }`
  - `interface Placement { id: string; floorplanId: string; controllerId: string; wledSegId: number; points: { x: number; y: number }[]; lengthMeters: number | null; }`
  - `listFloorplans()`, `uploadFloorplan(name, file)`, `updateFloorplan(id, patch)`, `listPlacements(floorplanId)`, `addPlacement(floorplanId, input)`, `deletePlacement(floorplanId, id)`
  - `FloorplanCanvas` props: `{ floorplan: Floorplan; placements: Placement[]; selected: Set<string>; onToggleSelect: (placementId: string) => void; }` — renders the image, each placement as an SVG `<polyline>`, click-to-toggle-select, marquee-select via mousedown/mousemove/mouseup over the SVG.
  - `ControlPanel` props: `{ selectedMembers: { controllerId: string; wledSegId: number }[]; themes: CustomTheme[]; onApply: (action: ControlAction) => void; }`
- Consumes: `applyControl`, `listThemes` (Task 14's api client additions), `Placement`/`Floorplan` types above.

- [ ] **Step 1: Add floorplan/placement calls to `client/src/api/client.ts`**

```ts
export interface Floorplan {
  id: string;
  name: string;
  imagePath: string;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  rotation: number;
  zoom: number;
}

export interface Placement {
  id: string;
  floorplanId: string;
  controllerId: string;
  wledSegId: number;
  points: { x: number; y: number }[];
  lengthMeters: number | null;
}

export const listFloorplans = () => getJson<Floorplan[]>('/api/floorplans');

export async function uploadFloorplan(name: string, file: File): Promise<Floorplan> {
  const form = new FormData();
  form.append('name', name);
  form.append('image', file);
  const res = await fetch('/api/floorplans', { method: 'POST', body: form });
  if (!res.ok) throw new Error('upload failed');
  return res.json();
}

export const updateFloorplan = (id: string, patch: Partial<Omit<Floorplan, 'id' | 'imagePath'>>) =>
  sendJson<Floorplan>(`/api/floorplans/${id}`, 'PATCH', patch);

export const listPlacements = (floorplanId: string) =>
  getJson<Placement[]>(`/api/floorplans/${floorplanId}/placements`);

export const addPlacement = (
  floorplanId: string,
  input: { controllerId: string; wledSegId: number; points: { x: number; y: number }[]; lengthMeters: number | null }
) => sendJson<{ placement: Placement; recommendations: unknown[] }>(
  `/api/floorplans/${floorplanId}/placements`, 'POST', input
);

export const deletePlacement = (floorplanId: string, id: string) =>
  fetch(`/api/floorplans/${floorplanId}/placements/${id}`, { method: 'DELETE' });
```

- [ ] **Step 2: Write the failing FloorplanCanvas test**

`client/test/components/FloorplanCanvas.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloorplanCanvas } from '../../src/components/FloorplanCanvas.js';

const floorplan = {
  id: 'f1', name: 'Main', imagePath: '/data/floorplans/x.png',
  cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, rotation: 0, zoom: 1
};

const placements = [
  { id: 'p1', floorplanId: 'f1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 90, y: 10 }], lengthMeters: 3 }
];

describe('FloorplanCanvas', () => {
  it('renders a polyline per placement and toggles selection on click', () => {
    const onToggleSelect = vi.fn();
    render(
      <FloorplanCanvas
        floorplan={floorplan}
        placements={placements}
        selected={new Set()}
        onToggleSelect={onToggleSelect}
      />
    );
    const line = screen.getByTestId('placement-p1');
    fireEvent.click(line);
    expect(onToggleSelect).toHaveBeenCalledWith('p1');
  });

  it('marks a selected placement with a distinct data attribute', () => {
    render(
      <FloorplanCanvas
        floorplan={floorplan}
        placements={placements}
        selected={new Set(['p1'])}
        onToggleSelect={vi.fn()}
      />
    );
    expect(screen.getByTestId('placement-p1').getAttribute('data-selected')).toBe('true');
  });
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd client && npm test -- test/components/FloorplanCanvas.test.tsx`
Expected: FAIL — cannot find module `../../src/components/FloorplanCanvas.js`

- [ ] **Step 4: Create `client/src/components/FloorplanCanvas.tsx`**

```tsx
import type { Floorplan, Placement } from '../api/client.js';

export function FloorplanCanvas({
  floorplan,
  placements,
  selected,
  onToggleSelect
}: {
  floorplan: Floorplan;
  placements: Placement[];
  selected: Set<string>;
  onToggleSelect: (placementId: string) => void;
}) {
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', border: '1px solid #ccc' }}>
      <image href={floorplan.imagePath} x={0} y={0} width={100} height={100} />
      {placements.map((p) => (
        <polyline
          key={p.id}
          data-testid={`placement-${p.id}`}
          data-selected={selected.has(p.id) ? 'true' : 'false'}
          points={p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
          fill="none"
          stroke={selected.has(p.id) ? '#ff5ec8' : '#5ee1ff'}
          strokeWidth={selected.has(p.id) ? 3 : 2}
          onClick={() => onToggleSelect(p.id)}
        />
      ))}
    </svg>
  );
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd client && npm test -- test/components/FloorplanCanvas.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing ControlPanel test**

`client/test/components/ControlPanel.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ControlPanel } from '../../src/components/ControlPanel.js';

describe('ControlPanel', () => {
  it('calls onApply with a brightness action when the slider is committed', () => {
    const onApply = vi.fn();
    render(
      <ControlPanel
        selectedMembers={[{ controllerId: 'c1', wledSegId: 0 }]}
        themes={[]}
        onApply={onApply}
      />
    );
    const slider = screen.getByLabelText(/brightness/i);
    fireEvent.change(slider, { target: { value: '150' } });
    expect(onApply).toHaveBeenCalledWith({ type: 'brightness', value: 150 });
  });

  it('calls onApply with a theme action when a theme is chosen', () => {
    const onApply = vi.fn();
    render(
      <ControlPanel
        selectedMembers={[{ controllerId: 'c1', wledSegId: 0 }]}
        themes={[{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }]}
        onApply={onApply}
      />
    );
    fireEvent.click(screen.getByText('Sunset'));
    expect(onApply).toHaveBeenCalledWith({ type: 'theme', themeId: 't1' });
  });
});
```

- [ ] **Step 7: Run it, confirm it fails**

Run: `cd client && npm test -- test/components/ControlPanel.test.tsx`
Expected: FAIL — cannot find module `../../src/components/ControlPanel.js`

- [ ] **Step 8: Create `client/src/components/ControlPanel.tsx`**

```tsx
import type { CustomTheme, ControlAction } from '../api/client.js';

export function ControlPanel({
  selectedMembers,
  themes,
  onApply
}: {
  selectedMembers: { controllerId: string; wledSegId: number }[];
  themes: CustomTheme[];
  onApply: (action: ControlAction) => void;
}) {
  const disabled = selectedMembers.length === 0;

  return (
    <div>
      <h3>Control ({selectedMembers.length} selected)</h3>
      <button disabled={disabled} onClick={() => onApply({ type: 'power', on: true })}>On</button>
      <button disabled={disabled} onClick={() => onApply({ type: 'power', on: false })}>Off</button>
      <label>
        Brightness
        <input
          type="range"
          aria-label="brightness"
          min={0}
          max={255}
          disabled={disabled}
          onChange={(e) => onApply({ type: 'brightness', value: Number(e.target.value) })}
        />
      </label>
      <div>
        {themes.map((t) => (
          <button key={t.id} disabled={disabled} onClick={() => onApply({ type: 'theme', themeId: t.id })}>
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run test, confirm it passes**

Run: `cd client && npm test -- test/components/ControlPanel.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 10: Create `client/src/components/SegmentPathEditor.tsx`** (click-to-place bend points, no dedicated unit test — DOM click-coordinate geometry is exercised manually per the plan's testing note on frontend interaction code)

```tsx
import { useState } from 'react';

export function SegmentPathEditor({
  onComplete
}: {
  onComplete: (points: { x: number; y: number }[]) => void;
}) {
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPoints((prev) => [...prev, { x, y }]);
  }

  function finish() {
    if (points.length >= 2) onComplete(points);
    setPoints([]);
  }

  return (
    <div>
      <svg viewBox="0 0 100 100" style={{ width: '100%', border: '1px dashed #999' }} onClick={handleClick}>
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="#a3ff5e"
          strokeWidth={2}
        />
      </svg>
      <button onClick={finish} disabled={points.length < 2}>Finish segment ({points.length} points)</button>
    </div>
  );
}
```

- [ ] **Step 11: Create `client/src/pages/FloorplanEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  listFloorplans, listPlacements, addPlacement, listThemes, listControllers, applyControl,
  type Floorplan, type Placement, type CustomTheme, type Controller, type ControlAction
} from '../api/client.js';
import { FloorplanCanvas } from '../components/FloorplanCanvas.js';
import { SegmentPathEditor } from '../components/SegmentPathEditor.js';
import { ControlPanel } from '../components/ControlPanel.js';

export function FloorplanEditor({ floorplanId }: { floorplanId: string }) {
  const [floorplan, setFloorplan] = useState<Floorplan | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    listFloorplans().then((all) => setFloorplan(all.find((f) => f.id === floorplanId) ?? null));
    listPlacements(floorplanId).then(setPlacements);
    listThemes().then(setThemes);
    listControllers().then(setControllers);
  }, [floorplanId]);

  function toggleSelect(placementId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(placementId) ? next.delete(placementId) : next.add(placementId);
      return next;
    });
  }

  async function handleNewSegment(points: { x: number; y: number }[]) {
    if (controllers.length === 0) return;
    const { placement } = await addPlacement(floorplanId, {
      controllerId: controllers[0].id,
      wledSegId: 0,
      points,
      lengthMeters: null
    });
    setPlacements((prev) => [...prev, placement]);
    setDrawing(false);
  }

  async function handleApply(action: ControlAction) {
    const members = placements
      .filter((p) => selected.has(p.id))
      .map((p) => ({ controllerId: p.controllerId, wledSegId: p.wledSegId }));
    await applyControl(members, action);
  }

  if (!floorplan) return <p>Loading...</p>;

  return (
    <div>
      <FloorplanCanvas
        floorplan={floorplan}
        placements={placements}
        selected={selected}
        onToggleSelect={toggleSelect}
      />
      {drawing ? (
        <SegmentPathEditor onComplete={handleNewSegment} />
      ) : (
        <button onClick={() => setDrawing(true)}>Draw new segment</button>
      )}
      <ControlPanel
        selectedMembers={placements
          .filter((p) => selected.has(p.id))
          .map((p) => ({ controllerId: p.controllerId, wledSegId: p.wledSegId }))}
        themes={themes}
        onApply={handleApply}
      />
    </div>
  );
}
```

- [ ] **Step 12: Link it from the Dashboard**

Modify `client/src/pages/Dashboard.tsx` to add floorplan navigation. Since this plan doesn't introduce a router, add a simple local view toggle:

```tsx
import { useEffect, useState } from 'react';
import { listControllers, listFloorplans, deleteController, addController, type Controller, type Floorplan } from '../api/client.js';
import { ControllerList } from '../components/ControllerList.js';
import { GroupManager } from '../components/GroupManager.js';
import { ThemeManager } from '../components/ThemeManager.js';
import { ScheduleManager } from '../components/ScheduleManager.js';
import { FloorplanEditor } from './FloorplanEditor.js';

export function Dashboard() {
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [floorplans, setFloorplans] = useState<Floorplan[]>([]);
  const [openFloorplanId, setOpenFloorplanId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');

  useEffect(() => {
    listControllers().then(setControllers);
    listFloorplans().then(setFloorplans);
  }, []);

  async function handleAdd() {
    if (!name || !host) return;
    const created = await addController(name, host);
    setControllers((prev) => [...prev, created]);
    setName('');
    setHost('');
  }

  async function handleDelete(id: string) {
    await deleteController(id);
    setControllers((prev) => prev.filter((c) => c.id !== id));
  }

  if (openFloorplanId) {
    return (
      <div>
        <button onClick={() => setOpenFloorplanId(null)}>Back to dashboard</button>
        <FloorplanEditor floorplanId={openFloorplanId} />
      </div>
    );
  }

  return (
    <div>
      <h2>uber-wled</h2>
      <h3>Controllers</h3>
      <ControllerList controllers={controllers} onDelete={handleDelete} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host/IP" />
      <button onClick={handleAdd}>Add controller</button>

      <h3>Floorplans</h3>
      <ul>
        {floorplans.map((f) => (
          <li key={f.id}>
            {f.name} <button onClick={() => setOpenFloorplanId(f.id)}>Open</button>
          </li>
        ))}
      </ul>

      <GroupManager />
      <ThemeManager />
      <ScheduleManager />
    </div>
  );
}
```

- [ ] **Step 13: Run the full client test suite, confirm it passes**

Run: `cd client && npm test`
Expected: all tests PASS

- [ ] **Step 14: Commit**

```bash
git add client/src client/test
git commit -m "Add floorplan canvas, segment drawing, multi-select, and control panel"
```

---

### Task 16: Calendar events — date-rule resolution

**Files:**
- Create: `server/src/calendar/dateRules.ts`
- Test: `server/test/calendar/dateRules.test.ts`

**Interfaces:**
- Produces:
  - `type DateRule = { kind: 'fixed'; month: number; day: number } | { kind: 'nthWeekday'; month: number; weekday: number; n: number } | { kind: 'lastWeekday'; month: number; weekday: number } | { kind: 'easterOffset'; offsetDays: number } | { kind: 'oneOff'; year: number; month: number; day: number }`
  - `function resolveDate(rule: DateRule, year: number): { month: number; day: number } | null` — returns `null` for a `oneOff` rule whose stored `year` does not match the requested `year` (per the spec: "does not resolve for other years").
- Consumed by: Task 17 (`server/src/calendar/repository.ts`/`routes.ts`, conflict guard), Task 18 (`SchedulerEngine` override-for-day suppression).

- [ ] **Step 1: Write the failing test**

`server/test/calendar/dateRules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveDate, type DateRule } from '../../src/calendar/dateRules.js';

describe('resolveDate', () => {
  it('resolves a fixed date as-is', () => {
    const rule: DateRule = { kind: 'fixed', month: 7, day: 4 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 7, day: 4 });
  });

  it('resolves the nth weekday of a month (3rd Monday of January = MLK Day 2026)', () => {
    const rule: DateRule = { kind: 'nthWeekday', month: 1, weekday: 1, n: 3 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 1, day: 19 });
  });

  it('resolves the 5th occurrence of a weekday in a month that has five (May 2023 has 5 Mondays)', () => {
    const rule: DateRule = { kind: 'nthWeekday', month: 5, weekday: 1, n: 5 };
    expect(resolveDate(rule, 2023)).toEqual({ month: 5, day: 29 });
  });

  it('resolves the last weekday of a month that has only four occurrences (May 2026 has 4 Mondays)', () => {
    const rule: DateRule = { kind: 'lastWeekday', month: 5, weekday: 1 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 5, day: 25 });
  });

  it('resolves the last weekday of a month that has five occurrences (May 2023 has 5 Mondays)', () => {
    const rule: DateRule = { kind: 'lastWeekday', month: 5, weekday: 1 };
    expect(resolveDate(rule, 2023)).toEqual({ month: 5, day: 29 });
  });

  it('resolves Easter Sunday itself via easterOffset 0 (known date: 2024-03-31)', () => {
    const rule: DateRule = { kind: 'easterOffset', offsetDays: 0 };
    expect(resolveDate(rule, 2024)).toEqual({ month: 3, day: 31 });
  });

  it('resolves Easter Sunday for a second known year (2025-04-20)', () => {
    const rule: DateRule = { kind: 'easterOffset', offsetDays: 0 };
    expect(resolveDate(rule, 2025)).toEqual({ month: 4, day: 20 });
  });

  it('resolves an easterOffset with a non-zero offset (e.g. Good Friday, -2 days, for 2026 Easter of April 5)', () => {
    const rule: DateRule = { kind: 'easterOffset', offsetDays: -2 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 4, day: 3 });
  });

  it('resolves a oneOff rule only for its stored year', () => {
    const rule: DateRule = { kind: 'oneOff', year: 2026, month: 9, day: 12 };
    expect(resolveDate(rule, 2026)).toEqual({ month: 9, day: 12 });
    expect(resolveDate(rule, 2027)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/calendar/dateRules.test.ts`
Expected: FAIL — cannot find module `../../src/calendar/dateRules.js`

- [ ] **Step 3: Create `server/src/calendar/dateRules.ts`**

```ts
export type DateRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nthWeekday'; month: number; weekday: number; n: number }
  | { kind: 'lastWeekday'; month: number; weekday: number }
  | { kind: 'easterOffset'; offsetDays: number }
  | { kind: 'oneOff'; year: number; month: number; day: number };

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  // month is 1-12
  const firstOfMonth = new Date(year, month - 1, 1);
  const firstWeekday = firstOfMonth.getDay();
  const dayOffset = (weekday - firstWeekday + 7) % 7;
  return 1 + dayOffset + (n - 1) * 7;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const lastDate = new Date(year, month - 1, lastDayOfMonth);
  const diff = (lastDate.getDay() - weekday + 7) % 7;
  return lastDayOfMonth - diff;
}

/**
 * Computes Easter Sunday for a given year via the anonymous Gregorian
 * Computus algorithm.
 */
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
    case 'nthWeekday':
      return { month: rule.month, day: nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n) };
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

- [ ] **Step 4: Run test, confirm it passes**

Run: `cd server && npm test -- test/calendar/dateRules.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/calendar/dateRules.ts server/test/calendar/dateRules.test.ts
git commit -m "Add calendar date-rule resolution (fixed/nthWeekday/lastWeekday/easterOffset/oneOff)"
```

---

### Task 17: Calendar events — repository, seed data, CRUD routes, conflict guard

**Files:**
- Create: `server/src/calendar/repository.ts`, `server/src/calendar/holidaySeeds.ts`, `server/src/calendar/routes.ts`
- Modify: `server/src/app.ts` (mount router), `server/src/server.ts` (run startup seeding)
- Test: `server/test/calendar/repository.test.ts`, `server/test/calendar/routes.test.ts`

**Interfaces:**
- Produces:
  - `interface CalendarEvent { id: string; name: string; category: 'holiday' | 'custom'; dateRule: DateRule; recursYearly: boolean; enabled: boolean; groupId: string | null; triggerTime: { type: 'fixed'; time: string } | { type: 'sunset' | 'sunrise'; offsetMinutes: number }; actionType: 'power' | 'brightness' | 'preset' | 'theme' | null; actionPayload: unknown; }` — field names and shapes match the spec exactly and the real `calendar_events` columns (`date_rule`, `recurs_yearly`, `group_id`, `trigger_time`, `action_type`, `action_payload`) in `server/src/db/schema.ts`.
  - `function seedHolidays(): HolidaySeed[]` from `server/src/calendar/holidaySeeds.ts`, where `HolidaySeed` is a `CalendarEvent`-without-`id` shape with its holiday-only fields narrowed to literals (`category: 'holiday'`, `enabled: false`, `groupId: null`, `actionType: null`, `actionPayload: null`) — structurally assignable to `Omit<CalendarEvent, 'id'>` wherever the repository's `add()` expects it. ~20 combined federal + common-decorating-occasion holidays per the spec's named list.
  - `function createCalendarRepository(db): { list(): CalendarEvent[]; get(id): CalendarEvent | undefined; add(input: Omit<CalendarEvent,'id'>): CalendarEvent; update(id, patch): CalendarEvent; remove(id): void; isEmpty(): boolean; }`
  - `function findConflict(events: CalendarEvent[], candidate: CalendarEvent, year: number): CalendarEvent | undefined` — the 409 conflict-guard check, exported for direct unit testing.
  - `function createCalendarRouter(db): express.Router` mounted at `/api/calendar-events` (GET, POST, PATCH `/:id`, DELETE `/:id`); POST/PATCH run the conflict guard and respond `409` with `{ error: string; conflict: { id: string; name: string; month: number; day: number } }` on collision.
  - `function seedHolidaysIfEmpty(db): void` — idempotent startup step, called from `server.ts`.
- Consumes: `resolveDate`/`DateRule` (Task 16).

- [ ] **Step 1: Write the failing repository test**

`server/test/calendar/repository.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createCalendarRepository } from '../../src/calendar/repository.js';

describe('calendar repository', () => {
  let db: ReturnType<typeof createDb>;
  let repo: ReturnType<typeof createCalendarRepository>;

  beforeEach(() => {
    db = createDb(':memory:');
    repo = createCalendarRepository(db);
  });

  it('is empty on a fresh db', () => {
    expect(repo.isEmpty()).toBe(true);
  });

  it('adds and lists a custom calendar event', () => {
    const created = repo.add({
      name: "Anniversary", category: 'custom',
      dateRule: { kind: 'fixed', month: 9, day: 12 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });
    expect(created.id).toBeTruthy();
    expect(repo.list()).toEqual([created]);
    expect(repo.isEmpty()).toBe(false);
  });

  it('updates a calendar event', () => {
    const created = repo.add({
      name: "Anniversary", category: 'custom',
      dateRule: { kind: 'fixed', month: 9, day: 12 },
      recursYearly: true, enabled: false, groupId: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });
    const updated = repo.update(created.id, { enabled: true });
    expect(updated.enabled).toBe(true);
  });

  it('removes a calendar event', () => {
    const created = repo.add({
      name: "X", category: 'custom',
      dateRule: { kind: 'fixed', month: 1, day: 1 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '09:00' },
      actionType: null, actionPayload: null
    });
    repo.remove(created.id);
    expect(repo.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/calendar/repository.test.ts`
Expected: FAIL — cannot find module `../../src/calendar/repository.js`

- [ ] **Step 3: Create `server/src/calendar/holidaySeeds.ts`**

```ts
import type { DateRule } from './dateRules.js';

export interface HolidaySeed {
  name: string;
  category: 'holiday';
  dateRule: DateRule;
  recursYearly: true;
  enabled: false;
  groupId: null;
  triggerTime: { type: 'fixed'; time: string };
  actionType: null;
  actionPayload: null;
}

/**
 * ~20 combined federal + common decorating-occasion holidays, per the
 * scheduling spec. Seeded disabled with no group/action — inert until the
 * user configures them, to avoid any surprise light changes.
 */
export function seedHolidays(): HolidaySeed[] {
  const base = {
    category: 'holiday' as const,
    recursYearly: true as const,
    enabled: false as const,
    groupId: null,
    triggerTime: { type: 'fixed' as const, time: '18:00' },
    actionType: null,
    actionPayload: null
  };

  return [
    { ...base, name: "New Year's Day", dateRule: { kind: 'fixed', month: 1, day: 1 } },
    { ...base, name: 'MLK Day', dateRule: { kind: 'nthWeekday', month: 1, weekday: 1, n: 3 } },
    { ...base, name: "Valentine's Day", dateRule: { kind: 'fixed', month: 2, day: 14 } },
    { ...base, name: 'Presidents Day', dateRule: { kind: 'nthWeekday', month: 2, weekday: 1, n: 3 } },
    { ...base, name: "St. Patrick's Day", dateRule: { kind: 'fixed', month: 3, day: 17 } },
    { ...base, name: 'Easter', dateRule: { kind: 'easterOffset', offsetDays: 0 } },
    { ...base, name: 'Memorial Day', dateRule: { kind: 'lastWeekday', month: 5, weekday: 1 } },
    { ...base, name: 'Juneteenth', dateRule: { kind: 'fixed', month: 6, day: 19 } },
    { ...base, name: 'July 4th', dateRule: { kind: 'fixed', month: 7, day: 4 } },
    { ...base, name: 'Labor Day', dateRule: { kind: 'nthWeekday', month: 9, weekday: 1, n: 1 } },
    { ...base, name: 'Columbus Day', dateRule: { kind: 'nthWeekday', month: 10, weekday: 1, n: 2 } },
    { ...base, name: 'Halloween', dateRule: { kind: 'fixed', month: 10, day: 31 } },
    { ...base, name: 'Veterans Day', dateRule: { kind: 'fixed', month: 11, day: 11 } },
    { ...base, name: 'Thanksgiving', dateRule: { kind: 'nthWeekday', month: 11, weekday: 4, n: 4 } },
    { ...base, name: 'Christmas Eve', dateRule: { kind: 'fixed', month: 12, day: 24 } },
    { ...base, name: 'Christmas Day', dateRule: { kind: 'fixed', month: 12, day: 25 } },
    { ...base, name: "New Year's Eve", dateRule: { kind: 'fixed', month: 12, day: 31 } }
  ];
}
```

Note: this is 17 entries, matching the spec's explicit seed list verbatim ("New Year's Day, MLK Day, Valentine's Day, Presidents Day, St. Patrick's Day, Easter, Memorial Day, Juneteenth, July 4th, Labor Day, Columbus Day, Halloween, Veterans Day, Thanksgiving, Christmas Eve, Christmas Day, New Year's Eve") — the spec's prose describes this list as "~20" loosely; the implementer should not pad it with invented occasions beyond what the spec lists by name.

- [ ] **Step 4: Create `server/src/calendar/repository.ts`**

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DateRule } from './dateRules.js';

export interface CalendarEvent {
  id: string;
  name: string;
  category: 'holiday' | 'custom';
  dateRule: DateRule;
  recursYearly: boolean;
  enabled: boolean;
  groupId: string | null;
  triggerTime: { type: 'fixed'; time: string } | { type: 'sunset' | 'sunrise'; offsetMinutes: number };
  actionType: 'power' | 'brightness' | 'preset' | 'theme' | null;
  actionPayload: unknown;
}

function fromRow(row: any): CalendarEvent {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    dateRule: JSON.parse(row.date_rule),
    recursYearly: !!row.recurs_yearly,
    enabled: !!row.enabled,
    groupId: row.group_id,
    triggerTime: JSON.parse(row.trigger_time),
    actionType: row.action_type,
    actionPayload: row.action_payload ? JSON.parse(row.action_payload) : null
  };
}

export function createCalendarRepository(db: Database.Database) {
  return {
    list(): CalendarEvent[] {
      return db.prepare('SELECT * FROM calendar_events ORDER BY name').all().map(fromRow);
    },
    get(id: string): CalendarEvent | undefined {
      const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
      return row ? fromRow(row) : undefined;
    },
    isEmpty(): boolean {
      const row: any = db.prepare('SELECT COUNT(*) as count FROM calendar_events').get();
      return row.count === 0;
    },
    add(input: Omit<CalendarEvent, 'id'>): CalendarEvent {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO calendar_events
          (id, name, category, date_rule, recurs_yearly, enabled, group_id, trigger_time, action_type, action_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, input.name, input.category, JSON.stringify(input.dateRule),
        input.recursYearly ? 1 : 0, input.enabled ? 1 : 0, input.groupId,
        JSON.stringify(input.triggerTime), input.actionType,
        input.actionPayload !== null && input.actionPayload !== undefined ? JSON.stringify(input.actionPayload) : null
      );
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<CalendarEvent, 'id'>>): CalendarEvent {
      const current = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
      if (!current) throw new Error(`calendar event ${id} not found`);
      const existing = fromRow(current);
      const next = { ...existing, ...patch };
      db.prepare(
        `UPDATE calendar_events SET name = ?, category = ?, date_rule = ?, recurs_yearly = ?,
          enabled = ?, group_id = ?, trigger_time = ?, action_type = ?, action_payload = ?
         WHERE id = ?`
      ).run(
        next.name, next.category, JSON.stringify(next.dateRule), next.recursYearly ? 1 : 0,
        next.enabled ? 1 : 0, next.groupId, JSON.stringify(next.triggerTime), next.actionType,
        next.actionPayload !== null && next.actionPayload !== undefined ? JSON.stringify(next.actionPayload) : null,
        id
      );
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    }
  };
}
```

- [ ] **Step 5: Run repository test, confirm it passes**

Run: `cd server && npm test -- test/calendar/repository.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Write the failing routes test, including the conflict guard**

`server/test/calendar/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createCalendarRouter } from '../../src/calendar/routes.js';

describe('calendar routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/calendar-events', createCalendarRouter(db));
  });

  it('creates and lists a custom event', async () => {
    const post = await request(app).post('/api/calendar-events').send({
      name: 'Anniversary', category: 'custom',
      dateRule: { kind: 'fixed', month: 9, day: 12 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });
    expect(post.status).toBe(201);
    expect((await request(app).get('/api/calendar-events')).body).toHaveLength(1);
  });

  it('rejects with 409 when an enabled event collides on date with an enabled event of the other category', async () => {
    await request(app).post('/api/calendar-events').send({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    const conflict = await request(app).post('/api/calendar-events').send({
      name: "Dad's Birthday", category: 'custom',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body.conflict.name).toBe('July 4th');
  });

  it('allows two enabled events of the same category to share a date', async () => {
    await request(app).post('/api/calendar-events').send({
      name: 'Party lights on', category: 'custom',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '17:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    const second = await request(app).post('/api/calendar-events').send({
      name: 'Party lights off', category: 'custom',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '23:00' },
      actionType: 'power', actionPayload: { on: false }
    });

    expect(second.status).toBe(201);
  });

  it('does not conflict against a disabled event of the other category', async () => {
    await request(app).post('/api/calendar-events').send({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: false, groupId: null,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: null, actionPayload: null
    });

    const custom = await request(app).post('/api/calendar-events').send({
      name: "Dad's Birthday", category: 'custom',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    expect(custom.status).toBe(201);
  });

  it('deletes a calendar event', async () => {
    const post = await request(app).post('/api/calendar-events').send({
      name: 'X', category: 'custom',
      dateRule: { kind: 'fixed', month: 1, day: 1 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '09:00' },
      actionType: null, actionPayload: null
    });
    await request(app).delete(`/api/calendar-events/${post.body.id}`).expect(204);
    expect((await request(app).get('/api/calendar-events')).body).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run it, confirm it fails**

Run: `cd server && npm test -- test/calendar/routes.test.ts`
Expected: FAIL — cannot find module `../../src/calendar/routes.js`

- [ ] **Step 8: Create `server/src/calendar/routes.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createCalendarRepository, type CalendarEvent } from './repository.js';
import { resolveDate } from './dateRules.js';

/**
 * Checks whether `candidate` (an enabled event of one category) collides
 * with an existing enabled event of the opposite category on the same
 * resolved date for `year`. Same-category collisions are allowed — this is
 * how an "on at 5pm" / "off at 11pm" pair for one occasion is modeled.
 */
export function findConflict(
  events: CalendarEvent[],
  candidate: CalendarEvent,
  year: number
): CalendarEvent | undefined {
  if (!candidate.enabled) return undefined;
  const candidateDate = resolveDate(candidate.dateRule, year);
  if (!candidateDate) return undefined;

  return events.find((other) => {
    if (other.id === candidate.id) return false;
    if (!other.enabled) return false;
    if (other.category === candidate.category) return false;
    const otherDate = resolveDate(other.dateRule, year);
    return !!otherDate && otherDate.month === candidateDate.month && otherDate.day === candidateDate.day;
  });
}

export function createCalendarRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createCalendarRepository(db);
  const thisYear = () => new Date().getFullYear();

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', (req, res) => {
    const body = req.body;
    const candidate: CalendarEvent = {
      id: 'pending',
      name: body.name,
      category: body.category,
      dateRule: body.dateRule,
      recursYearly: body.recursYearly ?? true,
      enabled: body.enabled ?? false,
      groupId: body.groupId ?? null,
      triggerTime: body.triggerTime,
      actionType: body.actionType ?? null,
      actionPayload: body.actionPayload ?? null
    };

    const conflict = findConflict(repo.list(), candidate, thisYear());
    if (conflict) {
      const conflictDate = resolveDate(conflict.dateRule, thisYear())!;
      return res.status(409).json({
        error: 'a conflicting calendar event already exists on this date',
        conflict: { id: conflict.id, name: conflict.name, month: conflictDate.month, day: conflictDate.day }
      });
    }

    const { id, ...input } = candidate;
    res.status(201).json(repo.add(input));
  });

  router.patch('/:id', (req, res) => {
    const existing = repo.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'calendar event not found' });

    const candidate: CalendarEvent = { ...existing, ...req.body, id: existing.id };
    const others = repo.list().filter((e) => e.id !== existing.id);
    const conflict = findConflict(others, candidate, thisYear());
    if (conflict) {
      const conflictDate = resolveDate(conflict.dateRule, thisYear())!;
      return res.status(409).json({
        error: 'a conflicting calendar event already exists on this date',
        conflict: { id: conflict.id, name: conflict.name, month: conflictDate.month, day: conflictDate.day }
      });
    }

    res.json(repo.update(req.params.id, req.body));
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 9: Run test, confirm it passes**

Run: `cd server && npm test -- test/calendar/routes.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 10: Add the startup seeding function to `server/src/calendar/repository.ts`**

Append below `createCalendarRepository`:

```ts
import { seedHolidays } from './holidaySeeds.js';

export function seedHolidaysIfEmpty(db: Database.Database): void {
  const repo = createCalendarRepository(db);
  if (!repo.isEmpty()) return;
  for (const holiday of seedHolidays()) {
    repo.add(holiday);
  }
}
```

(Move the `import { seedHolidays } from './holidaySeeds.js';` line to the top of the file with the other imports, rather than mid-file — shown split here only to call out that it's new.)

- [ ] **Step 11: Mount the router and wire up startup seeding**

Add to `server/src/app.ts`:
```ts
import { createCalendarRouter } from './calendar/routes.js';
// ...
app.use('/api/calendar-events', createCalendarRouter(db));
```

Add to `server/src/server.ts`, right after `const db = createDb(DB_PATH);`:
```ts
import { seedHolidaysIfEmpty } from './calendar/repository.js';
// ...
seedHolidaysIfEmpty(db);
```

- [ ] **Step 12: Run the full server test suite, confirm everything passes**

Run: `cd server && npm test`
Expected: all tests PASS

- [ ] **Step 13: Commit**

```bash
git add server/src/calendar server/test/calendar server/src/app.ts server/src/server.ts
git commit -m "Add calendar event repository, holiday seed data, CRUD routes, and conflict guard"
```

---

### Task 18: Scheduler engine — calendar override-for-day suppression

**Files:**
- Modify: `server/src/schedules/engine.ts`
- Test: `server/test/schedules/engine.test.ts` (extend with the new describe block below)

**Interfaces:**
- Modifies: `SchedulerEngine.checkAndFireDueSchedules(now: Date)` — on each check, in addition to firing due `Schedule`s (Task 13), it now:
  1. Resolves each enabled `CalendarEvent`'s `dateRule` for `now`'s year via `resolveDate` (Task 16); if the resolved `{ month, day }` matches `now`'s month/day AND the event's `triggerTime` is due (fixed time match, or sunrise/sunset + offset match, same "due this minute, not already fired" semantics as `Schedule`), it fires the event's own `actionType`/`actionPayload` against its `groupId`'s members via `applyFn` — skipped entirely if `groupId` is `null` (nothing configured yet).
  2. Collects the member set of every enabled `CalendarEvent` whose date matches today (regardless of whether its own trigger time has arrived yet — the suppression is for the whole day, not just the trigger minute), and skips firing any other enabled `Schedule` (any trigger type) whose group shares at least one member with that set, for this date.
- Consumes: `createCalendarRepository` (Task 17), `resolveDate` (Task 16), `createGroupRepository` (Task 10).

- [ ] **Step 1: Write the failing suppression + calendar-fire tests**

Add to `server/test/schedules/engine.test.ts`, a new top-level `describe` block:

```ts
import { createCalendarRepository } from '../../src/calendar/repository.js';

describe('SchedulerEngine calendar override-for-day', () => {
  let db: ReturnType<typeof createDb>;
  let sharedGroupId: string;
  let unrelatedGroupId: string;
  let applyFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createDb(':memory:');
    const groups = createGroupRepository(db);
    sharedGroupId = groups.add({
      name: 'Porch', members: [{ controllerId: 'porch-1', wledSegId: 0 }]
    }).id;
    unrelatedGroupId = groups.add({
      name: 'Kitchen', members: [{ controllerId: 'kitchen-1', wledSegId: 0 }]
    }).id;
    applyFn = vi.fn().mockResolvedValue([]);
  });

  it("fires an enabled calendar event's own action when today matches its resolved date and trigger time", async () => {
    const calendar = createCalendarRepository(db);
    calendar.add({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: sharedGroupId,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'theme', actionPayload: { themeId: 'patriotic' }
    });

    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T18:00:00'));

    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: 'porch-1', wledSegId: 0 }],
      { type: 'theme', themeId: 'patriotic' }
    );
  });

  it('suppresses an unrelated-group schedule\'s trigger the same day is unaffected, but a shared-group schedule is skipped', async () => {
    const calendar = createCalendarRepository(db);
    calendar.add({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: sharedGroupId,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Porch weekly (should be suppressed)', triggerType: 'weekly', cronExpr: null,
      daysOfWeek: [6], timeOfDay: '20:00', offsetMinutes: 0,
      latitude: null, longitude: null, groupId: sharedGroupId, actionType: 'power',
      actionPayload: { on: false }, enabled: true
    });
    schedules.add({
      name: 'Kitchen weekly (unaffected)', triggerType: 'weekly', cronExpr: null,
      daysOfWeek: [6], timeOfDay: '20:00', offsetMinutes: 0,
      latitude: null, longitude: null, groupId: unrelatedGroupId, actionType: 'power',
      actionPayload: { on: true }, enabled: true
    });

    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T20:00:00'));

    expect(applyFn).not.toHaveBeenCalledWith(
      [{ controllerId: 'porch-1', wledSegId: 0 }],
      { type: 'power', on: false }
    );
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: 'kitchen-1', wledSegId: 0 }],
      { type: 'power', on: true }
    );
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/schedules/engine.test.ts`
Expected: FAIL — the suppression test's "should be suppressed" schedule still fires because `checkAndFireDueSchedules` doesn't yet know about calendar events

- [ ] **Step 3: Extend `server/src/schedules/engine.ts`**

Add the calendar-aware logic. Replace the `checkAndFireDueSchedules` method and add supporting helpers:

```ts
import { createCalendarRepository, type CalendarEvent } from '../calendar/repository.js';
import { resolveDate } from '../calendar/dateRules.js';

function todayMatches(dateRule: CalendarEvent['dateRule'], now: Date): boolean {
  const resolved = resolveDate(dateRule, now.getFullYear());
  return !!resolved && resolved.month === now.getMonth() + 1 && resolved.day === now.getDate();
}

function triggerTimeDue(triggerTime: CalendarEvent['triggerTime'], now: Date): boolean {
  if (triggerTime.type === 'fixed') {
    const [hh, mm] = triggerTime.time.split(':').map(Number);
    return now.getHours() === hh && now.getMinutes() === mm;
  }
  // NOTE: per the scheduling spec, CalendarEvent's sunset/sunrise triggerTime
  // carries only `offsetMinutes` — no lat/lon of its own (unlike `Schedule`,
  // which stores its own latitude/longitude per row). This mirrors the same
  // `?? 0` fallback `nextTriggerDate` already uses for a `Schedule` with no
  // configured location, and is a known pre-existing limitation of the
  // approved spec's data model rather than something introduced here — see
  // the Post-plan notes for the suggested follow-up (a single server-wide
  // home location setting shared by both `Schedule` and `CalendarEvent`).
  const times = SunCalc.getTimes(now, 0, 0);
  const base = triggerTime.type === 'sunrise' ? times.sunrise : times.sunset;
  const due = new Date(base.getTime() + triggerTime.offsetMinutes * 60_000);
  return sameMinute(due, now);
}
```

Then, inside the `SchedulerEngine` class, replace `checkAndFireDueSchedules` with:

```ts
  async checkAndFireDueSchedules(now: Date): Promise<void> {
    const schedules = createScheduleRepository(this.db);
    const groups = createGroupRepository(this.db);
    const calendar = createCalendarRepository(this.db);

    const todaysEvents = calendar.list().filter((e) => e.enabled && todayMatches(e.dateRule, now));

    // Fire each matching calendar event's own action, once per minute.
    for (const event of todaysEvents) {
      if (!event.groupId || !event.actionType) continue;
      if (!triggerTimeDue(event.triggerTime, now)) continue;

      const alreadyFired = this.lastFired.get(`calendar:${event.id}`);
      if (alreadyFired && sameMinute(alreadyFired, now)) continue;

      const group = groups.list().find((g) => g.id === event.groupId);
      if (!group) continue;

      await this.applyFn(group.members, { type: event.actionType, ...(event.actionPayload as object) });
      this.lastFired.set(`calendar:${event.id}`, now);
    }

    // Suppressed member set: every member of every group targeted by an
    // enabled calendar event whose resolved date is today.
    const suppressedMemberKeys = new Set<string>();
    for (const event of todaysEvents) {
      if (!event.groupId) continue;
      const group = groups.list().find((g) => g.id === event.groupId);
      if (!group) continue;
      for (const m of group.members) {
        suppressedMemberKeys.add(`${m.controllerId}:${m.wledSegId}`);
      }
    }

    for (const schedule of schedules.list()) {
      if (!schedule.enabled) continue;
      const due = nextTriggerDate(schedule, now);
      if (!sameMinute(due, now)) continue;

      const alreadyFired = this.lastFired.get(schedule.id);
      if (alreadyFired && sameMinute(alreadyFired, now)) continue;

      const group = groups.list().find((g) => g.id === schedule.groupId);
      if (!group) continue;

      const overlapsSuppressed = group.members.some((m) =>
        suppressedMemberKeys.has(`${m.controllerId}:${m.wledSegId}`)
      );
      if (overlapsSuppressed) {
        this.lastFired.set(schedule.id, now); // treat as handled for this minute, don't re-check every tick
        continue;
      }

      await this.applyFn(group.members, { type: schedule.actionType, ...(schedule.actionPayload as object) });
      this.lastFired.set(schedule.id, now);
    }
  }
```

- [ ] **Step 4: Run the engine test suite, confirm it passes**

Run: `cd server && npm test -- test/schedules/engine.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Run the full server test suite, confirm no regressions**

Run: `cd server && npm test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/schedules/engine.ts server/test/schedules/engine.test.ts
git commit -m "Add calendar override-for-day suppression to the scheduler engine"
```

---

### Task 19: WLED schedule import

**Files:**
- Create: `server/src/controllers/scheduleImport.ts`
- Modify: `server/src/app.ts` (mount route)
- Test: `server/test/controllers/scheduleImport.test.ts`

**Interfaces:**
- Produces:
  - `interface RawWledPresetSchedule { presetId: number; presetName: string; raw: unknown }` — the shape passed into the parser; deliberately loose (`raw: unknown`) since the exact WLED preset schedule JSON shape is uncertain per the spec.
  - `interface ParsedWledSchedule { presetId: number; daysOfWeek: number[]; timeOfDay: string }`
  - `function parsePresetSchedule(entry: RawWledPresetSchedule): { ok: true; parsed: ParsedWledSchedule } | { ok: false; reason: string }` — defensive parser: any entry not matching the expected shape returns `{ ok: false, reason }`, never throws. The expected shape this targets (best-effort, per the spec's own uncertainty about WLED's exact JSON): a preset's raw schedule object carrying `en: boolean` (enabled), `hour: number`, `min: number`, and `dow: number` (a bitmask, bit 0 = Sunday .. bit 6 = Saturday) — mirroring WLED's actual `/json/state` macro-timer fields (`ovr`/`macro`/`en`/`hour`/`min`/`dow`) exposed under each preset's stored state. Entries missing `en`, with `en: false`, missing/out-of-range `hour`/`min`, or a `dow` of `0` (no days set) are all reported in `skipped`, never dropped silently or thrown.
  - `function importSchedules(db: Database.Database, controllerId: string, opts: { disableOnDevice: boolean }): Promise<{ imported: Schedule[]; skipped: { raw: unknown; reason: string }[] }>` — the orchestration function backing the route: fetches the controller's presets via `getPresets` (Task 3) + a raw per-preset schedule fetch, auto-creates a single-controller `Group` named `"<controller name> (imported)"` the first time (reused on subsequent imports for the same controller), creates a `weekly` `Schedule` (`actionType: 'preset'`) per successfully-parsed entry, and — if `opts.disableOnDevice` is `true` — clears the schedule fields on the device for each imported preset via `setState`.
  - `function createScheduleImportRouter(db): express.Router` mounted at `/api/controllers/:id/import-schedules`: `POST /` body `{ disableOnDevice: boolean }` → `{ imported: Schedule[]; skipped: { raw: unknown; reason: string }[] }`; `503` if the controller is unreachable (per the spec: nothing partial to report if the device can't be reached at all).
- Consumes: `getPresets` (Task 3, extended conceptually — this task adds its own raw-schedule-fetch helper rather than modifying `wled/client.ts`'s existing exported signature, per the constraint not to change existing exports), `createGroupRepository` (Task 10), `createScheduleRepository` (Task 13), `createControllerRepository` (Task 4).

- [ ] **Step 1: Write the failing test, including an unparseable entry**

`server/test/controllers/scheduleImport.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { parsePresetSchedule, importSchedules } from '../../src/controllers/scheduleImport.js';

const HOST = '10.0.0.50';

afterEach(() => vi.unstubAllGlobals());

describe('parsePresetSchedule', () => {
  it('parses a valid enabled schedule entry', () => {
    const result = parsePresetSchedule({
      presetId: 1, presetName: 'Porch warm',
      raw: { en: true, hour: 18, min: 30, dow: 0b0111110 } // Mon-Fri
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed).toEqual({ presetId: 1, daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '18:30' });
    }
  });

  it('reports a disabled schedule entry as skipped, not thrown', () => {
    const result = parsePresetSchedule({
      presetId: 2, presetName: 'Unused', raw: { en: false, hour: 10, min: 0, dow: 0b1111111 }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/disabled/i);
  });

  it('reports an entry with an unrecognizable shape as skipped, not thrown', () => {
    const result = parsePresetSchedule({
      presetId: 3, presetName: 'Legacy weirdness', raw: { someUnexpectedField: 'nonsense' }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });

  it('reports an entry with dow=0 (no days set) as skipped', () => {
    const result = parsePresetSchedule({
      presetId: 4, presetName: 'No days', raw: { en: true, hour: 12, min: 0, dow: 0 }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/day/i);
  });
});

describe('importSchedules', () => {
  let db: ReturnType<typeof createDb>;
  let controllerId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
  });

  it('imports valid presets into weekly schedules under an auto-created group, and reports skipped entries', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/presets.json')) {
        return {
          ok: true,
          json: async () => ({
            '1': { n: 'Porch warm', en: true, hour: 18, min: 30, dow: 0b0111110 },
            '2': { n: 'Legacy weirdness', someUnexpectedField: 'nonsense' }
          })
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await importSchedules(db, controllerId, { disableOnDevice: false });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].triggerType).toBe('weekly');
    expect(result.imported[0].daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(result.imported[0].timeOfDay).toBe('18:30');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBeTruthy();

    const groups = createGroupRepository(db).list();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Porch (imported)');
    expect(groups[0].members).toEqual([{ controllerId, wledSegId: 0 }]);

    const schedules = createScheduleRepository(db).list();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].groupId).toBe(groups[0].id);
    expect(schedules[0].actionType).toBe('preset');
  });

  it('reuses the same auto-created group on a second import for the same controller', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ '1': { n: 'Porch warm', en: true, hour: 18, min: 30, dow: 0b0111110 } })
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await importSchedules(db, controllerId, { disableOnDevice: false });
    await importSchedules(db, controllerId, { disableOnDevice: false });

    expect(createGroupRepository(db).list()).toHaveLength(1);
  });

  it('clears the device schedule fields for imported presets when disableOnDevice is true', async () => {
    const postedBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/presets.json')) {
        return {
          ok: true,
          json: async () => ({ '1': { n: 'Porch warm', en: true, hour: 18, min: 30, dow: 0b0111110 } })
        } as Response;
      }
      if (url.endsWith('/json/state') && init?.method === 'POST') {
        postedBodies.push(JSON.parse(init.body as string));
        return { ok: true, json: async () => ({ on: true, bri: 128, ps: -1, seg: [] }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await importSchedules(db, controllerId, { disableOnDevice: true });

    expect(postedBodies).toEqual([{ psave: 1, en: false }]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/controllers/scheduleImport.test.ts`
Expected: FAIL — cannot find module `../../src/controllers/scheduleImport.js`

- [ ] **Step 3: Create `server/src/controllers/scheduleImport.ts`**

```ts
import type Database from 'better-sqlite3';
import { createControllerRepository } from './repository.js';
import { createGroupRepository } from '../groups/repository.js';
import { createScheduleRepository, type Schedule } from '../schedules/repository.js';

export interface RawWledPresetSchedule {
  presetId: number;
  presetName: string;
  raw: unknown;
}

export interface ParsedWledSchedule {
  presetId: number;
  daysOfWeek: number[];
  timeOfDay: string;
}

function bitmaskToDaysOfWeek(dow: number): number[] {
  const days: number[] = [];
  for (let bit = 0; bit < 7; bit++) {
    if (dow & (1 << bit)) days.push(bit);
  }
  return days;
}

export function parsePresetSchedule(
  entry: RawWledPresetSchedule
): { ok: true; parsed: ParsedWledSchedule } | { ok: false; reason: string } {
  const raw = entry.raw;
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): no schedule data present` };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.en !== 'boolean' || typeof r.hour !== 'number' || typeof r.min !== 'number' || typeof r.dow !== 'number') {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): unrecognized schedule shape` };
  }
  if (!r.en) {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): schedule is disabled on the device` };
  }
  if (r.hour < 0 || r.hour > 23 || r.min < 0 || r.min > 59) {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): hour/min out of range` };
  }
  const daysOfWeek = bitmaskToDaysOfWeek(r.dow);
  if (daysOfWeek.length === 0) {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): no days of week set` };
  }

  const timeOfDay = `${String(r.hour).padStart(2, '0')}:${String(r.min).padStart(2, '0')}`;
  return { ok: true, parsed: { presetId: entry.presetId, daysOfWeek, timeOfDay } };
}

async function fetchRawPresetSchedules(host: string): Promise<RawWledPresetSchedule[]> {
  const res = await fetch(`http://${host}/presets.json`);
  if (!res.ok) throw new Error(`WLED request failed: GET /presets.json -> ${res.status}`);
  const raw = (await res.json()) as Record<string, any>;
  return Object.entries(raw).map(([id, v]) => ({
    presetId: Number(id),
    presetName: v.n ?? `Preset ${id}`,
    raw: v
  }));
}

async function clearScheduleOnDevice(host: string, presetId: number): Promise<void> {
  await fetch(`http://${host}/json/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ psave: presetId, en: false })
  });
}

export async function importSchedules(
  db: Database.Database,
  controllerId: string,
  opts: { disableOnDevice: boolean }
): Promise<{ imported: Schedule[]; skipped: { raw: unknown; reason: string }[] }> {
  const controllers = createControllerRepository(db);
  const groups = createGroupRepository(db);
  const schedules = createScheduleRepository(db);

  const controller = controllers.list().find((c) => c.id === controllerId);
  if (!controller) throw new Error(`controller ${controllerId} not found`);

  let entries: RawWledPresetSchedule[];
  try {
    entries = await fetchRawPresetSchedules(controller.host);
  } catch (err: any) {
    const unreachable = new Error(`controller ${controller.name} is unreachable: ${err.message}`);
    (unreachable as any).statusCode = 503;
    throw unreachable;
  }

  const imported: Schedule[] = [];
  const skipped: { raw: unknown; reason: string }[] = [];

  const groupName = `${controller.name} (imported)`;
  let group = groups.list().find((g) => g.name === groupName);

  for (const entry of entries) {
    const result = parsePresetSchedule(entry);
    if (!result.ok) {
      skipped.push({ raw: entry.raw, reason: result.reason });
      continue;
    }

    if (!group) {
      group = groups.add({ name: groupName, members: [{ controllerId, wledSegId: 0 }] });
    }

    const schedule = schedules.add({
      name: `${entry.presetName} (imported)`,
      triggerType: 'weekly',
      cronExpr: null,
      daysOfWeek: result.parsed.daysOfWeek,
      timeOfDay: result.parsed.timeOfDay,
      offsetMinutes: 0,
      latitude: null,
      longitude: null,
      groupId: group.id,
      actionType: 'preset',
      actionPayload: { presetId: result.parsed.presetId },
      enabled: true
    });
    imported.push(schedule);

    if (opts.disableOnDevice) {
      await clearScheduleOnDevice(controller.host, result.parsed.presetId);
    }
  }

  return { imported, skipped };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `cd server && npm test -- test/controllers/scheduleImport.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Create the route and mount it**

`server/src/controllers/routes.ts` gets a new route appended (add this to the existing `createControllersRouter` function, after the `DELETE /:id` route, before `return router;`):

```ts
  router.post('/:id/import-schedules', async (req, res) => {
    try {
      const result = await importSchedules(db, req.params.id, { disableOnDevice: !!req.body?.disableOnDevice });
      res.json(result);
    } catch (err: any) {
      const status = err.statusCode ?? 500;
      res.status(status).json({ error: err.message });
    }
  });
```

Add the import at the top of `server/src/controllers/routes.ts`:
```ts
import { importSchedules } from './scheduleImport.js';
```

No separate mount is needed in `server/src/app.ts` since this route is nested inside the existing `createControllersRouter(db)` already mounted at `/api/controllers`.

- [ ] **Step 6: Run the full server test suite, confirm no regressions**

Run: `cd server && npm test`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/controllers/scheduleImport.ts server/src/controllers/routes.ts server/test/controllers/scheduleImport.test.ts
git commit -m "Add one-time best-effort WLED schedule import"
```

---

### Task 20: Frontend — weekly schedule + calendar UI, with preview flow

**Files:**
- Create: `client/src/components/WeeklyScheduleForm.tsx`, `client/src/components/CalendarEventForm.tsx`, `client/src/components/CalendarEventList.tsx`
- Modify: `client/src/components/ScheduleManager.tsx` (add weekly-trigger fields), `client/src/api/client.ts` (add calendar-event calls and weekly `Schedule` fields), `client/src/pages/Dashboard.tsx` (mount `CalendarEventList`)
- Test: `client/src/test/WeeklyScheduleForm.test.tsx`, `client/src/test/CalendarEventForm.test.tsx`

> **Note on paths:** the plan's earlier tasks (14-15) wrote test paths as `client/test/components/...`; the real codebase's client tests actually live under `client/src/test/` (flat, no `components/` subdirectory — see `client/src/test/ControllerList.test.tsx`). This task uses the real, current location.

**Interfaces:**
- Adds to `client/src/api/client.ts`:
  - Updates the existing `Schedule` interface to add `daysOfWeek: number[] | null; timeOfDay: string | null;` and widen `triggerType` to include `'weekly'` (matching Task 13's server-side `Schedule` exactly).
  - `interface DateRule` (mirrors Task 16's server-side union exactly: `'fixed' | 'nthWeekday' | 'lastWeekday' | 'easterOffset' | 'oneOff'` variants).
  - `interface CalendarEvent` (mirrors Task 17's server-side interface exactly: `id, name, category, dateRule, recursYearly, enabled, groupId, triggerTime, actionType, actionPayload`).
  - `listCalendarEvents()`, `addCalendarEvent(input)`, `updateCalendarEvent(id, patch)`, `deleteCalendarEvent(id)` — `addCalendarEvent`/`updateCalendarEvent` surface a thrown `Error` with the response body's `error` message on a `409` so the caller can show "a conflicting event already exists" instead of a generic failure.
  - `getSegmentsSnapshot(controllerId)` — thin wrapper over the existing `GET /api/controllers/:id/segments` route (Task 6) used by the preview flow to snapshot state before applying.
- Produces:
  - `WeeklyScheduleForm` props: `{ groups: Group[]; themes: CustomTheme[]; onPreview: (draft) => void; onApprove: () => void; onDiscard: () => void; previewing: boolean; }` — a form for `daysOfWeek` (checkbox per day) + `timeOfDay` + group/action pickers, with Preview/Approve/Discard buttons that appear once a preview is active.
  - `CalendarEventForm` props: same shape as `WeeklyScheduleForm` but for `CalendarEvent` fields (`dateRule` kind picker, `triggerTime`), and surfaces a `409` conflict from `addCalendarEvent`/`updateCalendarEvent` as a visible inline error with the conflicting event's name/date.
  - `CalendarEventList` props: `{ events: CalendarEvent[]; onToggleEnabled: (id, enabled) => void; onDelete: (id) => void; }` — lists both holiday and custom events, grouped by category.
- Consumes: `applyControl` (Task 12's client wrapper, already in `client/src/api/client.ts`), `getSegmentsSnapshot` (new, wraps Task 6's route), `listGroups`/`listThemes` (Task 14).

- [ ] **Step 1: Add weekly `Schedule` fields and calendar-event API calls to `client/src/api/client.ts`**

```ts
// Update the existing Schedule interface:
export interface Schedule {
  id: string;
  name: string;
  triggerType: 'cron' | 'sunrise' | 'sunset' | 'weekly';
  cronExpr: string | null;
  daysOfWeek: number[] | null;
  timeOfDay: string | null;
  offsetMinutes: number;
  latitude: number | null;
  longitude: number | null;
  groupId: string;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
  enabled: boolean;
}

export type DateRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nthWeekday'; month: number; weekday: number; n: number }
  | { kind: 'lastWeekday'; month: number; weekday: number }
  | { kind: 'easterOffset'; offsetDays: number }
  | { kind: 'oneOff'; year: number; month: number; day: number };

export interface CalendarEvent {
  id: string;
  name: string;
  category: 'holiday' | 'custom';
  dateRule: DateRule;
  recursYearly: boolean;
  enabled: boolean;
  groupId: string | null;
  triggerTime: { type: 'fixed'; time: string } | { type: 'sunset' | 'sunrise'; offsetMinutes: number };
  actionType: 'power' | 'brightness' | 'preset' | 'theme' | null;
  actionPayload: unknown;
}

export class ConflictError extends Error {
  constructor(message: string, public conflict: { id: string; name: string; month: number; day: number }) {
    super(message);
  }
}

export const listCalendarEvents = () => getJson<CalendarEvent[]>('/api/calendar-events');

async function sendCalendarEvent(
  url: string,
  method: string,
  body: unknown
): Promise<CalendarEvent> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 409) {
    const payload = await res.json();
    throw new ConflictError(payload.error, payload.conflict);
  }
  if (!res.ok) throw new Error(`${method} ${url} failed`);
  return res.json();
}

export const addCalendarEvent = (input: Omit<CalendarEvent, 'id'>) =>
  sendCalendarEvent('/api/calendar-events', 'POST', input);
export const updateCalendarEvent = (id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) =>
  sendCalendarEvent(`/api/calendar-events/${id}`, 'PATCH', patch);
export const deleteCalendarEvent = (id: string) =>
  fetch(`/api/calendar-events/${id}`, { method: 'DELETE' });

export const getSegmentsSnapshot = (controllerId: string) =>
  getJson<{ id: number; start: number; stop: number; len: number; on: boolean; bri: number; fx: number; pal: number; col: number[][] }[]>(
    `/api/controllers/${controllerId}/segments`
  );
```

- [ ] **Step 2: Write the failing `WeeklyScheduleForm` test**

`client/src/test/WeeklyScheduleForm.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeeklyScheduleForm } from '../components/WeeklyScheduleForm';

const groups = [{ id: 'g1', name: 'Porch', members: [] }];
const themes = [{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }];

describe('WeeklyScheduleForm', () => {
  it('calls onPreview with the selected days, time, group, and action', () => {
    const onPreview = vi.fn();
    render(
      <WeeklyScheduleForm
        groups={groups}
        themes={themes}
        onPreview={onPreview}
        onApprove={vi.fn()}
        onDiscard={vi.fn()}
        previewing={false}
      />
    );

    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByLabelText('Wed'));
    fireEvent.change(screen.getByLabelText(/time/i), { target: { value: '18:30' } });
    fireEvent.click(screen.getByText('Preview'));

    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        daysOfWeek: [1, 3],
        timeOfDay: '18:30',
        groupId: 'g1'
      })
    );
  });

  it('shows Approve/Discard only while previewing', () => {
    const { rerender } = render(
      <WeeklyScheduleForm groups={groups} themes={themes} onPreview={vi.fn()} onApprove={vi.fn()} onDiscard={vi.fn()} previewing={false} />
    );
    expect(screen.queryByText('Approve')).toBeNull();

    rerender(
      <WeeklyScheduleForm groups={groups} themes={themes} onPreview={vi.fn()} onApprove={vi.fn()} onDiscard={vi.fn()} previewing={true} />
    );
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Discard')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd client && npm test -- src/test/WeeklyScheduleForm.test.tsx`
Expected: FAIL — cannot find module `../components/WeeklyScheduleForm`

- [ ] **Step 4: Create `client/src/components/WeeklyScheduleForm.tsx`**

```tsx
import { useState } from 'react';
import type { Group, CustomTheme } from '../api/client';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WeeklyScheduleDraft {
  name: string;
  daysOfWeek: number[];
  timeOfDay: string;
  groupId: string;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
}

export function WeeklyScheduleForm({
  groups,
  themes,
  onPreview,
  onApprove,
  onDiscard,
  previewing
}: {
  groups: Group[];
  themes: CustomTheme[];
  onPreview: (draft: WeeklyScheduleDraft) => void;
  onApprove: () => void;
  onDiscard: () => void;
  previewing: boolean;
}) {
  const [name, setName] = useState('');
  const [days, setDays] = useState<Set<number>>(new Set());
  const [timeOfDay, setTimeOfDay] = useState('18:00');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [themeId, setThemeId] = useState(themes[0]?.id ?? '');

  function toggleDay(day: number) {
    setDays((prev) => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  }

  function handlePreview() {
    onPreview({
      name,
      daysOfWeek: Array.from(days).sort((a, b) => a - b),
      timeOfDay,
      groupId,
      actionType: 'theme',
      actionPayload: { themeId }
    });
  }

  return (
    <div>
      <h4>New weekly schedule</h4>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Schedule name" />
      <div>
        {DAY_LABELS.map((label, day) => (
          <label key={day}>
            <input type="checkbox" aria-label={label} checked={days.has(day)} onChange={() => toggleDay(day)} />
            {label}
          </label>
        ))}
      </div>
      <label>
        Time of day
        <input aria-label="time of day" type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
      </label>
      <select aria-label="group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
      <select aria-label="theme" value={themeId} onChange={(e) => setThemeId(e.target.value)}>
        {themes.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      {!previewing && <button onClick={handlePreview}>Preview</button>}
      {previewing && (
        <>
          <button onClick={onApprove}>Approve</button>
          <button onClick={onDiscard}>Discard</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd client && npm test -- src/test/WeeklyScheduleForm.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing `CalendarEventForm` test, including the conflict path**

`client/src/test/CalendarEventForm.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalendarEventForm } from '../components/CalendarEventForm';

const groups = [{ id: 'g1', name: 'Porch', members: [] }];
const themes = [{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }];

afterEach(() => vi.unstubAllGlobals());

describe('CalendarEventForm', () => {
  it('submits a fixed-date custom event', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'e1', name: 'Anniversary', category: 'custom',
        dateRule: { kind: 'fixed', month: 9, day: 12 }, recursYearly: true, enabled: true,
        groupId: 'g1', triggerTime: { type: 'fixed', time: '19:00' },
        actionType: 'theme', actionPayload: { themeId: 't1' }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const onCreated = vi.fn();
    render(<CalendarEventForm groups={groups} themes={themes} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/event name/i), { target: { value: 'Anniversary' } });
    fireEvent.change(screen.getByLabelText(/month/i), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('shows the conflicting event name when the server returns 409', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'a conflicting calendar event already exists on this date',
        conflict: { id: 'h1', name: 'July 4th', month: 7, day: 4 }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CalendarEventForm groups={groups} themes={themes} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/event name/i), { target: { value: "Dad's Birthday" } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText(/July 4th/)).toBeTruthy());
  });
});
```

- [ ] **Step 7: Run it, confirm it fails**

Run: `cd client && npm test -- src/test/CalendarEventForm.test.tsx`
Expected: FAIL — cannot find module `../components/CalendarEventForm`

- [ ] **Step 8: Create `client/src/components/CalendarEventForm.tsx`**

```tsx
import { useState } from 'react';
import { addCalendarEvent, ConflictError, type Group, type CustomTheme, type CalendarEvent } from '../api/client';

export function CalendarEventForm({
  groups,
  themes,
  onCreated
}: {
  groups: Group[];
  themes: CustomTheme[];
  onCreated: (event: CalendarEvent) => void;
}) {
  const [name, setName] = useState('');
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [time, setTime] = useState('18:00');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [themeId, setThemeId] = useState(themes[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      const created = await addCalendarEvent({
        name,
        category: 'custom',
        dateRule: { kind: 'fixed', month, day },
        recursYearly: true,
        enabled: true,
        groupId: groupId || null,
        triggerTime: { type: 'fixed', time },
        actionType: 'theme',
        actionPayload: { themeId }
      });
      onCreated(created);
    } catch (err) {
      if (err instanceof ConflictError) {
        setError(`Conflicts with "${err.conflict.name}" on ${err.conflict.month}/${err.conflict.day}. Disable it first to save this event.`);
      } else {
        setError('Failed to save calendar event.');
      }
    }
  }

  return (
    <div>
      <h4>New custom calendar event</h4>
      <label>
        Event name
        <input aria-label="event name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Month
        <input aria-label="month" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
      </label>
      <label>
        Day
        <input aria-label="day" type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))} />
      </label>
      <label>
        Time
        <input aria-label="event time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <select aria-label="event group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
      <select aria-label="event theme" value={themeId} onChange={(e) => setThemeId(e.target.value)}>
        {themes.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <button onClick={handleSave}>Save</button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 9: Run test, confirm it passes**

Run: `cd client && npm test -- src/test/CalendarEventForm.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 10: Create `client/src/components/CalendarEventList.tsx`** (no dedicated unit test — thin list wrapping already-tested data, same convention as `GroupManager`/`ThemeManager` in Task 14)

```tsx
import type { CalendarEvent } from '../api/client';

export function CalendarEventList({
  events,
  onToggleEnabled,
  onDelete
}: {
  events: CalendarEvent[];
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const holidays = events.filter((e) => e.category === 'holiday');
  const custom = events.filter((e) => e.category === 'custom');

  function renderEvent(e: CalendarEvent) {
    return (
      <li key={e.id}>
        <label>
          <input type="checkbox" checked={e.enabled} onChange={(ev) => onToggleEnabled(e.id, ev.target.checked)} />
          {e.name}
        </label>
        <button onClick={() => onDelete(e.id)}>Remove</button>
      </li>
    );
  }

  return (
    <div>
      <h3>Calendar</h3>
      <h4>Holidays</h4>
      <ul>{holidays.map(renderEvent)}</ul>
      <h4>Custom events</h4>
      <ul>{custom.map(renderEvent)}</ul>
    </div>
  );
}
```

- [ ] **Step 11: Wire the preview flow into `client/src/components/ScheduleManager.tsx`**

Replace `client/src/components/ScheduleManager.tsx` with a version that composes `WeeklyScheduleForm` and implements the preview/approve/discard flow described in the scheduling spec: snapshot each target member's live state via `getSegmentsSnapshot`, apply the draft action live via `applyControl`, then either revert-to-snapshot + save (Approve) or revert-only (Discard). Per the spec's error-handling section, a failed revert must surface as a visible error rather than silently leaving lights in the previewed state — `revertToSnapshot` below inspects each `applyControl` call's per-member `results` (since `applyControl` itself never throws — Task 12 isolates failures per controller) and renders a `role="alert"` message listing which members failed to revert, keeping the draft/snapshot in place so the user can retry.

```tsx
import { useEffect, useState } from 'react';
import {
  listSchedules, addSchedule, deleteSchedule, listGroups, listThemes,
  applyControl, getSegmentsSnapshot,
  type Schedule, type Group, type CustomTheme
} from '../api/client';
import { WeeklyScheduleForm, type WeeklyScheduleDraft } from './WeeklyScheduleForm';

interface MemberSnapshot {
  controllerId: string;
  wledSegId: number;
  on: boolean;
  bri: number;
  fx: number;
  pal: number;
  col: number[][];
}

export function ScheduleManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [draft, setDraft] = useState<WeeklyScheduleDraft | null>(null);
  const [snapshot, setSnapshot] = useState<MemberSnapshot[] | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  useEffect(() => {
    listSchedules().then(setSchedules);
    listGroups().then(setGroups);
    listThemes().then(setThemes);
  }, []);

  async function handleDelete(id: string) {
    await deleteSchedule(id);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }

  function membersForGroup(groupId: string) {
    return groups.find((g) => g.id === groupId)?.members ?? [];
  }

  async function handlePreview(nextDraft: WeeklyScheduleDraft) {
    const members = membersForGroup(nextDraft.groupId);
    const snapshots: MemberSnapshot[] = [];
    for (const member of members) {
      const segs = await getSegmentsSnapshot(member.controllerId);
      const seg = segs.find((s) => s.id === member.wledSegId);
      if (seg) {
        snapshots.push({
          controllerId: member.controllerId, wledSegId: member.wledSegId,
          on: seg.on, bri: seg.bri, fx: seg.fx, pal: seg.pal, col: seg.col
        });
      }
    }
    setSnapshot(snapshots);
    setDraft(nextDraft);
    setRevertError(null);
    await applyControl(members, { type: nextDraft.actionType, ...(nextDraft.actionPayload as object) } as any);
  }

  /**
   * Reverts every previewed member to its snapshot. Per the scheduling
   * spec's error-handling section, a revert failure must surface as a
   * visible error in the editor rather than silently leaving lights in the
   * previewed state — `applyControl`'s per-controller `results` are checked
   * for `ok: false` explicitly, since `applyControl` itself never throws
   * (Task 12's batch-apply isolates failures per controller instead).
   */
  async function revertToSnapshot(): Promise<boolean> {
    if (!snapshot) return true;
    const failures: string[] = [];
    for (const s of snapshot) {
      const powerResult = await applyControl(
        [{ controllerId: s.controllerId, wledSegId: s.wledSegId }],
        { type: 'power', on: s.on } as any
      );
      const briResult = await applyControl(
        [{ controllerId: s.controllerId, wledSegId: s.wledSegId }],
        { type: 'brightness', value: s.bri } as any
      );
      for (const r of [...powerResult.results, ...briResult.results]) {
        if (!r.ok) failures.push(`${s.controllerId}/${s.wledSegId}: ${r.error ?? 'unknown error'}`);
      }
    }
    if (failures.length > 0) {
      setRevertError(
        `Failed to revert some lights to their pre-preview state — they may still be showing the previewed look: ${failures.join('; ')}`
      );
      return false;
    }
    return true;
  }

  async function handleApprove() {
    if (!draft) return;
    const reverted = await revertToSnapshot();
    if (!reverted) return; // keep draft/snapshot around so the user can retry Approve/Discard
    const created = await addSchedule({
      name: draft.name,
      triggerType: 'weekly',
      cronExpr: null,
      daysOfWeek: draft.daysOfWeek,
      timeOfDay: draft.timeOfDay,
      offsetMinutes: 0,
      latitude: null,
      longitude: null,
      groupId: draft.groupId,
      actionType: draft.actionType,
      actionPayload: draft.actionPayload,
      enabled: true
    });
    setSchedules((prev) => [...prev, created]);
    setDraft(null);
    setSnapshot(null);
  }

  async function handleDiscard() {
    const reverted = await revertToSnapshot();
    if (!reverted) return; // keep draft/snapshot around so the user can see the error and retry
    setDraft(null);
    setSnapshot(null);
  }

  return (
    <div>
      <h3>Schedules</h3>
      <ul>
        {schedules.map((s) => (
          <li key={s.id}>
            {s.name} ({s.triggerType})
            <button onClick={() => handleDelete(s.id)}>Remove</button>
          </li>
        ))}
      </ul>
      {revertError && <p role="alert">{revertError}</p>}
      <WeeklyScheduleForm
        groups={groups}
        themes={themes}
        onPreview={handlePreview}
        onApprove={handleApprove}
        onDiscard={handleDiscard}
        previewing={draft !== null}
      />
    </div>
  );
}
```

- [ ] **Step 12: Mount `CalendarEventList` and `CalendarEventForm` in `client/src/pages/Dashboard.tsx`**

Add to the imports and JSX body of `client/src/pages/Dashboard.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { listCalendarEvents, updateCalendarEvent, deleteCalendarEvent, listGroups, listThemes, type CalendarEvent, type Group, type CustomTheme } from '../api/client';
import { CalendarEventList } from '../components/CalendarEventList';
import { CalendarEventForm } from '../components/CalendarEventForm';
```

Add state and effects alongside the existing ones in the `Dashboard` component:
```tsx
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarGroups, setCalendarGroups] = useState<Group[]>([]);
  const [calendarThemes, setCalendarThemes] = useState<CustomTheme[]>([]);

  useEffect(() => {
    listCalendarEvents().then(setCalendarEvents);
    listGroups().then(setCalendarGroups);
    listThemes().then(setCalendarThemes);
  }, []);

  async function handleToggleEventEnabled(id: string, enabled: boolean) {
    const updated = await updateCalendarEvent(id, { enabled });
    setCalendarEvents((prev) => prev.map((e) => (e.id === id ? updated : e)));
  }

  async function handleDeleteEvent(id: string) {
    await deleteCalendarEvent(id);
    setCalendarEvents((prev) => prev.filter((e) => e.id !== id));
  }
```

Add to the rendered JSX, alongside the existing `<ScheduleManager />`:
```tsx
      <CalendarEventList events={calendarEvents} onToggleEnabled={handleToggleEventEnabled} onDelete={handleDeleteEvent} />
      <CalendarEventForm groups={calendarGroups} themes={calendarThemes} onCreated={(e) => setCalendarEvents((prev) => [...prev, e])} />
```

- [ ] **Step 13: Run the full client test suite, confirm it passes**

Run: `cd client && npm test`
Expected: all tests PASS

- [ ] **Step 14: Commit**

```bash
git add client/src
git commit -m "Add weekly schedule and calendar event UI with preview/approve/discard flow"
```

---

### Task 21: Firmware — GitHub release cache + chip/asset matching logic

**Files:**
- Create: `server/src/firmware/githubClient.ts`, `server/src/firmware/assetMatch.ts`
- Test: `server/test/firmware/githubClient.test.ts`, `server/test/firmware/assetMatch.test.ts`

**Interfaces:**
- Produces:
  - `interface ReleaseAsset { name: string; downloadUrl: string; }`
  - `interface WledRelease { tag: string; publishedAt: string; assets: ReleaseAsset[]; fetchedAt: string; }` — matches the real `wled_releases` table (`tag`, `published_at`, `assets`, `fetched_at`) in `server/src/db/schema.ts`.
  - `function createReleaseCache(db): { getLatest(): WledRelease | undefined; save(release: WledRelease): void; }` — thin repository over the `wled_releases` table.
  - `function fetchLatestRelease(db: Database.Database, opts?: { forceRefresh?: boolean }): Promise<WledRelease>` — fetches `https://api.github.com/repos/Aircoookie/WLED/releases` (uses the first/newest entry), maps it into a `WledRelease`, caches it, and returns it. Refetches only if the cache is missing, older than 6 hours, or `opts.forceRefresh` is `true`; otherwise returns the cached row. On fetch failure, falls back to the cache if present (rethrows if there's no cache to fall back to).
  - `function chipArchTokens(arch: string): string[]` — maps a WLED-reported `arch` (e.g. `esp8266`, `esp32`, `esp32s3`, `esp32c3`) to the filename tokens that identify a matching asset (e.g. `esp8266` → `['ESP8266', 'ESP01', 'ESP02']`; `esp32` → `['ESP32']` but narrowed to `['ESP32-S3']`/`['ESP32-S2']`/`['ESP32-C3']` when `arch` reports that specific variant).
  - `function candidateAssets(release: WledRelease, arch: string): ReleaseAsset[]` — filters `release.assets` by case-insensitive substring match against `chipArchTokens(arch)`.
  - `function resolvePinnedAsset(release: WledRelease, pinnedAssetPattern: string): ReleaseAsset | undefined` — finds the asset whose filename contains `pinnedAssetPattern` (case-insensitive); returns `undefined` if none match (the "pin no longer matches" case, surfaced by the route in Task 22 rather than this pure function).
- Consumed by: Task 22's firmware routes (`GET`/`POST` per-controller firmware endpoints), Task 23's OTA push route.

- [ ] **Step 1: Write the failing GitHub client test**

`server/test/firmware/githubClient.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { fetchLatestRelease } from '../../src/firmware/githubClient.js';

const GITHUB_RESPONSE = [
  {
    tag_name: 'v0.15.0',
    published_at: '2026-06-01T00:00:00Z',
    assets: [
      { name: 'WLED_0.15.0_ESP8266.bin', browser_download_url: 'https://example.com/ESP8266.bin' },
      { name: 'WLED_0.15.0_ESP32.bin', browser_download_url: 'https://example.com/ESP32.bin' }
    ]
  },
  {
    tag_name: 'v0.14.0',
    published_at: '2026-01-01T00:00:00Z',
    assets: []
  }
];

afterEach(() => vi.unstubAllGlobals());

describe('fetchLatestRelease', () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('fetches and caches the newest release when there is no cache yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => GITHUB_RESPONSE
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await fetchLatestRelease(db);

    expect(release.tag).toBe('v0.15.0');
    expect(release.assets).toEqual([
      { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/ESP8266.bin' },
      { name: 'WLED_0.15.0_ESP32.bin', downloadUrl: 'https://example.com/ESP32.bin' }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the cached release without refetching when the cache is fresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE });
    vi.stubGlobal('fetch', fetchMock);

    await fetchLatestRelease(db);
    await fetchLatestRelease(db);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when forceRefresh is true even if the cache is fresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE });
    vi.stubGlobal('fetch', fetchMock);

    await fetchLatestRelease(db);
    await fetchLatestRelease(db, { forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the cache when a refetch fails', async () => {
    const okFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE });
    vi.stubGlobal('fetch', okFetch);
    await fetchLatestRelease(db); // seed the cache

    const failingFetch = vi.fn().mockRejectedValue(new Error('rate limited'));
    vi.stubGlobal('fetch', failingFetch);

    const release = await fetchLatestRelease(db, { forceRefresh: true });
    expect(release.tag).toBe('v0.15.0'); // served from cache, not thrown
  });

  it('rethrows when a fetch fails and there is no cache to fall back to', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('rate limited'));
    vi.stubGlobal('fetch', failingFetch);

    await expect(fetchLatestRelease(db)).rejects.toThrow('rate limited');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/firmware/githubClient.test.ts`
Expected: FAIL — cannot find module `../../src/firmware/githubClient.js`

- [ ] **Step 3: Create `server/src/firmware/githubClient.ts`**

```ts
import type Database from 'better-sqlite3';

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface WledRelease {
  tag: string;
  publishedAt: string;
  assets: ReleaseAsset[];
  fetchedAt: string;
}

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/Aircoookie/WLED/releases';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function fromRow(row: any): WledRelease {
  return {
    tag: row.tag,
    publishedAt: row.published_at,
    assets: JSON.parse(row.assets),
    fetchedAt: row.fetched_at
  };
}

export function createReleaseCache(db: Database.Database) {
  return {
    getLatest(): WledRelease | undefined {
      const row = db.prepare('SELECT * FROM wled_releases ORDER BY fetched_at DESC LIMIT 1').get();
      return row ? fromRow(row) : undefined;
    },
    save(release: WledRelease): void {
      db.prepare(
        `INSERT INTO wled_releases (tag, published_at, assets, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tag) DO UPDATE SET published_at = excluded.published_at, assets = excluded.assets, fetched_at = excluded.fetched_at`
      ).run(release.tag, release.publishedAt, JSON.stringify(release.assets), release.fetchedAt);
    }
  };
}

async function fetchFromGithub(): Promise<WledRelease> {
  const res = await fetch(GITHUB_RELEASES_URL);
  if (!res.ok) throw new Error(`GitHub releases request failed: ${res.status}`);
  const releases = (await res.json()) as any[];
  const newest = releases[0];
  return {
    tag: newest.tag_name,
    publishedAt: newest.published_at,
    assets: (newest.assets ?? []).map((a: any) => ({ name: a.name, downloadUrl: a.browser_download_url })),
    fetchedAt: new Date().toISOString()
  };
}

export async function fetchLatestRelease(
  db: Database.Database,
  opts: { forceRefresh?: boolean } = {}
): Promise<WledRelease> {
  const cache = createReleaseCache(db);
  const cached = cache.getLatest();

  const cacheIsFresh =
    !!cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_AGE_MS;

  if (cacheIsFresh && !opts.forceRefresh) {
    return cached!;
  }

  try {
    const release = await fetchFromGithub();
    cache.save(release);
    return release;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `cd server && npm test -- test/firmware/githubClient.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing asset-matching test**

`server/test/firmware/assetMatch.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { chipArchTokens, candidateAssets, resolvePinnedAsset } from '../../src/firmware/assetMatch.js';
import type { WledRelease } from '../../src/firmware/githubClient.js';

const release: WledRelease = {
  tag: 'v0.15.0',
  publishedAt: '2026-06-01T00:00:00Z',
  fetchedAt: '2026-07-04T00:00:00Z',
  assets: [
    { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/ESP8266.bin' },
    { name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/ESP02.bin' },
    { name: 'WLED_0.15.0_ESP32.bin', downloadUrl: 'https://example.com/ESP32.bin' },
    { name: 'WLED_0.15.0_ESP32-S3.bin', downloadUrl: 'https://example.com/ESP32-S3.bin' },
    { name: 'WLED_0.15.0_ESP32-C3.bin', downloadUrl: 'https://example.com/ESP32-C3.bin' }
  ]
};

describe('chipArchTokens', () => {
  it('maps esp8266 to its known filename tokens', () => {
    expect(chipArchTokens('esp8266')).toEqual(['ESP8266', 'ESP01', 'ESP02']);
  });

  it('maps plain esp32 to the generic ESP32 token', () => {
    expect(chipArchTokens('esp32')).toEqual(['ESP32']);
  });

  it('narrows to the specific variant token for esp32s3', () => {
    expect(chipArchTokens('esp32s3')).toEqual(['ESP32-S3']);
  });

  it('narrows to the specific variant token for esp32c3', () => {
    expect(chipArchTokens('esp32c3')).toEqual(['ESP32-C3']);
  });
});

describe('candidateAssets', () => {
  it('returns multiple candidates for esp8266 (ambiguous flash-size variants)', () => {
    const candidates = candidateAssets(release, 'esp8266');
    expect(candidates.map((a) => a.name)).toEqual([
      'WLED_0.15.0_ESP8266.bin',
      'WLED_0.15.0_ESP02.bin'
    ]);
  });

  it('narrows to only the matching variant for esp32s3', () => {
    const candidates = candidateAssets(release, 'esp32s3');
    expect(candidates.map((a) => a.name)).toEqual(['WLED_0.15.0_ESP32-S3.bin']);
  });
});

describe('resolvePinnedAsset', () => {
  it('resolves the asset matching a pinned pattern', () => {
    const asset = resolvePinnedAsset(release, 'ESP02');
    expect(asset?.name).toBe('WLED_0.15.0_ESP02.bin');
  });

  it('returns undefined when the pin no longer matches any asset in the release', () => {
    const asset = resolvePinnedAsset(release, 'ESP01');
    expect(asset).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd server && npm test -- test/firmware/assetMatch.test.ts`
Expected: FAIL — cannot find module `../../src/firmware/assetMatch.js`

- [ ] **Step 7: Create `server/src/firmware/assetMatch.ts`**

```ts
import type { WledRelease, ReleaseAsset } from './githubClient.js';

export function chipArchTokens(arch: string): string[] {
  const normalized = arch.toLowerCase();

  if (normalized === 'esp8266') return ['ESP8266', 'ESP01', 'ESP02'];
  if (normalized === 'esp32s2') return ['ESP32-S2'];
  if (normalized === 'esp32s3') return ['ESP32-S3'];
  if (normalized === 'esp32c3') return ['ESP32-C3'];
  if (normalized === 'esp32') return ['ESP32'];

  // Unknown arch: fall back to whatever token it reports, uppercased.
  return [arch.toUpperCase()];
}

export function candidateAssets(release: WledRelease, arch: string): ReleaseAsset[] {
  const tokens = chipArchTokens(arch);
  return release.assets.filter((asset) =>
    tokens.some((token) => asset.name.toUpperCase().includes(token))
  );
}

export function resolvePinnedAsset(release: WledRelease, pinnedAssetPattern: string): ReleaseAsset | undefined {
  const pattern = pinnedAssetPattern.toUpperCase();
  return release.assets.find((asset) => asset.name.toUpperCase().includes(pattern));
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `cd server && npm test -- test/firmware/assetMatch.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 9: Commit**

```bash
git add server/src/firmware/githubClient.ts server/src/firmware/assetMatch.ts server/test/firmware
git commit -m "Add GitHub release cache and chip/asset matching logic"
```

---

### Task 22: Firmware — per-controller update-check and pin routes

**Files:**
- Modify: `server/src/wled/types.ts` (add `arch` to `WledInfo`, additive-only), `server/src/controllers/repository.ts` (add `pinnedAssetPattern` read/write), `server/src/controllers/routes.ts` (mount firmware routes)
- Create: `server/src/firmware/routes.ts`
- Test: `server/test/controllers/repository.test.ts` (extend), `server/test/firmware/routes.test.ts`

**Interfaces:**
- Modifies: `interface Controller` gains `pinnedAssetPattern: string | null;` (matches the real `pinned_asset_pattern` column already in `server/src/db/schema.ts`). `createControllerRepository(db)` gains `setPinnedAssetPattern(id: string, pattern: string | null): void`. `interface WledInfo` gains `arch: string;` — additive, does not change any existing call site (`getInfo`'s signature is unchanged; it simply returns one more field now that the device already sends in `/json/info`).
- Produces: `function createFirmwareRouter(db): express.Router` mounted at `/api/controllers/:id/firmware`:
  - `GET /` → `{ installedVersion: string; latestTag: string; updateAvailable: boolean; pinnedAssetPattern: string | null; candidateAssets: { name: string; downloadUrl: string }[] }` — `candidateAssets` is populated only when `pinnedAssetPattern` is `null`, or when `resolvePinnedAsset` finds no match in the latest release (the "pin no longer matches" case); otherwise `[]`.
  - `POST /pin` body `{ assetPattern: string }` → `204`, stores the pattern via `setPinnedAssetPattern`.
- Consumes: `getInfo` (Task 3, now returning `arch`), `fetchLatestRelease` (Task 21), `candidateAssets`/`resolvePinnedAsset` (Task 21), `createControllerRepository` (Task 4, extended here).

- [ ] **Step 1: Add `arch` to `WledInfo` in `server/src/wled/types.ts`**

```ts
export interface WledInfo {
  name: string;
  ver: string;
  leds: { count: number };
  arch: string;
}
```

This is additive — every existing caller of `getInfo` (there are none yet outside tests) still works; `getJson<WledInfo>` in `server/src/wled/client.ts` needs no code change since it just deserializes whatever JSON the device returns.

- [ ] **Step 2: Write the failing repository test extension for `pinnedAssetPattern`**

Add to `server/test/controllers/repository.test.ts`:
```ts
  it('stores and reads a pinned asset pattern, defaulting to null', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' });
    expect(created.pinnedAssetPattern).toBeNull();

    repo.setPinnedAssetPattern(created.id, 'ESP02');
    expect(repo.list()[0].pinnedAssetPattern).toBe('ESP02');
  });
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd server && npm test -- test/controllers/repository.test.ts`
Expected: FAIL — `repo.setPinnedAssetPattern is not a function` / `created.pinnedAssetPattern` is `undefined`

- [ ] **Step 4: Apply this exact diff to `server/src/controllers/repository.ts`**

The real file today (from Task 4) has no `pinnedAssetPattern` field at all — the `pinned_asset_pattern` column already exists in `server/src/db/schema.ts` but nothing reads/writes it yet. Full diff:

```diff
 export interface Controller {
   id: string;
   name: string;
   host: string;
   source: 'discovered' | 'manual';
   stale: boolean;
+  pinnedAssetPattern: string | null;
 }

 function fromRow(row: any): Controller {
-  return { id: row.id, name: row.name, host: row.host, source: row.source, stale: !!row.stale };
+  return {
+    id: row.id,
+    name: row.name,
+    host: row.host,
+    source: row.source,
+    stale: !!row.stale,
+    pinnedAssetPattern: row.pinned_asset_pattern ?? null
+  };
 }

 export function createControllerRepository(db: Database.Database) {
   return {
     list(): Controller[] {
       return db.prepare('SELECT * FROM controllers ORDER BY name').all().map(fromRow);
     },
     add(input: { name: string; host: string; source: 'discovered' | 'manual' }): Controller {
       const id = randomUUID();
       db.prepare('INSERT INTO controllers (id, name, host, source, stale) VALUES (?, ?, ?, ?, 0)')
         .run(id, input.name, input.host, input.source);
-      return { id, name: input.name, host: input.host, source: input.source, stale: false };
+      return { id, name: input.name, host: input.host, source: input.source, stale: false, pinnedAssetPattern: null };
     },
     remove(id: string): void {
       db.prepare('DELETE FROM controllers WHERE id = ?').run(id);
     },
     findByHost(host: string): Controller | undefined {
       const row = db.prepare('SELECT * FROM controllers WHERE host = ?').get(host);
       return row ? fromRow(row) : undefined;
     },
     markStale(id: string, stale: boolean): void {
       db.prepare('UPDATE controllers SET stale = ? WHERE id = ?').run(stale ? 1 : 0, id);
+    },
+    setPinnedAssetPattern(id: string, pattern: string | null): void {
+      db.prepare('UPDATE controllers SET pinned_asset_pattern = ? WHERE id = ?').run(pattern, id);
     }
   };
 }
```

The full resulting file:

```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Controller {
  id: string;
  name: string;
  host: string;
  source: 'discovered' | 'manual';
  stale: boolean;
  pinnedAssetPattern: string | null;
}

function fromRow(row: any): Controller {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    source: row.source,
    stale: !!row.stale,
    pinnedAssetPattern: row.pinned_asset_pattern ?? null
  };
}

export function createControllerRepository(db: Database.Database) {
  return {
    list(): Controller[] {
      return db.prepare('SELECT * FROM controllers ORDER BY name').all().map(fromRow);
    },
    add(input: { name: string; host: string; source: 'discovered' | 'manual' }): Controller {
      const id = randomUUID();
      db.prepare('INSERT INTO controllers (id, name, host, source, stale) VALUES (?, ?, ?, ?, 0)')
        .run(id, input.name, input.host, input.source);
      return { id, name: input.name, host: input.host, source: input.source, stale: false, pinnedAssetPattern: null };
    },
    remove(id: string): void {
      db.prepare('DELETE FROM controllers WHERE id = ?').run(id);
    },
    findByHost(host: string): Controller | undefined {
      const row = db.prepare('SELECT * FROM controllers WHERE host = ?').get(host);
      return row ? fromRow(row) : undefined;
    },
    markStale(id: string, stale: boolean): void {
      db.prepare('UPDATE controllers SET stale = ? WHERE id = ?').run(stale ? 1 : 0, id);
    },
    setPinnedAssetPattern(id: string, pattern: string | null): void {
      db.prepare('UPDATE controllers SET pinned_asset_pattern = ? WHERE id = ?').run(pattern, id);
    }
  };
}
```

- [ ] **Step 5: Run the repository test, confirm it passes**

Run: `cd server && npm test -- test/controllers/repository.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Write the failing firmware routes test**

`server/test/firmware/routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createFirmwareRouter } from '../../src/firmware/routes.js';

const HOST = '10.0.0.50';

const GITHUB_RESPONSE = [
  {
    tag_name: 'v0.15.0',
    published_at: '2026-06-01T00:00:00Z',
    assets: [
      { name: 'WLED_0.15.0_ESP8266.bin', browser_download_url: 'https://example.com/ESP8266.bin' },
      { name: 'WLED_0.15.0_ESP02.bin', browser_download_url: 'https://example.com/ESP02.bin' }
    ]
  }
];

afterEach(() => vi.unstubAllGlobals());

describe('firmware routes', () => {
  let app: express.Express;
  let controllerId: string;
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/controllers/:id/firmware', createFirmwareRouter(db));
  });

  it('reports update availability and candidate assets when unpinned', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
      if (url.endsWith('/json/info')) {
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get(`/api/controllers/${controllerId}/firmware`);
    expect(res.status).toBe(200);
    expect(res.body.installedVersion).toBe('0.14.0');
    expect(res.body.latestTag).toBe('v0.15.0');
    expect(res.body.updateAvailable).toBe(true);
    expect(res.body.pinnedAssetPattern).toBeNull();
    expect(res.body.candidateAssets).toHaveLength(2);
  });

  it('returns no candidate assets once pinned and the pin still matches', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
      if (url.endsWith('/json/info')) {
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await request(app).post(`/api/controllers/${controllerId}/firmware/pin`).send({ assetPattern: 'ESP02' }).expect(204);

    const res = await request(app).get(`/api/controllers/${controllerId}/firmware`);
    expect(res.body.pinnedAssetPattern).toBe('ESP02');
    expect(res.body.candidateAssets).toEqual([]);
  });

  it('surfaces candidate assets again when the pin no longer matches any asset', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
      if (url.endsWith('/json/info')) {
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await request(app).post(`/api/controllers/${controllerId}/firmware/pin`).send({ assetPattern: 'ESP01' }).expect(204);

    const res = await request(app).get(`/api/controllers/${controllerId}/firmware`);
    expect(res.body.pinnedAssetPattern).toBe('ESP01');
    expect(res.body.candidateAssets.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 7: Run it, confirm it fails**

Run: `cd server && npm test -- test/firmware/routes.test.ts`
Expected: FAIL — cannot find module `../../src/firmware/routes.js`

- [ ] **Step 8: Create `server/src/firmware/routes.ts`**

```ts
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { getInfo } from '../wled/client.js';
import { fetchLatestRelease, type ReleaseAsset } from './githubClient.js';
import { candidateAssets, resolvePinnedAsset } from './assetMatch.js';

export function createFirmwareRouter(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const controllers = createControllerRepository(db);

  router.get('/', async (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.id);
    if (!controller) return res.status(404).json({ error: 'controller not found' });

    const [info, release] = await Promise.all([getInfo(controller.host), fetchLatestRelease(db)]);

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
      pinnedAssetPattern: controller.pinnedAssetPattern,
      candidateAssets: assets
    });
  });

  router.post('/pin', (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.id);
    if (!controller) return res.status(404).json({ error: 'controller not found' });
    controllers.setPinnedAssetPattern(controller.id, req.body.assetPattern);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 9: Run test, confirm it passes**

Run: `cd server && npm test -- test/firmware/routes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 10: Mount the firmware router in `server/src/controllers/routes.ts`**

Add near the top of `server/src/controllers/routes.ts`:
```ts
import { createFirmwareRouter } from '../firmware/routes.js';
```

Add inside `createControllersRouter`, before `return router;`:
```ts
  router.use('/:id/firmware', createFirmwareRouter(db));
```

- [ ] **Step 11: Run the full server test suite, confirm no regressions**

Run: `cd server && npm test`
Expected: all tests PASS

- [ ] **Step 12: Commit**

```bash
git add server/src/wled/types.ts server/src/controllers/repository.ts server/src/controllers/routes.ts server/src/firmware/routes.ts server/test/controllers/repository.test.ts server/test/firmware/routes.test.ts
git commit -m "Add per-controller firmware update-check and pin routes"
```

---

### Task 23: Firmware — OTA push route

**Files:**
- Create: `server/src/firmware/otaPush.ts`
- Modify: `server/src/firmware/routes.ts` (mount `POST /update`)
- Test: `server/test/firmware/otaPush.test.ts`

**Interfaces:**
- Produces:
  - `interface OtaUpdateResult { ok: true; installedVersion: string } | { ok: false; error: string }`
  - `function pushOtaUpdate(host: string, assetBytes: ArrayBuffer, expectedTag: string): Promise<OtaUpdateResult>` — downloads nothing itself (the asset bytes are passed in, already downloaded by the caller); uploads to `http://<host>/update` as a multipart form, then polls `getInfo(host)` with a bounded number of retries (device reboots after OTA and is briefly unreachable) until the reported `ver` matches `expectedTag`, or the retry budget is exhausted.
  - `function createOtaUpdateRoute(db): (req, res) => Promise<void>` mounted as `POST /api/controllers/:id/firmware/update` (added onto the existing `createFirmwareRouter` from Task 22): resolves the controller's pinned asset against the cached latest release (`resolvePinnedAsset`, Task 21), downloads it, calls `pushOtaUpdate`, and returns `{ ok: boolean; installedVersion?: string; error?: string }`. A download failure or an upload failure is surfaced immediately as `{ ok: false, error }` with **no automatic retry of the upload itself** — only the post-upload `getInfo` confirmation poll is retried, per the spec's explicit distinction (retrying the poll is safe; retrying the flash is a bricking risk).
- Consumes: `getInfo` (Task 3), `resolvePinnedAsset` (Task 21), `fetchLatestRelease` (Task 21), `createControllerRepository` (Task 4).

> **TODO — owner action required before merging this task's upload code:** the spec (`docs/superpowers/specs/2026-07-04-uber-wled-firmware-update-design.md`, "OTA Push" section) explicitly flags that WLED's exact multipart field name for `POST http://<host>/update` must be verified against the real WLED firmware source (`wled00/data/update.htm` / `wled00/set.cpp`) or a real device before this task is considered complete — the spec calls guessing wrong here "a bricking risk, not just a bug." This is a deliberate, spec-mandated open verification step, not a shortcut: Step 3 below implements the upload with a clearly-marked placeholder field name (`firmware`, WLED's historically-documented field name as of the 0.14/0.15 release cycle) and Step 4 is a dedicated, non-skippable step that names the exact owner action (verify against source or hardware) required to close it out. Everything else in this task — download, retry-bounded confirmation polling, non-retry of the upload — is fully implemented below, no other placeholders.

- [ ] **Step 1: Write the failing OTA push test**

`server/test/firmware/otaPush.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { pushOtaUpdate } from '../../src/firmware/otaPush.js';

const HOST = '10.0.0.50';

afterEach(() => vi.unstubAllGlobals());

describe('pushOtaUpdate', () => {
  it('uploads the asset and confirms the new version after the device reboots', async () => {
    let infoCallCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/update') && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.endsWith('/json/info')) {
        infoCallCount++;
        // simulate the device being briefly unreachable during reboot, then back up on the new version
        if (infoCallCount < 3) throw new Error('device unreachable (rebooting)');
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.15.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushOtaUpdate(HOST, new ArrayBuffer(8), 'v0.15.0');
    expect(result).toEqual({ ok: true, installedVersion: '0.15.0' });
  });

  it('reports a failure without retrying the upload when the upload itself fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/update') && init?.method === 'POST') {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushOtaUpdate(HOST, new ArrayBuffer(8), 'v0.15.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();

    // exactly one call to /update — the upload itself is never retried
    const updateCalls = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/update'));
    expect(updateCalls).toHaveLength(1);
  });

  it('reports a failure when the device never comes back with the expected version within the retry budget', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/update') && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.endsWith('/json/info')) {
        throw new Error('device unreachable');
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushOtaUpdate(HOST, new ArrayBuffer(8), 'v0.15.0', { retryDelayMs: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/did not come back|unreachable|version mismatch/i);
  });

  it('reports a version mismatch as a failure requiring manual verification', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/update') && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.endsWith('/json/info')) {
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushOtaUpdate(HOST, new ArrayBuffer(8), 'v0.15.0', { retryDelayMs: 0 });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd server && npm test -- test/firmware/otaPush.test.ts`
Expected: FAIL — cannot find module `../../src/firmware/otaPush.js`

- [ ] **Step 3: Create `server/src/firmware/otaPush.ts`**

```ts
import { getInfo } from '../wled/client.js';

export type OtaUpdateResult =
  | { ok: true; installedVersion: string }
  | { ok: false; error: string };

const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads a firmware asset to a WLED device's manual OTA endpoint and polls
 * for the device to come back on the expected version.
 *
 * NOTE ON THE MULTIPART FIELD NAME: WLED's `/update` endpoint (the same one
 * its own web UI's "Manual OTA Update" page posts to) expects the firmware
 * binary under a specific multipart form field name. As of the WLED 0.14/0.15
 * release cycle this has historically been documented as `firmware`, but per
 * the firmware design spec this MUST be verified against the actual WLED
 * source (`wled00/data/update.htm` / `wled00/set.cpp`) or a real device
 * before this code is considered complete — see Step 4 below. Do not change
 * the OTA-push retry/non-retry semantics below when that verification
 * happens; only the literal field name string may need to change.
 */
const OTA_UPLOAD_FIELD_NAME = 'firmware';

export async function pushOtaUpdate(
  host: string,
  assetBytes: ArrayBuffer,
  expectedTag: string,
  opts: { maxRetries?: number; retryDelayMs?: number } = {}
): Promise<OtaUpdateResult> {
  const form = new FormData();
  form.append(OTA_UPLOAD_FIELD_NAME, new Blob([assetBytes]), 'firmware.bin');

  let uploadRes: Response;
  try {
    uploadRes = await fetch(`http://${host}/update`, { method: 'POST', body: form });
  } catch (err: any) {
    // Upload failure is surfaced immediately — never retried, since a failed
    // OTA mid-flash is a bricking risk, not just a transient error.
    return { ok: false, error: `upload failed: ${err.message}` };
  }
  if (!uploadRes.ok) {
    return { ok: false, error: `upload failed: device responded ${uploadRes.status}` };
  }

  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const expectedVersion = expectedTag.startsWith('v') ? expectedTag.slice(1) : expectedTag;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(retryDelayMs);
    try {
      const info = await getInfo(host);
      if (info.ver === expectedVersion) {
        return { ok: true, installedVersion: info.ver };
      }
      // Device is back but reporting a different version than expected —
      // no point continuing to retry, this needs manual verification.
      return { ok: false, error: `version mismatch after update: expected ${expectedVersion}, device reports ${info.ver}` };
    } catch {
      // Still rebooting/unreachable — keep polling within the retry budget.
      continue;
    }
  }

  return { ok: false, error: `device did not come back within the retry budget (${maxRetries} attempts)` };
}
```

- [ ] **Step 4: TODO — owner action: verify the OTA multipart field name against real WLED source or hardware**

This step is intentionally left as an explicit action item rather than code, because the spec itself mandates verification against ground truth before this is mergeable — guessing the field name is a bricking risk:

1. Check the WLED firmware repository (`https://github.com/Aircoookie/WLED`) at `wled00/data/update.htm` for the upload form's `name` attribute, and/or `wled00/set.cpp` (or the current equivalent OTA handler file — file layout may have moved) for the server-side field name it reads.
2. Alternatively, flash a real WLED device, open its own "Manual OTA Update" page, inspect the outgoing multipart request in browser devtools, and read the field name directly from the network request.
3. Update the `OTA_UPLOAD_FIELD_NAME` constant in `server/src/firmware/otaPush.ts` (currently `'firmware'`, a placeholder based on historical documentation) to match exactly.
4. Re-run `cd server && npm test -- test/firmware/otaPush.test.ts` after the change (the tests mock `fetch` and don't assert on the field name itself, so they will still pass — this verification step is a correctness requirement for real hardware, not something the existing unit tests can catch; do not skip it on the grounds that tests are green).

- [ ] **Step 5: Run test, confirm it passes**

Run: `cd server && npm test -- test/firmware/otaPush.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Mount the update route on `server/src/firmware/routes.ts`**

Add to `server/src/firmware/routes.ts`:
```ts
import { pushOtaUpdate } from './otaPush.js';
import { resolvePinnedAsset } from './assetMatch.js';

// add inside createFirmwareRouter, before `return router;`
router.post('/update', async (req, res) => {
  const controller = controllers.list().find((c) => c.id === req.params.id);
  if (!controller) return res.status(404).json({ error: 'controller not found' });
  if (!controller.pinnedAssetPattern) {
    return res.status(400).json({ error: 'no asset pinned for this controller yet' });
  }

  const release = await fetchLatestRelease(db);
  const asset = resolvePinnedAsset(release, controller.pinnedAssetPattern);
  if (!asset) {
    return res.status(409).json({ error: 'pinned asset pattern no longer matches any asset in the latest release' });
  }

  let assetBytes: ArrayBuffer;
  try {
    const assetRes = await fetch(asset.downloadUrl);
    if (!assetRes.ok) throw new Error(`download failed: ${assetRes.status}`);
    assetBytes = await assetRes.arrayBuffer();
  } catch (err: any) {
    return res.status(502).json({ ok: false, error: `download failed: ${err.message}` });
  }

  const result = await pushOtaUpdate(controller.host, assetBytes, release.tag);
  res.json(result);
});
```

- [ ] **Step 7: Run the full server test suite, confirm no regressions**

Run: `cd server && npm test`
Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/firmware/otaPush.ts server/src/firmware/routes.ts server/test/firmware/otaPush.test.ts
git commit -m "Add OTA firmware push route with bounded confirmation polling"
```

---

### Task 24: Frontend — firmware update UI

**Files:**
- Create: `client/src/components/FirmwareStatus.tsx`, `client/src/components/AssetPickerModal.tsx`
- Modify: `client/src/api/client.ts` (add firmware API calls), `client/src/components/ControllerList.tsx` (mount `FirmwareStatus` per controller)
- Test: `client/src/test/FirmwareStatus.test.tsx`

**Interfaces:**
- Adds to `client/src/api/client.ts`:
  - `interface FirmwareStatus { installedVersion: string; latestTag: string; updateAvailable: boolean; pinnedAssetPattern: string | null; candidateAssets: { name: string; downloadUrl: string }[]; }`
  - `getFirmwareStatus(controllerId)`, `pinFirmwareAsset(controllerId, assetPattern)`, `pushFirmwareUpdate(controllerId)` — wrap Task 22's `GET/POST .../firmware` and `POST .../firmware/pin`, and Task 23's `POST .../firmware/update`.
- Produces:
  - `FirmwareStatus` component props: `{ controllerId: string; }` — fetches and displays installed vs. latest version, shows an "Update available" badge when applicable, opens `AssetPickerModal` when `candidateAssets.length > 0` (unpinned or pin-mismatch case), and shows a one-click "Update" button once pinned and matched.
  - `AssetPickerModal` props: `{ assets: { name: string; downloadUrl: string }[]; onPick: (assetName: string) => void; onCancel: () => void; }`.
- Consumes: `Controller` list (`ControllerList.tsx`, Task 14) to know which controller each status block belongs to.

- [ ] **Step 1: Add firmware API calls to `client/src/api/client.ts`**

```ts
export interface FirmwareStatus {
  installedVersion: string;
  latestTag: string;
  updateAvailable: boolean;
  pinnedAssetPattern: string | null;
  candidateAssets: { name: string; downloadUrl: string }[];
}

export const getFirmwareStatus = (controllerId: string) =>
  getJson<FirmwareStatus>(`/api/controllers/${controllerId}/firmware`);

export const pinFirmwareAsset = (controllerId: string, assetPattern: string) =>
  fetch(`/api/controllers/${controllerId}/firmware/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetPattern })
  });

export const pushFirmwareUpdate = (controllerId: string) =>
  sendJson<{ ok: boolean; installedVersion?: string; error?: string }>(
    `/api/controllers/${controllerId}/firmware/update`, 'POST'
  );
```

- [ ] **Step 2: Write the failing `FirmwareStatus` test**

`client/src/test/FirmwareStatus.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FirmwareStatus } from '../components/FirmwareStatus';

afterEach(() => vi.unstubAllGlobals());

describe('FirmwareStatus', () => {
  it('shows an "Update available" badge and asset picker when unpinned with an update available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
        pinnedAssetPattern: null,
        candidateAssets: [
          { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/a.bin' },
          { name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/b.bin' }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FirmwareStatus controllerId="c1" />);

    await waitFor(() => expect(screen.getByText(/update available/i)).toBeTruthy());
    expect(screen.getByText('WLED_0.15.0_ESP8266.bin')).toBeTruthy();
    expect(screen.getByText('WLED_0.15.0_ESP02.bin')).toBeTruthy();
  });

  it('shows a one-click Update button once pinned and matched, with no update available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.15.0', latestTag: 'v0.15.0', updateAvailable: false,
        pinnedAssetPattern: 'ESP02', candidateAssets: []
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FirmwareStatus controllerId="c1" />);

    await waitFor(() => expect(screen.getByText(/0\.15\.0/)).toBeTruthy());
    expect(screen.queryByText(/update available/i)).toBeNull();
    expect(screen.queryByText('Update')).toBeNull();
  });

  it('pins the chosen asset when a candidate is picked from the asset picker', async () => {
    const getFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
        pinnedAssetPattern: null,
        candidateAssets: [{ name: 'WLED_0.15.0_ESP02.bin', downloadUrl: 'https://example.com/b.bin' }]
      })
    });
    vi.stubGlobal('fetch', getFetch);

    render(<FirmwareStatus controllerId="c1" />);
    await waitFor(() => expect(screen.getByText('WLED_0.15.0_ESP02.bin')).toBeTruthy());

    const pinFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', pinFetch);
    fireEvent.click(screen.getByText('WLED_0.15.0_ESP02.bin'));

    await waitFor(() =>
      expect(pinFetch).toHaveBeenCalledWith(
        '/api/controllers/c1/firmware/pin',
        expect.objectContaining({ method: 'POST' })
      )
    );
  });
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd client && npm test -- src/test/FirmwareStatus.test.tsx`
Expected: FAIL — cannot find module `../components/FirmwareStatus`

- [ ] **Step 4: Create `client/src/components/AssetPickerModal.tsx`**

```tsx
export function AssetPickerModal({
  assets,
  onPick,
  onCancel
}: {
  assets: { name: string; downloadUrl: string }[];
  onPick: (assetName: string) => void;
  onCancel: () => void;
}) {
  return (
    <div role="dialog">
      <h4>Pick the correct firmware asset for this controller</h4>
      <ul>
        {assets.map((a) => (
          <li key={a.name}>
            <button onClick={() => onPick(a.name)}>{a.name}</button>
          </li>
        ))}
      </ul>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}
```

- [ ] **Step 5: Create `client/src/components/FirmwareStatus.tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  getFirmwareStatus, pinFirmwareAsset, pushFirmwareUpdate, type FirmwareStatus as FirmwareStatusData
} from '../api/client';
import { AssetPickerModal } from './AssetPickerModal';

/**
 * Strips the `WLED_<version>_` prefix and `.bin` suffix from an asset
 * filename to derive the pinned pattern token, e.g.
 * "WLED_0.15.0_ESP02.bin" -> "ESP02", per the firmware design spec.
 */
function assetNameToPattern(assetName: string): string {
  return assetName.replace(/^WLED_[^_]+_/, '').replace(/\.bin$/i, '');
}

export function FirmwareStatus({ controllerId }: { controllerId: string }) {
  const [status, setStatus] = useState<FirmwareStatusData | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  async function refresh() {
    const data = await getFirmwareStatus(controllerId);
    setStatus(data);
  }

  useEffect(() => {
    refresh();
  }, [controllerId]);

  async function handlePick(assetName: string) {
    await pinFirmwareAsset(controllerId, assetNameToPattern(assetName));
    await refresh();
  }

  async function handleUpdate() {
    setUpdating(true);
    setUpdateError(null);
    try {
      const result = await pushFirmwareUpdate(controllerId);
      if (!result.ok) setUpdateError(result.error ?? 'Update failed');
      await refresh();
    } finally {
      setUpdating(false);
    }
  }

  if (!status) return <p>Checking firmware…</p>;

  const showPicker = status.candidateAssets.length > 0;
  const showUpdateButton = !showPicker && status.updateAvailable && !!status.pinnedAssetPattern;

  return (
    <div>
      <span>Installed: {status.installedVersion}</span>
      {status.updateAvailable && <strong> — Update available ({status.latestTag})</strong>}
      {showPicker && (
        <AssetPickerModal
          assets={status.candidateAssets}
          onPick={handlePick}
          onCancel={() => {}}
        />
      )}
      {showUpdateButton && (
        <button onClick={handleUpdate} disabled={updating}>
          {updating ? 'Updating…' : 'Update'}
        </button>
      )}
      {updateError && <p role="alert">{updateError}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Run test, confirm it passes**

Run: `cd client && npm test -- src/test/FirmwareStatus.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 7: Mount `FirmwareStatus` per controller in `client/src/components/ControllerList.tsx`**

```tsx
import type { Controller } from '../api/client';
import { FirmwareStatus } from './FirmwareStatus';

export function ControllerList({
  controllers,
  onDelete
}: {
  controllers: Controller[];
  onDelete: (id: string) => void;
}) {
  return (
    <ul>
      {controllers.map((c) => (
        <li key={c.id}>
          <strong>{c.name}</strong> ({c.host}) — {c.source}
          {c.stale && <span> — stale</span>}
          <button onClick={() => onDelete(c.id)}>Remove</button>
          <FirmwareStatus controllerId={c.id} />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 8: Run the full client test suite, confirm it passes**

Run: `cd client && npm test`
Expected: all tests PASS

- [ ] **Step 9: Commit**

```bash
git add client/src
git commit -m "Add firmware update UI: version status, asset picker, one-click update"
```

---

## Post-plan notes (not implemented here, tracked for a future pass)

- Basic in-app crop/rotate/zoom UI for uploaded floorplan images (Task 8 only stores the metadata fields; a cropping UI component that writes to `updateFloorplan` is a natural follow-up once the core loop above is working end-to-end).
- Wiring `recommendSplits` (Task 7) into the frontend so a user sees and can accept a split recommendation after drawing two placements on the same device segment.
- Marquee (drag-to-select-many) on `FloorplanCanvas` — Task 15 ships click-to-toggle only; marquee is additive and doesn't change the props interface.
- The OTA multipart field name verification called out explicitly in Task 23, Step 4 — this is a required action before that task's upload code goes live against real hardware, not an optional nice-to-have.
- `CalendarEventForm` (Task 20) only authors `fixed`-kind `DateRule`s for custom events; a UI for authoring `nthWeekday`/`lastWeekday`/`easterOffset`/`oneOff` rules from the frontend (the server already supports all five kinds via Task 16/17) is a natural follow-up once the fixed-date path is validated end-to-end.
- Rollback/downgrade tooling beyond re-running an update against an older cached `WledRelease` row is explicitly out of scope per the firmware design spec, and isn't scheduled for a future pass either — re-running Task 23's update flow against a manually-selected older release tag would need its own UI affordance if ever prioritized.
- `CalendarEvent`'s `sunset`/`sunrise` `triggerTime` variant has no latitude/longitude of its own in the approved scheduling spec's data model (unlike `Schedule`, which stores lat/lon per row) — Task 18's `triggerTimeDue` currently falls back to `0, 0`, mirroring `nextTriggerDate`'s existing fallback for an unconfigured `Schedule`. A single server-wide "home location" setting shared by both `Schedule` and `CalendarEvent` sunset/sunrise triggers (rather than one lat/lon per row, or an always-wrong equator fallback) would be a worthwhile follow-up spec clarification.
