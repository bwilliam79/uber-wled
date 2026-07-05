# Phase E — Home v2: Tiles, Glow, Multi-Select, Room Editing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Replace the old Home screen with a room-tile grid driven by the SSE live stream — dynamic per-tile glow from actual light colors, quick power/brightness controls, multi-select into the shared Control surface, and inline room (group) creation/rename/delete/membership/reorder.

**Architecture:** New `client/src/sections/home/` section consumes Phase D's `ControlSurface` + `useLiveStatus` and Phase C's ui kit; pure aggregation/color helpers live in `client/src/lib/`. The server's groups module gains `icon`/`sortOrder` passthrough (columns added by Phase B) plus a `POST /api/groups/reorder` route. Old `components/HomeSection.tsx` / `components/HomeTile.tsx` are deleted at the end of this phase.

**Tech Stack:** React 18 + Vite + Vitest + Testing Library (client), `@tanstack/react-query` for server state; Node 20 + TypeScript + Express + better-sqlite3 + supertest (server). No new dependencies.

## Global Constraints

(copied verbatim from `00-master.md`)

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

## Phase dependencies & drift verification

This plan was authored before Phases B/C/D plans/code landed. Before each task, apply
`executing-plans-verification`: confirm the consumed interfaces below exist under the
names the shipped code actually used, and adapt **call sites only** (never the
master-contract names, which are binding):

- **Phase B (required by Tasks 1–2):** `groups.icon` (TEXT, nullable) and
  `groups.sort_order` (INTEGER NOT NULL DEFAULT 0) columns exist via the idempotent
  ALTER pattern in `server/src/db/schema.ts`. Gate: `grep -n "sort_order" /Users/bwwilliams/github/uber-wled/server/src/db/schema.ts`
  must hit. If it does not, STOP — Phase B is incomplete.
- **Phase D (required by Tasks 5–12), binding per master:**
  - `client/src/control/ControlSurface.tsx` exporting
    `ControlSurface(props: { targets: Target[]; open: boolean; onClose(): void })`.
  - `client/src/api/live.ts` exporting
    `useLiveStatus(controllerIds: string[]): Map<string, LiveStatusEntry>` with
    `LiveStatusEntry = { reachable: boolean; state?: LiveState; info?: LiveInfo }`
    (04-control-surface.md Task 3 names; the master calls the payloads WledState/WledInfo),
    where `state` carries at least `{ on: boolean; bri: number; seg: { id, on, bri, len?, col }[] }`
    — note `len` is OPTIONAL on Phase D's `LiveSegment`; Tasks 3–4 helpers accept that.
  - `client/src/api/client.ts` already carrying the fan-out v2 pieces: types
    `Target`/`SegPatch`/`ControlPatch`/`ApplyResult` and
    `applyControl(targets: Target[], patch: ControlPatch): Promise<{ results: ApplyResult[] }>`
    (Phase D renames the old v1 fetcher to `applyControlV1`). Task 5 gates on their
    presence and does NOT re-add them.
  - Known Phase D drift: the master's `ControlPatch` includes `ps?: number`
    (device-preset apply rides `POST /api/control/apply` with `patch { ps }`), but
    Phase D's contract-mirror block predates that addition — Task 5 verifies the
    shipped `ControlPatch` and adds `ps` if it is missing.
- **Phase C (required by Tasks 6–12):** `components/ui/{Toggle,Slider,Modal}.tsx` exist.
  Expected minimal props consumed here (verify against shipped kit and adapt call
  sites if prop names differ — tests below mock the kit, so they are insensitive):
  - `Toggle`: `{ checked: boolean; disabled?: boolean; ariaLabel: string; onChange(next: boolean): void }`
  - `Slider`: `{ min: number; max: number; value: number; disabled?: boolean; ariaLabel: string; onChange(v: number): void }`
  - `Modal`: `{ open: boolean; title: string; onClose(): void; children: React.ReactNode }`
- If Phase C/D shipped `api/queries.ts` hooks `useGroups()`/`useControllers()`
  (keys `['groups']`/`['controllers']` — Phase D Task 2 produces both), use them in
  Task 7 instead of the inline `useQuery` calls shown — the keys are what is binding.

Test-code conventions in this plan follow `~/.claude/skills/vitest-testing-gotchas`:
fetch is mocked via `vi.stubGlobal('fetch', …)` (never nock); fake timers are used only
against direct component/unit calls (no real I/O underneath); visual assertions target
the inline-style cascade winner (`el.style.getPropertyValue('--tile-glow')`), not
attributes or classnames alone.

---

## Task 1: Server — groups gain `icon` + `sortOrder`

**Files:**
- Modify: `/Users/bwwilliams/github/uber-wled/server/src/groups/repository.ts` (whole file, currently 57 lines)
- Modify: `/Users/bwwilliams/github/uber-wled/server/src/groups/routes.ts` (POST `/` at lines 11–14)
- Test: `/Users/bwwilliams/github/uber-wled/server/test/groups/routes.test.ts` (append to existing describe)

**Interfaces:**
- Consumes: `groups.icon` / `groups.sort_order` columns (Phase B schema); existing `createDb(':memory:')` test pattern.
- Produces: `Group` server type `{ id: string; name: string; icon: string | null; sortOrder: number; members: GroupMember[] }`;
  `repo.add({ name, members, icon? })`; `repo.update(id, { name?, members?, icon? })`;
  `GET /api/groups` ordered by `sort_order` then `name`, each row carrying `icon` + `sortOrder`.

- [ ] Gate: `grep -n "sort_order" /Users/bwwilliams/github/uber-wled/server/src/db/schema.ts` — must show the Phase B idempotent adds for `groups.icon` and `groups.sort_order`. If empty, STOP (Phase B incomplete).
- [ ] Append failing tests inside the existing `describe('groups routes', …)` block of `server/test/groups/routes.test.ts`:

```ts
  it('returns icon and sortOrder on create, defaulting icon to null', async () => {
    const post = await request(app).post('/api/groups').send({ name: 'Den', members: [] });
    expect(post.status).toBe(201);
    expect(post.body.icon).toBeNull();
    expect(post.body.sortOrder).toBe(0);
  });

  it('persists an icon on create and allows patching it', async () => {
    const post = await request(app)
      .post('/api/groups')
      .send({ name: 'Den', icon: '🛋️', members: [] });
    expect(post.body.icon).toBe('🛋️');
    const patch = await request(app).patch(`/api/groups/${post.body.id}`).send({ icon: '📺' });
    expect(patch.body.icon).toBe('📺');
    const list = await request(app).get('/api/groups');
    expect(list.body[0].icon).toBe('📺');
  });

  it('assigns increasing sortOrder to new groups and lists in that order', async () => {
    await request(app).post('/api/groups').send({ name: 'Zeta', members: [] });
    await request(app).post('/api/groups').send({ name: 'Alpha', members: [] });
    const list = await request(app).get('/api/groups');
    // creation order (sort_order), not alphabetical
    expect(list.body.map((g: { name: string }) => g.name)).toEqual(['Zeta', 'Alpha']);
    expect(list.body.map((g: { sortOrder: number }) => g.sortOrder)).toEqual([0, 1]);
  });
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/groups/routes.test.ts` — expect the 3 new tests to fail (`expected undefined to be null` on `icon`, and `['Alpha','Zeta']` instead of `['Zeta','Alpha']`).
- [ ] Replace `server/src/groups/repository.ts` with:

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

  function toGroup(row: any): Group {
    return {
      id: row.id,
      name: row.name,
      icon: row.icon ?? null,
      sortOrder: row.sort_order ?? 0,
      members: membersFor(row.id)
    };
  }

  function list(): Group[] {
    return db.prepare('SELECT * FROM groups ORDER BY sort_order, name').all().map(toGroup);
  }

  return {
    list,
    add(input: { name: string; members: GroupMember[]; icon?: string | null }): Group {
      const id = randomUUID();
      const nextSort = (
        db.prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS n FROM groups').get() as { n: number }
      ).n;
      db.prepare('INSERT INTO groups (id, name, icon, sort_order) VALUES (?, ?, ?, ?)')
        .run(id, input.name, input.icon ?? null, nextSort);
      setMembers(id, input.members);
      return { id, name: input.name, icon: input.icon ?? null, sortOrder: nextSort, members: input.members };
    },
    update(id: string, patch: { name?: string; members?: GroupMember[]; icon?: string | null }): Group {
      const row: any = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
      if (!row) throw new Error(`group ${id} not found`);
      const name = patch.name ?? row.name;
      const icon = patch.icon !== undefined ? patch.icon : row.icon ?? null;
      db.prepare('UPDATE groups SET name = ?, icon = ? WHERE id = ?').run(name, icon, id);
      if (patch.members) setMembers(id, patch.members);
      return toGroup(db.prepare('SELECT * FROM groups WHERE id = ?').get(id));
    },
    remove(id: string): void {
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    },
    reorder(ids: string[]): Group[] {
      const setSort = db.prepare('UPDATE groups SET sort_order = ? WHERE id = ?');
      const tx = db.transaction((ordered: string[]) => {
        ordered.forEach((gid, i) => setSort.run(i, gid));
      });
      tx(ids);
      return list();
    }
  };
}
```

(`reorder` is exercised in Task 2 — it rides along here so the repository is written once.)
- [ ] In `server/src/groups/routes.ts`, replace the POST `/` handler body so icon flows through:

```ts
  router.post('/', (req, res) => {
    const created = repo.add({
      name: req.body.name,
      members: req.body.members ?? [],
      icon: req.body.icon ?? null
    });
    res.status(201).json(created);
  });
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/groups/routes.test.ts` — all tests pass (3 new + 3 pre-existing).
- [ ] Run full server suite: `cd /Users/bwwilliams/github/uber-wled/server && npm test` — green (schedule/calendar tests construct groups via `repo.add` whose new `icon` field is optional, so no fallout expected; fix any typed fixture that constructs `Group` literals by adding `icon: null, sortOrder: 0`).
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add server/src/groups server/test/groups && git -C /Users/bwwilliams/github/uber-wled commit -m "server: groups carry icon and sortOrder (Home v2 rooms)"`

## Task 2: Server — `POST /api/groups/reorder`

**Files:**
- Modify: `/Users/bwwilliams/github/uber-wled/server/src/groups/routes.ts` (add route above `router.patch('/:id', …)`)
- Test: `/Users/bwwilliams/github/uber-wled/server/test/groups/routes.test.ts` (append)

**Interfaces:**
- Consumes: `repo.reorder(ids: string[]): Group[]` from Task 1.
- Produces: `POST /api/groups/reorder` — body `{ ids: string[] }` (full desired order of group ids; index becomes `sort_order`); 200 → `Group[]` in new order; 400 `{ error }` when `ids` is not a string array.

- [ ] Append failing tests to `server/test/groups/routes.test.ts`:

