# Phase I — Migration, Cleanup, README, 1.0.0, Verification, Deploy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Move the scheduler engine and calendar trigger/preview paths onto fan-out v2, delete every v1 control artifact (route branch, `applyToMembers`, `GroupManager.tsx`, `ControlPanel.tsx`, orphans), rewrite the README for the 7-section IA, ship 1.0.0, and verify + deploy to media-server.

**Architecture:** A thin server-side adapter (`control/actionMap.ts`) converts the persisted v1 action rows (`schedules.action_type`/`calendar_events.action_type` — the DB schema is NOT migrated) into Phase B's `Target[] + ControlPatch` and delegates to `applyControlPatch` (Phase B's fan-out entry point), so `SchedulerEngine` and its tests stay untouched. The v1 `{members, action}` branch of `POST /api/control/apply` and all v1 client code are then deleted. Release work (README, version bumps, hw-smoke script, walkthrough, deploy) closes the milestone.

**Tech Stack:** Existing only — Node 20 + TypeScript + Express + better-sqlite3 + Vitest + supertest (server); React 18 + Vite + Vitest + Testing Library (client). No new dependencies in this phase.

**Repo root:** `/Users/bwwilliams/github/uber-wled`. All file paths below are relative to it unless absolute.

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

## Phase inputs and drift warning

This phase runs LAST, after Phases A–H have rewritten large parts of the
repo. Line numbers cited below are from the pre-Phase-A codebase and WILL
have drifted; every task therefore begins with a verification grep
(per the `executing-plans-verification` skill). The binding contracts from
`00-master.md` (copied verbatim where used below) always win over stale
snippets.

**Consumed from Phase B (binding, from `00-master.md`):**

```ts
// server/src/control/applyV2.ts
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
// POST /api/control/apply  body { targets: Target[], patch: ControlPatch }
// → { results: ApplyResult[] }  (HTTP 200 even with partial failures)
```

The fan-out entry point Phase B ships (per `02-server-control-live.md`
Task 4) is
`applyControlPatch(db: Database.Database, targets: Target[], patch: ControlPatch): Promise<ApplyResult[]>`
exported from `server/src/control/applyV2.ts`. It throws `GroupNotFoundError`
(same module) before any device I/O when a group-kind target names an unknown
group — irrelevant to the scheduler path built below, which only ever emits
segment-kind targets, but Task 3's route edit must keep catching it. If the
implemented Phase B export drifted (different name or an options object),
keep Phase B's calling convention at the call sites but keep the mapper
signatures this plan *produces* exactly as written — they are Phase I's own
contract.

---

## Task 1: v1-action → v2 mapper (`server/src/control/actionMap.ts`) + `ControlPatch.ps` extension

