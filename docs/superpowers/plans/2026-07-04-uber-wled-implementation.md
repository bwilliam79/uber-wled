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
      server.ts            # entry point: creates db, app, starts scheduler, listens
      db/
        client.ts          # createDb(path): opens better-sqlite3 db, runs migrations
        schema.ts           # runMigrations(db): CREATE TABLE IF NOT EXISTS statements
      wled/
        types.ts            # WledInfo, WledSegment, WledState, WledPreset
        client.ts            # getInfo, getState, setState, setSegment, getPresets, applyPreset
      controllers/
        repository.ts        # DB access for controllers table
        routes.ts             # Express router: list/add/delete controllers
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
        routes.ts                # Express router: POST /control/apply (batch action to a selection)
      schedules/
        repository.ts            # DB access for schedules table
        routes.ts                # Express router: CRUD schedules
        engine.ts                 # SchedulerEngine: registers cron/sunrise/sunset triggers, fires control.apply
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
        ScheduleManager.tsx
      pages/
        Dashboard.tsx
        FloorplanEditor.tsx
    test/
      (mirrors src/ — see per-task Test: paths)
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
  - `interface Schedule { id: string; name: string; triggerType: 'cron'|'sunrise'|'sunset'; cronExpr: string | null; offsetMinutes: number; latitude: number | null; longitude: number | null; groupId: string; actionType: ControlAction['type']; actionPayload: unknown; enabled: boolean; }`
  - `function createScheduleRepository(db): { list(): Schedule[]; add(input: Omit<Schedule,'id'>): Schedule; update(id, patch): Schedule; remove(id): void; }`
  - `function createSchedulesRouter(db): express.Router` mounted at `/api/schedules` (GET, POST, PATCH `/:id`, DELETE `/:id`)
  - `function nextTriggerDate(schedule: Schedule, now: Date): Date` — pure function used by the engine and directly testable: for `cron`, uses `node-cron`'s next-run calc; for `sunrise`/`sunset`, uses `suncalc.getTimes(now, lat, lon).sunrise|.sunset` plus `offsetMinutes`.
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
  triggerType: 'cron' | 'sunrise' | 'sunset';
  cronExpr: string | null;
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
          (id, name, trigger_type, cron_expr, offset_minutes, latitude, longitude, group_id, action_type, action_payload, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, input.name, input.triggerType, input.cronExpr, input.offsetMinutes,
        input.latitude, input.longitude, input.groupId, input.actionType,
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
        `UPDATE schedules SET name = ?, trigger_type = ?, cron_expr = ?, offset_minutes = ?,
          latitude = ?, longitude = ?, group_id = ?, action_type = ?, action_payload = ?, enabled = ?
         WHERE id = ?`
      ).run(
        next.name, next.triggerType, next.cronExpr, next.offsetMinutes,
        next.latitude, next.longitude, next.groupId, next.actionType,
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
Expected: PASS (3 tests)

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
      name: 'Every 10am', triggerType: 'cron', cronExpr: '0 10 * * *', offsetMinutes: 0,
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
      latitude: null, longitude: null, groupId, actionType: 'power',
      actionPayload: { on: true }, enabled: false
    });
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T10:00:00'));
    expect(applyFn).not.toHaveBeenCalled();
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
Expected: PASS (4 tests)

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
  triggerType: 'cron' | 'sunrise' | 'sunset';
  cronExpr: string | null;
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

## Post-plan notes (not implemented here, tracked for a future pass)

- Basic in-app crop/rotate/zoom UI for uploaded floorplan images (Task 8 only stores the metadata fields; a cropping UI component that writes to `updateFloorplan` is a natural Task 16 once the core loop above is working end-to-end).
- Wiring `recommendSplits` (Task 7) into the frontend so a user sees and can accept a split recommendation after drawing two placements on the same device segment.
- Marquee (drag-to-select-many) on `FloorplanCanvas` — Task 15 ships click-to-toggle only; marquee is additive and doesn't change the props interface.