```ts
  it('reorders groups and persists the new sortOrder', async () => {
    const a = await request(app).post('/api/groups').send({ name: 'A', members: [] });
    const b = await request(app).post('/api/groups').send({ name: 'B', members: [] });
    const res = await request(app).post('/api/groups/reorder').send({ ids: [b.body.id, a.body.id] });
    expect(res.status).toBe(200);
    expect(res.body.map((g: { id: string }) => g.id)).toEqual([b.body.id, a.body.id]);
    expect(res.body.map((g: { sortOrder: number }) => g.sortOrder)).toEqual([0, 1]);
    const list = await request(app).get('/api/groups');
    expect(list.body.map((g: { id: string }) => g.id)).toEqual([b.body.id, a.body.id]);
  });

  it('rejects a reorder body without an ids array of strings', async () => {
    await request(app).post('/api/groups/reorder').send({ ids: 'nope' }).expect(400);
    await request(app).post('/api/groups/reorder').send({}).expect(400);
  });
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/groups/routes.test.ts` — the 2 new tests fail (404 from Express: no `/reorder` route).
- [ ] Add the route in `server/src/groups/routes.ts` directly after the `router.post('/', …)` block:

```ts
  router.post('/reorder', (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
      return res.status(400).json({ error: 'ids must be an array of group ids' });
    }
    res.json(repo.reorder(ids));
  });
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/groups/routes.test.ts` — all pass.
- [ ] Run full suite: `cd /Users/bwwilliams/github/uber-wled/server && npm test` — green.
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add server/src/groups/routes.ts server/test/groups/routes.test.ts && git -C /Users/bwwilliams/github/uber-wled commit -m "server: POST /api/groups/reorder persists room tile order"`

## Task 3: Client lib — `aggregateTileStatusLive` (live-stream tile aggregation)

**Files:**
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/lib/tileStatus.ts` (append new types + function; existing exports untouched until Task 12)
- Test (Create): `/Users/bwwilliams/github/uber-wled/client/src/test/lib/tileStatusLive.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `TileTargetMember = { controllerId: string; wledSegId: number | null }` (`null` = whole-controller member)
  - `LiveSegState = { id: number; on: boolean; bri: number }`
  - `LiveTileState = { on: boolean; bri: number; seg: LiveSegState[] }`
  - `LiveTileSource = { reachable: boolean; state?: LiveTileState }`
  - `TileStatusV2 = { power: 'on'|'off'|'mixed'|'unknown'; brightness: number | null; anyOffline: boolean; allOffline: boolean }`
  - `aggregateTileStatusLive(members: TileTargetMember[], live: ReadonlyMap<string, LiveTileSource>): TileStatusV2`

Semantics: whole-controller member reads master `on`/`bri`; segment member is on iff `state.on && seg.on` and reports `seg.bri`; unreachable/missing controller or missing segment id counts offline; brightness averages over on members only.

- [ ] Create `client/src/test/lib/tileStatusLive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateTileStatusLive, type LiveTileSource, type LiveTileState } from '../../lib/tileStatus';

function src(state?: LiveTileState, reachable = true): LiveTileSource {
  return { reachable, state };
}