The scheduler/calendar rows keep storing `actionType`/`actionPayload`
(`'power' | 'brightness' | 'preset' | 'theme'`, plus `'effect'` in the old
client union). This task builds the one place that maps those onto
`Target[] + ControlPatch`. WLED device presets are a **top-level** state
field (`ps`), which the master's `ControlPatch` carries (`ps?: number`) and
which the master explicitly routes v1 preset actions through ("scheduler v1
'preset' actions map to it too"). Phase B's plan, however, omitted `ps` from
its local copy of the interface, and its `writeTarget` body-builder copies
only `on`/`bri`/`transition`/`nl` — so this task VERIFIES `ps` end-to-end
and adds the missing pieces if Phase B shipped without them. The mapper
emits raw `fxId`/`palId` (never names), so scheduler fires do not depend on
a populated capability cache.

**Files:**
- Create: `server/src/control/actionMap.ts`
- Create: `server/test/control/actionMap.test.ts`
- Modify: `server/src/control/applyV2.ts` (only if `ps` is missing — add it to the `ControlPatch` interface and copy it through in `writeTarget`, the function that builds the per-target `/json/state` body, next to where `on`/`bri` are copied; `WledStatePatch.ps` already exists in `server/src/wled/types.ts`)

**Interfaces:**
- Consumes: `applyControlPatch(db, targets, patch): Promise<ApplyResult[]>`, `Target`, `ControlPatch`, `ApplyResult` from `server/src/control/applyV2.js` (contract above); `createThemeRepository(db).get(id: string): CustomTheme | undefined` from `server/src/themes/repository.js` where `CustomTheme = { id: string; name: string; effect: number; palette: number; colors: number[][]; brightness: number }`.
- Produces:
  - `export type ControlAction = { type: 'power'; on: boolean } | { type: 'brightness'; value: number } | { type: 'preset'; presetId: number } | { type: 'theme'; themeId: string } | { type: 'effect'; effectId: number }`
  - `export interface Member { controllerId: string; wledSegId: number }`
  - `export function actionToPatch(action: ControlAction, resolveTheme: (id: string) => { effect: number; palette: number; colors: number[][]; brightness: number } | undefined): ControlPatch`
  - `export async function applyActionV2(db: Database.Database, members: Member[], action: ControlAction): Promise<ApplyResult[]>`
  - `ControlPatch.ps?: number` (additive; used by Task 4's client preview migration and the Presets flows)

**Steps:**

- [ ] Verify Phase B's actual exports: `grep -n "export" /Users/bwwilliams/github/uber-wled/server/src/control/applyV2.ts` (confirm the entry point is `applyControlPatch` — if the name drifted, use the real one at every call site below) and `grep -n "ps" /Users/bwwilliams/github/uber-wled/server/src/control/applyV2.ts`. Note whether `ps?: number` exists on `ControlPatch` AND is copied into the device body in `writeTarget` (if both, skip the `applyV2.ts` edit in the implementation step below — the test still must pass).
- [ ] Write the failing test `server/test/control/actionMap.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { actionToPatch, applyActionV2 } from '../../src/control/actionMap.js';

// Project-wide pattern: stub global fetch (nock does not intercept Node's
// built-in undici-backed fetch — see ~/.claude/skills/vitest-testing-gotchas).
function stubFetchByHost(
  handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    const handler = handlers[host];
    if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const okState = { on: true, bri: 128, ps: -1, seg: [] };

describe('actionToPatch', () => {
  const noTheme = () => undefined;

  it('maps power to a top-level on patch', () => {
    expect(actionToPatch({ type: 'power', on: true }, noTheme)).toEqual({ on: true });
    expect(actionToPatch({ type: 'power', on: false }, noTheme)).toEqual({ on: false });
  });

  it('maps brightness to a top-level bri patch', () => {
    expect(actionToPatch({ type: 'brightness', value: 200 }, noTheme)).toEqual({ bri: 200 });
  });

  it('maps preset to a top-level ps patch (device presets are device-level)', () => {
    expect(actionToPatch({ type: 'preset', presetId: 3 }, noTheme)).toEqual({ ps: 3 });
  });

  it('maps effect to a seg fxId patch', () => {
    expect(actionToPatch({ type: 'effect', effectId: 9 }, noTheme)).toEqual({ seg: { fxId: 9 } });
  });

  it('maps theme by resolving stored effect/palette/colors/brightness', () => {
    const resolve = (id: string) =>
      id === 't1' ? { effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 } : undefined;
    expect(actionToPatch({ type: 'theme', themeId: 't1' }, resolve)).toEqual({
      bri: 180,
      seg: { fxId: 2, palId: 5, col: [[255, 100, 0]] }
    });
  });

  it('throws for an unresolvable theme', () => {
    expect(() => actionToPatch({ type: 'theme', themeId: 'nope' }, noTheme))
      .toThrow('theme nope not found');
  });
});

describe('applyActionV2', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    const a = controllers.add({ name: 'A', host: '10.0.0.50', source: 'manual' }).id;
    const b = controllers.add({ name: 'B', host: '10.0.0.51', source: 'manual' }).id;
    return { db, a, b };
  }

  it('fans brightness out to every member with udpn:{nn:true}', async () => {
    const { db, a, b } = setup();
    const bodies: any[] = [];
    stubFetchByHost({
      '10.0.0.50': (_url, init) => { bodies.push(JSON.parse(init?.body as string)); return { status: 200, body: okState }; },
      '10.0.0.51': (_url, init) => { bodies.push(JSON.parse(init?.body as string)); return { status: 200, body: okState }; }
    });

    const results = await applyActionV2(db, [
      { controllerId: a, wledSegId: 0 },
      { controllerId: b, wledSegId: 0 }
    ], { type: 'brightness', value: 200 });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    for (const body of bodies) {
      expect(body).toEqual(expect.objectContaining({ bri: 200, udpn: { nn: true } }));
    }
  });

  it('applies a theme to the member segment by id (v2 patches JUST that segment)', async () => {
    const { db, a } = setup();
    const themes = createThemeRepository(db);
    const theme = themes.add({ name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 });
    let captured: any;
    stubFetchByHost({
      '10.0.0.50': (_url, init) => { captured = JSON.parse(init?.body as string); return { status: 200, body: okState }; }
    });

    const results = await applyActionV2(db, [{ controllerId: a, wledSegId: 1 }],
      { type: 'theme', themeId: theme.id });

    expect(results[0].ok).toBe(true);
    expect(captured.bri).toBe(180);
    expect(captured.udpn).toEqual({ nn: true });
    expect(captured.seg[0]).toEqual(expect.objectContaining({ id: 1, fx: 2, pal: 5, col: [[255, 100, 0]] }));
  });

  it('applies a preset as top-level ps with udpn:{nn:true}', async () => {
    const { db, a } = setup();
    let captured: any;
    stubFetchByHost({
      '10.0.0.50': (_url, init) => { captured = JSON.parse(init?.body as string); return { status: 200, body: okState }; }
    });

    const results = await applyActionV2(db, [{ controllerId: a, wledSegId: 0 }],
      { type: 'preset', presetId: 3 });

    expect(results[0].ok).toBe(true);
    expect(captured).toEqual(expect.objectContaining({ ps: 3, udpn: { nn: true } }));
  });

  it('fails every member without touching the network when the theme does not exist (v1 parity: never throws)', async () => {
    const { db, a, b } = setup();
    const fetchMock = stubFetchByHost({});

    const results = await applyActionV2(db, [
      { controllerId: a, wledSegId: 0 },
      { controllerId: b, wledSegId: 0 }
    ], { type: 'theme', themeId: 'ghost' });

    expect(results).toEqual([
      { controllerId: a, wledSegId: 0, ok: false, error: 'theme ghost not found' },
      { controllerId: b, wledSegId: 0, ok: false, error: 'theme ghost not found' }
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isolates one failing member and retries it exactly once (v1 parity via applyControlPatch)', async () => {
    const { db, a, b } = setup();
    const fetchMock = stubFetchByHost({
      '10.0.0.50': () => ({ status: 200, body: okState }),
      '10.0.0.51': () => ({ status: 500, body: {} })
    });

    const results = await applyActionV2(db, [
      { controllerId: a, wledSegId: 0 },
      { controllerId: b, wledSegId: 0 }
    ], { type: 'power', on: true });

    expect(results.find((r) => r.controllerId === a)!.ok).toBe(true);
    const failed = results.find((r) => r.controllerId === b)!;
    expect(failed.ok).toBe(false);
    expect(failed.error).toBeTruthy();
    const hostBCalls = fetchMock.mock.calls.filter(([url]) => new URL(url as string).host === '10.0.0.51');
    expect(hostBCalls.length).toBe(2);
  });
});
```

- [ ] Run it and confirm the failure is "Cannot find module .../control/actionMap.js": `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/control/actionMap.test.ts`
- [ ] Implement `server/src/control/actionMap.ts`:

```ts
import type Database from 'better-sqlite3';
import { createThemeRepository } from '../themes/repository.js';
import { applyControlPatch, type Target, type ControlPatch, type ApplyResult } from './applyV2.js';

/**
 * The v1 action union. It survives ONLY as the persisted shape of
 * schedules.action_type/action_payload and calendar_events rows — the wire
 * API and all client code use ControlPatch. Do not export from routes.ts.
 */
export type ControlAction =
  | { type: 'power'; on: boolean }
  | { type: 'brightness'; value: number }
  | { type: 'preset'; presetId: number }
  | { type: 'theme'; themeId: string }
  | { type: 'effect'; effectId: number };

export interface Member {
  controllerId: string;
  wledSegId: number;
}

export function actionToPatch(
  action: ControlAction,
  resolveTheme: (id: string) => { effect: number; palette: number; colors: number[][]; brightness: number } | undefined
): ControlPatch {
  switch (action.type) {
    case 'power':
      return { on: action.on };
    case 'brightness':
      return { bri: action.value };
    case 'preset':
      // WLED presets are device-level: top-level `ps`, wledSegId is ignored
      // by the device — identical to v1's applyPreset(host, id) semantics.
      return { ps: action.presetId };
    case 'effect':
      return { seg: { fxId: action.effectId } };
    case 'theme': {
      const theme = resolveTheme(action.themeId);
      if (!theme) throw new Error(`theme ${action.themeId} not found`);
      return {
        bri: theme.brightness,
        seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors }
      };
    }
  }
}

/**
 * v1-shaped entry point for the scheduler engine and calendar trigger path.
 * Maps members → segment Targets and the action → a ControlPatch, then
 * delegates to applyControlPatch (per-target isolation, one retry, and
 * udpn:{nn:true} on every device write). Targets are always segment-kind,
 * so applyControlPatch's GroupNotFoundError can never throw from here.
 */
export async function applyActionV2(
  db: Database.Database,
  members: Member[],
  action: ControlAction
): Promise<ApplyResult[]> {
  const themes = createThemeRepository(db);
  let patch: ControlPatch;
  try {
    patch = actionToPatch(action, (id) => themes.get(id));
  } catch (err) {
    // v1 parity: an unresolvable theme fails every member; it never throws
    // out of the batch.
    const message = err instanceof Error ? err.message : 'unknown error';
    return members.map((m) => ({
      controllerId: m.controllerId,
      wledSegId: m.wledSegId,
      ok: false,
      error: message
    }));
  }

  const targets: Target[] = members.map((m) => ({
    kind: 'segment',
    controllerId: m.controllerId,
    wledSegId: m.wledSegId
  }));
  return applyControlPatch(db, targets, patch);
}
```

- [ ] Only if the Step-1 grep showed `ps` missing: in `server/src/control/applyV2.ts` bring `ControlPatch` up to the master contract verbatim —

```ts
export interface ControlPatch {
  on?: boolean;
  bri?: number;                        // 1-255
  transition?: number;                 // WLED units (100ms)
  ps?: number;                         // apply device preset id (device-local ids —
                                       // client restricts to single-controller selections)
  nl?: { on?: boolean; dur?: number; mode?: 0|1|2|3; tbri?: number };
  seg?: SegPatch;
}
```

  and, in `writeTarget` (the function that assembles the per-target `/json/state` body), copy it through top-level next to where `on`/`bri` are copied (`ps` is device-level: WLED ignores segment targeting for it, matching v1's `applyPreset(host, id)` semantics; `WledStatePatch.ps` already exists in `server/src/wled/types.ts`):

```ts
if (patch.ps !== undefined) body.ps = patch.ps;
```

- [ ] Run the file's tests, expect all green: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/control/actionMap.test.ts`
- [ ] Run the whole server suite (guards Phase B regressions from the `ps` addition): `cd /Users/bwwilliams/github/uber-wled/server && npm test`
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/control/actionMap.ts server/src/control/applyV2.ts server/test/control/actionMap.test.ts && git commit -m "Add v1-action → fan-out-v2 mapper (actionMap) and ControlPatch.ps"`

---

## Task 2: Scheduler engine + calendar trigger path onto applyV2

`SchedulerEngine` already takes `applyFn(members, action)` as a constructor
argument, so the engine file and ALL existing engine tests stay byte-for-byte
untouched (this is the "preserve engine tests" requirement). Only the wiring
in `server/src/server.ts` changes, plus a new integration test proving a due
schedule and a due calendar event now reach the device through v2 semantics
(segment-id targeting + `udpn:{nn:true}`).

**Files:**
- Modify: `server/src/server.ts` (pre-phase lines 6 and 32 — verify with grep, they will have drifted)
- Create: `server/test/schedules/engineV2.test.ts`
- Test (must stay green, unmodified): `server/test/schedules/engine.test.ts`

**Interfaces:**
- Consumes: `applyActionV2(db, members, action): Promise<ApplyResult[]>` and `ControlAction` from Task 1; `SchedulerEngine(db, applyFn)` from `server/src/schedules/engine.js` (unchanged `ApplyFn = (members: {controllerId,wledSegId}[], action: {type: string}) => Promise<unknown>`).
- Produces: the running scheduler/calendar trigger path uses fan-out v2. Task 3 depends on this (nothing may import `applyToMembers` afterward).

**Steps:**

- [ ] Verify current wiring: `grep -n "applyToMembers\|SchedulerEngine" /Users/bwwilliams/github/uber-wled/server/src/server.ts`
- [ ] Write the failing integration test `server/test/schedules/engineV2.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { createCalendarRepository } from '../../src/calendar/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { SchedulerEngine } from '../../src/schedules/engine.js';
import { applyActionV2, type ControlAction } from '../../src/control/actionMap.js';

function stubFetchByHost(
  handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    const handler = handlers[host];
    if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const okState = { on: true, bri: 128, ps: -1, seg: [] };

describe('SchedulerEngine wired to applyActionV2 (fan-out v2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fires a due theme schedule through v2: segment-id targeting + udpn nn', async () => {
    const db = createDb(':memory:');
    const controllerId = createControllerRepository(db)
      .add({ name: 'Porch', host: '10.0.0.60', source: 'manual' }).id;
    const groupId = createGroupRepository(db)
      .add({ name: 'Porch', members: [{ controllerId, wledSegId: 1 }] }).id;
    const theme = createThemeRepository(db)
      .add({ name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 });
    createScheduleRepository(db).add({
      name: 'Evening', triggerType: 'cron', cronExpr: '0 20 * * *',
      daysOfWeek: null, timeOfDay: null, offsetMinutes: 0,
      latitude: null, longitude: null, groupId,
      actionType: 'theme', actionPayload: { themeId: theme.id }, enabled: true
    });

    let captured: any;
    stubFetchByHost({
      '10.0.0.60': (_url, init) => {
        captured = JSON.parse(init?.body as string);
        return { status: 200, body: okState };
      }
    });

    // Exactly the server.ts wiring: engine's applyFn delegates to applyActionV2.
    const engine = new SchedulerEngine(db, (members, action) =>
      applyActionV2(db, members, action as ControlAction));
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T20:00:00'));

    expect(captured).toBeDefined();
    expect(captured.bri).toBe(180);
    expect(captured.udpn).toEqual({ nn: true });
    expect(captured.seg[0]).toEqual(
      expect.objectContaining({ id: 1, fx: 2, pal: 5, col: [[255, 100, 0]] })
    );
  });

  it('fires a due calendar event action through v2 with udpn nn', async () => {
    const db = createDb(':memory:');
    const controllerId = createControllerRepository(db)
      .add({ name: 'Roof', host: '10.0.0.61', source: 'manual' }).id;
    const groupId = createGroupRepository(db)
      .add({ name: 'Roofline', members: [{ controllerId, wledSegId: 0 }] }).id;
    createCalendarRepository(db).add({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    let captured: any;
    stubFetchByHost({
      '10.0.0.61': (_url, init) => {
        captured = JSON.parse(init?.body as string);
        return { status: 200, body: okState };
      }
    });

    const engine = new SchedulerEngine(db, (members, action) =>
      applyActionV2(db, members, action as ControlAction));
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T18:00:00'));

    expect(captured).toEqual(expect.objectContaining({ on: true, udpn: { nn: true } }));
  });
});
```

- [ ] Run it, expect green already IF Task 1 landed correctly (this test consumes only Task 1 code — if it fails, fix actionMap, not the test): `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/schedules/engineV2.test.ts`
- [ ] Rewire `server/src/server.ts` — replace the applyToMembers import and the scheduler construction:

```ts
// before (pre-phase lines 6 and 32):
import { applyToMembers } from './control/routes.js';
const scheduler = new SchedulerEngine(db, (members, action) => applyToMembers(db, members, action as any));

// after:
import { applyActionV2, type ControlAction } from './control/actionMap.js';
const scheduler = new SchedulerEngine(db, (members, action) =>
  applyActionV2(db, members, action as ControlAction));
```

- [ ] Confirm nothing else in `server/src` still imports `applyToMembers`: `grep -rn "applyToMembers" /Users/bwwilliams/github/uber-wled/server/src` → the only remaining hits must be inside `server/src/control/routes.ts` itself (deleted in Task 3).
- [ ] Run the untouched engine suite + the new one + a typecheck-by-build: `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/schedules/engine.test.ts test/schedules/engineV2.test.ts && npm run build`
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/server.ts server/test/schedules/engineV2.test.ts && git commit -m "Migrate scheduler + calendar trigger path onto fan-out v2"`

---

## Task 3: Delete the v1 `{members, action}` route branch and `applyToMembers`

After Task 2 nothing calls v1 server-side. Remove the v1 branch from
`POST /api/control/apply`, delete `applyToMembers`/`applyToMember` and the
`ControlAction`/`Member` exports from `control/routes.ts`, prune the v1
tests, and lock the deletion in with a 400-rejection test.

**Files:**
- Modify: `server/src/control/routes.ts` (pre-phase: v1 occupies lines 8–74 and the body-branch inside the `/apply` handler; Phase B will have added the v2 handling — verify with `grep -n "members\|applyToMembers\|targets" server/src/control/routes.ts` first)
- Modify: `server/test/control/routes.test.ts` (delete the four v1 tests: "applies brightness to every member…", "isolates a failure to one controller…", "applies a custom theme by resolving…", "applies a raw effect id…" — i.e. every test that POSTs a `{members, action}` body expecting 200; keep all Phase B v2 tests in the file untouched)

**Interfaces:**
- Consumes: `applyControlPatch`, `GroupNotFoundError`, `Target`, `ControlPatch` from `server/src/control/applyV2.js`.
- Produces: `POST /api/control/apply` accepts ONLY `{ targets: Target[], patch: ControlPatch }` → `{ results: ApplyResult[] }`; any body without an array `targets` gets `400 { error: 'invalid body: expected { targets, patch }' }`; an unknown group id keeps Phase B's `400 { error: 'group not found: <id>' }` (and its Phase B test must stay green). `server/src/control/routes.ts` exports only `createControlRouter`.

**Steps:**

- [ ] Verify what Phase B left in the route: `grep -n "router.post\|members\|targets\|applyToMembers\|ControlAction" /Users/bwwilliams/github/uber-wled/server/src/control/routes.ts`
- [ ] Add the failing rejection test to `server/test/control/routes.test.ts` (inside the existing `describe('control routes')` block that has `app`/`controllerA` in scope, or its Phase B equivalent):

```ts
  it('rejects the removed v1 {members, action} body shape with 400', async () => {
    const res = await request(app).post('/api/control/apply').send({
      members: [{ controllerId: controllerA, wledSegId: 0 }],
      action: { type: 'power', on: true }
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targets/);
  });
```

- [ ] Run it, expect failure (v1 branch still answers 200, or an unvalidated 500): `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/control/routes.test.ts`
- [ ] Edit `server/src/control/routes.ts`: delete the `ControlAction` type, the `Member` interface, `applyToMember`, `applyToMembers`, the v1 request-body branch, and any now-unused imports (`setState`, `applyPreset`, `createThemeRepository`, `WledState`, `WledSegment`, `createControllerRepository` — keep whichever Phase B's v2 handler still uses). The `/apply` handler must reduce to the v2-only shape with an explicit guard (add the guard if Phase B did not have one):

```ts
  router.post('/apply', async (req, res) => {
    const { targets, patch } = req.body as { targets?: Target[]; patch?: ControlPatch };
    if (!Array.isArray(targets) || typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      return res.status(400).json({ error: 'invalid body: expected { targets, patch }' });
    }
    try {
      const results = await applyControlPatch(db, targets, patch);
      res.json({ results });
    } catch (err) {
      if (err instanceof GroupNotFoundError) {
        return res.status(400).json({ error: err.message }); // 'group not found: <id>' — Phase B behavior, keep it
      }
      throw err;
    }
  });
```

- [ ] Delete the four v1 tests listed under **Files** above from `server/test/control/routes.test.ts`, and remove imports the deletion orphans (e.g. `createThemeRepository` if only the v1 theme test used it).
- [ ] Confirm zero remaining references repo-wide (server side): `grep -rn "applyToMembers\|from './control/routes.js'" /Users/bwwilliams/github/uber-wled/server/src /Users/bwwilliams/github/uber-wled/server/test` → `control/routes.js` may only be imported for `createControlRouter`.
- [ ] Run the full server suite + build: `cd /Users/bwwilliams/github/uber-wled/server && npm test && npm run build` — expect all green.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/control/routes.ts server/test/control/routes.test.ts && git commit -m "Delete v1 {members,action} control route and applyToMembers"`

---## Task 4: Client v1 deletion — GroupManager, ControlPanel, v1 api fns, orphan sweep

Phases C–H replaced the shell and most sections; this task removes what they
were told to leave for Phase I (`GroupManager.tsx`, `ControlPanel.tsx`),
migrates any straggler still POSTing the v1 body (the schedule/calendar
theme-preview flow is the known candidate), deletes the v1 `ControlAction`
type + the legacy `applyControlV1` (renamed from `applyControl` by
`04-control-surface.md` Task 1 — do NOT delete Phase D's v2 `applyControl`,
which every section still depends on) from `client/src/api/client.ts`, and sweeps
`client/src/components/` for orphans. **Groups CRUD client functions
(`listGroups`/`addGroup`/`updateGroup`/`deleteGroup`) STAY — Home's inline
room editing uses them.** `icons.tsx` stays regardless of import count.

**Files:**
- Delete: `client/src/components/GroupManager.tsx`, `client/src/test/GroupManager.test.tsx`
- Delete: `client/src/components/ControlPanel.tsx`, `client/src/test/components/ControlPanel.test.tsx`
- Modify: `client/src/api/client.ts` (remove `export type ControlAction = ...` [pre-phase lines 51–56] and the legacy `export const applyControlV1 = ...` [pre-phase lines 142–145, renamed from `applyControl` by Phase D Task 1] — leave Phase D's v2 `applyControl` in place)
- Modify: any file the Step-2 grep finds still sending a v1 body (pre-phase candidates: `client/src/components/ScheduleManager.tsx` lines 60, 75–82 — by Phase I this logic lives in `client/src/sections/schedule/`; migrate wherever it landed)
- Modify: whichever stylesheet still holds the deleted components' rules (pre-phase: `client/src/index.css`; post-Phase-C: `client/src/design/global.css` — grep both)
- Delete: every orphan the sweep in the steps below finds, plus its test file

**Interfaces:**
- Consumes: Phase D's client-side v2 apply function in `client/src/api/` (locate it: `grep -rn "'/api/control/apply'" client/src/api`). Per the master contract it sends `{ targets, patch }` and the client `Target` type mirrors the server contract exactly. If — and only if — no such function exists, add to `client/src/api/client.ts`:

```ts
export type Target =
  | { kind: 'controller'; controllerId: string }
  | { kind: 'segment'; controllerId: string; wledSegId: number }
  | { kind: 'group'; groupId: string };

export interface ControlPatch {
  on?: boolean;
  bri?: number;
  transition?: number;
  nl?: { on?: boolean; dur?: number; mode?: 0 | 1 | 2 | 3; tbri?: number };
  seg?: {
    fxName?: string; fxId?: number; palName?: string; palId?: number;
    col?: number[][]; sx?: number; ix?: number;
    c1?: number; c2?: number; c3?: number;
    o1?: boolean; o2?: boolean; o3?: boolean;
    cct?: number; on?: boolean; bri?: number;
  };
  ps?: number;
}

export interface ApplyResult {
  controllerId: string;
  wledSegId: number | null;
  ok: boolean;
  error?: string;
}

export const applyControl = (targets: Target[], patch: ControlPatch) =>
  sendJson<{ results: ApplyResult[] }>('/api/control/apply', 'POST', { targets, patch });
```

- Produces: a client bundle with zero v1 control references: `grep -rn "ControlAction\|applyControlV1\b" client/src` returns nothing (Phase D's v2 `applyControl` is expected to remain and is a different symbol — `\b` after `applyControlV1` does not match it).

**Steps:**

- [ ] Inventory current state (paths will have moved since plan-authoring):
  `cd /Users/bwwilliams/github/uber-wled/client && grep -rn "GroupManager\|ControlPanel" src ; grep -rn "'/api/control/apply'" src ; grep -rn "applyControlV1\b\|ControlAction" src`
- [ ] Migrate every remaining v1 caller found (known candidate: the schedule preview/revert flow, `handlePreview`/`revertToSnapshot`). Apply this exact transformation, adjusting only the import path to where the flow now lives:

```ts
// v1 (pre-phase ScheduleManager.tsx:60, function since renamed to `applyControlV1` by
// 04-control-surface.md Task 1 — use whatever name the Step-1 grep actually finds):
await applyControlV1(members, { type: nextDraft.actionType, ...(nextDraft.actionPayload as object) } as any);

// v2 — resolve the draft action to a ControlPatch client-side (themes are
// already loaded in this component via listThemes):
function draftActionToPatch(
  actionType: Schedule['actionType'],
  actionPayload: any,
  themes: CustomTheme[]
): ControlPatch {
  switch (actionType) {
    case 'power': return { on: !!actionPayload.on };
    case 'brightness': return { bri: Number(actionPayload.value) };
    case 'preset': return { ps: Number(actionPayload.presetId) };
    case 'theme': {
      const t = themes.find((th) => th.id === actionPayload.themeId);
      if (!t) throw new Error(`theme ${actionPayload.themeId} not found`);
      return { bri: t.brightness, seg: { fxId: t.effect, palId: t.palette, col: t.colors } };
    }
  }
}

const targets: Target[] = members.map((m) => ({
  kind: 'segment', controllerId: m.controllerId, wledSegId: m.wledSegId
}));
await applyControl(targets, draftActionToPatch(nextDraft.actionType, nextDraft.actionPayload, themes));

// v1 revert (pre-phase ScheduleManager.tsx:75-82, two calls per snapshot, same
// applyControlV1 rename applies):
// → one combined v2 call per snapshot entry, same on/bri-only restore scope:
const result = await applyControl(
  [{ kind: 'segment', controllerId: s.controllerId, wledSegId: s.wledSegId }],
  { on: s.on, bri: s.bri }
);
for (const r of result.results) {
  if (!r.ok) failures.push(`${s.controllerId}/${s.wledSegId}: ${r.error ?? 'unknown error'}`);
}
```

- [ ] Update the migrated flow's test assertions from v1 to v2 body shape, e.g.:

```ts
expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
  method: 'POST',
  body: JSON.stringify({
    targets: [{ kind: 'segment', controllerId: 'c1', wledSegId: 0 }],
    patch: { on: true, bri: 128 }
  })
}));
```

  Run just those tests and confirm the new assertions fail before the source edit and pass after it: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test` (narrow to the schedule test file the grep found).
- [ ] Delete the two components and their tests:
  `cd /Users/bwwilliams/github/uber-wled && git rm client/src/components/GroupManager.tsx client/src/components/ControlPanel.tsx && git rm --ignore-unmatch client/src/test/GroupManager.test.tsx client/src/test/components/ControlPanel.test.tsx`
  (If Phase G already deleted `ControlPanel.tsx` when it shipped the canvas's Control-surface integration, `--ignore-unmatch` keeps this step idempotent — verify with the Step-1 grep and skip what is already gone.)
- [ ] Remove `ControlAction` and `applyControlV1` (NOT the v2 `applyControl`) from `client/src/api/client.ts`; fix any import lists that referenced them.
- [ ] Orphan sweep — list every component with zero non-test importers:

```bash
cd /Users/bwwilliams/github/uber-wled/client
for f in src/components/*.tsx; do
  b=$(basename "$f" .tsx)
  hits=$(grep -rlE "from ['\"][./]+((components|\.)/)?${b}['\"]" src --include='*.ts' --include='*.tsx' \
    | grep -v "^src/components/${b}.tsx$" | grep -cv '^src/test/')
  echo "$hits  $f"
done | sort -n
```

  Every file listed with `0` **except `src/components/icons.tsx`** gets `git rm` along with its test file(s) under `src/test/`. Repeat the sweep after deleting (removals can orphan second-order files). Do NOT delete anything under `src/components/ui/` (Phase C kit) even if a sweep false-positives on it — verify such hits manually before removing.
- [ ] Purge dead styles: for each deleted component, grep its distinctive class names (pre-phase set from GroupManager/ControlPanel: `.control-panel`, `.control-panel-buttons`, `.control-panel-themes`, `.group-members-editor`, `.group-row`, `.group-members-card`) across `client/src/**/*.css` and delete rules no longer referenced by any `.tsx`: `grep -rn "control-panel\|group-members\|group-row" client/src --include='*.css' --include='*.tsx'`
- [ ] Full client gate: `cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build` — expect green; then re-run the zero-reference check from **Produces** above.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add -A client/src && git commit -m "Delete v1 client control path: GroupManager, ControlPanel, ControlAction, orphans"`

---

## Task 4B: Relocate firmware components into `sections/devices/`

Phases F (`06-devices.md` Task 14) and H (`08-restyle-sections.md`) both left
`client/src/components/FirmwareStatus.tsx` and
`client/src/components/AssetPickerModal.tsx` in place under the BINDING
agreement that "Phase I removes any leftovers." The Task 4 orphan sweep above
is reference-count based and will never flag these two files — they stay
imported by `client/src/sections/devices/UpdateTab.tsx` throughout, so they
are never orphans. This task performs the actual relocation the earlier
phases deferred, completing the migration to the `sections/<name>/` layout
that every other section already underwent.

**Files:**
- Move: `client/src/components/FirmwareStatus.tsx` → `client/src/sections/devices/FirmwareStatus.tsx`
- Move: `client/src/components/AssetPickerModal.tsx` → `client/src/sections/devices/AssetPickerModal.tsx`
- Move: `client/src/test/FirmwareStatus.test.tsx` → `client/src/test/devices/FirmwareStatus.test.tsx` (adjust the relative import)
- Modify: `client/src/sections/devices/UpdateTab.tsx` (import path)

**Steps:**

- [ ] Confirm current state before moving: `grep -rln "FirmwareStatus\|AssetPickerModal" /Users/bwwilliams/github/uber-wled/client/src --include='*.ts*'` — expect hits in `components/FirmwareStatus.tsx`, `components/AssetPickerModal.tsx`, `sections/devices/UpdateTab.tsx`, and `test/FirmwareStatus.test.tsx` only (if `FirmwareSection.tsx` still exists here, STOP — Phase H has not run; this task depends on it having deleted `FirmwareSection.tsx`).
- [ ] Move the two components with history preserved:
  ```bash
  cd /Users/bwwilliams/github/uber-wled
  git mv client/src/components/FirmwareStatus.tsx client/src/sections/devices/FirmwareStatus.tsx
  git mv client/src/components/AssetPickerModal.tsx client/src/sections/devices/AssetPickerModal.tsx
  mkdir -p client/src/test/devices
  git mv client/src/test/FirmwareStatus.test.tsx client/src/test/devices/FirmwareStatus.test.tsx
  ```
- [ ] `AssetPickerModal.tsx`'s import of `./AssetPickerModal` from `FirmwareStatus.tsx` needs no change (both files moved together, same relative path).
- [ ] Update `client/src/sections/devices/UpdateTab.tsx`: change `import { FirmwareStatus } from '../../components/FirmwareStatus';` to `import { FirmwareStatus } from './FirmwareStatus';`.
- [ ] Update `client/src/test/devices/FirmwareStatus.test.tsx`: change `import { FirmwareStatus } from '../components/FirmwareStatus';` to `import { FirmwareStatus } from '../../sections/devices/FirmwareStatus';`; if this test uses a `renderDevices`/route-stubbing helper from `client/src/test/devices/helpers.ts` (Phase F), prefer that over any ad hoc fetch stubbing it previously used, but only if reconciling is trivial — otherwise leave its existing fetch-mocking approach intact.
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — expect green (import paths are the only change; no behavior change).
- [ ] Verify zero references to the old path: `grep -rn "components/FirmwareStatus\|components/AssetPickerModal" /Users/bwwilliams/github/uber-wled/client/src` → expect no hits.
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm run build` — expect green.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add -A client/src && git commit -m "Phase I: relocate FirmwareStatus/AssetPickerModal into sections/devices/"`

---

## Task 5: README rewrite for the 7-section IA

Full replacement of `README.md`. The two test-count figures written here are
plan-authoring estimates and MUST be replaced with measured numbers in
Task 8 (which runs both suites and updates them from the vitest summary).

**Files:**
- Modify: `README.md` (full rewrite; content below)

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: README describing the shipped 1.0.0 app. Task 8 trues up the test counts; Task 11's deploy steps must match this README's Deployment section.

**Steps:**

- [ ] Replace the entire contents of `README.md` with:

```markdown
# uber-wled

A self-hosted, LAN-only control plane for every [WLED](https://kno.wled.ge/)
device in the house. One app replaces the per-device WLED web UIs and the
WLED phone app — multi-controller-first: select any mix of rooms, devices,
or segments and apply the complete WLED control surface (colors, effects,
palettes, presets, nightlight) to all of them at once. Fan-out writes carry
WLED's per-request no-notify flag (`udpn: { nn: true }`) so the app never
fights an existing UDP sync group.

Full design rationale lives in [docs/superpowers/specs/](docs/superpowers/specs/);
implementation plans live in [docs/superpowers/plans/](docs/superpowers/plans/).

## The seven sections

The app is a responsive shell — left sidebar on desktop, bottom navigation
bar on phones — with seven sections, opening on Home:

1. **Home** — one tile per room (a room *is* a group) plus one per ungrouped
   controller. Tiles show live power/brightness with an ambient glow derived
   from the lights' actual current colors (muted when off, grey when
   offline). Quick power toggle and brightness slider on the tile; tapping a
   tile opens the Control surface for it. Long-press (touch) or
   hover-checkbox (desktop) multi-selects tiles into one Control session.
   Edit mode creates/renames/deletes rooms, assigns controller+segment
   members inline, and drag-reorders tiles.
2. **Layout** — an imageless canvas of the house. Draw each strip as a
   multi-point path (click to place vertices, Enter to finish, Esc to
   cancel, Shift for 45° angles, optional grid snap), drag strips or
   individual vertices to arrange, wheel/pinch zoom and pan, "fit all".
   Strips render in their real live color from the live stream. Click or
   marquee-select strips to open the Control surface for exactly those
   (controller, segment) targets.
3. **Devices** — one card per controller: name, host, firmware chip, live
   WiFi signal, FPS, power, uptime, stale/offline and update-available
   badges. The detail page has five tabs: **Info** (identity, network,
   uptime, heap, filesystem, LED counts, usermods, an embedded `/liveview`
   peek of the actual output, reboot with confirm, open-native-UI),
   **Segments** (full editor: bounds validated against the LED count,
   grouping, spacing, offset, reverse, mirror, name, per-segment
   on/brightness, create/delete — applies live), **Presets** (device presets
   and playlists: apply, delete with confirm, save-current-state with
   include-brightness and save-bounds options), **Config** (below), and
   **Update** (the per-controller firmware pin/OTA flow).
4. **Themes** — custom effect/palette/color/brightness combos independent of
   any device's presets. The form reads the per-controller capability cache:
   effect search with 2D/audio badges, palette picker with real gradient
   previews, color slots, brightness. Themes are applicable from the Control
   surface, schedules, and calendar events.
5. **Schedule** — a real month calendar. Holidays and custom events sit as
   chips on their dates; a side panel shows the selected day plus weekly and
   cron recurring schedules targeting a room. An enabled calendar event
   overrides overlapping schedules for that day. Editors preview a theme
   live against the real lights and revert exactly on approve or discard.
6. **Firmware** — fleet view of installed vs. latest stable version
   (pre-releases opt-in via Settings). First update per controller pins the
   correct release asset; later updates reuse the pin. OTA push via WLED's
   own endpoint, with post-update version polling.
7. **Settings** — pre-release firmware toggle, home latitude/longitude for
   sunrise/sunset schedules, discovery re-scan interval + "Re-scan now",
   background status poll interval, live poll interval (seconds) for the
   streaming sessions, and the WLED schedule-import default.

## The Control surface

One shared component, three entry points (Home tiles, Layout selection,
Devices "Control" button). Desktop: a ~480px right slide-over. Phone: a
full-height draggable bottom sheet.

- A selection is a list of targets — whole controllers or
  (controller, segment) pairs; room targets expand to their members. Header
  shows removable target chips.
- Always visible: master power, master brightness, transition duration,
  nightlight popover. Anywhere the targets disagree, a "Mixed" chip shows
  and the control is write-only until you set a value.
- **Colors** tab: color wheel, per-effect color slots, hex input, RGB
  sliders, white-channel slider on RGBW targets, CCT + kelvin presets,
  recent colors.
- **Effects** tab: searchable list of every effect with 2D/audio badges;
  selecting one reveals its real controls (speed/intensity/custom sliders,
  checkbox options) with the labels the firmware itself reports.
- **Palettes** tab: searchable list with true gradient previews; randomized
  and color-slot palettes render sensibly.
- **Presets** tab: saved Themes always; device presets/playlists when the
  selection is a single controller.
- Effects and palettes are resolved **by name per device**, so mixed-firmware
  fleets apply the same-named effect even when ids differ; a device lacking
  the name reports a per-target failure without failing the batch. Every
  target is written in isolation with one retry; results surface as a toast
  with expandable per-target details.

## Live streaming

While Home, Layout, or the Control surface is open, the client subscribes to
`GET /api/live?controllers=...` (Server-Sent Events). The server keeps one
refcounted fast-poll session per watched controller (default every 2s,
configurable in Settings) and stops it when the last subscriber disconnects.
The separate background status poller (default every 5 minutes) still
provides glanceable data when nobody is watching.

## Device config parity + guardrails

The Devices → Config tab edits the device's full `cfg.json`: structured
forms for Identity, LED & hardware outputs (GPIO pin, type, length, color
order, reverse, skip, power limits, auto-white), WiFi (SSID, write-only
password, static IP, AP fallback), sync interfaces, time/NTP, and LED
preferences — plus a raw JSON editor for everything else (usermods
included). Guardrails, because full parity includes footguns:

- Every save first runs a server-side dry-run and shows a
  **diff-and-confirm modal** (old → new per changed path) before applying.
- WiFi and GPIO changes get an extra explicit warning naming the
  strand-the-device risk.
- Saves that need a reboot surface a "Reboot now" follow-up instead of
  rebooting silently.

## Architecture

- **Backend**: Node.js + TypeScript, Express (`server/`). Talks to WLED
  devices over their local JSON API; per-controller capability cache
  (effects, palettes, effect metadata, palette previews) refreshed when a
  device's firmware build changes. SQLite for persistence (schema in
  `server/src/db/schema.ts`).
- **Frontend**: React + Vite SPA (`client/`), served by the backend in
  production. Design system is plain CSS tokens + a small component kit —
  no UI framework; fonts self-hosted (no CDN calls, ever).
- **Deployment**: one Docker image (multi-stage build), one
  `docker-compose.yml`. `network_mode: host` so mDNS discovery can see WLED
  devices on the LAN — the container binds directly to a host port.
- **Security posture**: no auth, no HTTPS, no cloud dependency — a
  deliberate LAN-only design relying on the home network's perimeter.

## Local development

Requires Node 20+.

```bash
# Backend — runs on :3000 by default, auto-reloads on save
cd server
npm install
npm run dev

# Frontend — Vite dev server, proxies API calls to the backend
cd client
npm install
npm run dev
```

Run each test suite from its own directory:

```bash
cd server && npm test   # 31 files / 180 tests
cd client && npm test   # 24 files / 90 tests
```

## Running the whole app locally via Docker

```bash
cp .env.example .env   # adjust PORT if 8081 is taken on your machine
docker compose up --build
```

The app will be reachable at `http://localhost:<PORT>` (default `8081`).
SQLite data persists in `./data/`, which is gitignored and mounted into the
container — nothing personal (your home layout, controller IPs, etc.) is
ever committed to this repo.

## Deployment

This repo is deployed to a home server via: push to GitHub, then on the
target host, `git clone`/`git pull` into `~/docker/uber-wled/` and run
`docker compose up -d --build` from there. The compose file uses
`network_mode: host`, so pick a `PORT` (via a local `.env` file, not
committed) that isn't already taken by another service on that host.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8081` | Port the app binds to (host networking — this is the actual port on the machine) |
| `DB_PATH` | `/app/data/uber-wled.db` (container) | SQLite database file location |

## Using the app

1. **Add controllers** — Devices fills itself via mDNS discovery (interval
   in Settings), or add one manually by name + IP/hostname. A stale badge
   means a discovered controller stopped responding; it's kept, not deleted.
2. **Make rooms** — on Home, hit Edit, create a room, pick its
   controller + segment members, drag tiles into the order you want.
3. **Control** — tap a tile (or select several) and the Control surface
   opens: power, brightness, colors, effects with their real per-effect
   controls, palettes with previews, presets. Same surface from Layout
   selections and the Devices list.
4. **Draw the house** — on Layout, draw each strip as a path where it
   physically runs, bind it to a controller + segment, and drop room
   labels. Strips light up in their true live colors.
5. **Save Themes** — build effect/palette/color/brightness combos; apply
   them anywhere, schedule them, or hang them on holidays.
6. **Schedule** — weekly/cron schedules and calendar events (pre-seeded US
   holidays + custom dates) target a room; sunset/sunrise offsets use the
   home location from Settings; preview shows the real lights before you
   commit, then restores them exactly.
7. **Stay current** — Firmware shows installed vs. latest stable per
   controller; pin the right release asset once, then update in one click
   (also per-device under Devices → Update).

## Known limitations / follow-up items

- Playlist editing is out of scope (apply/delete only); no custom palette
  builder (built-ins browse only, by design).
- The WLED OTA upload's exact multipart field name is implemented against
  the best available documentation — verify against a device you can
  re-flash by hand before relying on it (see
  `server/src/firmware/otaPush.ts`).
- UDP-sync *replacement* (the long-term north star) is not built; the app
  coexists with sync via per-request no-notify writes.
```

- [ ] Sanity-check internal accuracy against the shipped app: `grep -rn "live poll" /Users/bwwilliams/github/uber-wled/client/src/sections/settings` (Settings row exists), `grep -n "network_mode" /Users/bwwilliams/github/uber-wled/docker-compose.yml`, and confirm the section names in the README match the shell's nav labels: `grep -rn "label:" /Users/bwwilliams/github/uber-wled/client/src/components/AppShell.tsx /Users/bwwilliams/github/uber-wled/client/src/components/*.tsx | grep -i "home\|layout\|devices\|themes\|schedule\|firmware\|settings"`. Fix any label mismatch in the README (the app is the source of truth).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add README.md && git commit -m "Rewrite README for the 1.0 seven-section control plane"`

---

## Task 6: Version 1.0.0 in both packages + sidebar pickup

The sidebar brand renders `v{__APP_VERSION__}`, a Vite `define` injected
from `client/package.json`'s `version` at build time (see
`client/vite.config.ts`) — bumping the package version is sufficient; no
component change.

**Files:**
- Modify: `client/package.json` (line 4: `"version": "0.8.2"` at plan-authoring; whatever it is now → `"1.0.0"`)
- Modify: `server/package.json` (line 3: `"version": "0.7.0"` at plan-authoring → `"1.0.0"`)
- Modify: `client/package-lock.json`, `server/package-lock.json` (regenerated, both are committed files)

**Interfaces:**
- Consumes: `__APP_VERSION__` define in `client/vite.config.ts` (must still exist — verify).
- Produces: version `1.0.0` visible in the built bundle and in the sidebar; Task 11 asserts it on production.

**Steps:**

- [ ] Verify the define still exists post-Phase-C: `grep -n "__APP_VERSION__" /Users/bwwilliams/github/uber-wled/client/vite.config.ts /Users/bwwilliams/github/uber-wled/client/src -r` — expect the `define` in vite.config.ts and at least one render site. If Phase C dropped the render site, add `<span className="sidebar-version">v{__APP_VERSION__}</span>` back into the shell's sidebar brand block (and `.sidebar-version { font-size: 11px; color: var(--text-muted); }` if the class is gone).
- [ ] Edit `client/package.json`: set `"version": "1.0.0"`.
- [ ] Edit `server/package.json`: set `"version": "1.0.0"`.
- [ ] Sync both lockfiles: `cd /Users/bwwilliams/github/uber-wled/client && npm install --package-lock-only && cd /Users/bwwilliams/github/uber-wled/server && npm install --package-lock-only`
- [ ] Prove the bundle picked it up: `cd /Users/bwwilliams/github/uber-wled/client && npm run build && grep -o '"1.0.0"' dist/assets/*.js | head -1` — expect `"1.0.0"`.
- [ ] Run both suites (version bumps must not break anything): `cd /Users/bwwilliams/github/uber-wled/server && npm test && cd /Users/bwwilliams/github/uber-wled/client && npm test`
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/package.json client/package-lock.json server/package.json server/package-lock.json && git commit -m "Version 1.0.0"`

---

## Task 7: Reversible hardware smoke script `scripts/hw-smoke.mjs`

The ONLY permitted real-device write path in this whole redesign, and it is
run **manually by the orchestrator** (Task 10) — never from automated tests.
It captures the device's exact state, applies a color+effect through
uber-wled's own v2 API (proving the deployed fan-out path end-to-end), and
restores the captured state byte-for-byte-relevant fields.

**Files:**
- Create: `scripts/hw-smoke.mjs` (new directory `scripts/`)

**Interfaces:**
- Consumes: `POST /api/control/apply { targets, patch }` (v2 route, Task 3 final shape); `GET /api/controllers` (existing, returns `[{ id, name, host, ... }]`); device `GET /json/state`, `GET /json/eff`, `POST /json/state` (restore only).
- Produces: `node scripts/hw-smoke.mjs [deviceHost] [apiBase]` exit 0 = pass; exports `buildRestorePatch(state)` for hardware-free verification.

**Steps:**

- [ ] Create `scripts/hw-smoke.mjs`:

```js
#!/usr/bin/env node
// Reversible real-hardware smoke test for uber-wled releases.
//
//   node scripts/hw-smoke.mjs [deviceHost] [apiBase]
//     deviceHost  WLED controller host    (default 192.168.1.86)
//     apiBase     uber-wled server base   (default http://localhost:3000)
//
// THIS IS THE ONLY PERMITTED REAL-DEVICE WRITE PATH. Run it MANUALLY as the
// release orchestrator; never wire it into vitest/CI. Flow:
//   1. capture  GET  http://<device>/json/state          (exact snapshot)
//   2. apply    POST <apiBase>/api/control/apply         (v2 targets+patch:
//               orange + effect "Blink" through uber-wled itself)
//   3. verify   GET  http://<device>/json/state          (color + fx took)
//   4. restore  POST http://<device>/json/state          (snapshot, exact)
//   5. verify   GET  http://<device>/json/state          (matches snapshot)

import { pathToFileURL } from 'node:url';

const SMOKE_COLOR = [255, 64, 0, 0]; // orange (w = 0)
const SMOKE_FX_NAME = 'Blink';
const SETTLE_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
  return res.json();
}

/**
 * Builds the exact-restore /json/state patch from a captured state. Pure —
 * covered by the hardware-free check in the plan. Restores every field the
 * smoke could have disturbed (top-level power/brightness/transition and the
 * full per-segment look), always with udpn:{nn:true}.
 */
export function buildRestorePatch(state) {
  return {
    on: state.on,
    bri: state.bri,
    transition: state.transition,
    udpn: { nn: true },
    seg: state.seg.map((s) => ({
      id: s.id, on: s.on, bri: s.bri, frz: s.frz,
      fx: s.fx, sx: s.sx, ix: s.ix, pal: s.pal,
      c1: s.c1, c2: s.c2, c3: s.c3,
      o1: s.o1, o2: s.o2, o3: s.o3,
      cct: s.cct, rev: s.rev, mi: s.mi,
      col: s.col.map((c) => [...c])
    }))
  };
}

function assertEqual(actual, expected, label, failures) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function main() {
  const deviceHost = process.argv[2] ?? '192.168.1.86';
  const apiBase = process.argv[3] ?? 'http://localhost:3000';

  console.log(`[1/5] capture: http://${deviceHost}/json/state`);
  const before = await getJson(`http://${deviceHost}/json/state`);
  console.log(`      on=${before.on} bri=${before.bri} segs=${before.seg.length}`);

  const controllers = await getJson(`${apiBase}/api/controllers`);
  const controller = controllers.find((c) => c.host === deviceHost);
  if (!controller) throw new Error(`uber-wled at ${apiBase} has no controller with host ${deviceHost}`);

  const effects = await getJson(`http://${deviceHost}/json/eff`);
  const smokeFxId = effects.indexOf(SMOKE_FX_NAME);
  if (smokeFxId < 0) throw new Error(`device has no effect named ${SMOKE_FX_NAME}`);

  console.log(`[2/5] apply via uber-wled v2: color+${SMOKE_FX_NAME} -> controller ${controller.id}`);
  const applied = await postJson(`${apiBase}/api/control/apply`, {
    targets: [{ kind: 'controller', controllerId: controller.id }],
    patch: { on: true, seg: { fxName: SMOKE_FX_NAME, col: [SMOKE_COLOR] } }
  });
  const failedTargets = applied.results.filter((r) => !r.ok);
  if (failedTargets.length > 0) throw new Error(`apply failed: ${JSON.stringify(failedTargets)}`);

  await sleep(SETTLE_MS);
  console.log('[3/5] verify smoke state on device');
  const during = await getJson(`http://${deviceHost}/json/state`);
  const failures = [];
  assertEqual(during.seg[0].col[0].slice(0, 3), SMOKE_COLOR.slice(0, 3), 'seg0 color', failures);
  assertEqual(during.seg[0].fx, smokeFxId, 'seg0 fx', failures);
  if (failures.length > 0) {
    console.error('SMOKE APPLY DID NOT TAKE:\n  ' + failures.join('\n  '));
    // fall through to restore regardless — never leave the device dirty
  }

  console.log('[4/5] restore captured state (direct to device, udpn nn)');
  await postJson(`http://${deviceHost}/json/state`, buildRestorePatch(before));
  await sleep(SETTLE_MS);

  console.log('[5/5] verify restoration');
  const after = await getJson(`http://${deviceHost}/json/state`);
  const restoreFailures = [];
  assertEqual(after.on, before.on, 'on', restoreFailures);
  assertEqual(after.bri, before.bri, 'bri', restoreFailures);
  for (const [i, s] of before.seg.entries()) {
    const a = after.seg[i];
    for (const k of ['on', 'bri', 'fx', 'sx', 'ix', 'pal']) assertEqual(a?.[k], s[k], `seg${i}.${k}`, restoreFailures);
    assertEqual(a?.col, s.col, `seg${i}.col`, restoreFailures);
  }
  if (failures.length > 0 || restoreFailures.length > 0) {
    if (restoreFailures.length > 0) console.error('RESTORE MISMATCH:\n  ' + restoreFailures.join('\n  '));
    process.exit(1);
  }
  console.log('PASS: applied and fully restored. Device state is exactly as captured.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] Hardware-free verification (syntax + the pure restore builder, using a real state fixture captured read-only from 192.168.1.86 — `on:true, bri:9, transition:7`, seg0 white RGBW):

```bash
cd /Users/bwwilliams/github/uber-wled && node --check scripts/hw-smoke.mjs && node --input-type=module -e "
const { buildRestorePatch } = await import('./scripts/hw-smoke.mjs');
const captured = { on: true, bri: 9, transition: 7, ps: -1,
  seg: [{ id: 0, on: true, bri: 255, frz: false, fx: 0, sx: 128, ix: 128, pal: 0,
          c1: 220, c2: 30, c3: 21, o1: true, o2: false, o3: false, cct: 127,
          rev: false, mi: false, col: [[255,255,255,0],[0,0,0,0],[0,0,0,0]] }] };
const p = buildRestorePatch(captured);
console.assert(p.udpn.nn === true, 'restore must carry udpn nn');
console.assert(p.ps === undefined, 'must NOT replay ps (-1 is not a valid preset apply)');
console.assert(p.on === true && p.bri === 9 && p.transition === 7, 'top-level restore wrong');
console.assert(JSON.stringify(p.seg[0].col) === JSON.stringify(captured.seg[0].col), 'col restore wrong');
captured.seg[0].col[0][0] = 0;
console.assert(p.seg[0].col[0][0] === 255, 'restore patch must deep-copy col');
console.log('buildRestorePatch OK');
"
```

  Expected output: `buildRestorePatch OK` and exit 0. **Do NOT run the script against a device in this task.**
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add scripts/hw-smoke.mjs && git commit -m "Add reversible hardware smoke script (capture → apply v2 → restore)"`

---

## Task 8: Full verification gate + README test-count truing

**Files:**
- Modify: `README.md` (the two test-count comment lines under "Local development" only)

**Interfaces:**
- Consumes: everything shipped in Phases A–I.
- Produces: green server suite, green client suite, green client build, buildable Docker image; README counts match reality. Gate for Tasks 9–11.

**Steps:**

- [ ] `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect exit 0. Record the vitest summary line (`Test Files N passed`, `Tests M passed`).
- [ ] `cd /Users/bwwilliams/github/uber-wled/client && npm test` — expect exit 0. Record the summary line.
- [ ] `cd /Users/bwwilliams/github/uber-wled/client && npm run build` — expect exit 0.
- [ ] `cd /Users/bwwilliams/github/uber-wled && docker build -t uber-wled:1.0.0 .` — expect a successful image build (this validates both `npm run build`s inside the multi-stage Dockerfile).
- [ ] Edit `README.md`: replace the two count comments with the measured numbers from the first two steps, e.g. `cd server && npm test   # <measured files> files / <measured tests> tests` (the figures currently in the README are Task 5's authoring-time estimates — they MUST be overwritten with the recorded summaries).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add README.md && git commit -m "True up README test counts from measured 1.0.0 suite runs"`

---

## Task 9: ORCHESTRATOR — browser walkthrough at 390px and 1440px

**This task is executed by the ORCHESTRATOR (not a subagent).** It needs the
dev servers, real controllers on the LAN, and a browser. Autonomy policy for
this walkthrough: state-level operations (power/brightness/color/effect/
palette) are allowed and must be reverted where visible; config saves,
preset saves/deletes, reboots, and OTA pushes are **verified up to their
confirmation dialog and then CANCELLED**.

**Files:** none (verification only).

**Interfaces:** Consumes the running app; produces a pass/fail record per check (fix-and-rerun any failure before Task 10).

**Steps:**

- [ ] Start the stack: terminal 1 `cd /Users/bwwilliams/github/uber-wled/server && npm run dev`; terminal 2 `cd /Users/bwwilliams/github/uber-wled/client && npm run dev`. Open the Vite URL in the browser.
- [ ] Set viewport 1440×900 (desktop pass), then repeat the full list at 390×844 (phone pass). Global checks at BOTH widths, every section: no horizontal page scroll; interactive targets ≥ 40px; desktop shows the left sidebar (7 items: Home, Layout, Devices, Themes, Schedule, Firmware, Settings), phone shows the bottom nav (7 icons, label on the active item); sidebar brand shows **v1.0.0**.
- [ ] **Home:** one tile per room + one per ungrouped controller; each tile's power state/brightness matches the physical device; tile glow tracks the strip's actual color (change a strip's color from the Control surface and watch the glow follow); tile power toggle flips the real device (toggle back); brightness slider fans out (restore original value); multi-select (hover checkbox at 1440, long-press at 390) → floating "N selected → Control" bar → opens Control surface with N target chips; Edit mode: create a room "Walkthrough Test", rename it, assign a controller+segment member, drag-reorder, reload page → order persisted, then delete the test room.
- [ ] **Control surface:** opens as right slide-over (~480px) at 1440 and as a draggable bottom sheet at 390; header has master power, master brightness, transition, nightlight popover; select two targets with different brightness → "Mixed" chip shows; setting the slider clears it and fans out. Colors tab: wheel + hex + RGB sliders; white slider present on the RGBW controller; kelvin presets apply. Effects tab: search filters; picking "Blink" shows its speed control with the fxdata label; controls c1–c3/o1–o3 only appear for effects that define them. Palettes tab: gradient previews are real gradients; search works. Presets tab: Themes always listed; device presets only when a single controller is targeted. During a slider drag, the network tab shows ≤ 4 `/api/control/apply` POSTs per second and each request body carries `targets`+`patch` (v1 `members` must never appear). Revert any state changes when done.
- [ ] **Layout:** click-to-place vertices, Enter finishes, Esc cancels, Backspace removes last vertex, Shift constrains to 45°; snap-to-grid toggles; select strip → drag whole strip and individual vertices; delete key asks confirm (cancel it); wheel zoom + drag-empty pan + "fit all"; marquee box-select of two strips opens the Control surface with their (controller, segment) chips; strips render live colors and the network tab shows exactly one open `/api/live` EventSource connection (not the old 5s polling).
- [ ] **Devices:** list cards show name, host, firmware chip, WiFi bars, FPS, power, uptime; "Control" button opens the Control surface targeting that controller. Detail → Info: identity/IP/version/uptime/heap/LED counts/usermods (AudioReactive appears for 192.168.1.86); `/liveview` iframe strip shows real output; Reboot shows a confirm dialog → **Cancel**. Segments: bounds outside `info.leds.count` are rejected inline; do not persist changes. Presets: device presets list with names/ids; "Save current state" opens the name/include-brightness/save-bounds form → **Cancel**; delete asks confirm → **Cancel**. Config: Identity/LED/WiFi/Sync/Time forms populated from the live device; change the name field and hit save → diff-and-confirm modal shows exactly that one path → **Cancel**; open the WiFi form, touch a field, save → the extra strand-the-device warning appears → **Cancel**; raw JSON editor renders full cfg including unknown `um` keys. Update tab: shows the pin/OTA flow → do NOT push.
- [ ] **Themes:** form pickers come from the capability cache (unplug/ignore one controller — the form still works); effect search with 2D/audio badges; palette picker shows gradient previews; save a theme "Walkthrough" → appears in the list with a preview swatch row → delete it.
- [ ] **Schedule:** month calendar renders with holiday chips; click a day → side panel detail; create a custom event with a theme + trigger time; preview → real lights change → **Discard** → lights revert to their exact prior look (this capture/restore is the flow's own contract — watching it IS the test); delete the test event; weekly schedule form previews the same way (discard, delete).
- [ ] **Firmware:** every controller lists installed vs latest stable; an offline controller shows "Controller offline", not a spinner; do NOT start an OTA update.
- [ ] **Settings:** all rows present including "live poll interval (seconds)" defaulting to 2; set it to 5, reopen Home, and confirm in the network tab that live events slow to ~5s cadence; set it back to 2.
- [ ] Record any failing check, fix (as its own committed task), and re-run the failed section at both widths before proceeding.

---

## Task 10: ORCHESTRATOR — reversible real-hardware smoke

**Executed by the ORCHESTRATOR only.** This is the single sanctioned
real-device write, and it restores what it touches.

**Files:** none (runs `scripts/hw-smoke.mjs` from Task 7).

**Steps:**

- [ ] With the dev server from Task 9 still running: `cd /Users/bwwilliams/github/uber-wled && node scripts/hw-smoke.mjs 192.168.1.86 http://localhost:3000`
- [ ] Expect the five numbered stage lines and final `PASS: applied and fully restored. Device state is exactly as captured.` with exit 0.
- [ ] Physically/visually confirm the Cabinet Lights strip is back to its pre-smoke look.
- [ ] If it exits 1 with `RESTORE MISMATCH`, the device is NOT clean: re-run `node scripts/hw-smoke.mjs 192.168.1.86 http://localhost:3000` (restore runs unconditionally) and debug the apply path before any deploy.

---

## Task 11: ORCHESTRATOR — deploy to media-server + production verification

**Executed by the ORCHESTRATOR only.** Matches the README Deployment
section: push, pull + rebuild on the host, health-check, live browser
verification.

**Files:** none.

**Steps:**

- [ ] Push everything: `cd /Users/bwwilliams/github/uber-wled && git push origin main`
- [ ] Verify the ssh alias read-only first: `ssh media-server true` → exit 0. If it fails, discover the real alias with `grep -i -B1 -A5 "media" ~/.ssh/config` and substitute it in the remaining steps.
- [ ] Deploy: `ssh media-server 'cd ~/docker/uber-wled && git pull && docker compose up -d --build'` — expect the compose build to finish and the service to report started.
- [ ] Health check: `curl -s http://media-server:8081/health` → exactly `{"status":"ok"}`. If it fails, check `ssh media-server 'cd ~/docker/uber-wled && docker compose logs --tail=50'`.
- [ ] Browser-verify production at `http://media-server:8081`: sidebar shows **v1.0.0**; Home tiles render with live states from the real controllers; open the Control surface on one room, toggle power off then back on (state-level, self-reverting); open Devices and confirm live info loads; network tab shows a working `/api/live` stream.
- [ ] Done. Phase I and the 1.0.0 milestone are complete.