describe('aggregateTileStatusLive', () => {
  it('reads whole-controller members from the top-level state', () => {
    const live = new Map([['c1', src({ on: true, bri: 200, seg: [] })]]);
    expect(aggregateTileStatusLive([{ controllerId: 'c1', wledSegId: null }], live))
      .toEqual({ power: 'on', brightness: 200, anyOffline: false, allOffline: false });
  });

  it('treats a segment as off when master power is off even if the segment flag is on', () => {
    const live = new Map([['c1', src({ on: false, bri: 128, seg: [{ id: 0, on: true, bri: 255 }] })]]);
    expect(aggregateTileStatusLive([{ controllerId: 'c1', wledSegId: 0 }], live))
      .toEqual({ power: 'off', brightness: null, anyOffline: false, allOffline: false });
  });

  it('reports mixed across members and averages brightness over on members only', () => {
    const live = new Map([
      ['c1', src({ on: true, bri: 9, seg: [{ id: 0, on: true, bri: 255 }, { id: 1, on: false, bri: 255 }] })]
    ]);
    expect(aggregateTileStatusLive(
      [{ controllerId: 'c1', wledSegId: 0 }, { controllerId: 'c1', wledSegId: 1 }], live))
      .toEqual({ power: 'mixed', brightness: 255, anyOffline: false, allOffline: false });
  });

  it('flags anyOffline for an unreachable controller and allOffline when every member is', () => {
    const live = new Map([['c1', src(undefined, false)]]);
    expect(aggregateTileStatusLive([{ controllerId: 'c1', wledSegId: null }], live))
      .toEqual({ power: 'unknown', brightness: null, anyOffline: true, allOffline: true });
  });

  it('counts a missing segment id as offline without failing the tile', () => {
    const live = new Map([['c1', src({ on: true, bri: 100, seg: [{ id: 0, on: true, bri: 100 }] })]]);
    expect(aggregateTileStatusLive(
      [{ controllerId: 'c1', wledSegId: 0 }, { controllerId: 'c1', wledSegId: 5 }], live))
      .toEqual({ power: 'on', brightness: 100, anyOffline: true, allOffline: false });
  });

  it('returns unknown for an empty member list', () => {
    expect(aggregateTileStatusLive([], new Map()))
      .toEqual({ power: 'unknown', brightness: null, anyOffline: false, allOffline: false });
  });

  it('handles the real-device shape captured from 192.168.1.86', () => {
    // captured 2026-07-04 from GET /json/state (WLED 16.0.0 "Niji"): master bri 9, both segs on
    const state: LiveTileState = {
      on: true, bri: 9,
      seg: [{ id: 0, on: true, bri: 255 }, { id: 1, on: true, bri: 255 }]
    };
    const live = new Map([['cabinet', src(state)]]);
    expect(aggregateTileStatusLive(
      [{ controllerId: 'cabinet', wledSegId: 0 }, { controllerId: 'cabinet', wledSegId: 1 }], live))
      .toEqual({ power: 'on', brightness: 255, anyOffline: false, allOffline: false });
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib/tileStatusLive.test.ts` — fails: `aggregateTileStatusLive` is not exported.
- [ ] Append to `client/src/lib/tileStatus.ts`:

```ts
// --- Home v2: live-stream aggregation ------------------------------------

export interface TileTargetMember {
  controllerId: string;
  wledSegId: number | null; // null = whole controller
}

export interface LiveSegState {
  id: number;
  on: boolean;
  bri: number;
}

export interface LiveTileState {
  on: boolean;
  bri: number;
  seg: LiveSegState[];
}

export interface LiveTileSource {
  reachable: boolean;
  state?: LiveTileState;
}

export interface TileStatusV2 {
  power: 'on' | 'off' | 'mixed' | 'unknown';
  brightness: number | null;
  anyOffline: boolean;
  allOffline: boolean;
}

export function aggregateTileStatusLive(
  members: TileTargetMember[],
  live: ReadonlyMap<string, LiveTileSource>
): TileStatusV2 {
  if (members.length === 0) {
    return { power: 'unknown', brightness: null, anyOffline: false, allOffline: false };
  }

  let offline = 0;
  const onStates: boolean[] = [];
  const onBrightnesses: number[] = [];

  for (const member of members) {
    const src = live.get(member.controllerId);
    if (!src || !src.reachable || !src.state) {
      offline++;
      continue;
    }
    if (member.wledSegId === null) {
      onStates.push(src.state.on);
      if (src.state.on) onBrightnesses.push(src.state.bri);
    } else {
      const seg = src.state.seg.find((s) => s.id === member.wledSegId);
      if (!seg) {
        offline++;
        continue;
      }
      const isOn = src.state.on && seg.on;
      onStates.push(isOn);
      if (isOn) onBrightnesses.push(seg.bri);
    }
  }

  const anyOffline = offline > 0;
  const allOffline = offline === members.length;
  if (onStates.length === 0) {
    return { power: 'unknown', brightness: null, anyOffline, allOffline };
  }

  const allOn = onStates.every(Boolean);
  const allOff = onStates.every((s) => !s);
  return {
    power: allOn ? 'on' : allOff ? 'off' : 'mixed',
    brightness:
      onBrightnesses.length > 0
        ? Math.round(onBrightnesses.reduce((a, b) => a + b, 0) / onBrightnesses.length)
        : null,
    anyOffline,
    allOffline
  };
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib/tileStatusLive.test.ts` — all 7 pass.
- [ ] Run full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green (old `aggregateTileStatus` untouched).
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add client/src/lib/tileStatus.ts client/src/test/lib/tileStatusLive.test.ts && git -C /Users/bwwilliams/github/uber-wled commit -m "client: live-stream tile status aggregation for Home v2"`

## Task 4: Client lib — `dominantColor` glow helper + `throttle`

**Files:**
- Create: `/Users/bwwilliams/github/uber-wled/client/src/lib/dominantColor.ts`
- Create: `/Users/bwwilliams/github/uber-wled/client/src/lib/throttle.ts`
- Test (Create): `/Users/bwwilliams/github/uber-wled/client/src/test/lib/dominantColor.test.ts`
- Test (Create): `/Users/bwwilliams/github/uber-wled/client/src/test/lib/throttle.test.ts`

**Interfaces:**
- Consumes: nothing (pure). Companion to (not a modification of) `lib/segmentColor.ts:1` — that helper is per-segment for the Layout canvas; this one is per-controller for tile glow.
- Produces:
  - `OFF_GLOW = '#334155'`, `OFFLINE_GLOW = '#3A3F4B'` (exported css color constants)
  - `dominantColor(state: DominantColorState | undefined): string` — `undefined` → `OFFLINE_GLOW`; master off / all-black → `OFF_GLOW`; else the length-weighted dominant primary segment color scaled by `max(0.35, bri/255)` as `rgb(r, g, b)`.
  - `DominantColorState = { on: boolean; bri: number; seg: { on: boolean; len?: number; col: number[][] }[] }`
    — `len` optional (weight 1 when absent) so Phase D's `LiveState` (whose `LiveSegment.len` is optional) is structurally assignable with no cast.
  - `throttle<A extends unknown[]>(fn: (...args: A) => void, intervalMs: number): (...args: A) => void` — leading edge immediate, trailing edge with latest args.

- [ ] Create `client/src/test/lib/dominantColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dominantColor, OFF_GLOW, OFFLINE_GLOW } from '../../lib/dominantColor';

describe('dominantColor', () => {
  it('returns the offline grey when no state is available', () => {
    expect(dominantColor(undefined)).toBe(OFFLINE_GLOW);
  });

  it('returns the muted off color when master power is off', () => {
    expect(dominantColor({ on: false, bri: 255, seg: [{ on: true, len: 10, col: [[255, 0, 0]] }] }))
      .toBe(OFF_GLOW);
  });

  it('picks the primary color of the longest on segment, scaled by master brightness', () => {
    const state = {
      on: true, bri: 255,
      seg: [
        { on: true, len: 5, col: [[0, 0, 255]] },
        { on: true, len: 30, col: [[255, 80, 0]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(255, 80, 0)');
  });

  it('sums weight across segments sharing the same color', () => {
    const state = {
      on: true, bri: 255,
      seg: [
        { on: true, len: 20, col: [[0, 0, 255]] },
        { on: true, len: 15, col: [[255, 0, 0]] },
        { on: true, len: 15, col: [[255, 0, 0]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(255, 0, 0)');
  });

  it('treats a segment without len as weight 1 (Phase D LiveSegment.len is optional)', () => {
    const state = {
      on: true, bri: 255,
      seg: [
        { on: true, col: [[255, 0, 0]] },
        { on: true, len: 5, col: [[0, 0, 255]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(0, 0, 255)');
  });

  it('ignores off segments and black color slots', () => {
    const state = {
      on: true, bri: 255,
      seg: [
        { on: false, len: 100, col: [[0, 255, 0]] },
        { on: true, len: 10, col: [[0, 0, 0, 0]] },
        { on: true, len: 5, col: [[120, 0, 200]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(120, 0, 200)');
  });

  it('maps a white-channel-only slot to warm white', () => {
    const state = { on: true, bri: 255, seg: [{ on: true, len: 10, col: [[0, 0, 0, 200]] }] };
    expect(dominantColor(state)).toBe('rgb(255, 214, 170)');
  });

  it('never dims below the visibility floor (real device fixture, master bri 9)', () => {
    // captured 2026-07-04 from GET http://192.168.1.86/json/state:
    // seg0 len 39 col[0]=[255,255,255,0] on; seg1 len 9 col[0]=[0,0,0,0] on
    const state = {
      on: true, bri: 9,
      seg: [
        { on: true, len: 39, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
        { on: true, len: 9, col: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }
      ]
    };
    expect(dominantColor(state)).toBe('rgb(89, 89, 89)'); // 255 * 0.35 floor, rounded
  });

  it('falls back to the off color when everything on is black', () => {
    expect(dominantColor({ on: true, bri: 255, seg: [{ on: true, len: 10, col: [[0, 0, 0, 0]] }] }))
      .toBe(OFF_GLOW);
  });
});
```

- [ ] Create `client/src/test/lib/throttle.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { throttle } from '../../lib/throttle';

afterEach(() => vi.useRealTimers());

describe('throttle', () => {
  it('fires immediately on the leading edge', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 250);
    t(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('coalesces calls inside the window into one trailing call with the latest args', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 250);
    t(1); t(2); t(3);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it('allows a new leading call after the window has passed', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = throttle(fn, 250);
    t(1);
    vi.advanceTimersByTime(300);
    t(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib/dominantColor.test.ts src/test/lib/throttle.test.ts` — both fail: "Failed to resolve import".
- [ ] Create `client/src/lib/dominantColor.ts`:

```ts
export const OFF_GLOW = '#334155'; // muted slate — matches segmentToCssColor's off color
export const OFFLINE_GLOW = '#3A3F4B'; // desaturated grey for unreachable targets

const MIN_GLOW_SCALE = 0.35; // keep the glow visible even at very low master brightness

export interface DominantColorSegment {
  on: boolean;
  len?: number; // optional to match Phase D's LiveSegment; weight 1 when absent
  col: number[][];
}

export interface DominantColorState {
  on: boolean;
  bri: number;
  seg: DominantColorSegment[];
}

function effectiveRgb(col: number[] | undefined): [number, number, number] | null {
  if (!col || col.length < 3) return null;
  const [r, g, b] = col;
  const w = col[3] ?? 0;
  if (r === 0 && g === 0 && b === 0) {
    if (w > 0) return [255, 214, 170]; // warm-white approximation of the W channel
    return null; // black contributes no glow
  }
  return [r, g, b];
}

export function dominantColor(state: DominantColorState | undefined): string {
  if (!state) return OFFLINE_GLOW;
  if (!state.on) return OFF_GLOW;

  const weights = new Map<string, { rgb: [number, number, number]; weight: number }>();
  for (const seg of state.seg) {
    if (!seg.on) continue;
    const rgb = effectiveRgb(seg.col[0]);
    if (!rgb) continue;
    const key = rgb.join(',');
    const entry = weights.get(key) ?? { rgb, weight: 0 };
    entry.weight += Math.max(1, seg.len ?? 1);
    weights.set(key, entry);
  }

  let best: { rgb: [number, number, number]; weight: number } | null = null;
  for (const entry of weights.values()) {
    if (!best || entry.weight > best.weight) best = entry;
  }
  if (!best) return OFF_GLOW;

  const scale = Math.max(MIN_GLOW_SCALE, state.bri / 255);
  const [r, g, b] = best.rgb;
  return `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;
}
```

- [ ] Create `client/src/lib/throttle.ts`:

```ts
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number
): (...args: A) => void {
  let lastCall = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  return (...args: A) => {
    const now = Date.now();
    const elapsed = now - lastCall;
    if (elapsed >= intervalMs) {
      lastCall = now;
      fn(...args);
      return;
    }
    lastArgs = args;
    if (!trailing) {
      trailing = setTimeout(() => {
        trailing = null;
        lastCall = Date.now();
        if (lastArgs) fn(...lastArgs);
        lastArgs = null;
      }, intervalMs - elapsed);
    }
  };
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib/dominantColor.test.ts src/test/lib/throttle.test.ts` — all pass.
- [ ] Run full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green.
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add client/src/lib/dominantColor.ts client/src/lib/throttle.ts client/src/test/lib && git -C /Users/bwwilliams/github/uber-wled commit -m "client: dominantColor glow helper and throttle for Home v2"`

## Task 5: Client API — Group icon/sortOrder, `reorderGroups`, `ControlPatch.ps` gap-fill

**Files:**
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/api/client.ts` (pre-Phase-D refs: Group at lines 15–19, addGroup/updateGroup at lines 115–119 — Phase D appends/renames below them, so re-locate by symbol)
- Test (Create): `/Users/bwwilliams/github/uber-wled/client/src/test/api/groups.test.ts`

**Interfaces:**
- Consumes: server routes from Tasks 1–2; Phase D's fan-out v2 client pieces in
  `client/src/api/client.ts` — types `Target`/`SegPatch`/`ControlPatch`/`ApplyResult` and
  `applyControl(targets: Target[], patch: ControlPatch): Promise<{ results: ApplyResult[] }>`.
- Produces (all exported from `client/src/api/client.ts`):
  - `Group = { id: string; name: string; icon: string | null; sortOrder: number; members: GroupMember[] }`
  - `addGroup(name: string, members: GroupMember[], icon?: string | null): Promise<Group>`
  - `updateGroup(id: string, patch: { name?: string; members?: GroupMember[]; icon?: string | null }): Promise<Group>`
  - `reorderGroups(ids: string[]): Promise<Group[]>`
  - `ControlPatch` guaranteed to carry `ps?: number` (master contract; added here if Phase D shipped without it)

- [ ] Gate: `grep -n "applyControl = (targets" /Users/bwwilliams/github/uber-wled/client/src/api/client.ts` — must hit Phase D's v2 fetcher (`export const applyControl = (targets: Target[], patch: ControlPatch) => …`). If instead only the v1 signature `applyControl = (members, action)` exists, STOP — Phase D is incomplete and Phase E depends on it.
- [ ] Create `client/src/test/api/groups.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { addGroup, updateGroup, reorderGroups, applyControl } from '../../api/client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('groups + control v2 api', () => {
  it('addGroup sends icon alongside name and members', async () => {
    const fetchMock = stubFetch();
    await addGroup('Bedroom', [], '🛏️');
    expect(fetchMock).toHaveBeenCalledWith('/api/groups', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Bedroom', members: [], icon: '🛏️' })
    }));
  });

  it('updateGroup can patch just the icon', async () => {
    const fetchMock = stubFetch();
    await updateGroup('g1', { icon: '📚' });
    expect(fetchMock).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ icon: '📚' })
    }));
  });

  it('reorderGroups posts the full id order', async () => {
    const fetchMock = stubFetch([]);
    await reorderGroups(['g2', 'g1']);
    expect(fetchMock).toHaveBeenCalledWith('/api/groups/reorder', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ids: ['g2', 'g1'] })
    }));
  });

  it('applyControl posts targets and patch to the v2 route', async () => {
    const fetchMock = stubFetch({ results: [] });
    await applyControl([{ kind: 'group', groupId: 'g1' }], { seg: { on: true } });
    expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ targets: [{ kind: 'group', groupId: 'g1' }], patch: { seg: { on: true } } })
    }));
  });

  it('applyControl carries a device-preset ps patch through unchanged', async () => {
    const fetchMock = stubFetch({ results: [] });
    await applyControl([{ kind: 'controller', controllerId: 'c1' }], { ps: 3 });
    expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ targets: [{ kind: 'controller', controllerId: 'c1' }], patch: { ps: 3 } })
    }));
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/groups.test.ts` — the three groups tests fail (`reorderGroups` not exported, `addGroup` body lacks `icon`); the two `applyControl` tests pass at runtime (Phase D shipped the fetcher; vitest strips types, so a missing `ps` field cannot fail here — the typecheck step below catches it).
- [ ] Typecheck for the `ps` contract: `cd /Users/bwwilliams/github/uber-wled/client && npx tsc -b` — if Phase D shipped `ControlPatch` without `ps`, expect `error TS2353: Object literal may only specify known properties, and 'ps' does not exist in type 'ControlPatch'` pointing at the new test. If it compiles clean, `ps` already landed — skip the ControlPatch edit step below.
- [ ] In `client/src/api/client.ts`, replace the `Group` interface (lines 15–19) with:

```ts
export interface Group {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  members: GroupMember[];
}
```

- [ ] Replace the `addGroup`/`updateGroup` exports (lines 115–119) with, and add `reorderGroups`:

```ts
export const addGroup = (name: string, members: GroupMember[], icon?: string | null) =>
  sendJson<Group>('/api/groups', 'POST', { name, members, icon: icon ?? null });
export const updateGroup = (
  id: string,
  patch: { name?: string; members?: GroupMember[]; icon?: string | null }
) => sendJson<Group>(`/api/groups/${id}`, 'PATCH', patch);
export const reorderGroups = (ids: string[]) =>
  sendJson<Group[]>('/api/groups/reorder', 'POST', { ids });
```

- [ ] Gap-fill `ControlPatch.ps` (only if the typecheck above errored): in the shipped `ControlPatch` interface in `client/src/api/client.ts` (Phase D placed it in the fan-out v2 block), insert the `ps` line so the interface reads exactly:

```ts
export interface ControlPatch {
  on?: boolean;
  bri?: number;                        // 1-255
  transition?: number;                 // WLED units (100ms)
  ps?: number;                         // apply device preset id (device-local ids —
                                       // client restricts to single-controller selections)
  nl?: { on?: boolean; dur?: number; mode?: 0 | 1 | 2 | 3; tbri?: number };
  seg?: SegPatch;
}
```

- [ ] Re-run typecheck: `cd /Users/bwwilliams/github/uber-wled/client && npx tsc -b` — clean.
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/groups.test.ts` — all 5 pass.
- [ ] Run full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green. (Existing components read only `id`/`name`/`members` off `Group`; untyped test fixtures are unaffected by the added fields.)
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add client/src/api/client.ts client/src/test/api/groups.test.ts && git -C /Users/bwwilliams/github/uber-wled commit -m "client: group icon/sortOrder api, reorderGroups, ControlPatch.ps gap-fill"`

## Task 6: `sections/home/HomeTile.tsx` — tile with glow, quick controls, long-press

**Files:**
- Create: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/HomeTile.tsx`
- Create: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/home.css` (complete stylesheet for the whole phase)
- Test (Create): `/Users/bwwilliams/github/uber-wled/client/src/test/sections/home/HomeTile.test.tsx`

**Interfaces:**
- Consumes: `Toggle`, `Slider` from `components/ui` (Phase C, expected props in the header of this plan); `TileStatusV2`, `TileTargetMember` from Task 3.
- Produces:
  - `HomeTileData = { id: string; kind: 'group' | 'controller'; title: string; icon: string | null; members: TileTargetMember[] }` (for `kind: 'controller'`, `id` IS the controller id)
  - `HomeTile(props: { tile: HomeTileData; status: TileStatusV2; glowColor: string; selectMode: boolean; selected: boolean; onToggleSelect(id: string): void; onLongPress(id: string): void; onOpenControl(tile: HomeTileData): void; onPower(tile: HomeTileData, on: boolean): void; onBrightness(tile: HomeTileData, bri: number): void })`
  - DOM contract: root `data-testid="home-tile-<id>"` with inline `--tile-glow`; body `role="button"` labeled `open controls for <title>`; checkbox labeled `select <title>`; switch labeled `power for <title>`; slider labeled `brightness for <title>`.
  - CSS class contract (all defined in `home.css`): `home-section, home-header, home-header-actions, home-grid, home-select-mode, home-tile, home-tile-offline, home-tile-selected, home-tile-select, home-tile-body, home-tile-top, home-tile-icon, home-tile-name, home-tile-status, home-tile-controls, home-action-bar, home-action-count, home-tile-edit, home-tile-name-input, home-tile-icon-btn, home-tile-edit-actions, home-tile-drag-handle, icon-picker, icon-picker-item, icon-picker-selected, room-members-editor, room-members-list, room-member-row, room-members-add, modal-actions`.

- [ ] Create `client/src/test/sections/home/HomeTile.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../../components/ui/Toggle', () => ({
  Toggle: ({ checked, onChange, ariaLabel, disabled }: any) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
    />
  )
}));
vi.mock('../../../components/ui/Slider', () => ({
  Slider: ({ value, onChange, ariaLabel, min, max, disabled }: any) => (
    <input
      type="range"
      aria-label={ariaLabel}
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => onChange(Number((e.target as HTMLInputElement).value))}
    />
  )
}));

import { HomeTile, type HomeTileData } from '../../../sections/home/HomeTile';
import type { TileStatusV2 } from '../../../lib/tileStatus';

const TILE: HomeTileData = {
  id: 'g1',
  kind: 'group',
  title: 'Kitchen',
  icon: '🍳',
  members: [{ controllerId: 'c1', wledSegId: 0 }]
};
const STATUS_ON: TileStatusV2 = { power: 'on', brightness: 204, anyOffline: false, allOffline: false };

function renderTile(overrides: Record<string, unknown> = {}) {
  const props = {
    tile: TILE,
    status: STATUS_ON,
    glowColor: 'rgb(128, 40, 0)',
    selectMode: false,
    selected: false,
    onToggleSelect: vi.fn(),
    onLongPress: vi.fn(),
    onOpenControl: vi.fn(),
    onPower: vi.fn(),
    onBrightness: vi.fn(),
    ...overrides
  };
  render(<HomeTile {...(props as any)} />);
  return props;
}

afterEach(() => vi.useRealTimers());

describe('HomeTile', () => {
  it('shows name, icon, power label and brightness percent', () => {
    renderTile();
    expect(screen.getByText('Kitchen')).toBeTruthy();
    expect(screen.getByText('🍳')).toBeTruthy();
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy(); // 204/255
  });

  it('applies the glow color as the --tile-glow inline custom property', () => {
    renderTile();
    const el = screen.getByTestId('home-tile-g1');
    expect(el.style.getPropertyValue('--tile-glow')).toBe('rgb(128, 40, 0)');
  });

  it('opens controls when the body is tapped outside select mode', () => {
    const p = renderTile();
    fireEvent.click(screen.getByRole('button', { name: 'open controls for Kitchen' }));
    expect(p.onOpenControl).toHaveBeenCalledWith(TILE);
  });

  it('toggles selection instead of opening controls in select mode', () => {
    const p = renderTile({ selectMode: true });
    fireEvent.click(screen.getByRole('button', { name: 'open controls for Kitchen' }));
    expect(p.onToggleSelect).toHaveBeenCalledWith('g1');
    expect(p.onOpenControl).not.toHaveBeenCalled();
  });

  it('fires onLongPress after 450ms of pointer hold', () => {
    vi.useFakeTimers();
    const p = renderTile();
    const body = screen.getByRole('button', { name: 'open controls for Kitchen' });
    fireEvent.pointerDown(body, { clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(450); });
    expect(p.onLongPress).toHaveBeenCalledWith('g1');
  });

  it('cancels the long press when the pointer moves more than 10px', () => {
    vi.useFakeTimers();
    const p = renderTile();
    const body = screen.getByRole('button', { name: 'open controls for Kitchen' });
    fireEvent.pointerDown(body, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(body, { clientX: 40, clientY: 10 });
    act(() => { vi.advanceTimersByTime(600); });
    expect(p.onLongPress).not.toHaveBeenCalled();
  });

  it('does not treat the click after a long press as a body tap', () => {
    vi.useFakeTimers();
    const p = renderTile();
    const body = screen.getByRole('button', { name: 'open controls for Kitchen' });
    fireEvent.pointerDown(body, { clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(450); });
    fireEvent.pointerUp(body);
    fireEvent.click(body);
    expect(p.onOpenControl).not.toHaveBeenCalled();
  });

  it('routes power toggle and brightness slider changes to callbacks', () => {
    const p = renderTile();
    fireEvent.click(screen.getByRole('switch', { name: 'power for Kitchen' }));
    expect(p.onPower).toHaveBeenCalledWith(TILE, false);
    fireEvent.change(screen.getByRole('slider', { name: 'brightness for Kitchen' }), {
      target: { value: '90' }
    });
    expect(p.onBrightness).toHaveBeenCalledWith(TILE, 90);
  });

  it('disables quick controls and greys the tile when all members are offline', () => {
    renderTile({
      status: { power: 'unknown', brightness: null, anyOffline: true, allOffline: true },
      glowColor: '#3A3F4B'
    });
    expect((screen.getByRole('switch', { name: 'power for Kitchen' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('home-tile-g1').className).toContain('home-tile-offline');
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeTile.test.tsx` — fails: cannot resolve `../../../sections/home/HomeTile`.
- [ ] Create `client/src/sections/home/HomeTile.tsx`:

```tsx
import { useRef } from 'react';
import { Toggle } from '../../components/ui/Toggle';
import { Slider } from '../../components/ui/Slider';
import type { TileStatusV2, TileTargetMember } from '../../lib/tileStatus';

export interface HomeTileData {
  id: string; // group id, or controller id for ungrouped tiles
  kind: 'group' | 'controller';
  title: string;
  icon: string | null;
  members: TileTargetMember[];
}

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;

const POWER_LABEL: Record<TileStatusV2['power'], string> = {
  on: 'On',
  off: 'Off',
  mixed: 'Mixed',
  unknown: '—'
};

export function HomeTile({
  tile,
  status,
  glowColor,
  selectMode,
  selected,
  onToggleSelect,
  onLongPress,
  onOpenControl,
  onPower,
  onBrightness
}: {
  tile: HomeTileData;
  status: TileStatusV2;
  glowColor: string;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onLongPress: (id: string) => void;
  onOpenControl: (tile: HomeTileData) => void;
  onPower: (tile: HomeTileData, on: boolean) => void;
  onBrightness: (tile: HomeTileData, bri: number) => void;
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  function clearPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  }

  function handlePointerDown(e: React.PointerEvent) {
    longPressFired.current = false;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onLongPress(tile.id);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!pressOrigin.current) return;
    if (
      Math.abs(e.clientX - pressOrigin.current.x) > MOVE_CANCEL_PX ||
      Math.abs(e.clientY - pressOrigin.current.y) > MOVE_CANCEL_PX
    ) {
      clearPress();
    }
  }

  function handleBodyActivate() {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (selectMode) onToggleSelect(tile.id);
    else onOpenControl(tile);
  }

  const classes = [
    'home-tile',
    selected ? 'home-tile-selected' : '',
    status.allOffline ? 'home-tile-offline' : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{ '--tile-glow': glowColor } as React.CSSProperties}
      data-testid={`home-tile-${tile.id}`}
    >
      <input
        type="checkbox"
        className="home-tile-select"
        checked={selected}
        aria-label={`select ${tile.title}`}
        onChange={() => onToggleSelect(tile.id)}
      />
      <div
        role="button"
        tabIndex={0}
        className="home-tile-body"
        aria-label={`open controls for ${tile.title}`}
        onClick={handleBodyActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleBodyActivate();
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearPress}
        onPointerLeave={clearPress}
        onPointerCancel={clearPress}
      >
        <div className="home-tile-top">
          {tile.icon && (
            <span className="home-tile-icon" aria-hidden="true">{tile.icon}</span>
          )}
          <span className="home-tile-name">{tile.title}</span>
          {status.anyOffline && !status.allOffline && <span className="chip chip-warn">offline</span>}
        </div>
        <div className="home-tile-status">
          <span>{POWER_LABEL[status.power]}</span>
          {status.brightness !== null && (
            <span>{Math.round((status.brightness / 255) * 100)}%</span>
          )}
          {status.allOffline && <span>offline</span>}
        </div>
      </div>
      <div className="home-tile-controls">
        <Toggle
          checked={status.power === 'on'}
          disabled={status.allOffline}
          ariaLabel={`power for ${tile.title}`}
          onChange={(next: boolean) => onPower(tile, next)}
        />
        <Slider
          min={1}
          max={255}
          value={status.brightness ?? 128}
          disabled={status.allOffline}
          ariaLabel={`brightness for ${tile.title}`}
          onChange={(v: number) => onBrightness(tile, v)}
        />
      </div>
    </div>
  );
}
```

- [ ] Create `client/src/sections/home/home.css` (complete for the phase — later tasks only consume these classes):

```css
.home-section { display: flex; flex-direction: column; gap: 16px; }
.home-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.home-header-actions { display: flex; gap: 8px; }

.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 14px;
}
@media (min-width: 900px) {
  .home-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px; }
}

.home-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: 0 0 36px -10px var(--tile-glow);
  overflow: hidden;
}
.home-tile::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 90% at 85% 0%, var(--tile-glow) 0%, transparent 65%);
  opacity: 0.14;
  pointer-events: none;
}
.home-tile-offline { opacity: 0.65; }
.home-tile-selected { outline: 2px solid var(--accent); outline-offset: 1px; }

.home-tile-select {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  width: 40px;   /* ≥40px touch target */
  height: 40px;
  accent-color: var(--accent);
  opacity: 0;
  transition: opacity 120ms;
}
.home-tile:hover .home-tile-select,
.home-tile-select:focus-visible,
.home-select-mode .home-tile-select { opacity: 1; }

.home-tile-body {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 64px;
  position: relative;
  z-index: 1;
}
.home-tile-body:focus-visible { outline: 2px solid var(--accent); border-radius: 8px; }
.home-tile-top { display: flex; align-items: center; gap: 8px; }
.home-tile-icon { font-size: 20px; }
.home-tile-name {
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-tile-status { display: flex; gap: 10px; color: var(--text-muted); font-size: 13px; }
.home-tile-controls { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; }
.home-tile-controls > :last-child { flex: 1; }

.home-action-bar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(76px + env(safe-area-inset-bottom)); /* clears the phone bottom nav */
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  z-index: 40;
}
@media (min-width: 900px) {
  .home-action-bar { bottom: 24px; }
}
.home-action-count { color: var(--text); font-weight: 600; }

.home-tile-edit { gap: 8px; }
.home-tile-name-input { flex: 1; min-width: 0; }
.home-tile-icon-btn {
  cursor: pointer;
  font-size: 20px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-control);
  background: var(--surface-2);
  color: var(--text);
}
.home-tile-edit-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.home-tile-drag-handle {
  cursor: grab;
  touch-action: none;
  user-select: none;
  padding: 10px;
  color: var(--text-muted);
  margin-left: auto;
}

.icon-picker { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
.icon-picker-item {
  cursor: pointer;
  text-align: center;
  font-size: 18px;
  padding: 10px 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-control);
}
.icon-picker-item:hover,
.icon-picker-selected { background: var(--accent-soft); }

.room-members-editor { display: flex; flex-direction: column; gap: 8px; }
.room-members-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.room-member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
}
.room-members-add { display: flex; flex-wrap: wrap; gap: 8px; }

.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeTile.test.tsx` — all 9 pass.
- [ ] Run full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green.
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add client/src/sections client/src/test/sections && git -C /Users/bwwilliams/github/uber-wled commit -m "client: HomeTile v2 with dynamic glow, quick controls, long-press"`

## Task 7: `sections/home/HomeSection.tsx` — tile grid, live status, quick-control writes, Control surface

**Files:**
- Create: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/HomeSection.tsx`
- Test (Create): `/Users/bwwilliams/github/uber-wled/client/src/test/sections/home/HomeSection.test.tsx`

**Interfaces:**
- Consumes:
  - Phase D (master contract): `ControlSurface({ targets, open, onClose })` from `control/ControlSurface`; `useLiveStatus(controllerIds: string[])` from `api/live`.
  - Task 3 `aggregateTileStatusLive`, Task 4 `dominantColor`/`OFF_GLOW`/`OFFLINE_GLOW`/`throttle`, Task 5 groups api fns + Phase D's `applyControl(targets, patch)` (verified by Task 5's gate), Task 6 `HomeTile`.
  - react-query keys `['groups']` / `['controllers']` (binding).
- Produces:
  - `HomeSection(): JSX.Element` (exported, default Home route component)
  - `buildTiles(groups: Group[], controllers: Controller[]): HomeTileData[]` (exported for tests) — group tiles sorted by `sortOrder` then name, then ungrouped controllers by name.
  - Quick-control semantics (binding for this phase): group tile → targets `[{ kind: 'group', groupId }]`, patch `{ seg: { on } }` / `{ seg: { bri } }`; ungrouped controller tile → targets `[{ kind: 'controller', controllerId }]`, patch `{ on }` / `{ bri }`. Brightness writes throttled to 1 per 250ms per section; optimistic override held 4s.

- [ ] Create `client/src/test/sections/home/HomeSection.test.tsx` (this file grows in Tasks 8–11):

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { liveMap } = vi.hoisted(() => ({ liveMap: new Map<string, unknown>() }));

vi.mock('../../../api/live', () => ({
  useLiveStatus: () => liveMap
}));
vi.mock('../../../control/ControlSurface', () => ({
  ControlSurface: ({ open, targets }: { open: boolean; targets: unknown[] }) =>
    open ? <div data-testid="control-surface">{JSON.stringify(targets)}</div> : null
}));
vi.mock('../../../components/ui/Toggle', () => ({
  Toggle: ({ checked, onChange, ariaLabel, disabled }: any) => (
    <input type="checkbox" role="switch" aria-label={ariaLabel} checked={checked} disabled={disabled}
      onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
  )
}));
vi.mock('../../../components/ui/Slider', () => ({
  Slider: ({ value, onChange, ariaLabel, min, max, disabled }: any) => (
    <input type="range" aria-label={ariaLabel} value={value} min={min} max={max} disabled={disabled}
      onChange={(e) => onChange(Number((e.target as HTMLInputElement).value))} />
  )
}));
vi.mock('../../../components/ui/Modal', () => ({
  Modal: ({ open, title, children }: any) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null
}));

import { HomeSection } from '../../../sections/home/HomeSection';

afterEach(() => vi.unstubAllGlobals());

const GROUPS = [
  { id: 'g1', name: 'Kitchen', icon: '🍳', sortOrder: 0, members: [{ controllerId: 'c1', wledSegId: 0 }] },
  { id: 'g2', name: 'Porch', icon: null, sortOrder: 1, members: [{ controllerId: 'c1', wledSegId: 1 }] }
];
const CONTROLLERS = [
  { id: 'c1', name: 'Cabinet Lights', host: '192.168.1.86', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Desk Strip', host: '192.168.1.90', source: 'manual', stale: false, pinnedAssetPattern: null }
];

// captured 2026-07-04 from GET http://192.168.1.86/json/state (color slot changed for test clarity)
const LIVE_STATE_C1 = {
  on: true,
  bri: 128,
  seg: [
    { id: 0, start: 0, stop: 39, len: 39, on: true, bri: 255, col: [[255, 80, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    { id: 1, start: 39, stop: 48, len: 9, on: false, bri: 255, col: [[0, 0, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }
  ]
};

function statusFixture(id: string, segIds: number[]) {
  return {
    controllerId: id,
    reachable: true,
    info: { name: id, ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' },
    state: {
      on: true, bri: 9, ps: -1,
      seg: segIds.map((s) => ({ id: s, start: 0, stop: 10, len: 10, on: true, bri: 255, fx: 0, pal: 0, col: [[255, 255, 255, 0]] }))
    },
    polledAt: '2026-07-04T22:00:00Z'
  };
}

function stubFetch() {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const respond = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
    const method = init?.method ?? 'GET';
    if (url === '/api/groups' && method === 'GET') return respond(GROUPS);
    if (url === '/api/groups' && method === 'POST') return respond({ ...GROUPS[0], id: 'g-new' });
    if (url === '/api/groups/reorder') return respond(GROUPS);
    if (url.startsWith('/api/groups/') && method === 'PATCH') return respond(GROUPS[0]);
    if (url.startsWith('/api/groups/') && method === 'DELETE') return respond({});
    if (url === '/api/controllers') return respond(CONTROLLERS);
    if (url === '/api/control/apply') return respond({ results: [] });
    if (url === '/api/controllers/c1/status') return respond(statusFixture('c1', [0, 1]));
    if (url === '/api/controllers/c2/status') return respond(statusFixture('c2', [0]));
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomeSection />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  liveMap.clear();
  liveMap.set('c1', { reachable: true, state: LIVE_STATE_C1 });
});

describe('HomeSection grid', () => {
  it('renders group tiles in sortOrder then ungrouped controllers, and skips grouped ones', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    const ids = screen.getAllByTestId(/^home-tile-/).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['home-tile-g1', 'home-tile-g2', 'home-tile-c2']);
  });

  it('derives tile glow from the dominant live segment color', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    // seg0 col [255,80,0] scaled by master bri 128/255
    expect(screen.getByTestId('home-tile-g1').style.getPropertyValue('--tile-glow'))
      .toBe('rgb(128, 40, 0)');
  });

  it('greys out a tile whose controller has no live entry', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Desk Strip')).toBeTruthy());
    const tile = screen.getByTestId('home-tile-c2');
    expect(tile.className).toContain('home-tile-offline');
    expect(tile.style.getPropertyValue('--tile-glow')).toBe('#3A3F4B');
  });

  it('sends a v2 seg power patch for a group tile toggle, optimistically flipping the tile', async () => {
    const fetchMock = stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch', { name: 'power for Kitchen' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ targets: [{ kind: 'group', groupId: 'g1' }], patch: { seg: { on: false } } })
      }))
    );
    const kitchen = screen.getByTestId('home-tile-g1');
    expect(within(kitchen).getByText('Off')).toBeTruthy(); // optimistic override
  });

  it('sends a top-level power patch for an ungrouped controller tile', async () => {
    const fetchMock = stubFetch();
    liveMap.set('c2', {
      reachable: true,
      state: { on: false, bri: 60, seg: [{ id: 0, start: 0, stop: 30, len: 30, on: true, bri: 60, col: [[0, 255, 0]] }] }
    });
    renderHome();
    await waitFor(() => expect(screen.getByText('Desk Strip')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch', { name: 'power for Desk Strip' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ targets: [{ kind: 'controller', controllerId: 'c2' }], patch: { on: true } })
      }))
    );
  });

  it('sends a throttled v2 brightness patch and shows the optimistic percent', async () => {
    const fetchMock = stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.change(screen.getByRole('slider', { name: 'brightness for Kitchen' }), {
      target: { value: '200' }
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ targets: [{ kind: 'group', groupId: 'g1' }], patch: { seg: { bri: 200 } } })
      }))
    );
    expect(within(screen.getByTestId('home-tile-g1')).getByText('78%')).toBeTruthy(); // 200/255
  });

  it('opens the Control surface with the group target when the tile body is tapped', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'open controls for Kitchen' }));
    const surface = screen.getByTestId('control-surface');
    expect(surface.textContent).toContain('"groupId":"g1"');
  });

  it('shows an empty state when there are no controllers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    renderHome();
    await waitFor(() => expect(screen.getByText(/Add a controller in Devices/)).toBeTruthy());
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeSection.test.tsx` — fails: cannot resolve `../../../sections/home/HomeSection`.
- [ ] Create `client/src/sections/home/HomeSection.tsx`:

```tsx
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listControllers,
  listGroups,
  applyControl,
  type Controller,
  type ControlPatch,
  type Group,
  type Target
} from '../../api/client';
import { useLiveStatus } from '../../api/live';
import { ControlSurface } from '../../control/ControlSurface';
import { HomeTile, type HomeTileData } from './HomeTile';
import {
  aggregateTileStatusLive,
  type LiveTileSource,
  type TileStatusV2
} from '../../lib/tileStatus';
import { dominantColor, OFF_GLOW, OFFLINE_GLOW } from '../../lib/dominantColor';
import { throttle } from '../../lib/throttle';
import './home.css';

const OVERRIDE_TTL_MS = 4000; // two live-poll ticks at the 2s default
const BRIGHTNESS_THROTTLE_MS = 250;

interface QuickOverride {
  on?: boolean;
  bri?: number;
  at: number;
}

export function buildTiles(groups: Group[], controllers: Controller[]): HomeTileData[] {
  const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m.controllerId)));
  const groupTiles: HomeTileData[] = groups
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((g) => ({
      id: g.id,
      kind: 'group' as const,
      title: g.name,
      icon: g.icon,
      members: g.members.map((m) => ({ controllerId: m.controllerId, wledSegId: m.wledSegId }))
    }));
  const controllerTiles: HomeTileData[] = controllers
    .filter((c) => !grouped.has(c.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      kind: 'controller' as const,
      title: c.name,
      icon: null,
      members: [{ controllerId: c.id, wledSegId: null }]
    }));
  return [...groupTiles, ...controllerTiles];
}

function targetsFor(tile: HomeTileData): Target[] {
  return tile.kind === 'group'
    ? [{ kind: 'group', groupId: tile.id }]
    : [{ kind: 'controller', controllerId: tile.id }];
}

export function HomeSection() {
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: listGroups });
  const controllersQuery = useQuery({ queryKey: ['controllers'], queryFn: listControllers });
  const groups = groupsQuery.data ?? [];
  const controllers = controllersQuery.data ?? [];

  const controllerIds = useMemo(() => controllers.map((c) => c.id), [controllers]);
  const live = useLiveStatus(controllerIds) as ReadonlyMap<string, LiveTileSource>;

  const [controlTargets, setControlTargets] = useState<Target[] | null>(null);
  const [overrides, setOverrides] = useState<Map<string, QuickOverride>>(new Map());

  const tiles = useMemo(() => buildTiles(groups, controllers), [groups, controllers]);

  function statusFor(tile: HomeTileData): TileStatusV2 {
    const base = aggregateTileStatusLive(tile.members, live);
    const o = overrides.get(tile.id);
    if (!o || Date.now() - o.at > OVERRIDE_TTL_MS) return base;
    return {
      ...base,
      power: o.on === undefined ? base.power : o.on ? 'on' : 'off',
      brightness: o.bri ?? base.brightness
    };
  }

  function glowFor(tile: HomeTileData, status: TileStatusV2): string {
    if (status.allOffline) return OFFLINE_GLOW;
    for (const m of tile.members) {
      const src = live.get(m.controllerId);
      if (src?.reachable && src.state) {
        const color = dominantColor(src.state);
        if (color !== OFF_GLOW && color !== OFFLINE_GLOW) return color;
      }
    }
    return OFF_GLOW;
  }

  function setOverride(tileId: string, patch: { on?: boolean; bri?: number }) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(tileId, { ...next.get(tileId), ...patch, at: Date.now() });
      return next;
    });
  }

  function handlePower(tile: HomeTileData, on: boolean) {
    setOverride(tile.id, { on });
    const patch: ControlPatch = tile.kind === 'group' ? { seg: { on } } : { on };
    applyControl(targetsFor(tile), patch).catch(() => {});
  }

  const throttledBrightness = useRef(
    throttle((tile: HomeTileData, bri: number) => {
      const patch: ControlPatch = tile.kind === 'group' ? { seg: { bri } } : { bri };
      applyControl(targetsFor(tile), patch).catch(() => {});
    }, BRIGHTNESS_THROTTLE_MS)
  ).current;

  function handleBrightness(tile: HomeTileData, bri: number) {
    setOverride(tile.id, { bri });
    throttledBrightness(tile, bri);
  }

  if (!controllersQuery.isLoading && controllers.length === 0) {
    return (
      <section className="section home-section">
        <h2>Home</h2>
        <p className="empty-state">Add a controller in Devices to get started.</p>
      </section>
    );
  }

  return (
    <section className="section home-section">
      <div className="home-header">
        <h2>Home</h2>
        <div className="home-header-actions" />
      </div>
      <div className="home-grid">
        {tiles.map((tile) => {
          const status = statusFor(tile);
          return (
            <HomeTile
              key={tile.id}
              tile={tile}
              status={status}
              glowColor={glowFor(tile, status)}
              selectMode={false}
              selected={false}
              onToggleSelect={() => {}}
              onLongPress={() => {}}
              onOpenControl={(t) => setControlTargets(targetsFor(t))}
              onPower={handlePower}
              onBrightness={handleBrightness}
            />
          );
        })}
      </div>
      <ControlSurface
        targets={controlTargets ?? []}
        open={controlTargets !== null}
        onClose={() => setControlTargets(null)}
      />
    </section>
  );
}
```

(Phase D's `LiveState` — `{ on, bri, seg: LiveSegment[] }` with `LiveSegment.len?: number` and `col: number[][]` — is structurally assignable to both `LiveTileState` and `DominantColorState` because Task 3/4 declared only the fields they read and made `len` optional; no casts needed beyond the `ReadonlyMap<string, LiveTileSource>` view on the hook result, which also holds structurally.)
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeSection.test.tsx` — all 8 pass.
- [ ] Run full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green.
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add client/src/sections client/src/test/sections && git -C /Users/bwwilliams/github/uber-wled commit -m "client: Home v2 tile grid with live status, glow, quick controls"`

## Task 8: Multi-select mode + floating action bar

**Files:**
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/HomeSection.tsx` (from Task 7)
- Test: `/Users/bwwilliams/github/uber-wled/client/src/test/sections/home/HomeSection.test.tsx` (append describe)

**Interfaces:**
- Consumes: Task 6 `HomeTile` select props; Task 7 `targetsFor`.
- Produces: select-mode UX — checkbox click or long-press enters select mode; floating bar (`role="toolbar"`, label `selection actions`) with `N selected`, `Select all`, `Control` (opens ControlSurface with all selected tiles' targets, disabled at 0), `Cancel`.

- [ ] Append to `client/src/test/sections/home/HomeSection.test.tsx`:

```tsx
describe('HomeSection multi-select', () => {
  it('enters select mode from the tile checkbox and shows the action bar', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: 'select Kitchen' }));
    const bar = screen.getByRole('toolbar', { name: 'selection actions' });
    expect(within(bar).getByText('1 selected')).toBeTruthy();
  });

  it('select-all selects every tile and Control opens the surface with all targets', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: 'select Kitchen' }));
    fireEvent.click(screen.getByText('Select all'));
    expect(screen.getByText('3 selected')).toBeTruthy();
    fireEvent.click(screen.getByText('Control'));
    const surface = screen.getByTestId('control-surface');
    expect(surface.textContent).toContain('"groupId":"g1"');
    expect(surface.textContent).toContain('"groupId":"g2"');
    expect(surface.textContent).toContain('"controllerId":"c2"');
  });

  it('cancel exits select mode and clears the selection', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: 'select Kitchen' }));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('toolbar', { name: 'selection actions' })).toBeNull();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeSection.test.tsx` — new describe fails (no toolbar rendered).
- [ ] In `HomeSection.tsx`, add select-mode state and handlers after the `overrides` state declaration:

```tsx
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelectMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function enterSelectMode(id: string) {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function selectAll() {
    setSelectedIds(new Set(tiles.map((t) => t.id)));
  }

  function controlSelected() {
    const targets = tiles.filter((t) => selectedIds.has(t.id)).flatMap(targetsFor);
    if (targets.length > 0) setControlTargets(targets);
  }
```

- [ ] In the return JSX: change the grid wrapper to `` <div className={`home-grid${selectMode ? ' home-select-mode' : ''}`}> ``, pass real select props to `HomeTile`:

```tsx
              selectMode={selectMode}
              selected={selectedIds.has(tile.id)}
              onToggleSelect={toggleSelect}
              onLongPress={enterSelectMode}
```

and insert the action bar between the grid `</div>` and `<ControlSurface …>`:

```tsx
      {selectMode && (
        <div className="home-action-bar" role="toolbar" aria-label="selection actions">
          <span className="home-action-count">{selectedIds.size} selected</span>
          <button type="button" className="btn btn-secondary" onClick={selectAll}>Select all</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selectedIds.size === 0}
            onClick={controlSelected}
          >
            Control
          </button>
          <button type="button" className="btn btn-secondary" onClick={exitSelectMode}>Cancel</button>
        </div>
      )}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeSection.test.tsx` — all pass (Task 7 tests still green: their tiles receive `selectMode={false}` because no checkbox was clicked).
- [ ] Run full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green.
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add client/src/sections/home/HomeSection.tsx client/src/test/sections/home/HomeSection.test.tsx && git -C /Users/bwwilliams/github/uber-wled commit -m "client: Home multi-select with floating action bar into Control surface"`

## Task 9: Edit mode — create / rename / delete rooms with icon picker

**Files:**
- Create: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/IconPicker.tsx`
- Create: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/RoomCreateModal.tsx`
- Create: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/RoomEditTile.tsx`
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/HomeSection.tsx`
- Test: `/Users/bwwilliams/github/uber-wled/client/src/test/sections/home/HomeSection.test.tsx` (append describe)

**Interfaces:**
- Consumes: `Modal` from `components/ui/Modal` (Phase C); `addGroup`/`updateGroup`/`deleteGroup` from Task 5; `useQueryClient` invalidation on key `['groups']`.
- Produces:
  - `ROOM_ICONS: readonly string[]` — exactly `['🛋️','🛏️','🍳','🍽️','🛁','🚪','🖥️','📺','🎮','🌳','🚗','🧺','📚','🎄','⭐','💡']`
  - `IconPicker({ value: string | null; onChange(icon: string | null): void })`
  - `RoomCreateModal({ open: boolean; onClose(): void; onCreate(name: string, icon: string | null): Promise<void> })`
  - `RoomEditTile({ group: Group; index: number; count: number; onRename(id, name): void; onSetIcon(id, icon): void; onDelete(id): void })` (Tasks 10–11 extend these props; root `data-testid="edit-tile-<id>"`)

- [ ] Append to `client/src/test/sections/home/HomeSection.test.tsx`:

```tsx
describe('HomeSection edit mode', () => {
  async function enterEdit() {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  }

  it('creates a room with a name and an icon from the fixed set', async () => {
    await enterEdit();
    fireEvent.click(screen.getByText('Add room'));
    const dialog = screen.getByRole('dialog', { name: 'New room' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Bedroom' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'icon 🛏️' }));
    fireEvent.click(within(dialog).getByText('Create room'));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Bedroom', members: [], icon: '🛏️' })
      }))
    );
  });

  it('renames a room inline on blur', async () => {
    await enterEdit();
    const input = screen.getByRole('textbox', { name: 'rename Kitchen' });
    fireEvent.change(input, { target: { value: 'Kitchen 2' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Kitchen 2' })
      }))
    );
  });

  it('changes a room icon from the picker', async () => {
    await enterEdit();
    fireEvent.click(screen.getByRole('button', { name: 'change icon for Kitchen' }));
    fireEvent.click(screen.getAllByRole('radio', { name: 'icon 📚' })[0]);
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ icon: '📚' })
      }))
    );
  });

  it('deletes a room only after modal confirmation', async () => {
    await enterEdit();
    const tile = screen.getByTestId('edit-tile-g1');
    fireEvent.click(within(tile).getByText('Delete'));
    const dialog = screen.getByRole('dialog', { name: 'Delete room' });
    fireEvent.click(within(dialog).getByText('Delete'));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', { method: 'DELETE' })
    );
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeSection.test.tsx` — new describe fails (no `Edit` button).
- [ ] Create `client/src/sections/home/IconPicker.tsx`:

```tsx
export const ROOM_ICONS = [
  '🛋️', '🛏️', '🍳', '🍽️', '🛁', '🚪', '🖥️', '📺',
  '🎮', '🌳', '🚗', '🧺', '📚', '🎄', '⭐', '💡'
] as const;

export function IconPicker({
  value,
  onChange
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
}) {
  return (
    <div className="icon-picker" role="radiogroup" aria-label="room icon">
      {ROOM_ICONS.map((icon) => (
        <button
          key={icon}
          type="button"
          role="radio"
          aria-checked={value === icon}
          aria-label={`icon ${icon}`}
          className={`icon-picker-item${value === icon ? ' icon-picker-selected' : ''}`}
          onClick={() => onChange(value === icon ? null : icon)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
```

- [ ] Create `client/src/sections/home/RoomCreateModal.tsx`:

```tsx
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { IconPicker } from './IconPicker';

export function RoomCreateModal({
  open,
  onClose,
  onCreate
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string | null) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), icon);
      setName('');
      setIcon(null);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="New room" onClose={onClose}>
      <div className="field">
        <label htmlFor="room-name">Name</label>
        <input
          id="room-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Living room"
        />
      </div>
      <IconPicker value={icon} onChange={setIcon} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim() || busy}
          onClick={handleCreate}
        >
          Create room
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] Create `client/src/sections/home/RoomEditTile.tsx` (Task 9 version — Tasks 10/11 extend it):

```tsx
import { useState } from 'react';
import type { Group } from '../../api/client';
import { IconPicker } from './IconPicker';

export function RoomEditTile({
  group,
  onRename,
  onSetIcon,
  onDelete
}: {
  group: Group;
  onRename: (id: string, name: string) => void;
  onSetIcon: (id: string, icon: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const [showIcons, setShowIcons] = useState(false);

  function commitName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== group.name) onRename(group.id, trimmed);
  }

  return (
    <div className="home-tile home-tile-edit" data-testid={`edit-tile-${group.id}`}>
      <div className="home-tile-top">
        <button
          type="button"
          className="home-tile-icon-btn"
          aria-label={`change icon for ${group.name}`}
          onClick={() => setShowIcons((v) => !v)}
        >
          {group.icon ?? '＋'}
        </button>
        <input
          className="input home-tile-name-input"
          aria-label={`rename ${group.name}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      {showIcons && (
        <IconPicker
          value={group.icon}
          onChange={(icon) => {
            onSetIcon(group.id, icon);
            setShowIcons(false);
          }}
        />
      )}
      <div className="home-tile-edit-actions">
        <button type="button" className="btn btn-destructive" onClick={() => onDelete(group.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
```

- [ ] In `HomeSection.tsx`: extend the api import with `addGroup, deleteGroup, updateGroup, type GroupMember`, add `useQueryClient` to the react-query import, and import the new components:

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RoomCreateModal } from './RoomCreateModal';
import { RoomEditTile } from './RoomEditTile';
```

Add edit-mode state + mutation handlers after the select-mode handlers:

```tsx
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);

  const sortedGroups = useMemo(
    () => groups.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [groups]
  );

  function invalidateGroups() {
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  }

  async function createRoom(name: string, icon: string | null) {
    await addGroup(name, [], icon);
    invalidateGroups();
  }

  function renameRoom(id: string, name: string) {
    updateGroup(id, { name }).then(invalidateGroups);
  }

  function setRoomIcon(id: string, icon: string | null) {
    updateGroup(id, { icon }).then(invalidateGroups);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteGroup(deleteTarget.id).then(() => {
      setDeleteTarget(null);
      invalidateGroups();
    });
  }
```

Replace the `home-header-actions` placeholder div with:

```tsx
        <div className="home-header-actions">
          {editMode && (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              Add room
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            aria-pressed={editMode}
            onClick={() => {
              setEditMode((v) => !v);
              exitSelectMode();
            }}
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>
```

Wrap the tile grid so edit mode swaps in the edit tiles (replace the existing `home-grid` div with):

```tsx
      {editMode ? (
        <div className="home-grid">
          {sortedGroups.map((g) => (
            <RoomEditTile
              key={g.id}
              group={g}
              onRename={renameRoom}
              onSetIcon={setRoomIcon}
              onDelete={(id) => setDeleteTarget(sortedGroups.find((x) => x.id === id) ?? null)}
            />
          ))}
        </div>
      ) : (
        <div className={`home-grid${selectMode ? ' home-select-mode' : ''}`}>
          {/* …existing HomeTile map from Tasks 7–8, unchanged… */}
        </div>
      )}
```

And add the modals before `<ControlSurface …>` (import `Modal` from `../../components/ui/Modal`):

```tsx
      <RoomCreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createRoom} />
      <Modal open={deleteTarget !== null} title="Delete room" onClose={() => setDeleteTarget(null)}>
        <p>
          Delete “{deleteTarget?.name}”? Schedules and calendar events that reference it will stop
          working.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-destructive" onClick={confirmDelete}>
            Delete
          </button>
        </div>
      </Modal>
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeSection.test.tsx` — all pass.
- [ ] Run full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green.
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add client/src/sections/home client/src/test/sections/home && git -C /Users/bwwilliams/github/uber-wled commit -m "client: Home edit mode - create/rename/delete rooms with icon picker"`

## Task 10: Edit mode — room member editor (controller + segment pairs)

**Files:**
- Create: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/RoomMembersEditor.tsx`
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/RoomEditTile.tsx`
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/HomeSection.tsx` (pass `controllers` + `onMembersChange` into `RoomEditTile`)
- Test: `/Users/bwwilliams/github/uber-wled/client/src/test/sections/home/HomeSection.test.tsx` (append describe)

**Interfaces:**
- Consumes: existing `getControllerStatus(controllerId)` (`client/src/api/client.ts:248`, returns `ControllerStatus` with `state.seg[].id` from the cached status poller — this is the "segment ids from cached status" source); `updateGroup` from Task 5.
- Produces: `RoomMembersEditor({ group: Group; controllers: Controller[]; onMembersChange(id: string, members: GroupMember[]): void })`; `RoomEditTile` gains props `controllers: Controller[]` and `onMembersChange` and a `Members` disclosure button.

- [ ] Append to `client/src/test/sections/home/HomeSection.test.tsx`:

```tsx
describe('HomeSection room member editing', () => {
  async function openMembers() {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(screen.getByTestId('edit-tile-g1')).getByText('Members'));
  }

  it('lists current members with controller name and segment id', async () => {
    await openMembers();
    await waitFor(() =>
      expect(screen.getByText('Cabinet Lights · segment 0')).toBeTruthy()
    );
  });

  it('adds a controller+segment pair, with segment ids from the cached status', async () => {
    await openMembers();
    const tile = screen.getByTestId('edit-tile-g1');
    fireEvent.change(within(tile).getByRole('combobox', { name: 'controller to add to Kitchen' }), {
      target: { value: 'c2' }
    });
    // status fetch for c2 resolves with one segment (id 0)
    await waitFor(() =>
      expect(within(tile).getByRole('combobox', { name: 'segment to add to Kitchen' })).toBeTruthy()
    );
    fireEvent.click(within(tile).getByText('Add member'));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          members: [
            { controllerId: 'c1', wledSegId: 0 },
            { controllerId: 'c2', wledSegId: 0 }
          ]
        })
      }))
    );
  });

  it('removes a member', async () => {
    await openMembers();
    await waitFor(() => expect(screen.getByText('Cabinet Lights · segment 0')).toBeTruthy());
    fireEvent.click(
      screen.getByRole('button', { name: 'remove Cabinet Lights segment 0 from Kitchen' })
    );
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/g1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ members: [] })
      }))
    );
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeSection.test.tsx` — new describe fails (no `Members` button).
- [ ] Create `client/src/sections/home/RoomMembersEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  getControllerStatus,
  type Controller,
  type Group,
  type GroupMember
} from '../../api/client';

export function RoomMembersEditor({
  group,
  controllers,
  onMembersChange
}: {
  group: Group;
  controllers: Controller[];
  onMembersChange: (id: string, members: GroupMember[]) => void;
}) {
  const [controllerId, setControllerId] = useState(controllers[0]?.id ?? '');
  const [segId, setSegId] = useState(0);
  const [segOptions, setSegOptions] = useState<number[]>([0]);

  useEffect(() => {
    if (!controllerId) return;
    let cancelled = false;
    getControllerStatus(controllerId)
      .then((s) => {
        if (cancelled) return;
        const ids = s.state?.seg.map((x) => x.id) ?? [0];
        setSegOptions(ids.length > 0 ? ids : [0]);
        setSegId(ids[0] ?? 0);
      })
      .catch(() => {
        if (cancelled) return;
        setSegOptions([0]);
        setSegId(0);
      });
    return () => {
      cancelled = true;
    };
  }, [controllerId]);

  function controllerName(id: string) {
    return controllers.find((c) => c.id === id)?.name ?? id;
  }

  function addMember() {
    if (!controllerId) return;
    const exists = group.members.some(
      (m) => m.controllerId === controllerId && m.wledSegId === segId
    );
    if (exists) return;
    onMembersChange(group.id, [...group.members, { controllerId, wledSegId: segId }]);
  }

  function removeMember(index: number) {
    onMembersChange(group.id, group.members.filter((_, i) => i !== index));
  }

  return (
    <div className="room-members-editor">
      <ul className="room-members-list">
        {group.members.map((m, i) => (
          <li key={`${m.controllerId}-${m.wledSegId}`} className="room-member-row">
            <span>{controllerName(m.controllerId)} · segment {m.wledSegId}</span>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label={`remove ${controllerName(m.controllerId)} segment ${m.wledSegId} from ${group.name}`}
              onClick={() => removeMember(i)}
            >
              Remove
            </button>
          </li>
        ))}
        {group.members.length === 0 && <li className="empty-state">No members yet.</li>}
      </ul>
      <div className="room-members-add">
        <select
          className="input"
          aria-label={`controller to add to ${group.name}`}
          value={controllerId}
          onChange={(e) => setControllerId(e.target.value)}
        >
          {controllers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          className="input"
          aria-label={`segment to add to ${group.name}`}
          value={segId}
          onChange={(e) => setSegId(Number(e.target.value))}
        >
          {segOptions.map((s) => (
            <option key={s} value={s}>segment {s}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={addMember} disabled={!controllerId}>
          Add member
        </button>
      </div>
    </div>
  );
}
```

- [ ] In `RoomEditTile.tsx`: add props `controllers: Controller[]` and `onMembersChange: (id: string, members: GroupMember[]) => void` (import both types from `../../api/client`), add `const [showMembers, setShowMembers] = useState(false);`, import `RoomMembersEditor` from `./RoomMembersEditor`, add a toggle button inside `home-tile-edit-actions` **before** Delete:

```tsx
        <button type="button" className="btn btn-secondary" onClick={() => setShowMembers((v) => !v)}>
          Members
        </button>
```

and render the editor after the actions row:

```tsx
      {showMembers && (
        <RoomMembersEditor group={group} controllers={controllers} onMembersChange={onMembersChange} />
      )}
```

- [ ] In `HomeSection.tsx`: add handler and pass props to `RoomEditTile`:

```tsx
  function changeMembers(id: string, members: GroupMember[]) {
    updateGroup(id, { members }).then(invalidateGroups);
  }
```

```tsx
            <RoomEditTile
              key={g.id}
              group={g}
              controllers={controllers}
              onRename={renameRoom}
              onSetIcon={setRoomIcon}
              onDelete={(id) => setDeleteTarget(sortedGroups.find((x) => x.id === id) ?? null)}
              onMembersChange={changeMembers}
            />
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/HomeSection.test.tsx` — all pass.
- [ ] Run full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green.
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add client/src/sections/home client/src/test/sections/home && git -C /Users/bwwilliams/github/uber-wled commit -m "client: Home edit mode room member editor with cached segment ids"`

## Task 11: Edit mode — reorder tiles (pointer drag + arrow buttons)

**Files:**
- Create: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/reorder.ts`
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/RoomEditTile.tsx`
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/sections/home/HomeSection.tsx`
- Test (Create): `/Users/bwwilliams/github/uber-wled/client/src/test/sections/home/reorder.test.ts`
- Test: `/Users/bwwilliams/github/uber-wled/client/src/test/sections/home/HomeSection.test.tsx` (append describe)

**Interfaces:**
- Consumes: `reorderGroups(ids)` from Task 5; `POST /api/groups/reorder` from Task 2.
- Produces:
  - `moveId(ids: string[], id: string, toIndex: number): string[]` (pure, clamping)
  - `dropIndexForPoint(rects: { left; top; right; bottom }[], x: number, y: number): number` (pure, nearest-center)
  - `RoomEditTile` gains `index: number; count: number; onMove(id: string, delta: number): void; onDragStart(id: string, e: React.PointerEvent): void` and renders arrow buttons (`move <name> earlier` / `move <name> later`) + a drag handle (`aria-hidden`, class `home-tile-drag-handle`).

Reorder UX: arrow buttons are the keyboard/deterministic path (each press persists immediately); pointer drag on the handle live-reorders via `dropIndexForPoint` over the edit grid children's bounding rects and persists once on pointer-up. jsdom cannot produce real layout rects, so drag math is covered by the pure-helper unit tests and the component test covers the arrow path end-to-end.

- [ ] Create `client/src/test/sections/home/reorder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { moveId, dropIndexForPoint } from '../../../sections/home/reorder';

describe('moveId', () => {
  it('moves an id to a later index', () => {
    expect(moveId(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
  });
  it('moves an id earlier and clamps out-of-range targets', () => {
    expect(moveId(['a', 'b', 'c'], 'c', -5)).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a']);
  });
  it('returns the array unchanged for an unknown id or a no-op move', () => {
    expect(moveId(['a', 'b'], 'x', 1)).toEqual(['a', 'b']);
    expect(moveId(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
  });
});

describe('dropIndexForPoint', () => {
  const rects = [
    { left: 0, top: 0, right: 100, bottom: 100 },
    { left: 110, top: 0, right: 210, bottom: 100 },
    { left: 0, top: 110, right: 100, bottom: 210 }
  ];
  it('returns the index of the tile whose center is nearest the pointer', () => {
    expect(dropIndexForPoint(rects, 160, 50)).toBe(1);
    expect(dropIndexForPoint(rects, 10, 200)).toBe(2);
  });
  it('returns 0 for an empty rect list', () => {
    expect(dropIndexForPoint([], 50, 50)).toBe(0);
  });
});
```

- [ ] Append to `client/src/test/sections/home/HomeSection.test.tsx`:

```tsx
describe('HomeSection reorder', () => {
  it('persists the new order when a room is moved with the arrow buttons', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'move Kitchen later' }));
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/groups/reorder', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['g2', 'g1'] })
      }))
    );
  });

  it('disables the boundary arrows', async () => {
    stubFetch();
    renderHome();
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByRole('button', { name: 'move Kitchen earlier' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'move Porch later' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/reorder.test.ts src/test/sections/home/HomeSection.test.tsx` — both fail (module missing / no arrow buttons).
- [ ] Create `client/src/sections/home/reorder.ts`:

```ts
export function moveId(ids: string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const clamped = Math.max(0, Math.min(ids.length - 1, toIndex));
  if (clamped === from) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(clamped, 0, id);
  return next;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function dropIndexForPoint(rects: Rect[], x: number, y: number): number {
  if (rects.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  rects.forEach((r, i) => {
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
```

- [ ] In `RoomEditTile.tsx`, add props `index: number; count: number; onMove: (id: string, delta: number) => void; onDragStart: (id: string, e: React.PointerEvent) => void;` and replace the `home-tile-edit-actions` div with:

```tsx
      <div className="home-tile-edit-actions">
        <button
          type="button"
          className="btn btn-secondary"
          aria-label={`move ${group.name} earlier`}
          disabled={index === 0}
          onClick={() => onMove(group.id, -1)}
        >
          ←
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label={`move ${group.name} later`}
          disabled={index === count - 1}
          onClick={() => onMove(group.id, 1)}
        >
          →
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setShowMembers((v) => !v)}>
          Members
        </button>
        <span
          className="home-tile-drag-handle"
          aria-hidden="true"
          onPointerDown={(e) => onDragStart(group.id, e)}
        >
          ⠿
        </span>
        <button type="button" className="btn btn-destructive" onClick={() => onDelete(group.id)}>
          Delete
        </button>
      </div>
```

- [ ] In `HomeSection.tsx`: import `moveId, dropIndexForPoint` from `./reorder` and `reorderGroups` from `../../api/client`; add drag state + handlers after `changeMembers`:

```tsx
  const editGridRef = useRef<HTMLDivElement | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);

  const orderedGroups = useMemo(() => {
    if (!dragOrder) return sortedGroups;
    const byId = new Map(sortedGroups.map((g) => [g.id, g]));
    return dragOrder.map((id) => byId.get(id)).filter((g): g is Group => !!g);
  }, [sortedGroups, dragOrder]);

  function persistOrder(ids: string[]) {
    reorderGroups(ids).then(invalidateGroups);
  }

  function moveRoom(id: string, delta: number) {
    const ids = orderedGroups.map((g) => g.id);
    const from = ids.indexOf(id);
    if (from === -1) return;
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    persistOrder(moveId(ids, id, to));
  }

  function handleDragStart(id: string, e: React.PointerEvent) {
    dragIdRef.current = id;
    setDragOrder(orderedGroups.map((g) => g.id));
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function handleDragMove(e: React.PointerEvent) {
    const dragId = dragIdRef.current;
    if (!dragId || !editGridRef.current) return;
    const rects = Array.from(editGridRef.current.children).map((el) => el.getBoundingClientRect());
    const idx = dropIndexForPoint(rects, e.clientX, e.clientY);
    setDragOrder((prev) => (prev ? moveId(prev, dragId, idx) : prev));
  }

  function handleDragEnd() {
    const dragId = dragIdRef.current;
    dragIdRef.current = null;
    if (dragId && dragOrder) persistOrder(dragOrder);
    setDragOrder(null);
  }
```

Update the edit grid to use them (replace the edit-mode grid from Task 9):

```tsx
        <div
          className="home-grid"
          ref={editGridRef}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
        >
          {orderedGroups.map((g, i) => (
            <RoomEditTile
              key={g.id}
              group={g}
              controllers={controllers}
              index={i}
              count={orderedGroups.length}
              onRename={renameRoom}
              onSetIcon={setRoomIcon}
              onDelete={(id) => setDeleteTarget(orderedGroups.find((x) => x.id === id) ?? null)}
              onMembersChange={changeMembers}
              onMove={moveRoom}
              onDragStart={handleDragStart}
            />
          ))}
        </div>
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/home/reorder.test.ts src/test/sections/home/HomeSection.test.tsx` — all pass.
- [ ] Run full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green.
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add client/src/sections/home client/src/test/sections/home && git -C /Users/bwwilliams/github/uber-wled commit -m "client: Home room reordering via drag handle and arrow buttons"`

## Task 12: Wire into AppShell, delete the old Home implementation

**Files:**
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/components/AppShell.tsx` (the Home route import — Phase C's rewritten shell; locate with grep, see step 1)
- Modify: `/Users/bwwilliams/github/uber-wled/client/src/lib/tileStatus.ts` (remove the snapshot-era exports)
- Delete: `/Users/bwwilliams/github/uber-wled/client/src/components/HomeSection.tsx`, `/Users/bwwilliams/github/uber-wled/client/src/components/HomeTile.tsx`, `/Users/bwwilliams/github/uber-wled/client/src/test/HomeSection.test.tsx`, `/Users/bwwilliams/github/uber-wled/client/src/test/components/HomeTile.test.tsx`, `/Users/bwwilliams/github/uber-wled/client/src/test/lib/tileStatus.test.ts`
- Test: full client suite + build (no new tests; this task is deletion + wiring)

**Interfaces:**
- Consumes: `HomeSection` from Task 7.
- Produces: the app renders `sections/home/HomeSection` on the Home route; zero references to the old components remain. (`GroupManager` stays — Phase I deletes it per the master plan.)

- [ ] Locate the current Home wiring: `grep -rn "HomeSection" /Users/bwwilliams/github/uber-wled/client/src --include='*.tsx' -l` — expect hits in `components/AppShell.tsx` (Phase C shell), old `components/HomeSection.tsx`, and the new section/tests.
- [ ] In `client/src/components/AppShell.tsx`, replace the old import with the new one (exact old line per grep; target state):

```tsx
import { HomeSection } from '../sections/home/HomeSection';
```

(The rendered `<HomeSection />` element does not change — only the import path.)
- [ ] Delete the replaced files:

```
git -C /Users/bwwilliams/github/uber-wled rm client/src/components/HomeSection.tsx client/src/components/HomeTile.tsx client/src/test/HomeSection.test.tsx client/src/test/components/HomeTile.test.tsx client/src/test/lib/tileStatus.test.ts
```

- [ ] In `client/src/lib/tileStatus.ts`, delete the now-dead snapshot-era exports — the `WledSegmentSnapshot` interface, the `TileMember` interface, the `TileStatus` interface, and the `aggregateTileStatus` function (everything above the `// --- Home v2: live-stream aggregation` marker added in Task 3).
- [ ] Verify nothing references the removed exports: `grep -rn "aggregateTileStatus\b\|from '../lib/tileStatus'" /Users/bwwilliams/github/uber-wled/client/src --include='*.ts*' | grep -v tileStatusLive | grep -v aggregateTileStatusLive` — expect only imports of the new names (`sections/home/*`). If Phase D/G code imports `TileMember`, keep that one type and update this step's deletion list accordingly.
- [ ] Run full suites and build:
  - `cd /Users/bwwilliams/github/uber-wled/client && npm test` — green
  - `cd /Users/bwwilliams/github/uber-wled/client && npm run build` — succeeds
  - `cd /Users/bwwilliams/github/uber-wled/server && npm test` — green
- [ ] Browser spot-check (dev server against real controllers, read-only + state-level quick controls only per hardware policy): Home renders tiles with glow at 390px and 1440px; toggle a tile's power and restore it to its prior state immediately after (capture the prior on/off from the tile before toggling).
- [ ] Commit: `git -C /Users/bwwilliams/github/uber-wled add -A client/src && git -C /Users/bwwilliams/github/uber-wled commit -m "client: Home v2 replaces old HomeSection/HomeTile; remove snapshot tile aggregation"`
- [ ] After phase review passes: `git -C /Users/bwwilliams/github/uber-wled push origin main`

---

## Phase completion gate

- `cd /Users/bwwilliams/github/uber-wled/server && npm test` green
- `cd /Users/bwwilliams/github/uber-wled/client && npm test` green
- `cd /Users/bwwilliams/github/uber-wled/client && npm run build` green
- Home verified in-browser at 390px and 1440px (grid min tile 168px phone / 220px desktop; action bar clears the bottom nav; touch targets ≥ 40px)
- One commit per task (12 minimum), pushed after review
