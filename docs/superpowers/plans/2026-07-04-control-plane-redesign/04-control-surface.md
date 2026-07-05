# Phase D — Shared Control Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Build the shared Control surface — react-query data hooks, SSE live-status hook, pure mixed-state aggregation, and the Drawer-mounted 4-tab control UI (Colors / Effects / Palettes / Presets) with optimistic, throttled fan-out writes.

**Architecture:** All new code is client-side. `api/queries.ts` + `api/live.ts` wrap Phase B's routes (`POST /api/control/apply` v2, `GET /api/live` SSE, capabilities/presets routes); `control/controlState.ts` is pure aggregation/merge logic; `control/ControlSurface.tsx` composes Phase C's `components/ui/*` kit and the four tab components, applying every user gesture as a fan-out `ControlPatch` throttled to ≤4 writes/sec per control with optimistic local overrides and a partial-failure toast.

**Tech Stack:** React 19 + TypeScript + Vite; `@tanstack/react-query` (server state), `@jaames/iro` (color wheel); Vitest + Testing Library (jsdom). No other new deps.

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

## Binding contracts consumed from the master plan

These types are copied **verbatim** from `00-master.md` and are mirrored on the
client in Task 1. Never rename or reshape them.

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
// POST /api/control/apply  body { targets: Target[], patch: ControlPatch }
// → { results: ApplyResult[] }  (HTTP 200 even with partial failures)

export interface FxMeta {
  id: number;
  name: string;                    // from /json/eff at same index
  sliders: {                       // null = control hidden for this effect
    sx: string | null;             // '!' in fxdata → 'Effect speed'
    ix: string | null;             // '!' → 'Effect intensity'
    c1: string | null;
    c2: string | null;
    c3: string | null;
  };
  options: {                       // checkbox labels, null = hidden
    o1: string | null;
    o2: string | null;
    o3: string | null;
  };
  colorLabels: (string | null)[];  // length 3; '!' → default names Fx/Bg/Cs; null = slot unused
  usesPalette: boolean;
  flags: string[];                 // e.g. ['1'] dimensionality chars, 'v', 'f'
  defaults: Record<string, number>; // e.g. { sx: 24, m12: 0 }
}

export type PalettePreview =
  | { type: 'stops'; stops: [number, number, number, number][] } // [pos0-255, r, g, b]
  | { type: 'random' }
  | { type: 'slots'; slots: ('c1' | 'c2' | 'c3')[] };

export interface ControllerCapabilities {
  vid: number;
  effects: string[];
  palettes: string[];
  fxMeta: FxMeta[];
  palettePreviews: Record<number, PalettePreview>;
  fetchedAt: string; // ISO
}
```

Server routes consumed (Phase B / master):

```
POST /api/control/apply                  body { targets, patch } → { results: ApplyResult[] }
GET  /api/live?controllers=<id>,<id>     SSE, event: status,
                                         data: { controllerId, reachable, state?, info? }
GET  /api/controllers/:id/capabilities   → ControllerCapabilities
GET  /api/controllers/:id/presets        → { presets: { id, name, isPlaylist, quicklook? }[] }
```

Preset APPLY has no dedicated route (master): device presets apply through
`POST /api/control/apply` with patch `{ ps }` — preset ids are device-local,
so this surface gates preset apply to single-controller selections.

react-query keys (master, exact): `['controllers']`, `['capabilities', id]`,
`['groups']`, `['themes']`, `['status']`, `['presets', id]`.

Master component contract: `control/ControlSurface.tsx` props
`{ targets: Target[]; open: boolean; onClose(): void }`; tab files
`control/{ColorTab,EffectsTab,PalettesTab,PresetsTab}.tsx` (note: **ColorTab**,
singular — binding); pure logic in `control/controlState.ts`.

## Consumed Phase C UI-kit contract (verified against `03-client-foundation.md`)

Phase D consumes these `client/src/components/ui/*` exports. The signatures
below are copied from the Phase C plan — this phase's code is written against
them. **Preflight for the implementer of every task that imports the kit:**
diff the actual built component against this block; if Phase C's
implementation drifted, adapt the call site in this phase's code; do NOT
change the kit or this phase's exported interfaces.

```ts
// Button.tsx — extends ButtonHTMLAttributes<HTMLButtonElement>; ...rest (incl. aria-label) spreads onto <button>
export function Button(props: { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm' } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element;
// IconButton.tsx — renders <button aria-label={label} title={label}>; extends ButtonHTMLAttributes
export function IconButton(props: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element;
// Slider.tsx — renders <input type="range" aria-label={label}>. NO mixed/null value support:
// this phase shows mixed state with an adjacent warning Chip and feeds the
// slider a deterministic fallback value of 128 until the user writes one.
export function Slider(props: { value: number; min?: number; max?: number; step?: number; label: string; disabled?: boolean; fillColor?: string; onChange: (value: number) => void; onCommit?: (value: number) => void }): JSX.Element;
// Toggle.tsx — renders <button role="switch" aria-checked={checked} aria-label={label}>; no mixed prop
export function Toggle(props: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }): JSX.Element;
// Tabs.tsx — renders one <button role="tab">{label}</button> per tab
export function Tabs(props: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void; label?: string }): JSX.Element;
// SearchInput.tsx — aria-label comes from `label` (default 'Search'), NOT from placeholder — always pass both
export function SearchInput(props: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }): JSX.Element;
// Select.tsx — renders <select aria-label={label}>
export function Select(props: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label?: string; id?: string; disabled?: boolean }): JSX.Element;
// Chip.tsx — when onRemove is given renders a <button aria-label="Remove"> (capital R)
export function Chip(props: { variant?: 'default' | 'accent' | 'success' | 'danger' | 'warning'; onRemove?: () => void; children: ReactNode }): JSX.Element;
// Drawer.tsx — renders nothing when open=false; slide-over ≥900px, bottom sheet <900px
export function Drawer(props: { open: boolean; onClose: () => void; title?: string; children: ReactNode; className?: string }): JSX.Element;
// Toast.tsx — a ToastProvider + useToast().show({ title, description?, variant?, duration? }) stack API,
// NOT an <open/onClose> component. Phase D does NOT use it: the partial-failure
// notice needs expandable per-target detail, so ControlSurface renders its own
// inline dismissible .cs-failure-notice block (Task 11).
```

Phase C also provides the app-level `QueryClientProvider`. Tests in this phase
construct their own `QueryClient` or mock the hooks, so they do not depend on it.

## Real-device fixture provenance

All FxMeta / palette / live-state fixture values in this plan were captured
from a live probe of WLED 16.0.0 "Niji" (`vid 2605030`, esp32, 48 RGBW LEDs,
2 segments) at `http://192.168.1.86` on 2026-07-04 via read-only GETs
(`/json/eff`, `/json/fxdata`, `/json/pal`, `/json/palx`, `/json/state`,
`/json/info`). Raw source strings are quoted in comments next to each fixture.
Fixture effect/palette **ids are remapped** to a compact 0..N space so the
fixture `effects[]` arrays stay dense; every other field is verbatim.

---

## Task 1: Client API mirror types + v2 fetchers (rename v1 `applyControl` → `applyControlV1`)

**Files:**
- Modify: `client/src/api/client.ts` (rename at line 142; append new types/fetchers at end of file)
- Modify: `client/src/components/HomeSection.tsx` (import line 3, call line 55)
- Modify: `client/src/components/LayoutSection.tsx` (import line 3, call line 66)
- Modify: `client/src/components/ScheduleManager.tsx` (import line 4, calls lines 60, 75, 79; comment lines 67–68)
- Test: `client/src/test/api/clientV2.test.ts` (create)

**Interfaces:**
- Consumes: existing `getJson` / `sendJson` helpers (`client/src/api/client.ts:87-101`), existing `GroupMember`, `ControlAction` types.
- Produces (all exported from `client/src/api/client.ts`):
  - types `Target`, `SegPatch`, `ControlPatch`, `ApplyResult`, `FxMeta`, `PalettePreview`, `ControllerCapabilities` — verbatim master mirrors above
  - `interface DevicePreset { id: number; name: string; isPlaylist: boolean; quicklook?: { fx?: number; pal?: number; on?: boolean; bri?: number } }`
  - `applyControl(targets: Target[], patch: ControlPatch): Promise<{ results: ApplyResult[] }>`
  - `applyControlV1(members: GroupMember[], action: ControlAction): Promise<{ results: { controllerId: string; wledSegId: number; ok: boolean; error?: string }[] }>` (the renamed legacy fetcher, body `{ members, action }` unchanged)
  - `getCapabilities(controllerId: string): Promise<ControllerCapabilities>`
  - `listDevicePresets(controllerId: string): Promise<DevicePreset[]>` (unwraps `{ presets }`)

**Steps:**

- [ ] Write the failing test `client/src/test/api/clientV2.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  applyControl, applyControlV1, getCapabilities, listDevicePresets,
  type Target, type ControlPatch
} from '../../api/client';

describe('api client v2 control fetchers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applyControl POSTs { targets, patch } to /api/control/apply and returns results', async () => {
    const results = [{ controllerId: 'c1', wledSegId: null, ok: true }];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results }) });
    const targets: Target[] = [
      { kind: 'controller', controllerId: 'c1' },
      { kind: 'segment', controllerId: 'c2', wledSegId: 1 },
      { kind: 'group', groupId: 'g1' }
    ];
    const patch: ControlPatch = { on: true, bri: 120, seg: { fxName: 'Blink', sx: 40 } };
    const res = await applyControl(targets, patch);
    expect(global.fetch).toHaveBeenCalledWith('/api/control/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets, patch })
    });
    expect(res).toEqual({ results });
  });

  it('applyControl rejects when the response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(applyControl([], {})).rejects.toThrow('POST /api/control/apply failed');
  });

  it('applyControl carries a device-preset patch { ps }', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    await applyControl([{ kind: 'controller', controllerId: 'c1' }], { ps: 3 });
    expect(global.fetch).toHaveBeenCalledWith('/api/control/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [{ kind: 'controller', controllerId: 'c1' }], patch: { ps: 3 } })
    });
  });

  it('applyControlV1 still POSTs the legacy { members, action } body', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    await applyControlV1([{ controllerId: 'c1', wledSegId: 0 }], { type: 'preset', presetId: 3 });
    expect(global.fetch).toHaveBeenCalledWith('/api/control/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: [{ controllerId: 'c1', wledSegId: 0 }], action: { type: 'preset', presetId: 3 } })
    });
  });

  it('getCapabilities GETs /api/controllers/:id/capabilities', async () => {
    const caps = { vid: 2605030, effects: ['Solid'], palettes: ['Default'], fxMeta: [], palettePreviews: {}, fetchedAt: '2026-07-04T00:00:00.000Z' };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => caps });
    const res = await getCapabilities('c1');
    expect(global.fetch).toHaveBeenCalledWith('/api/controllers/c1/capabilities');
    expect(res).toEqual(caps);
  });

  it('listDevicePresets GETs /api/controllers/:id/presets and unwraps presets', async () => {
    const presets = [{ id: 1, name: 'Night', isPlaylist: false, quicklook: { fx: 0, on: true } }];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ presets }) });
    const res = await listDevicePresets('c1');
    expect(global.fetch).toHaveBeenCalledWith('/api/controllers/c1/presets');
    expect(res).toEqual(presets);
  });
});
```

- [ ] Run it and confirm the failure mode: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/clientV2.test.ts` — expect FAIL: `client.ts` has no exports `applyControlV1`, `getCapabilities`, `listDevicePresets`, `Target`, `ControlPatch`; and `applyControl` has the wrong signature.
- [ ] In `client/src/api/client.ts`, rename the legacy fetcher (lines 142–145):

```ts
export const applyControlV1 = (members: GroupMember[], action: ControlAction) =>
  sendJson<{ results: { controllerId: string; wledSegId: number; ok: boolean; error?: string }[] }>(
    '/api/control/apply', 'POST', { members, action }
  );
```

- [ ] Append the mirror types and new fetchers to the end of `client/src/api/client.ts` (types verbatim from the contracts block above, then):

```ts
export interface DevicePreset {
  id: number;
  name: string;
  isPlaylist: boolean;
  quicklook?: { fx?: number; pal?: number; on?: boolean; bri?: number };
}

export const applyControl = (targets: Target[], patch: ControlPatch) =>
  sendJson<{ results: ApplyResult[] }>('/api/control/apply', 'POST', { targets, patch });

export const getCapabilities = (controllerId: string) =>
  getJson<ControllerCapabilities>(`/api/controllers/${controllerId}/capabilities`);

export const listDevicePresets = (controllerId: string) =>
  getJson<{ presets: DevicePreset[] }>(`/api/controllers/${controllerId}/presets`).then((r) => r.presets);
```

- [ ] Update the three legacy call sites to the new name (`applyControl` → `applyControlV1` in the import list and calls): `HomeSection.tsx:3,55`; `LayoutSection.tsx:3,66`; `ScheduleManager.tsx:4,60,75,79` (also fix the two mentions in the comment at `ScheduleManager.tsx:67-68`).
- [ ] Run the new test: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/clientV2.test.ts` — expect PASS (6 tests).
- [ ] Run the whole client suite to catch rename fallout: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — expect PASS (existing HomeSection/LayoutSection/ScheduleSection tests mock `fetch`, not the fetcher, so only compile errors would surface).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 1: mirror v2 control types on client, add applyControl(targets, patch), rename legacy fetcher to applyControlV1"`

---

## Task 2: react-query hooks — `client/src/api/queries.ts`

**Files:**
- Create: `client/src/api/queries.ts`
- Test: `client/src/test/api/queries.test.tsx` (create)

**Interfaces:**
- Consumes: Task 1 fetchers; existing `listControllers`, `listGroups`, `listThemes`, `getControllerStatus`, types `Controller`, `Group`, `CustomTheme`, `ControllerStatus` from `client/src/api/client.ts`.
- Produces (exported from `client/src/api/queries.ts`):
  - `useControllers(): UseQueryResult<Controller[]>` — key `['controllers']`
  - `useGroups(): UseQueryResult<Group[]>` — key `['groups']`
  - `useThemes(): UseQueryResult<CustomTheme[]>` — key `['themes']`
  - `useControllerStatuses(): UseQueryResult<Map<string, ControllerStatus>>` — key `['status']`, refetch every 60 s, unreachable controllers get a `{ reachable: false }` fallback entry
  - `useCapabilities(controllerId: string | null): UseQueryResult<ControllerCapabilities>` — key `['capabilities', controllerId]`, disabled when null
  - `useCapabilitiesMap(controllerIds: string[]): Map<string, ControllerCapabilities>` — one `['capabilities', id]` query per id via `useQueries`
  - `useDevicePresets(controllerId: string | null): UseQueryResult<DevicePreset[]>` — key `['presets', controllerId]`, disabled when null

**Steps:**

- [ ] Ensure the dependency exists (Phase C installs it; this is idempotent): `cd /Users/bwwilliams/github/uber-wled/client && ls node_modules/@tanstack/react-query >/dev/null 2>&1 || npm install @tanstack/react-query`
- [ ] Write the failing test `client/src/test/api/queries.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useControllers, useControllerStatuses, useCapabilities, useDevicePresets
} from '../../api/queries';

const CONTROLLERS = [
  { id: 'c1', name: 'Cabinet', host: '192.168.1.86', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Porch', host: '192.168.1.87', source: 'manual', stale: false, pinnedAssetPattern: null }
];

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function stubFetch(routes: Record<string, { ok: boolean; body: unknown }>) {
  const fn = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return { ok: route.ok, json: async () => route.body };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api/queries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('useControllers fetches /api/controllers under key [controllers]', async () => {
    stubFetch({ '/api/controllers': { ok: true, body: CONTROLLERS } });
    const { result } = renderHook(() => useControllers(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(CONTROLLERS));
  });

  it('useControllerStatuses returns a Map with a reachable:false fallback for failed status fetches', async () => {
    stubFetch({
      '/api/controllers': { ok: true, body: CONTROLLERS },
      '/api/controllers/c1/status': {
        ok: true,
        body: { controllerId: 'c1', reachable: true, info: null, state: null, polledAt: '2026-07-04T00:00:00Z' }
      },
      '/api/controllers/c2/status': { ok: false, body: {} }
    });
    const { result } = renderHook(() => useControllerStatuses(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.get('c1')!.reachable).toBe(true);
    expect(result.current.data!.get('c2')).toEqual({
      controllerId: 'c2', reachable: false, info: null, state: null, polledAt: null
    });
  });

  it('useCapabilities is disabled for null and fetches for an id', async () => {
    const caps = { vid: 1, effects: ['Solid'], palettes: ['Default'], fxMeta: [], palettePreviews: {}, fetchedAt: 'x' };
    const fetchMock = stubFetch({ '/api/controllers/c1/capabilities': { ok: true, body: caps } });
    const wrapper = makeWrapper();
    const disabled = renderHook(() => useCapabilities(null), { wrapper });
    expect(disabled.result.current.fetchStatus).toBe('idle');
    const enabled = renderHook(() => useCapabilities('c1'), { wrapper });
    await waitFor(() => expect(enabled.result.current.data).toEqual(caps));
    expect(fetchMock).toHaveBeenCalledWith('/api/controllers/c1/capabilities');
  });

  it('useDevicePresets fetches and unwraps presets for an id, stays idle for null', async () => {
    const presets = [{ id: 1, name: 'Night', isPlaylist: false }];
    stubFetch({ '/api/controllers/c1/presets': { ok: true, body: { presets } } });
    const wrapper = makeWrapper();
    const idle = renderHook(() => useDevicePresets(null), { wrapper });
    expect(idle.result.current.fetchStatus).toBe('idle');
    const active = renderHook(() => useDevicePresets('c1'), { wrapper });
    await waitFor(() => expect(active.result.current.data).toEqual(presets));
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/queries.test.tsx` — expect FAIL: `Cannot find module '../../api/queries'`.
- [ ] Create `client/src/api/queries.ts`:

```ts
import { useQuery, useQueries } from '@tanstack/react-query';
import {
  listControllers, listGroups, listThemes, getControllerStatus, getCapabilities, listDevicePresets,
  type ControllerStatus, type ControllerCapabilities
} from './client';

export function useControllers() {
  return useQuery({ queryKey: ['controllers'], queryFn: listControllers });
}

export function useGroups() {
  return useQuery({ queryKey: ['groups'], queryFn: listGroups });
}

export function useThemes() {
  return useQuery({ queryKey: ['themes'], queryFn: listThemes });
}

export function useControllerStatuses() {
  return useQuery({
    queryKey: ['status'],
    queryFn: async (): Promise<Map<string, ControllerStatus>> => {
      const controllers = await listControllers();
      const statuses = await Promise.all(
        controllers.map((c) =>
          getControllerStatus(c.id).catch(
            (): ControllerStatus => ({ controllerId: c.id, reachable: false, info: null, state: null, polledAt: null })
          )
        )
      );
      return new Map(statuses.map((s) => [s.controllerId, s]));
    },
    refetchInterval: 60_000
  });
}

export function useCapabilities(controllerId: string | null) {
  return useQuery({
    queryKey: ['capabilities', controllerId],
    queryFn: () => getCapabilities(controllerId as string),
    enabled: controllerId !== null,
    staleTime: 5 * 60_000
  });
}

export function useCapabilitiesMap(controllerIds: string[]): Map<string, ControllerCapabilities> {
  const results = useQueries({
    queries: controllerIds.map((id) => ({
      queryKey: ['capabilities', id],
      queryFn: () => getCapabilities(id),
      staleTime: 5 * 60_000
    }))
  });
  const map = new Map<string, ControllerCapabilities>();
  results.forEach((r, i) => {
    if (r.data) map.set(controllerIds[i], r.data);
  });
  return map;
}

export function useDevicePresets(controllerId: string | null) {
  return useQuery({
    queryKey: ['presets', controllerId],
    queryFn: () => listDevicePresets(controllerId as string),
    enabled: controllerId !== null
  });
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/queries.test.tsx` — expect PASS (4 tests).
- [ ] Run full suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — expect PASS.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 2: react-query hooks with master query keys (controllers/groups/themes/status/capabilities/presets)"`

---

## Task 3: SSE live-status hook — `client/src/api/live.ts`

**Files:**
- Create: `client/src/api/live.ts`
- Test: `client/src/test/api/live.test.tsx` (create)

**Interfaces:**
- Consumes: `GET /api/live?controllers=<id>,<id>` SSE contract (Phase B): named event `status`, JSON data `{ controllerId, reachable, state?, info? }`.
- Produces (exported from `client/src/api/live.ts`):
  - `interface LiveNightlight { on: boolean; dur: number; mode: 0 | 1 | 2 | 3; tbri: number; rem: number }`
  - `interface LiveSegment { id: number; start: number; stop: number; len?: number; on: boolean; bri: number; col: number[][]; fx: number; sx: number; ix: number; pal: number; c1: number; c2: number; c3: number; o1: boolean; o2: boolean; o3: boolean; cct?: number; rev?: boolean; mi?: boolean; n?: string }`
  - `interface LiveState { on: boolean; bri: number; transition: number; ps: number; pl: number; nl: LiveNightlight; mainseg: number; seg: LiveSegment[] }`
  - `interface LiveInfo { name: string; ver: string; vid?: number; leds: { count: number; rgbw: boolean; cct: number | boolean; seglc?: number[] } }`
  - `interface LiveStatusEntry { reachable: boolean; state?: LiveState; info?: LiveInfo }`
  - `useLiveStatus(controllerIds: string[]): Map<string, LiveStatusEntry>` — subscribes to `/api/live?controllers=` + sorted-joined ids; merges per-controller events (keeps last `state`/`info` when an event omits them); reconnects on error with capped exponential backoff (2 s, 4 s, … capped 30 s); resubscribes when the sorted id set changes; tears down on unmount; no connection for an empty id list.

**Steps:**

- [ ] Write the failing test `client/src/test/api/live.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveStatus } from '../../api/live';

type Listener = (ev: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() { this.closed = true; }
  emitStatus(payload: unknown) {
    for (const fn of this.listeners.get('status') ?? []) {
      fn({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }
}

describe('useLiveStatus', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens one EventSource at /api/live with sorted, comma-joined ids', () => {
    renderHook(() => useLiveStatus(['b2', 'a1']));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/live?controllers=a1,b2');
  });

  it('opens no connection for an empty id list', () => {
    renderHook(() => useLiveStatus([]));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('updates the map on status events and keeps the last state/info when omitted', () => {
    const { result } = renderHook(() => useLiveStatus(['a1']));
    const es = FakeEventSource.instances[0];
    const state1 = { on: true, bri: 9, transition: 7, ps: -1, pl: -1, nl: { on: false, dur: 60, mode: 1, tbri: 0, rem: -1 }, mainseg: 0, seg: [] };
    const info = { name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030, leds: { count: 48, rgbw: true, cct: 0 } };
    act(() => es.emitStatus({ controllerId: 'a1', reachable: true, state: state1, info }));
    expect(result.current.get('a1')).toEqual({ reachable: true, state: state1, info });
    const state2 = { ...state1, bri: 128 };
    act(() => es.emitStatus({ controllerId: 'a1', reachable: true, state: state2 }));
    expect(result.current.get('a1')!.state!.bri).toBe(128);
    expect(result.current.get('a1')!.info).toEqual(info); // info retained across info-less ticks
  });

  it('resubscribes when the id set changes but not when only the order changes', () => {
    const { rerender } = renderHook(({ ids }) => useLiveStatus(ids), { initialProps: { ids: ['b2', 'a1'] } });
    expect(FakeEventSource.instances).toHaveLength(1);
    rerender({ ids: ['a1', 'b2'] }); // same sorted key → no new connection
    expect(FakeEventSource.instances).toHaveLength(1);
    rerender({ ids: ['a1', 'b2', 'c3'] });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances[1].url).toBe('/api/live?controllers=a1,b2,c3');
  });

  it('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useLiveStatus(['a1']));
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('reconnects after an error with capped exponential backoff (2s then 4s)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderHook(() => useLiveStatus(['a1']));
    act(() => FakeEventSource.instances[0].onerror?.());
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1999); });
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => FakeEventSource.instances[1].onerror?.());
    act(() => { vi.advanceTimersByTime(3999); });
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeEventSource.instances).toHaveLength(3);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/live.test.tsx` — expect FAIL: `Cannot find module '../../api/live'`.
- [ ] Create `client/src/api/live.ts`:

```ts
import { useEffect, useState } from 'react';

export interface LiveNightlight { on: boolean; dur: number; mode: 0 | 1 | 2 | 3; tbri: number; rem: number }

export interface LiveSegment {
  id: number; start: number; stop: number; len?: number;
  on: boolean; bri: number; col: number[][];
  fx: number; sx: number; ix: number; pal: number;
  c1: number; c2: number; c3: number;
  o1: boolean; o2: boolean; o3: boolean;
  cct?: number; rev?: boolean; mi?: boolean; n?: string;
}

export interface LiveState {
  on: boolean; bri: number; transition: number; ps: number; pl: number;
  nl: LiveNightlight; mainseg: number; seg: LiveSegment[];
}

export interface LiveInfo {
  name: string; ver: string; vid?: number;
  leds: { count: number; rgbw: boolean; cct: number | boolean; seglc?: number[] };
}

export interface LiveStatusEntry { reachable: boolean; state?: LiveState; info?: LiveInfo }

interface StatusEvent { controllerId: string; reachable: boolean; state?: LiveState; info?: LiveInfo }

const MAX_BACKOFF_MS = 30_000;

export function useLiveStatus(controllerIds: string[]): Map<string, LiveStatusEntry> {
  const [statuses, setStatuses] = useState<Map<string, LiveStatusEntry>>(new Map());
  const key = [...controllerIds].sort().join(',');

  useEffect(() => {
    setStatuses(new Map());
    if (key === '') return;

    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/api/live?controllers=${key}`);
      source.addEventListener('status', (ev) => {
        attempts = 0;
        const data = JSON.parse((ev as MessageEvent).data) as StatusEvent;
        setStatuses((prev) => {
          const next = new Map(prev);
          const existing = next.get(data.controllerId);
          next.set(data.controllerId, {
            reachable: data.reachable,
            state: data.state ?? existing?.state,
            info: data.info ?? existing?.info
          });
          return next;
        });
      });
      source.onerror = () => {
        source?.close();
        attempts += 1;
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 5));
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      source?.close();
    };
  }, [key]);

  return statuses;
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/live.test.tsx` — expect PASS (6 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 3: useLiveStatus SSE hook with capped backoff and stable-key resubscription"`

---

## Task 4: Pure helpers — kelvin/hex color math, palette gradients, recent colors, trailing throttle

**Files:**
- Create: `client/src/lib/color.ts`, `client/src/lib/recentColors.ts`, `client/src/lib/throttle.ts`
- Test: `client/src/test/lib/color.test.ts`, `client/src/test/lib/recentColors.test.ts`, `client/src/test/lib/throttle.test.ts` (create all three)

**Interfaces:**
- Consumes: `PalettePreview` type from `client/src/api/client.ts` (Task 1).
- Produces:
  - `kelvinToRgb(kelvin: number): [number, number, number]` (Tanner Helland approximation, clamped 1000–40000 K)
  - `rgbToHex(rgb: number[]): string` (`'#rrggbb'`, ignores a 4th w entry)
  - `hexToRgb(hex: string): [number, number, number] | null`
  - `paletteGradientCss(preview: PalettePreview, slotColors: (number[] | null)[]): string`
  - `getRecentColors(): string[]` / `pushRecentColor(hex: string): string[]` (localStorage key `'uber-wled.recent-colors'`, max 12, dedupe move-to-front)
  - `interface Throttled<A extends unknown[]> { call: (...args: A) => void; flush: () => void; cancel: () => void }`
  - `throttleTrailing<A extends unknown[]>(fn: (...args: A) => void, intervalMs: number): Throttled<A>` — leading call fires immediately, calls inside the window coalesce to the latest args and fire once at window end (trailing edge). 250 ms ⇒ ≤ 4 writes/sec.

**Steps:**

- [ ] Write the failing test `client/src/test/lib/color.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { kelvinToRgb, rgbToHex, hexToRgb, paletteGradientCss } from '../../lib/color';

describe('kelvinToRgb', () => {
  // Expected values computed from the Tanner Helland approximation used in the implementation.
  it('maps the four quick-preset temperatures', () => {
    expect(kelvinToRgb(2700)).toEqual([255, 167, 87]);
    expect(kelvinToRgb(3500)).toEqual([255, 193, 141]);
    expect(kelvinToRgb(5000)).toEqual([255, 228, 206]);
    expect(kelvinToRgb(6500)).toEqual([255, 254, 250]);
  });
  it('clamps out-of-range inputs', () => {
    expect(kelvinToRgb(200)).toEqual(kelvinToRgb(1000));   // [255, 68, 0]
    expect(kelvinToRgb(99000)).toEqual(kelvinToRgb(40000));
  });
  it('is warm below and cool above the 6600K pivot', () => {
    expect(kelvinToRgb(2700)[2]).toBeLessThan(120);
    expect(kelvinToRgb(10000)).toEqual([202, 218, 255]);
  });
});

describe('hex <-> rgb', () => {
  it('round-trips', () => {
    expect(rgbToHex([255, 167, 87])).toBe('#ffa757');
    expect(hexToRgb('#ffa757')).toEqual([255, 167, 87]);
    expect(hexToRgb('FFA757')).toEqual([255, 167, 87]); // no #, uppercase
  });
  it('rgbToHex ignores a white channel and clamps', () => {
    expect(rgbToHex([255, 0, 0, 128])).toBe('#ff0000');
    expect(rgbToHex([300, -5, 12.4])).toBe('#ff000c');
  });
  it('hexToRgb rejects malformed input', () => {
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('red')).toBeNull();
  });
});

describe('paletteGradientCss', () => {
  it('renders gradient stops positioned 0-255 → 0-100%', () => {
    const css = paletteGradientCss(
      { type: 'stops', stops: [[0, 255, 0, 0], [128, 0, 255, 0], [255, 0, 0, 255]] },
      [null, null, null]
    );
    expect(css).toBe('linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 255, 0) 50%, rgb(0, 0, 255) 100%)');
  });
  it('renders a fixed multi-hue gradient for random palettes', () => {
    const css = paletteGradientCss({ type: 'random' }, [null, null, null]);
    expect(css).toContain('linear-gradient(90deg');
  });
  it('renders hard bands from current slot colors for slot palettes', () => {
    const css = paletteGradientCss(
      { type: 'slots', slots: ['c3', 'c2', 'c1'] }, // real device preview for '* Color Gradient' (pal 4)
      [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0]]
    );
    expect(css).toBe(
      'linear-gradient(90deg, rgb(0, 0, 255) 0% 33%, rgb(0, 255, 0) 33% 67%, rgb(255, 0, 0) 67% 100%)'
    );
  });
  it('falls back to slate for missing slot colors', () => {
    const css = paletteGradientCss({ type: 'slots', slots: ['c1'] }, [null, null, null]);
    expect(css).toBe('linear-gradient(90deg, rgb(100, 116, 139) 0% 100%)');
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib/color.test.ts` — expect FAIL: module not found.
- [ ] Create `client/src/lib/color.ts`:

```ts
import type { PalettePreview } from '../api/client';

export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = Math.min(40_000, Math.max(1000, kelvin)) / 100;
  let r: number; let g: number; let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return [clamp(r), clamp(g), clamp(b)];
}

export function rgbToHex(rgb: number[]): string {
  const channel = (v: number | undefined) =>
    Math.max(0, Math.min(255, Math.round(v ?? 0))).toString(16).padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const RANDOM_PREVIEW =
  'linear-gradient(90deg, #e6437d 0%, #f5a623 25%, #3ddc84 50%, #38b6ff 75%, #9b5de5 100%)';
const FALLBACK_SLOT = 'rgb(100, 116, 139)';

export function paletteGradientCss(
  preview: PalettePreview,
  slotColors: (number[] | null)[]
): string {
  if (preview.type === 'random') return RANDOM_PREVIEW;
  if (preview.type === 'slots') {
    const n = preview.slots.length;
    const bands = preview.slots.map((slot, i) => {
      const idx = slot === 'c1' ? 0 : slot === 'c2' ? 1 : 2;
      const col = slotColors[idx];
      const css = col && col.length >= 3 ? `rgb(${col[0]}, ${col[1]}, ${col[2]})` : FALLBACK_SLOT;
      const from = Math.round((i / n) * 100);
      const to = Math.round(((i + 1) / n) * 100);
      return `${css} ${from}% ${to}%`;
    });
    return `linear-gradient(90deg, ${bands.join(', ')})`;
  }
  const stops = preview.stops.map(
    ([pos, r, g, b]) => `rgb(${r}, ${g}, ${b}) ${Math.round((pos / 255) * 100)}%`
  );
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib/color.test.ts` — expect PASS.
- [ ] Write the failing test `client/src/test/lib/recentColors.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getRecentColors, pushRecentColor } from '../../lib/recentColors';

describe('recentColors', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and persists pushes', () => {
    expect(getRecentColors()).toEqual([]);
    pushRecentColor('#FF0000');
    expect(getRecentColors()).toEqual(['#ff0000']); // normalized lowercase
    expect(JSON.parse(localStorage.getItem('uber-wled.recent-colors')!)).toEqual(['#ff0000']);
  });

  it('dedupes by moving a repeated color to the front', () => {
    pushRecentColor('#111111');
    pushRecentColor('#222222');
    const result = pushRecentColor('#111111');
    expect(result).toEqual(['#111111', '#222222']);
  });

  it('caps at 12 entries', () => {
    for (let i = 0; i < 15; i++) pushRecentColor(`#0000${i.toString(16).padStart(2, '0')}`);
    const colors = getRecentColors();
    expect(colors).toHaveLength(12);
    expect(colors[0]).toBe('#00000e');
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('uber-wled.recent-colors', '{not json');
    expect(getRecentColors()).toEqual([]);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib/recentColors.test.ts` — expect FAIL: module not found.
- [ ] Create `client/src/lib/recentColors.ts`:

```ts
const KEY = 'uber-wled.recent-colors';
const MAX = 12;

export function getRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentColor(hex: string): string[] {
  const normalized = hex.toLowerCase();
  const next = [normalized, ...getRecentColors().filter((c) => c !== normalized)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable/full — recents are best-effort
  }
  return next;
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib/recentColors.test.ts` — expect PASS.
- [ ] Write the failing test `client/src/test/lib/throttle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { throttleTrailing } from '../../lib/throttle';

describe('throttleTrailing', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('fires the first call immediately (leading edge)', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.call(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('coalesces calls inside the window to one trailing fire with the latest args', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.call(1);
    t.call(2);
    t.call(3);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(249);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it('never exceeds 1 fire per interval during a sustained drag (≤4/sec at 250ms)', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    for (let ms = 0; ms < 1000; ms += 50) {
      t.call(ms);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(250);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(5); // 1 leading + ≤4 trailing over 1s
    expect(fn).toHaveBeenLastCalledWith(950);
  });

  it('fires immediately again after a quiet period', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.call(1);
    vi.advanceTimersByTime(300);
    t.call(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the pending trailing call; flush fires it immediately', () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.call(1);
    t.call(2);
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    t.call(3);
    t.call(4);
    t.flush();
    expect(fn).toHaveBeenLastCalledWith(4);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib/throttle.test.ts` — expect FAIL: module not found.
- [ ] Create `client/src/lib/throttle.ts`:

```ts
export interface Throttled<A extends unknown[]> {
  call: (...args: A) => void;
  flush: () => void;
  cancel: () => void;
}

export function throttleTrailing<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number
): Throttled<A> {
  let lastFire = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const fire = (args: A) => {
    lastFire = Date.now();
    fn(...args);
  };

  const call = (...args: A) => {
    const elapsed = Date.now() - lastFire;
    if (elapsed >= intervalMs && timer === null) {
      fire(args);
      return;
    }
    pending = args;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (pending !== null) {
          const args2 = pending;
          pending = null;
          fire(args2);
        }
      }, Math.max(0, intervalMs - elapsed));
    }
  };

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) {
      const args = pending;
      pending = null;
      fire(args);
    }
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  return { call, flush, cancel };
}
```

- [ ] Run all three: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/lib` — expect PASS (existing lib tests included).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 4: pure helpers - kelvinToRgb, hex/rgb, palette gradient css, recent colors, trailing throttle"`

---

## Task 5: Mixed-state aggregation + capability merge — `client/src/control/controlState.ts` (pure, heavy tests)

**Files:**
- Create: `client/src/control/controlState.ts`, `client/src/test/fixtures/capabilities.ts`
- Test: `client/src/test/control/controlState.test.ts` (create)

**Interfaces:**
- Consumes: `Target`, `Group`, `ControllerCapabilities`, `FxMeta`, `PalettePreview` (Task 1); `LiveStatusEntry`, `LiveSegment`, `LiveState`, `LiveInfo` (Task 3).
- Produces (all exported from `client/src/control/controlState.ts`):
  - `interface ExpandedTarget { controllerId: string; wledSegId: number | null }`
  - `expandTargets(targets: Target[], groups: Group[], live: Map<string, LiveStatusEntry>): ExpandedTarget[]` — groups → member pairs; controller kind → one entry per live segment id (or `wledSegId: null` when no live state); dedupes exact pairs.
  - `targetControllerIds(targets: Target[], groups: Group[]): string[]` — unique, sorted.
  - `type Mixed<T> = T | 'mixed' | null`
  - `interface AggregatedControlState { hasData: boolean; anyUnreachable: boolean; power: 'on' | 'off' | 'mixed'; bri: number | 'mixed'; transition: Mixed<number>; fxName: Mixed<string>; palName: Mixed<string>; colors: Mixed<number[]>[]; sx: Mixed<number>; ix: Mixed<number>; c1: Mixed<number>; c2: Mixed<number>; c3: Mixed<number>; o1: Mixed<boolean>; o2: Mixed<boolean>; o3: Mixed<boolean>; cct: Mixed<number>; nl: { on: boolean; dur: number; mode: 0 | 1 | 2 | 3; tbri: number } | null }` (master's named fields `power`/`bri`/`fxName` kept exactly; `colors` always length 3)
  - `aggregateControlState(targets: Target[], groups: Group[], live: Map<string, LiveStatusEntry>, caps: Map<string, ControllerCapabilities>): AggregatedControlState`
  - Aggregation rules (binding for tests): `power` from segment-level `on` across expanded pairs; `bri` and `transition` from **controller-level** `state.bri`/`state.transition` per distinct involved controller (they fan out as top-level `ControlPatch` fields); `fxName`/`palName` resolved per device through `caps` (name comparison, so equal names with different ids are NOT mixed); color slots compared with a missing white channel treated as 0; no live data at all ⇒ `{ hasData: false, power: 'off', bri: 'mixed' }` and every `Mixed` field `null`; `nl` from the first controller (expansion order) with live state; `anyUnreachable` true when any expanded pair's controller has no live entry or `reachable: false`.
  - `interface MergedEffectEntry { name: string; supportedEverywhere: boolean; ids: Record<string, number>; meta: FxMeta | null }`
  - `mergeEffects(controllerIds: string[], caps: Map<string, ControllerCapabilities>): MergedEffectEntry[]` — union by name across controllers; skips empty and `'RSVD'` names; `supportedEverywhere` = every listed controller has the name (missing caps ⇒ false); `meta` from the first controller that has the name; sorted `'Solid'` first then case-sensitive `localeCompare`.
  - `interface MergedPaletteEntry { name: string; supportedEverywhere: boolean; ids: Record<string, number>; preview: PalettePreview | null }`
  - `mergePalettes(controllerIds: string[], caps: Map<string, ControllerCapabilities>): MergedPaletteEntry[]` — same rules, `'Default'` pinned first.
  - `interface ControlOverrides { power?: boolean; bri?: number; transition?: number; fxName?: string; palName?: string; colors?: Record<number, number[]>; sx?: number; ix?: number; c1?: number; c2?: number; c3?: number; o1?: boolean; o2?: boolean; o3?: boolean; cct?: number }`
  - `applyOverrides(agg: AggregatedControlState, overrides: ControlOverrides): AggregatedControlState`

**Steps:**

- [ ] Create the shared fixture module `client/src/test/fixtures/capabilities.ts` (used again in Tasks 8–11):

```ts
import type { ControllerCapabilities, FxMeta } from '../../api/client';
import type { LiveInfo, LiveSegment, LiveState, LiveStatusEntry } from '../../api/live';

// ── FxMeta fixtures ─────────────────────────────────────────────────────────
// Captured from WLED 16.0.0 (vid 2605030) at 192.168.1.86 on 2026-07-04.
// Raw /json/fxdata strings quoted per entry; ids remapped to a compact 0..4
// space so the fixture effects[] arrays stay dense (real device ids noted).

// fxdata[0] = '' (Solid)
export const FX_SOLID: FxMeta = {
  id: 0, name: 'Solid',
  sliders: { sx: null, ix: null, c1: null, c2: null, c3: null },
  options: { o1: null, o2: null, o3: null },
  colorLabels: ['Fx', null, null],
  usesPalette: false, flags: [], defaults: {}
};

// fxdata[1] = '!,Duty cycle;!,!;!;01' (Blink)
export const FX_BLINK: FxMeta = {
  id: 1, name: 'Blink',
  sliders: { sx: 'Effect speed', ix: 'Duty cycle', c1: null, c2: null, c3: null },
  options: { o1: null, o2: null, o3: null },
  colorLabels: ['Fx', 'Bg', null],
  usesPalette: true, flags: ['0', '1'], defaults: {}
};

// fxdata[74] = 'Fade speed,Spawn speed;;!;;m12=0' (Colortwinkles, device id 74)
export const FX_COLORTWINKLES: FxMeta = {
  id: 2, name: 'Colortwinkles',
  sliders: { sx: 'Fade speed', ix: 'Spawn speed', c1: null, c2: null, c3: null },
  options: { o1: null, o2: null, o3: null },
  colorLabels: [null, null, null],
  usesPalette: true, flags: [], defaults: { m12: 0 }
};

// fxdata[118] = '!,Blur,,,,Smear;;!;2' (Spaceships, device id 118 — 2D, has o1)
export const FX_SPACESHIPS: FxMeta = {
  id: 3, name: 'Spaceships',
  sliders: { sx: 'Effect speed', ix: 'Blur', c1: null, c2: null, c3: null },
  options: { o1: 'Smear', o2: null, o3: null },
  colorLabels: [null, null, null],
  usesPalette: true, flags: ['2'], defaults: {}
};

// fxdata[128] = 'Fade rate,# of pixels;!,!;!;1v;m12=0,si=0' (Pixels, device id 128 — audio 'v')
export const FX_PIXELS: FxMeta = {
  id: 4, name: 'Pixels',
  sliders: { sx: 'Fade rate', ix: '# of pixels', c1: null, c2: null, c3: null },
  options: { o1: null, o2: null, o3: null },
  colorLabels: ['Fx', 'Bg', null],
  usesPalette: true, flags: ['1', 'v'], defaults: { m12: 0, si: 0 }
};

// ── Palette previews (real /json/palx data) ────────────────────────────────
// First five gradient stops of palette 0 'Default'.
export const PAL_DEFAULT_STOPS: [number, number, number, number][] = [
  [0, 155, 0, 213], [16, 189, 0, 184], [32, 218, 0, 146], [48, 243, 0, 92], [64, 244, 85, 0]
];
// Full 13 stops of palette 35 'Fire'.
export const PAL_FIRE_STOPS: [number, number, number, number][] = [
  [0, 0, 0, 0], [46, 77, 0, 0], [96, 177, 0, 0], [108, 196, 38, 9], [119, 215, 76, 19],
  [146, 235, 115, 29], [174, 255, 153, 41], [188, 255, 178, 41], [202, 255, 204, 41],
  [218, 255, 230, 41], [234, 255, 255, 41], [244, 255, 255, 143], [255, 255, 255, 255]
];

// ── Capability fixtures for two controllers with different id layouts ─────
export const CAPS_A: ControllerCapabilities = {
  vid: 2605030,
  effects: ['Solid', 'Blink', 'Colortwinkles', 'Spaceships', 'Pixels'],
  palettes: ['Default', '* Random Cycle', '* Colors 1&2', '* Color Gradient', 'Fire'],
  fxMeta: [FX_SOLID, FX_BLINK, FX_COLORTWINKLES, FX_SPACESHIPS, FX_PIXELS],
  palettePreviews: {
    0: { type: 'stops', stops: PAL_DEFAULT_STOPS },
    1: { type: 'random' },
    2: { type: 'slots', slots: ['c1', 'c1', 'c2', 'c2'] },
    3: { type: 'slots', slots: ['c3', 'c2', 'c1'] },
    4: { type: 'stops', stops: PAL_FIRE_STOPS }
  },
  fetchedAt: '2026-07-04T00:00:00.000Z'
};

// Older firmware: same names at DIFFERENT ids, one reserved slot, fewer palettes.
export const CAPS_B: ControllerCapabilities = {
  vid: 2405180,
  effects: ['Solid', 'Pixels', 'Blink', 'RSVD'],
  palettes: ['Default', '* Random Cycle', 'Fire'],
  fxMeta: [
    { ...FX_SOLID, id: 0 },
    { ...FX_PIXELS, id: 1 },
    { ...FX_BLINK, id: 2 }
  ],
  palettePreviews: {
    0: { type: 'stops', stops: PAL_DEFAULT_STOPS },
    1: { type: 'random' },
    2: { type: 'stops', stops: PAL_FIRE_STOPS }
  },
  fetchedAt: '2026-07-04T00:00:00.000Z'
};

// ── Live-state builders (defaults from the real /json/state probe) ────────
export function makeSeg(id: number, overrides: Partial<LiveSegment> = {}): LiveSegment {
  return {
    id, start: 0, stop: 39, len: 39, on: true, bri: 255,
    col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    fx: 0, sx: 128, ix: 128, pal: 0, c1: 220, c2: 30, c3: 21,
    o1: true, o2: false, o3: false, cct: 127, rev: false, mi: false,
    ...overrides
  };
}

export function makeState(seg: LiveSegment[], overrides: Partial<LiveState> = {}): LiveState {
  return {
    on: true, bri: 9, transition: 7, ps: -1, pl: -1,
    nl: { on: false, dur: 60, mode: 1, tbri: 0, rem: -1 },
    mainseg: 0, seg,
    ...overrides
  };
}

export function makeInfo(overrides: Partial<LiveInfo> = {}): LiveInfo {
  return {
    name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
    leds: { count: 48, rgbw: true, cct: 0, seglc: [1, 1] },
    ...overrides
  };
}

export function liveEntry(state: LiveState, info?: LiveInfo): LiveStatusEntry {
  return { reachable: true, state, info: info ?? makeInfo() };
}
```

- [ ] Write the failing test `client/src/test/control/controlState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Target, Group, ControllerCapabilities } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import {
  expandTargets, targetControllerIds, aggregateControlState,
  mergeEffects, mergePalettes, applyOverrides
} from '../../control/controlState';
import { CAPS_A, CAPS_B, makeSeg, makeState, makeInfo, liveEntry } from '../fixtures/capabilities';

const GROUPS: Group[] = [
  { id: 'g1', name: 'Kitchen', members: [{ controllerId: 'cA', wledSegId: 0 }, { controllerId: 'cB', wledSegId: 0 }] }
];

const caps = new Map<string, ControllerCapabilities>([['cA', CAPS_A], ['cB', CAPS_B]]);

function liveMap(entries: Record<string, LiveStatusEntry>) {
  return new Map(Object.entries(entries));
}

describe('expandTargets', () => {
  it('passes segment targets through and expands groups to member pairs', () => {
    const live = liveMap({});
    expect(expandTargets(
      [{ kind: 'segment', controllerId: 'cA', wledSegId: 1 }, { kind: 'group', groupId: 'g1' }],
      GROUPS, live
    )).toEqual([
      { controllerId: 'cA', wledSegId: 1 },
      { controllerId: 'cA', wledSegId: 0 },
      { controllerId: 'cB', wledSegId: 0 }
    ]);
  });

  it('expands a controller target to its live segment ids', () => {
    const live = liveMap({ cA: liveEntry(makeState([makeSeg(0), makeSeg(1)])) });
    expect(expandTargets([{ kind: 'controller', controllerId: 'cA' }], [], live))
      .toEqual([{ controllerId: 'cA', wledSegId: 0 }, { controllerId: 'cA', wledSegId: 1 }]);
  });

  it('uses wledSegId null when the controller has no live state', () => {
    expect(expandTargets([{ kind: 'controller', controllerId: 'cA' }], [], liveMap({})))
      .toEqual([{ controllerId: 'cA', wledSegId: null }]);
  });

  it('dedupes identical (controller, seg) pairs from overlapping targets', () => {
    const live = liveMap({ cA: liveEntry(makeState([makeSeg(0)])) });
    const targets: Target[] = [
      { kind: 'controller', controllerId: 'cA' },
      { kind: 'segment', controllerId: 'cA', wledSegId: 0 },
      { kind: 'group', groupId: 'g1' }
    ];
    const pairs = expandTargets(targets, GROUPS, live);
    expect(pairs.filter((p) => p.controllerId === 'cA' && p.wledSegId === 0)).toHaveLength(1);
  });

  it('targetControllerIds returns unique sorted ids incl. group members', () => {
    expect(targetControllerIds(
      [{ kind: 'group', groupId: 'g1' }, { kind: 'controller', controllerId: 'cA' }], GROUPS
    )).toEqual(['cA', 'cB']);
  });
});

describe('aggregateControlState', () => {
  const T_BOTH: Target[] = [
    { kind: 'controller', controllerId: 'cA' },
    { kind: 'controller', controllerId: 'cB' }
  ];

  it('aggregates agreeing targets into concrete values (name-resolved across differing ids)', () => {
    // cA runs Blink at id 1; cB runs Blink at id 2 → same NAME → not mixed.
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { fx: 1, sx: 100, ix: 50, pal: 0, col: [[255, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] })], { bri: 100 })),
      cB: liveEntry(makeState([makeSeg(0, { fx: 2, sx: 100, ix: 50, pal: 0, col: [[255, 0, 0], [0, 0, 0], [0, 0, 0]] })], { bri: 100 }))
    });
    const agg = aggregateControlState(T_BOTH, [], live, caps);
    expect(agg.hasData).toBe(true);
    expect(agg.anyUnreachable).toBe(false);
    expect(agg.power).toBe('on');
    expect(agg.bri).toBe(100);
    expect(agg.transition).toBe(7);
    expect(agg.fxName).toBe('Blink');
    expect(agg.palName).toBe('Default');
    // [255,0,0,0] vs [255,0,0]: missing white treated as 0 → equal
    expect(agg.colors[0]).toEqual([255, 0, 0, 0]);
    expect(agg.sx).toBe(100);
    expect(agg.ix).toBe(50);
    expect(agg.o1).toBe(true);
    expect(agg.cct).toBe(127);
    expect(agg.nl).toEqual({ on: false, dur: 60, mode: 1, tbri: 0 });
  });

  it('reports mixed power, brightness, effect and palette when targets disagree', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { on: true, fx: 1, pal: 0 })], { bri: 10 })),
      cB: liveEntry(makeState([makeSeg(0, { on: false, fx: 1, pal: 2 })], { bri: 200 }))
    });
    const agg = aggregateControlState(T_BOTH, [], live, caps);
    expect(agg.power).toBe('mixed');
    expect(agg.bri).toBe('mixed');
    // cA pal 0 = 'Default', cB pal 2 = 'Fire'
    expect(agg.palName).toBe('mixed');
  });

  it('reports mixed effect params and colors', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { sx: 10, o1: true, col: [[255, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] })])),
      cB: liveEntry(makeState([makeSeg(0, { sx: 20, o1: false, col: [[0, 255, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] })]))
    });
    const agg = aggregateControlState(T_BOTH, [], live, caps);
    expect(agg.sx).toBe('mixed');
    expect(agg.o1).toBe('mixed');
    expect(agg.colors[0]).toBe('mixed');
    expect(agg.colors[1]).toEqual([0, 0, 0, 0]);
  });

  it('ignores caps-less controllers for name resolution but keeps numeric aggregation', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { fx: 1 })])),
      cX: liveEntry(makeState([makeSeg(0, { fx: 9 })]))
    });
    const agg = aggregateControlState(
      [{ kind: 'controller', controllerId: 'cA' }, { kind: 'controller', controllerId: 'cX' }],
      [], live, caps // caps has no entry for cX
    );
    expect(agg.fxName).toBe('Blink'); // only cA contributes a name
    expect(agg.power).toBe('on');
  });

  it('flags unreachable targets and still aggregates the reachable ones', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { fx: 1 })], { bri: 42 })),
      cB: { reachable: false }
    });
    const agg = aggregateControlState(T_BOTH, [], live, caps);
    expect(agg.anyUnreachable).toBe(true);
    expect(agg.bri).toBe(42);
    expect(agg.fxName).toBe('Blink');
  });

  it('returns the no-data shape when nothing is live', () => {
    const agg = aggregateControlState(T_BOTH, [], liveMap({}), caps);
    expect(agg).toMatchObject({
      hasData: false, anyUnreachable: true, power: 'off', bri: 'mixed',
      transition: null, fxName: null, palName: null,
      sx: null, ix: null, c1: null, c2: null, c3: null,
      o1: null, o2: null, o3: null, cct: null, nl: null
    });
    expect(agg.colors).toEqual([null, null, null]);
  });

  it('aggregates group targets through their member segments', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { on: true }), makeSeg(1, { on: false })])),
      cB: liveEntry(makeState([makeSeg(0, { on: true })]))
    });
    // g1 members are (cA,0) and (cB,0) — seg 1 of cA is NOT included
    const agg = aggregateControlState([{ kind: 'group', groupId: 'g1' }], GROUPS, live, caps);
    expect(agg.power).toBe('on');
  });
});

describe('mergeEffects', () => {
  it('unions names, tracks per-controller ids, flags partial support, filters RSVD, pins Solid', () => {
    const merged = mergeEffects(['cA', 'cB'], caps);
    expect(merged.map((e) => e.name)).toEqual(
      ['Solid', 'Blink', 'Colortwinkles', 'Pixels', 'Spaceships'] // Solid pinned, rest alphabetical
    );
    const blink = merged.find((e) => e.name === 'Blink')!;
    expect(blink.ids).toEqual({ cA: 1, cB: 2 });
    expect(blink.supportedEverywhere).toBe(true);
    expect(blink.meta!.sliders.ix).toBe('Duty cycle');
    const spaceships = merged.find((e) => e.name === 'Spaceships')!;
    expect(spaceships.supportedEverywhere).toBe(false);
    expect(spaceships.ids).toEqual({ cA: 3 });
    expect(merged.some((e) => e.name === 'RSVD')).toBe(false);
  });

  it('marks nothing supportedEverywhere when a controller has no caps', () => {
    const merged = mergeEffects(['cA', 'cMissing'], caps);
    expect(merged.every((e) => e.supportedEverywhere === false)).toBe(true);
    expect(merged.some((e) => e.name === 'Solid')).toBe(true); // still listed from cA
  });
});

describe('mergePalettes', () => {
  it('unions palettes with Default pinned and previews attached', () => {
    const merged = mergePalettes(['cA', 'cB'], caps);
    expect(merged.map((p) => p.name)).toEqual(
      ['Default', '* Color Gradient', '* Colors 1&2', '* Random Cycle', 'Fire']
    );
    const fire = merged.find((p) => p.name === 'Fire')!;
    expect(fire.supportedEverywhere).toBe(true);
    expect(fire.ids).toEqual({ cA: 4, cB: 2 });
    expect(fire.preview).toEqual({ type: 'stops', stops: expect.any(Array) });
    const gradient = merged.find((p) => p.name === '* Color Gradient')!;
    expect(gradient.supportedEverywhere).toBe(false);
    expect(gradient.preview).toEqual({ type: 'slots', slots: ['c3', 'c2', 'c1'] });
  });
});

describe('applyOverrides', () => {
  it('overlays optimistic values without touching un-overridden fields', () => {
    const live = liveMap({ cA: liveEntry(makeState([makeSeg(0, { fx: 1 })], { bri: 10 })) });
    const agg = aggregateControlState([{ kind: 'controller', controllerId: 'cA' }], [], live, caps);
    const out = applyOverrides(agg, { bri: 200, fxName: 'Pixels', colors: { 1: [0, 0, 255, 0] } });
    expect(out.bri).toBe(200);
    expect(out.fxName).toBe('Pixels');
    expect(out.colors[1]).toEqual([0, 0, 255, 0]);
    expect(out.colors[0]).toEqual(agg.colors[0]);
    expect(out.power).toBe(agg.power);
  });

  it('maps a power override onto the on/off union', () => {
    const live = liveMap({ cA: liveEntry(makeState([makeSeg(0, { on: false })])) });
    const agg = aggregateControlState([{ kind: 'controller', controllerId: 'cA' }], [], live, caps);
    expect(applyOverrides(agg, { power: true }).power).toBe('on');
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/controlState.test.ts` — expect FAIL: `Cannot find module '../../control/controlState'`.
- [ ] Create `client/src/control/controlState.ts`:

```ts
import type { Target, Group, ControllerCapabilities, FxMeta, PalettePreview } from '../api/client';
import type { LiveStatusEntry, LiveSegment } from '../api/live';

export interface ExpandedTarget { controllerId: string; wledSegId: number | null }

export function expandTargets(
  targets: Target[],
  groups: Group[],
  live: Map<string, LiveStatusEntry>
): ExpandedTarget[] {
  const out: ExpandedTarget[] = [];
  const seen = new Set<string>();
  const push = (controllerId: string, wledSegId: number | null) => {
    const key = `${controllerId}:${wledSegId ?? '*'}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ controllerId, wledSegId });
  };
  for (const target of targets) {
    if (target.kind === 'segment') {
      push(target.controllerId, target.wledSegId);
    } else if (target.kind === 'controller') {
      const segs = live.get(target.controllerId)?.state?.seg;
      if (segs && segs.length > 0) for (const seg of segs) push(target.controllerId, seg.id);
      else push(target.controllerId, null);
    } else {
      const group = groups.find((g) => g.id === target.groupId);
      for (const member of group?.members ?? []) push(member.controllerId, member.wledSegId);
    }
  }
  return out;
}

export function targetControllerIds(targets: Target[], groups: Group[]): string[] {
  const ids = new Set<string>();
  for (const target of targets) {
    if (target.kind === 'group') {
      const group = groups.find((g) => g.id === target.groupId);
      for (const member of group?.members ?? []) ids.add(member.controllerId);
    } else {
      ids.add(target.controllerId);
    }
  }
  return [...ids].sort();
}

export type Mixed<T> = T | 'mixed' | null;

export interface AggregatedControlState {
  hasData: boolean;
  anyUnreachable: boolean;
  power: 'on' | 'off' | 'mixed';
  bri: number | 'mixed';
  transition: Mixed<number>;
  fxName: Mixed<string>;
  palName: Mixed<string>;
  colors: Mixed<number[]>[]; // always length 3
  sx: Mixed<number>; ix: Mixed<number>;
  c1: Mixed<number>; c2: Mixed<number>; c3: Mixed<number>;
  o1: Mixed<boolean>; o2: Mixed<boolean>; o3: Mixed<boolean>;
  cct: Mixed<number>;
  nl: { on: boolean; dur: number; mode: 0 | 1 | 2 | 3; tbri: number } | null;
}

function reduceValues<T>(values: T[], eq: (a: T, b: T) => boolean): Mixed<T> {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => eq(v, first)) ? first : 'mixed';
}

const scalarEq = <T,>(a: T, b: T) => a === b;

function colorEq(a: number[], b: number[]): boolean {
  for (let i = 0; i < 4; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return false;
  }
  return true;
}

export function aggregateControlState(
  targets: Target[],
  groups: Group[],
  live: Map<string, LiveStatusEntry>,
  caps: Map<string, ControllerCapabilities>
): AggregatedControlState {
  const expanded = expandTargets(targets, groups, live);
  let anyUnreachable = false;
  const segs: { controllerId: string; seg: LiveSegment }[] = [];
  const statefulControllers: string[] = []; // expansion order, deduped

  for (const pair of expanded) {
    const entry = live.get(pair.controllerId);
    if (!entry || !entry.reachable) {
      anyUnreachable = true;
      continue;
    }
    if (!entry.state) continue;
    if (!statefulControllers.includes(pair.controllerId)) statefulControllers.push(pair.controllerId);
    if (pair.wledSegId === null) {
      for (const seg of entry.state.seg) segs.push({ controllerId: pair.controllerId, seg });
    } else {
      const seg = entry.state.seg.find((s) => s.id === pair.wledSegId);
      if (seg) segs.push({ controllerId: pair.controllerId, seg });
    }
  }

  const hasData = segs.length > 0;
  const onValues = segs.map((s) => s.seg.on);
  const powerReduced = reduceValues(onValues, scalarEq);
  const power: 'on' | 'off' | 'mixed' =
    powerReduced === null ? 'off' : powerReduced === 'mixed' ? 'mixed' : powerReduced ? 'on' : 'off';

  const states = statefulControllers.map((id) => live.get(id)!.state!);
  const briReduced = reduceValues(states.map((s) => s.bri), scalarEq);
  const bri: number | 'mixed' = briReduced === null ? 'mixed' : briReduced;

  const names = (resolve: (controllerId: string, seg: LiveSegment) => string | undefined): Mixed<string> => {
    const values: string[] = [];
    for (const { controllerId, seg } of segs) {
      const name = resolve(controllerId, seg);
      if (name !== undefined) values.push(name);
    }
    return reduceValues(values, scalarEq);
  };

  const colors: Mixed<number[]>[] = [0, 1, 2].map((slot) =>
    reduceValues(
      segs.map((s) => s.seg.col[slot]).filter((c): c is number[] => Array.isArray(c)),
      colorEq
    )
  );

  const num = (pick: (seg: LiveSegment) => number | undefined): Mixed<number> =>
    reduceValues(segs.map((s) => pick(s.seg)).filter((v): v is number => typeof v === 'number'), scalarEq);
  const bool = (pick: (seg: LiveSegment) => boolean | undefined): Mixed<boolean> =>
    reduceValues(segs.map((s) => pick(s.seg)).filter((v): v is boolean => typeof v === 'boolean'), scalarEq);

  const firstNl = states[0]?.nl ?? null;

  return {
    hasData,
    anyUnreachable,
    power,
    bri,
    transition: reduceValues(states.map((s) => s.transition), scalarEq),
    fxName: names((id, seg) => caps.get(id)?.effects[seg.fx]),
    palName: names((id, seg) => caps.get(id)?.palettes[seg.pal]),
    colors,
    sx: num((s) => s.sx), ix: num((s) => s.ix),
    c1: num((s) => s.c1), c2: num((s) => s.c2), c3: num((s) => s.c3),
    o1: bool((s) => s.o1), o2: bool((s) => s.o2), o3: bool((s) => s.o3),
    cct: num((s) => s.cct),
    nl: firstNl ? { on: firstNl.on, dur: firstNl.dur, mode: firstNl.mode, tbri: firstNl.tbri } : null
  };
}

export interface MergedEffectEntry {
  name: string;
  supportedEverywhere: boolean;
  ids: Record<string, number>;
  meta: FxMeta | null;
}

export interface MergedPaletteEntry {
  name: string;
  supportedEverywhere: boolean;
  ids: Record<string, number>;
  preview: PalettePreview | null;
}

function mergeNamed<E>(
  controllerIds: string[],
  caps: Map<string, ControllerCapabilities>,
  list: (cap: ControllerCapabilities) => string[],
  attach: (cap: ControllerCapabilities, id: number) => E | null,
  pinnedFirst: string
): { name: string; supportedEverywhere: boolean; ids: Record<string, number>; extra: E | null }[] {
  const byName = new Map<string, { name: string; supportedEverywhere: boolean; ids: Record<string, number>; extra: E | null }>();
  for (const controllerId of controllerIds) {
    const cap = caps.get(controllerId);
    if (!cap) continue;
    list(cap).forEach((name, id) => {
      if (!name || name === 'RSVD') return;
      let entry = byName.get(name);
      if (!entry) {
        entry = { name, supportedEverywhere: false, ids: {}, extra: null };
        byName.set(name, entry);
      }
      entry.ids[controllerId] = id;
      if (entry.extra === null) entry.extra = attach(cap, id);
    });
  }
  const entries = [...byName.values()];
  for (const entry of entries) {
    entry.supportedEverywhere = controllerIds.every((id) => entry.ids[id] !== undefined);
  }
  entries.sort((a, b) =>
    a.name === pinnedFirst ? -1 : b.name === pinnedFirst ? 1 : a.name.localeCompare(b.name)
  );
  return entries;
}

export function mergeEffects(
  controllerIds: string[],
  caps: Map<string, ControllerCapabilities>
): MergedEffectEntry[] {
  return mergeNamed(
    controllerIds, caps,
    (cap) => cap.effects,
    (cap, id) => cap.fxMeta.find((m) => m.id === id) ?? null,
    'Solid'
  ).map(({ name, supportedEverywhere, ids, extra }) => ({ name, supportedEverywhere, ids, meta: extra }));
}

export function mergePalettes(
  controllerIds: string[],
  caps: Map<string, ControllerCapabilities>
): MergedPaletteEntry[] {
  return mergeNamed(
    controllerIds, caps,
    (cap) => cap.palettes,
    (cap, id) => cap.palettePreviews[id] ?? null,
    'Default'
  ).map(({ name, supportedEverywhere, ids, extra }) => ({ name, supportedEverywhere, ids, preview: extra }));
}

export interface ControlOverrides {
  power?: boolean; bri?: number; transition?: number;
  fxName?: string; palName?: string;
  colors?: Record<number, number[]>;
  sx?: number; ix?: number; c1?: number; c2?: number; c3?: number;
  o1?: boolean; o2?: boolean; o3?: boolean;
  cct?: number;
}

export function applyOverrides(
  agg: AggregatedControlState,
  overrides: ControlOverrides
): AggregatedControlState {
  return {
    ...agg,
    power: overrides.power !== undefined ? (overrides.power ? 'on' : 'off') : agg.power,
    bri: overrides.bri ?? agg.bri,
    transition: overrides.transition ?? agg.transition,
    fxName: overrides.fxName ?? agg.fxName,
    palName: overrides.palName ?? agg.palName,
    colors: agg.colors.map((c, i) => overrides.colors?.[i] ?? c),
    sx: overrides.sx ?? agg.sx, ix: overrides.ix ?? agg.ix,
    c1: overrides.c1 ?? agg.c1, c2: overrides.c2 ?? agg.c2, c3: overrides.c3 ?? agg.c3,
    o1: overrides.o1 ?? agg.o1, o2: overrides.o2 ?? agg.o2, o3: overrides.o3 ?? agg.o3,
    cct: overrides.cct ?? agg.cct
  };
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/controlState.test.ts` — expect PASS (all describe blocks).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 5: pure control-state aggregation, target expansion, capability merge with real-device fixtures"`

---

## Task 6: iro.js wrapper — `client/src/components/ui/ColorWheel.tsx`

**Files:**
- Create: `client/src/components/ui/ColorWheel.tsx`
- Test: `client/src/test/components/ColorWheel.test.tsx` (create)

**Interfaces:**
- Consumes: `@jaames/iro` (`iro.ColorPicker(el, opts)` factory, `picker.on('color:change', cb)`, `picker.color.rgb`, `picker.color.set(rgb)`).
- Produces: `ColorWheel(props: { color: { r: number; g: number; b: number }; onChange: (c: { r: number; g: number; b: number }) => void; width?: number }): JSX.Element` — controlled: external `color` changes update the wheel WITHOUT re-emitting `onChange`.

**Steps:**

- [ ] Ensure the dependency exists: `cd /Users/bwwilliams/github/uber-wled/client && ls node_modules/@jaames/iro >/dev/null 2>&1 || npm install @jaames/iro`
- [ ] Write the failing test `client/src/test/components/ColorWheel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ColorWheel } from '../../components/ui/ColorWheel';

type Rgb = { r: number; g: number; b: number };
const instances: FakePicker[] = [];

class FakeColor {
  rgb: Rgb = { r: 0, g: 0, b: 0 };
  setCalls: Rgb[] = [];
  set(c: Rgb) { this.rgb = { ...c }; this.setCalls.push({ ...c }); }
}

class FakePicker {
  color = new FakeColor();
  handlers: Record<string, ((c: { rgb: Rgb }) => void)[]> = {};
  constructor(_el: HTMLElement, opts: { color: Rgb }) {
    this.color.rgb = { ...opts.color };
    instances.push(this);
  }
  on(evt: string, fn: (c: { rgb: Rgb }) => void) { (this.handlers[evt] ??= []).push(fn); }
  emitChange() { for (const fn of this.handlers['color:change'] ?? []) fn({ rgb: { ...this.color.rgb } }); }
}

vi.mock('@jaames/iro', () => ({
  default: {
    ColorPicker: (el: HTMLElement, opts: { color: Rgb }) => new FakePicker(el, opts),
    ui: { Wheel: 'wheel' }
  }
}));

describe('ColorWheel', () => {
  beforeEach(() => { instances.length = 0; });

  it('mounts one picker seeded with the color prop', () => {
    render(<ColorWheel color={{ r: 255, g: 0, b: 0 }} onChange={vi.fn()} />);
    expect(instances).toHaveLength(1);
    expect(instances[0].color.rgb).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('forwards user color changes to onChange', () => {
    const onChange = vi.fn();
    render(<ColorWheel color={{ r: 255, g: 0, b: 0 }} onChange={onChange} />);
    instances[0].color.rgb = { r: 10, g: 20, b: 30 };
    instances[0].emitChange();
    expect(onChange).toHaveBeenCalledWith({ r: 10, g: 20, b: 30 });
  });

  it('pushes external color prop changes into the picker without re-emitting onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColorWheel color={{ r: 255, g: 0, b: 0 }} onChange={onChange} />);
    rerender(<ColorWheel color={{ r: 0, g: 255, b: 0 }} onChange={onChange} />);
    expect(instances[0].color.setCalls).toContainEqual({ r: 0, g: 255, b: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('skips picker updates when the prop already matches', () => {
    const { rerender } = render(<ColorWheel color={{ r: 1, g: 2, b: 3 }} onChange={vi.fn()} />);
    rerender(<ColorWheel color={{ r: 1, g: 2, b: 3 }} onChange={vi.fn()} />);
    expect(instances[0].color.setCalls).toHaveLength(0);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ColorWheel.test.tsx` — expect FAIL: `Cannot find module '../../components/ui/ColorWheel'`.
- [ ] Create `client/src/components/ui/ColorWheel.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import iro from '@jaames/iro';

type Rgb = { r: number; g: number; b: number };

interface IroPickerLike {
  color: { rgb: Rgb; set(c: Rgb): void };
  on(evt: 'color:change', fn: (c: { rgb: Rgb }) => void): void;
}

export interface ColorWheelProps {
  color: Rgb;
  onChange: (c: Rgb) => void;
  width?: number;
}

export function ColorWheel({ color, onChange, width = 260 }: ColorWheelProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<IroPickerLike | null>(null);
  const suppressRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const createPicker = iro.ColorPicker as unknown as (
      el: HTMLElement,
      opts: Record<string, unknown>
    ) => IroPickerLike;
    const picker = createPicker(mount, {
      width,
      color,
      layout: [{ component: iro.ui.Wheel }]
    });
    picker.on('color:change', (c) => {
      if (suppressRef.current) return;
      onChangeRef.current(c.rgb);
    });
    pickerRef.current = picker;
    return () => {
      pickerRef.current = null;
      mount.innerHTML = '';
    };
    // The picker is created once; prop updates flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const current = picker.color.rgb;
    if (current.r === color.r && current.g === color.g && current.b === color.b) return;
    suppressRef.current = true;
    picker.color.set(color);
    suppressRef.current = false;
  }, [color.r, color.g, color.b]);

  return <div ref={mountRef} data-testid="color-wheel" className="color-wheel" />;
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ColorWheel.test.tsx` — expect PASS (4 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 6: controlled iro.js ColorWheel wrapper"`

---

## Task 7: Colors tab — `client/src/control/ColorTab.tsx`

**Files:**
- Create: `client/src/control/ColorTab.tsx`
- Test: `client/src/test/control/ColorTab.test.tsx` (create)

**Interfaces:**
- Consumes: `ColorWheel` (Task 6); `Slider`, `Chip`, `Button` from the Phase C kit; `kelvinToRgb`, `rgbToHex`, `hexToRgb` and `getRecentColors`, `pushRecentColor` (Task 4); `AggregatedControlState` and `FxMeta` types.
- Produces:
  - `interface ColorTabProps { agg: AggregatedControlState; fxMeta: FxMeta | null; anyRgbw: boolean; cctSupported: boolean; onColorChange: (slot: number, rgb: number[]) => void; onCctChange: (cct: number) => void }`
  - `ColorTab(props: ColorTabProps): JSX.Element` — slot swatches labeled by `fxMeta.colorLabels` (null slots hidden, `'!'` guarded to Fx/Bg/Cs, no meta ⇒ all three defaults); wheel + hex + RGB sliders edit the active slot; white slider only when `anyRgbw` (appends `[..,w]`); CCT slider only when `cctSupported`; kelvin chips 2700/3500/5000/6500 K; recent colors (12) from localStorage.
- Emitted color arrays: `[r,g,b]`, or `[r,g,b,w]` when `anyRgbw` (w preserved from the current slot value, default 0).

**Steps:**

- [ ] Write the failing test `client/src/test/control/ColorTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorTab } from '../../control/ColorTab';
import { FX_BLINK } from '../fixtures/capabilities';
import type { AggregatedControlState } from '../../control/controlState';

vi.mock('../../components/ui/ColorWheel', () => ({
  ColorWheel: ({ color }: { color: { r: number; g: number; b: number } }) => (
    <div data-testid="color-wheel-mock" data-color={`${color.r},${color.g},${color.b}`} />
  )
}));

function makeAgg(overrides: Partial<AggregatedControlState> = {}): AggregatedControlState {
  return {
    hasData: true, anyUnreachable: false, power: 'on', bri: 128,
    transition: 7, fxName: 'Blink', palName: 'Default',
    colors: [[255, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    sx: 100, ix: 50, c1: 0, c2: 0, c3: 0,
    o1: false, o2: false, o3: false, cct: 127,
    nl: { on: false, dur: 60, mode: 1, tbri: 0 },
    ...overrides
  };
}

describe('ColorTab', () => {
  beforeEach(() => localStorage.clear());

  it('shows only the slots the selected effect defines (Blink: Fx + Bg, no Cs)', () => {
    render(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={false} cctSupported={false}
      onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Fx' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bg' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cs' })).toBeNull();
  });

  it('shows all three default slots when no effect meta is available', () => {
    render(<ColorTab agg={makeAgg()} fxMeta={null} anyRgbw={false} cctSupported={false}
      onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cs' })).toBeTruthy();
  });

  it('flags a mixed active slot and feeds the wheel a neutral color', () => {
    render(<ColorTab agg={makeAgg({ colors: ['mixed', null, null] })} fxMeta={FX_BLINK}
      anyRgbw={false} cctSupported={false} onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.getByText('Mixed')).toBeTruthy();
    expect(screen.getByTestId('color-wheel-mock').getAttribute('data-color')).toBe('255,255,255');
  });

  it('applies a committed hex value to the active slot, preserving the white channel, and records a recent color', () => {
    const onColorChange = vi.fn();
    render(<ColorTab agg={makeAgg({ colors: [[10, 20, 30, 99], [0, 0, 0, 0], [0, 0, 0, 0]] })}
      fxMeta={FX_BLINK} anyRgbw={true} cctSupported={false}
      onColorChange={onColorChange} onCctChange={vi.fn()} />);
    const hex = screen.getByLabelText('hex color');
    fireEvent.change(hex, { target: { value: '#ffa757' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onColorChange).toHaveBeenCalledWith(0, [255, 167, 87, 99]);
    expect(JSON.parse(localStorage.getItem('uber-wled.recent-colors')!)).toContain('#ffa757');
  });

  it('kelvin quick chips map through kelvinToRgb', () => {
    const onColorChange = vi.fn();
    render(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={false} cctSupported={false}
      onColorChange={onColorChange} onCctChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '2700K' }));
    expect(onColorChange).toHaveBeenCalledWith(0, [255, 167, 87]);
  });

  it('renders the RGB sliders and routes edits to the active slot', () => {
    const onColorChange = vi.fn();
    render(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={false} cctSupported={false}
      onColorChange={onColorChange} onCctChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Green'), { target: { value: '200' } });
    expect(onColorChange).toHaveBeenCalledWith(0, [255, 200, 0]);
  });

  it('shows the white slider only for RGBW targets and the CCT slider only when supported', () => {
    const { rerender } = render(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={false}
      cctSupported={false} onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.queryByLabelText('White')).toBeNull();
    expect(screen.queryByLabelText('CCT')).toBeNull();
    rerender(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={true} cctSupported={true}
      onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.getByLabelText('White')).toBeTruthy();
    expect(screen.getByLabelText('CCT')).toBeTruthy();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/ColorTab.test.tsx` — expect FAIL: module not found.
- [ ] Create `client/src/control/ColorTab.tsx`:

```tsx
import { useState } from 'react';
import type { FxMeta } from '../api/client';
import type { AggregatedControlState } from './controlState';
import { ColorWheel } from '../components/ui/ColorWheel';
import { Slider } from '../components/ui/Slider';
import { Chip } from '../components/ui/Chip';
import { kelvinToRgb, rgbToHex, hexToRgb } from '../lib/color';
import { getRecentColors, pushRecentColor } from '../lib/recentColors';

const KELVIN_PRESETS = [2700, 3500, 5000, 6500] as const;
const DEFAULT_SLOT_LABELS = ['Fx', 'Bg', 'Cs'] as const;
const CHANNELS = [
  { label: 'Red', index: 0 },
  { label: 'Green', index: 1 },
  { label: 'Blue', index: 2 }
] as const;

export interface ColorTabProps {
  agg: AggregatedControlState;
  fxMeta: FxMeta | null;
  anyRgbw: boolean;
  cctSupported: boolean;
  onColorChange: (slot: number, rgb: number[]) => void;
  onCctChange: (cct: number) => void;
}

export function ColorTab({ agg, fxMeta, anyRgbw, cctSupported, onColorChange, onCctChange }: ColorTabProps) {
  const labels: (string | null)[] = (fxMeta?.colorLabels ?? [...DEFAULT_SLOT_LABELS]).map(
    (label, i) => (label === '!' ? DEFAULT_SLOT_LABELS[i] : label)
  );
  const visibleSlots = [0, 1, 2].filter((i) => labels[i] != null);

  const [activeSlotRaw, setActiveSlot] = useState(0);
  const [hexDraft, setHexDraft] = useState('');
  const [recent, setRecent] = useState<string[]>(() => getRecentColors());

  const slot = visibleSlots.includes(activeSlotRaw) ? activeSlotRaw : (visibleSlots[0] ?? 0);
  const current = agg.colors[slot];
  const rgb = Array.isArray(current) ? current : null;
  const wheelColor = rgb
    ? { r: rgb[0] ?? 0, g: rgb[1] ?? 0, b: rgb[2] ?? 0 }
    : { r: 255, g: 255, b: 255 };

  const emit = (nextRgb: number[], remember = false) => {
    const value = anyRgbw ? [...nextRgb.slice(0, 3), rgb?.[3] ?? 0] : nextRgb.slice(0, 3);
    onColorChange(slot, value);
    if (remember) setRecent(pushRecentColor(rgbToHex(value)));
  };

  const commitHex = () => {
    const parsed = hexToRgb(hexDraft);
    if (!parsed) return;
    emit(parsed, true);
    setHexDraft('');
  };

  const setChannel = (index: number, value: number) => {
    const base = rgb ? [...rgb] : [0, 0, 0];
    base[index] = value;
    emit(base);
  };

  const setWhite = (value: number) => {
    const base = rgb ? [...rgb.slice(0, 3)] : [0, 0, 0];
    onColorChange(slot, [...base, value]);
  };

  return (
    <div className="color-tab">
      <div className="slot-row">
        {visibleSlots.map((i) => {
          const slotValue = agg.colors[i];
          const swatch = Array.isArray(slotValue)
            ? `rgb(${slotValue[0] ?? 0}, ${slotValue[1] ?? 0}, ${slotValue[2] ?? 0})`
            : 'transparent';
          return (
            <button key={i} type="button"
              className={i === slot ? 'slot-swatch active' : 'slot-swatch'}
              style={{ background: swatch }}
              onClick={() => setActiveSlot(i)}>
              {labels[i]}
            </button>
          );
        })}
        {current === 'mixed' && <Chip variant="warning">Mixed</Chip>}
      </div>

      <ColorWheel color={wheelColor} onChange={(c) => emit([c.r, c.g, c.b])} />

      <div className="hex-row">
        <input aria-label="hex color" className="input" placeholder="#rrggbb"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitHex(); }}
          onBlur={() => { if (hexDraft !== '') commitHex(); }} />
      </div>

      {/* Kit Slider takes a plain number — mixed/unknown slots fall back to 128
          (write-only until the user drags; the Mixed chip above signals the state). */}
      {CHANNELS.map(({ label, index }) => (
        <Slider key={label} label={label} min={0} max={255}
          value={rgb ? (rgb[index] ?? 0) : 128}
          onChange={(v) => setChannel(index, v)} />
      ))}
      {anyRgbw && (
        <Slider label="White" min={0} max={255}
          value={rgb ? (rgb[3] ?? 0) : 128}
          onChange={setWhite} />
      )}
      {cctSupported && (
        <Slider label="CCT" min={0} max={255}
          value={typeof agg.cct === 'number' ? agg.cct : 128}
          onChange={onCctChange} />
      )}

      <div className="kelvin-chips">
        {KELVIN_PRESETS.map((kelvin) => (
          <button key={kelvin} type="button" className="kelvin-chip"
            onClick={() => emit([...kelvinToRgb(kelvin)], true)}>
            {kelvin}K
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="recent-colors">
          {recent.map((hex) => (
            <button key={hex} type="button" className="swatch" aria-label={`recent color ${hex}`}
              style={{ background: hex }}
              onClick={() => { const parsed = hexToRgb(hex); if (parsed) emit(parsed); }} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/ColorTab.test.tsx` — expect PASS (7 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 7: ColorTab with effect-driven slots, hex/RGB/white/CCT, kelvin chips, recent colors"`

---

## Task 8: Effects tab — `client/src/control/EffectsTab.tsx`

**Files:**
- Create: `client/src/control/EffectsTab.tsx`
- Test: `client/src/test/control/EffectsTab.test.tsx` (create)

**Interfaces:**
- Consumes: `SearchInput`, `Slider`, `Toggle`, `Chip` (Phase C kit); `MergedEffectEntry`, `AggregatedControlState` (Task 5).
- Produces:
  - `type EffectParamKey = 'sx' | 'ix' | 'c1' | 'c2' | 'c3'`
  - `type EffectOptionKey = 'o1' | 'o2' | 'o3'`
  - `interface EffectsTabProps { effects: MergedEffectEntry[]; agg: AggregatedControlState; onSelectEffect: (name: string) => void; onParamChange: (key: EffectParamKey, value: number) => void; onOptionChange: (key: EffectOptionKey, value: boolean) => void }`
  - `EffectsTab(props: EffectsTabProps): JSX.Element` — search + union list with id / 2D / Audio / "Not on all" badges; the selected effect (by `agg.fxName`) renders its FxMeta-driven sliders (`'!'` guarded to Effect speed / Effect intensity) and option toggles seeded from `agg`.

**Steps:**

- [ ] Write the failing test `client/src/test/control/EffectsTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EffectsTab } from '../../control/EffectsTab';
import { CAPS_A, CAPS_B } from '../fixtures/capabilities';
import { mergeEffects, type AggregatedControlState } from '../../control/controlState';
import type { ControllerCapabilities } from '../../api/client';

const caps = new Map<string, ControllerCapabilities>([['cA', CAPS_A], ['cB', CAPS_B]]);
const EFFECTS = mergeEffects(['cA', 'cB'], caps);

function makeAgg(overrides: Partial<AggregatedControlState> = {}): AggregatedControlState {
  return {
    hasData: true, anyUnreachable: false, power: 'on', bri: 128,
    transition: 7, fxName: 'Blink', palName: 'Default',
    colors: [[255, 0, 0, 0], null, null],
    sx: 100, ix: 50, c1: 0, c2: 0, c3: 0,
    o1: false, o2: false, o3: false, cct: 127,
    nl: null,
    ...overrides
  };
}

describe('EffectsTab', () => {
  it('lists union effects with 2D, Audio and Not-on-all badges from FxMeta flags', () => {
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: null })}
      onSelectEffect={vi.fn()} onParamChange={vi.fn()} onOptionChange={vi.fn()} />);
    const spaceships = screen.getByRole('button', { name: /Spaceships/ });
    expect(spaceships.textContent).toContain('2D');
    expect(spaceships.textContent).toContain('Not on all'); // only CAPS_A has it
    const pixels = screen.getByRole('button', { name: /Pixels/ });
    expect(pixels.textContent).toContain('Audio'); // flags include 'v'
    expect(screen.queryByText('RSVD')).toBeNull();
  });

  it('filters by search text', () => {
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: null })}
      onSelectEffect={vi.fn()} onParamChange={vi.fn()} onOptionChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search effects'), { target: { value: 'twink' } });
    expect(screen.getByRole('button', { name: /Colortwinkles/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Blink/ })).toBeNull();
  });

  it('applies an effect by NAME on click', () => {
    const onSelectEffect = vi.fn();
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: null })}
      onSelectEffect={onSelectEffect} onParamChange={vi.fn()} onOptionChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Colortwinkles/ }));
    expect(onSelectEffect).toHaveBeenCalledWith('Colortwinkles');
  });

  it('renders the selected effect\'s FxMeta sliders with real labels seeded from live state', () => {
    const onParamChange = vi.fn();
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: 'Blink', sx: 100, ix: 50 })}
      onSelectEffect={vi.fn()} onParamChange={onParamChange} onOptionChange={vi.fn()} />);
    const speed = screen.getByLabelText('Effect speed') as HTMLInputElement; // sx '!' → default label
    expect(speed.value).toBe('100');
    const duty = screen.getByLabelText('Duty cycle') as HTMLInputElement; // ix real label
    expect(duty.value).toBe('50');
    expect(screen.queryByLabelText('Custom 1')).toBeNull(); // Blink defines no c1
    fireEvent.change(duty, { target: { value: '80' } });
    expect(onParamChange).toHaveBeenCalledWith('ix', 80);
  });

  it('renders option toggles for effects that define them (Spaceships → Smear)', () => {
    const onOptionChange = vi.fn();
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: 'Spaceships' })}
      onSelectEffect={vi.fn()} onParamChange={vi.fn()} onOptionChange={onOptionChange} />);
    fireEvent.click(screen.getByLabelText('Smear'));
    expect(onOptionChange).toHaveBeenCalledWith('o1', true);
  });

  it('shows a mixed note and no dynamic controls when effects disagree', () => {
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: 'mixed' })}
      onSelectEffect={vi.fn()} onParamChange={vi.fn()} onOptionChange={vi.fn()} />);
    expect(screen.getByText(/different effects/)).toBeTruthy();
    expect(screen.queryByLabelText('Effect speed')).toBeNull();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/EffectsTab.test.tsx` — expect FAIL: module not found.
- [ ] Create `client/src/control/EffectsTab.tsx`:

```tsx
import { useState } from 'react';
import type { AggregatedControlState, MergedEffectEntry } from './controlState';
import { SearchInput } from '../components/ui/SearchInput';
import { Slider } from '../components/ui/Slider';
import { Toggle } from '../components/ui/Toggle';
import { Chip } from '../components/ui/Chip';

const SLIDER_KEYS = ['sx', 'ix', 'c1', 'c2', 'c3'] as const;
const OPTION_KEYS = ['o1', 'o2', 'o3'] as const;
export type EffectParamKey = (typeof SLIDER_KEYS)[number];
export type EffectOptionKey = (typeof OPTION_KEYS)[number];

const DEFAULT_SLIDER_LABELS: Record<EffectParamKey, string> = {
  sx: 'Effect speed', ix: 'Effect intensity', c1: 'Custom 1', c2: 'Custom 2', c3: 'Custom 3'
};

export interface EffectsTabProps {
  effects: MergedEffectEntry[];
  agg: AggregatedControlState;
  onSelectEffect: (name: string) => void;
  onParamChange: (key: EffectParamKey, value: number) => void;
  onOptionChange: (key: EffectOptionKey, value: boolean) => void;
}

export function EffectsTab({ effects, agg, onSelectEffect, onParamChange, onOptionChange }: EffectsTabProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q === '' ? effects : effects.filter((e) => e.name.toLowerCase().includes(q));
  const selectedName = typeof agg.fxName === 'string' ? agg.fxName : null;

  return (
    <div className="effects-tab">
      <SearchInput value={query} onChange={setQuery} placeholder="Search effects" label="Search effects" />
      {agg.fxName === 'mixed' && (
        <p className="cs-mixed-note">Targets are running different effects — pick one to sync them.</p>
      )}
      <ul className="effect-list">
        {filtered.map((effect) => {
          const selected = effect.name === selectedName;
          const flags = effect.meta?.flags ?? [];
          return (
            <li key={effect.name}>
              <button type="button"
                className={selected ? 'effect-row selected' : 'effect-row'}
                onClick={() => onSelectEffect(effect.name)}>
                <span className="effect-name">{effect.name}</span>
                <span className="effect-badges">
                  <Chip>#{effect.meta?.id ?? Object.values(effect.ids)[0]}</Chip>
                  {flags.includes('2') && <Chip>2D</Chip>}
                  {(flags.includes('v') || flags.includes('f')) && <Chip>Audio</Chip>}
                  {!effect.supportedEverywhere && <Chip variant="warning">Not on all</Chip>}
                </span>
              </button>
              {selected && effect.meta && (
                <div className="effect-controls">
                  {SLIDER_KEYS.map((key) => {
                    const label = effect.meta!.sliders[key];
                    if (label == null) return null;
                    const display = label === '!' ? DEFAULT_SLIDER_LABELS[key] : label;
                    const value = agg[key];
                    return (
                      // mixed → deterministic 128 fallback (write-only until the user drags)
                      <Slider key={key} label={display} min={0} max={255}
                        value={typeof value === 'number' ? value : 128}
                        onChange={(v) => onParamChange(key, v)} />
                    );
                  })}
                  {OPTION_KEYS.map((key) => {
                    const label = effect.meta!.options[key];
                    if (label == null) return null;
                    const value = agg[key];
                    return (
                      // mixed → shown unchecked; first tap writes true everywhere
                      <Toggle key={key} label={label}
                        checked={value === true}
                        onChange={(v) => onOptionChange(key, v)} />
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/EffectsTab.test.tsx` — expect PASS (6 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 8: EffectsTab with fxdata-driven dynamic controls and capability badges"`

---

## Task 9: Palettes tab — `client/src/control/PalettesTab.tsx`

**Files:**
- Create: `client/src/control/PalettesTab.tsx`
- Test: `client/src/test/control/PalettesTab.test.tsx` (create)

**Interfaces:**
- Consumes: `SearchInput`, `Chip` (Phase C kit); `paletteGradientCss` (Task 4); `MergedPaletteEntry`, `AggregatedControlState` (Task 5).
- Produces:
  - `interface PalettesTabProps { palettes: MergedPaletteEntry[]; agg: AggregatedControlState; onSelectPalette: (name: string) => void }`
  - `PalettesTab(props: PalettesTabProps): JSX.Element` — searchable rows with CSS linear-gradient previews; `random` previews get a "Random" badge; `slots` previews render the current slot colors from `agg.colors`; partial support gets "Not on all"; click applies by NAME.
- Testing note (per the vitest-testing-gotchas skill): jsdom's CSS engine drops `linear-gradient` values from inline styles, so the preview element carries a `data-gradient` attribute set from the SAME variable that feeds `style.background` (one line apart); tests assert `data-gradient` while `paletteGradientCss` itself is exhaustively unit-tested in Task 4.

**Steps:**

- [ ] Write the failing test `client/src/test/control/PalettesTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PalettesTab } from '../../control/PalettesTab';
import { CAPS_A, CAPS_B } from '../fixtures/capabilities';
import { mergePalettes, type AggregatedControlState } from '../../control/controlState';
import type { ControllerCapabilities } from '../../api/client';

const caps = new Map<string, ControllerCapabilities>([['cA', CAPS_A], ['cB', CAPS_B]]);
const PALETTES = mergePalettes(['cA', 'cB'], caps);

function makeAgg(overrides: Partial<AggregatedControlState> = {}): AggregatedControlState {
  return {
    hasData: true, anyUnreachable: false, power: 'on', bri: 128,
    transition: 7, fxName: 'Blink', palName: 'Default',
    colors: [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0]],
    sx: 100, ix: 50, c1: 0, c2: 0, c3: 0,
    o1: false, o2: false, o3: false, cct: 127, nl: null,
    ...overrides
  };
}

describe('PalettesTab', () => {
  it('renders gradient previews from real palx stops (Fire ends white-hot)', () => {
    render(<PalettesTab palettes={PALETTES} agg={makeAgg()} onSelectPalette={vi.fn()} />);
    const fireRow = screen.getByRole('button', { name: /Fire/ });
    const preview = fireRow.querySelector('.palette-preview')!;
    const gradient = preview.getAttribute('data-gradient')!;
    expect(gradient).toContain('linear-gradient(90deg');
    expect(gradient).toContain('rgb(255, 255, 255) 100%');
  });

  it('badges random palettes', () => {
    render(<PalettesTab palettes={PALETTES} agg={makeAgg()} onSelectPalette={vi.fn()} />);
    expect(screen.getByRole('button', { name: /\* Random Cycle/ }).textContent).toContain('Random');
  });

  it('renders slot palettes from the current slot colors', () => {
    render(<PalettesTab palettes={PALETTES} agg={makeAgg()} onSelectPalette={vi.fn()} />);
    const row = screen.getByRole('button', { name: /\* Color Gradient/ });
    const gradient = row.querySelector('.palette-preview')!.getAttribute('data-gradient')!;
    // slots ['c3','c2','c1'] → blue band, green band, red band
    expect(gradient).toBe(
      'linear-gradient(90deg, rgb(0, 0, 255) 0% 33%, rgb(0, 255, 0) 33% 67%, rgb(255, 0, 0) 67% 100%)'
    );
    expect(row.textContent).toContain('Not on all'); // CAPS_B lacks this palette
  });

  it('filters by search and applies by name', () => {
    const onSelectPalette = vi.fn();
    render(<PalettesTab palettes={PALETTES} agg={makeAgg()} onSelectPalette={onSelectPalette} />);
    fireEvent.change(screen.getByLabelText('Search palettes'), { target: { value: 'fire' } });
    expect(screen.queryByRole('button', { name: /Default/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Fire/ }));
    expect(onSelectPalette).toHaveBeenCalledWith('Fire');
  });

  it('notes mixed palettes', () => {
    render(<PalettesTab palettes={PALETTES} agg={makeAgg({ palName: 'mixed' })} onSelectPalette={vi.fn()} />);
    expect(screen.getByText(/different palettes/)).toBeTruthy();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/PalettesTab.test.tsx` — expect FAIL: module not found.
- [ ] Create `client/src/control/PalettesTab.tsx`:

```tsx
import { useState } from 'react';
import type { AggregatedControlState, MergedPaletteEntry } from './controlState';
import { SearchInput } from '../components/ui/SearchInput';
import { Chip } from '../components/ui/Chip';
import { paletteGradientCss } from '../lib/color';

export interface PalettesTabProps {
  palettes: MergedPaletteEntry[];
  agg: AggregatedControlState;
  onSelectPalette: (name: string) => void;
}

export function PalettesTab({ palettes, agg, onSelectPalette }: PalettesTabProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q === '' ? palettes : palettes.filter((p) => p.name.toLowerCase().includes(q));
  const selectedName = typeof agg.palName === 'string' ? agg.palName : null;
  const slotColors = agg.colors.map((c) => (Array.isArray(c) ? c : null));

  return (
    <div className="palettes-tab">
      <SearchInput value={query} onChange={setQuery} placeholder="Search palettes" label="Search palettes" />
      {agg.palName === 'mixed' && (
        <p className="cs-mixed-note">Targets are using different palettes — pick one to sync them.</p>
      )}
      <ul className="palette-list">
        {filtered.map((palette) => {
          const gradient = palette.preview ? paletteGradientCss(palette.preview, slotColors) : null;
          return (
            <li key={palette.name}>
              <button type="button"
                className={palette.name === selectedName ? 'palette-row selected' : 'palette-row'}
                onClick={() => onSelectPalette(palette.name)}>
                <span className="palette-preview"
                  data-gradient={gradient ?? ''}
                  style={gradient ? { background: gradient } : undefined} />
                <span className="palette-name">{palette.name}</span>
                <span className="palette-badges">
                  {palette.preview?.type === 'random' && <Chip>Random</Chip>}
                  {!palette.supportedEverywhere && <Chip variant="warning">Not on all</Chip>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/PalettesTab.test.tsx` — expect PASS (5 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 9: PalettesTab with real gradient previews, random badge, slot-color rendering"`

---

## Task 10: Presets tab — `client/src/control/PresetsTab.tsx`

**Files:**
- Create: `client/src/control/PresetsTab.tsx`
- Test: `client/src/test/control/PresetsTab.test.tsx` (create)

**Interfaces:**
- Consumes: `Chip`, `Button` (Phase C kit); `CustomTheme`, `DevicePreset` types (Task 1).
- Produces:
  - `interface PresetsTabProps { themes: CustomTheme[]; devicePresets: DevicePreset[] | null; onApplyTheme: (theme: CustomTheme) => void; onApplyDevicePreset: (preset: DevicePreset) => void }`
  - `PresetsTab(props: PresetsTabProps): JSX.Element` — themes always listed with color swatches; `devicePresets === null` (multi-controller selection) shows the single-device hint; `[]` shows the empty message; playlists get a "Playlist" chip.
- Preset-application transport decision (binding for Task 11): the master `ControlPatch` includes `ps?: number` and states "Preset APPLY has no dedicated route: it goes through POST /api/control/apply with patch { ps }". Device presets therefore apply through the **v2 fetcher** — `applyControl([{ kind: 'controller', controllerId }], { ps: preset.id })` — gated client-side to single-controller selections because preset ids are device-local. The legacy v1 preset action (`server/src/control/routes.ts:31-32`, `applyPreset`) stays untouched for the scheduler until Phase I migrates it. Cross-phase dependency: Phase B's `applyControlPatch` must pass top-level `ps` through to the device write (`WledStatePatch.ps` already exists in `server/src/wled/types.ts` per the 02 plan); if the implemented Phase B route rejects or drops `ps`, fix Phase B to match the master contract — do NOT fall back to v1 here.

**Steps:**

- [ ] Write the failing test `client/src/test/control/PresetsTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PresetsTab } from '../../control/PresetsTab';
import type { CustomTheme, DevicePreset } from '../../api/client';

const THEMES: CustomTheme[] = [
  { id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0], [80, 0, 120]], brightness: 180 }
];
const PRESETS: DevicePreset[] = [
  { id: 1, name: 'Night mode', isPlaylist: false, quicklook: { on: true, bri: 40 } },
  { id: 2, name: 'Party loop', isPlaylist: true }
];

describe('PresetsTab', () => {
  it('always lists themes and applies them via onApplyTheme', () => {
    const onApplyTheme = vi.fn();
    render(<PresetsTab themes={THEMES} devicePresets={null}
      onApplyTheme={onApplyTheme} onApplyDevicePreset={vi.fn()} />);
    expect(screen.getByText('Sunset')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply theme Sunset' }));
    expect(onApplyTheme).toHaveBeenCalledWith(THEMES[0]);
  });

  it('hints that device presets need a single device when devicePresets is null', () => {
    render(<PresetsTab themes={[]} devicePresets={null}
      onApplyTheme={vi.fn()} onApplyDevicePreset={vi.fn()} />);
    expect(screen.getByText(/single device is selected/)).toBeTruthy();
  });

  it('lists device presets with a playlist badge and applies via onApplyDevicePreset', () => {
    const onApplyDevicePreset = vi.fn();
    render(<PresetsTab themes={[]} devicePresets={PRESETS}
      onApplyTheme={vi.fn()} onApplyDevicePreset={onApplyDevicePreset} />);
    expect(screen.getByText('Night mode')).toBeTruthy();
    const partyRow = screen.getByText('Party loop').closest('li')!;
    expect(partyRow.textContent).toContain('Playlist');
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset Night mode' }));
    expect(onApplyDevicePreset).toHaveBeenCalledWith(PRESETS[0]);
  });

  it('shows the empty message for a device with no presets', () => {
    render(<PresetsTab themes={[]} devicePresets={[]}
      onApplyTheme={vi.fn()} onApplyDevicePreset={vi.fn()} />);
    expect(screen.getByText(/No presets saved on this device/)).toBeTruthy();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/PresetsTab.test.tsx` — expect FAIL: module not found.
- [ ] Create `client/src/control/PresetsTab.tsx`:

```tsx
import type { CustomTheme, DevicePreset } from '../api/client';
import { Chip } from '../components/ui/Chip';
import { Button } from '../components/ui/Button';

export interface PresetsTabProps {
  themes: CustomTheme[];
  devicePresets: DevicePreset[] | null;
  onApplyTheme: (theme: CustomTheme) => void;
  onApplyDevicePreset: (preset: DevicePreset) => void;
}

export function PresetsTab({ themes, devicePresets, onApplyTheme, onApplyDevicePreset }: PresetsTabProps) {
  return (
    <div className="presets-tab">
      <h4 className="cs-subhead">Themes</h4>
      {themes.length === 0 && (
        <p className="empty-state">No themes yet — create one in the Themes section.</p>
      )}
      <ul className="preset-list">
        {themes.map((theme) => (
          <li key={theme.id} className="preset-row">
            <span className="preset-swatches">
              {theme.colors.slice(0, 3).map((c, i) => (
                <span key={i} className="swatch"
                  style={{ background: `rgb(${c[0] ?? 0}, ${c[1] ?? 0}, ${c[2] ?? 0})` }} />
              ))}
            </span>
            <span className="preset-name">{theme.name}</span>
            <Button variant="secondary" onClick={() => onApplyTheme(theme)}
              aria-label={`Apply theme ${theme.name}`}>Apply</Button>
          </li>
        ))}
      </ul>

      <h4 className="cs-subhead">Device presets</h4>
      {devicePresets === null && (
        <p className="empty-state">Device presets are available when a single device is selected.</p>
      )}
      {devicePresets !== null && devicePresets.length === 0 && (
        <p className="empty-state">No presets saved on this device.</p>
      )}
      {devicePresets !== null && devicePresets.length > 0 && (
        <ul className="preset-list">
          {devicePresets.map((preset) => (
            <li key={preset.id} className="preset-row">
              <span className="preset-name">{preset.name}</span>
              {preset.isPlaylist && <Chip>Playlist</Chip>}
              <Button variant="secondary" onClick={() => onApplyDevicePreset(preset)}
                aria-label={`Apply preset ${preset.name}`}>Apply</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Note: the Phase C `Button` extends `ButtonHTMLAttributes<HTMLButtonElement>` and spreads `...rest` onto the underlying `<button>`, so the `aria-label` props above reach the DOM and the `getByRole('button', { name: 'Apply theme Sunset' })` queries resolve.

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/PresetsTab.test.tsx` — expect PASS (4 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 10: PresetsTab - themes always, device presets single-controller only"`

---

## Task 11: The Control surface — `client/src/control/ControlSurface.tsx` + `control.css`

**Files:**
- Create: `client/src/control/ControlSurface.tsx`, `client/src/control/control.css`
- Test: `client/src/test/control/ControlSurface.test.tsx` (create)

**Interfaces:**
- Consumes: everything above — `applyControl` (Task 1); `useControllers`, `useGroups`, `useThemes`, `useCapabilitiesMap`, `useDevicePresets` (Task 2); `useLiveStatus` (Task 3); `throttleTrailing` (Task 4); all of `controlState` (Task 5); the four tab components (Tasks 7–10); kit `Drawer`, `Tabs`, `Slider`, `Toggle`, `Chip`, `Button`, `IconButton`, `Select` (NOT the kit Toast — see the kit-contract section; failures render as an inline `.cs-failure-notice`).
- Produces (master contract, binding):
  - `interface ControlSurfaceProps { targets: Target[]; open: boolean; onClose: () => void }`
  - `ControlSurface(props: ControlSurfaceProps): JSX.Element` — used by Phases E (Home), F (Devices), G (Layout).
- Behavior contract:
  - Header: removable target chips (edits internal `localTargets`, re-seeded whenever `targets`/`open` change), master power Toggle, master brightness Slider (1–255), transition stepper (±0.1 s, WLED units), Nightlight popover (on/dur/mode/tbri → one `{ nl }` apply), Mixed chips wherever power/brightness/effect/palette disagree. Mixed controls are write-only: they render the mixed indicator until the user sets a value.
  - Writes: every gesture builds a master-shaped `ControlPatch`; continuous controls (brightness, sx/ix/c1..c3, cct, color slots) run through `throttleTrailing(…, 250)` keyed per control; discrete controls (power, transition, options, effect/palette/theme selection, nightlight) apply immediately. Optimistic overrides update the UI instantly; overrides reset when the surface (re)opens or targets change.
  - Color slot writes send a sparse `col` array — `[[r,g,b,w]]` for slot 0, `[[], [r,g,b,w]]` for slot 1, `[[], [], [r,g,b,w]]` for slot 2 (WLED keeps slots given as empty arrays).
  - Theme apply → `{ bri: theme.brightness, seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors } }` (themes store ids, not names).
  - Device preset apply → `applyControl([{ kind: 'controller', controllerId: singleControllerId }], { ps: preset.id })` (see Task 10 decision), only when the expanded selection resolves to exactly one controller.
  - Any `ApplyResult` with `ok: false` (or a rejected request) raises an inline dismissible failure notice (`.cs-failure-notice`, `role="alert"`) with an expandable per-target failure list (the kit Toast is a title/description stack API and cannot host the expandable `<details>` list).
  - Mixed handling with the real kit (no `mixed` props): mixed power renders the switch off, mixed brightness renders the slider at the 128 fallback; both are flagged by adjacent warning Chips and are write-only — the first user gesture writes a concrete value to every target.

**Steps:**

- [ ] Write the failing test `client/src/test/control/ControlSurface.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ControlSurface } from '../../control/ControlSurface';
import { CAPS_A, CAPS_B, makeSeg, makeState, liveEntry } from '../fixtures/capabilities';
import type { ControllerCapabilities, Target } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { applyControl } from '../../api/client';
import {
  useControllers, useGroups, useThemes, useCapabilitiesMap, useDevicePresets
} from '../../api/queries';
import { useLiveStatus } from '../../api/live';

vi.mock('../../api/live', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/live')>();
  return { ...actual, useLiveStatus: vi.fn() };
});
vi.mock('../../api/queries', () => ({
  useControllers: vi.fn(),
  useGroups: vi.fn(),
  useThemes: vi.fn(),
  useCapabilitiesMap: vi.fn(),
  useDevicePresets: vi.fn()
}));
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    applyControl: vi.fn(async () => ({ results: [] }))
  };
});

const CONTROLLERS = [
  { id: 'cA', name: 'Cabinet', host: '192.168.1.86', source: 'manual' as const, stale: false, pinnedAssetPattern: null },
  { id: 'cB', name: 'Porch', host: '192.168.1.87', source: 'manual' as const, stale: false, pinnedAssetPattern: null }
];
const TWO_TARGETS: Target[] = [
  { kind: 'controller', controllerId: 'cA' },
  { kind: 'controller', controllerId: 'cB' }
];

function setupMocks(live: Map<string, LiveStatusEntry>) {
  vi.mocked(useControllers).mockReturnValue({ data: CONTROLLERS } as never);
  vi.mocked(useGroups).mockReturnValue({ data: [] } as never);
  vi.mocked(useThemes).mockReturnValue({
    data: [{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }]
  } as never);
  vi.mocked(useCapabilitiesMap).mockReturnValue(
    new Map<string, ControllerCapabilities>([['cA', CAPS_A], ['cB', CAPS_B]])
  );
  vi.mocked(useDevicePresets).mockReturnValue({ data: [] } as never);
  vi.mocked(useLiveStatus).mockReturnValue(live);
}

describe('ControlSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyControl).mockResolvedValue({ results: [] });
  });

  it('shows a Mixed chip for disagreeing brightness and is write-only until the user sets a value (then optimistic + fanned out)', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0)], { bri: 10 }))],
      ['cB', liveEntry(makeState([makeSeg(0)], { bri: 200 }))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    expect(screen.getAllByText('Mixed').length).toBeGreaterThan(0);
    const slider = screen.getByLabelText('Brightness') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '150' } });
    expect(applyControl).toHaveBeenCalledWith(TWO_TARGETS, { bri: 150 });
    expect(slider.value).toBe('150'); // optimistic
  });

  it('sends a top-level power patch from the master toggle', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0, { on: false })], { on: false }))],
      ['cB', liveEntry(makeState([makeSeg(0, { on: false })], { on: false }))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Power'));
    expect(applyControl).toHaveBeenCalledWith(TWO_TARGETS, { on: true });
  });

  it('throttles rapid slider drags to the leading call (trailing fires later)', () => {
    setupMocks(new Map([['cA', liveEntry(makeState([makeSeg(0)], { bri: 10 }))]]));
    render(<ControlSurface targets={[TWO_TARGETS[0]]} open onClose={vi.fn()} />);
    const slider = screen.getByLabelText('Brightness');
    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.change(slider, { target: { value: '60' } });
    fireEvent.change(slider, { target: { value: '70' } });
    expect(applyControl).toHaveBeenCalledTimes(1); // leading edge only; trailing waits 250ms
    expect(applyControl).toHaveBeenCalledWith([TWO_TARGETS[0]], { bri: 50 });
  });

  it('removing a target chip narrows subsequent writes', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0)]))],
      ['cB', liveEntry(makeState([makeSeg(0)]))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByLabelText('Remove')[1]); // drop Porch (kit Chip remove button)
    fireEvent.click(screen.getByLabelText('Power'));
    expect(applyControl).toHaveBeenCalledWith([TWO_TARGETS[0]], expect.any(Object));
  });

  it('surfaces partial failures in an expandable toast', async () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0)]))],
      ['cB', liveEntry(makeState([makeSeg(0)]))]
    ]));
    vi.mocked(applyControl).mockResolvedValue({
      results: [
        { controllerId: 'cA', wledSegId: null, ok: true },
        { controllerId: 'cB', wledSegId: 0, ok: false, error: 'timeout' }
      ]
    });
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Power'));
    expect(await screen.findByText('1 target failed')).toBeTruthy();
    expect(screen.getByText(/cB seg 0: timeout/)).toBeTruthy();
  });

  it('applies an effect by name from the Effects tab', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0, { fx: 0 })]))],
      ['cB', liveEntry(makeState([makeSeg(0, { fx: 0 })]))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Effects' }));
    fireEvent.click(screen.getByRole('button', { name: /Colortwinkles/ }));
    expect(applyControl).toHaveBeenCalledWith(TWO_TARGETS, { seg: { fxName: 'Colortwinkles' } });
  });

  it('applies a theme as an id-based ControlPatch', () => {
    setupMocks(new Map([['cA', liveEntry(makeState([makeSeg(0)]))]]));
    render(<ControlSurface targets={[TWO_TARGETS[0]]} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply theme Sunset' }));
    expect(applyControl).toHaveBeenCalledWith(
      [TWO_TARGETS[0]],
      { bri: 180, seg: { fxId: 2, palId: 5, col: [[255, 100, 0]] } }
    );
  });

  it('gates device presets on a single-controller selection and applies a { ps } patch via v2', () => {
    setupMocks(new Map([['cA', liveEntry(makeState([makeSeg(0)]))]]));
    vi.mocked(useDevicePresets).mockReturnValue({
      data: [{ id: 3, name: 'Night', isPlaylist: false }]
    } as never);
    render(<ControlSurface targets={[TWO_TARGETS[0]]} open onClose={vi.fn()} />);
    expect(useDevicePresets).toHaveBeenLastCalledWith('cA');
    fireEvent.click(screen.getByRole('tab', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset Night' }));
    expect(applyControl).toHaveBeenCalledWith(
      [{ kind: 'controller', controllerId: 'cA' }],
      { ps: 3 }
    );
  });

  it('passes null to useDevicePresets for multi-controller selections', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0)]))],
      ['cB', liveEntry(makeState([makeSeg(0)]))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    expect(useDevicePresets).toHaveBeenLastCalledWith(null);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/ControlSurface.test.tsx` — expect FAIL: `Cannot find module '../../control/ControlSurface'`.
- [ ] Create `client/src/control/control.css`:

```css
/* Control surface — uses Phase C design tokens (design/tokens.css). */
.control-surface { display: flex; flex-direction: column; gap: 16px; height: 100%; }

.cs-header { display: flex; flex-direction: column; gap: 12px; }
.cs-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.cs-row { display: flex; align-items: center; gap: 12px; }
.cs-mixed-note { color: var(--warning); font-size: 0.85rem; margin: 4px 0; }
.cs-subhead { color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase;
  letter-spacing: 0.06em; margin: 12px 0 4px; }

.transition-stepper { gap: 8px; }
.transition-value { min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
.control-label { color: var(--text-muted); font-size: 0.85rem; }

.nl-popover { position: absolute; z-index: 30; margin-top: 8px; padding: 16px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius-card); display: flex; flex-direction: column; gap: 12px;
  min-width: 260px; }
.cs-row:has(.nl-popover) { position: relative; }

.cs-tab-body { flex: 1; overflow-y: auto; padding-bottom: 24px; }

.effect-list, .palette-list, .preset-list { list-style: none; margin: 8px 0 0; padding: 0;
  display: flex; flex-direction: column; gap: 4px; }
.effect-row, .palette-row { display: flex; align-items: center; gap: 10px; width: 100%;
  min-height: 44px; padding: 8px 12px; background: transparent; border: 1px solid transparent;
  border-radius: var(--radius-control); color: var(--text); text-align: left; cursor: pointer; }
.effect-row:hover, .palette-row:hover { background: var(--surface-2); }
.effect-row.selected, .palette-row.selected { border-color: var(--accent);
  background: var(--accent-soft); }
.effect-name, .palette-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.effect-badges, .palette-badges { display: flex; gap: 6px; flex-shrink: 0; }
.effect-controls { padding: 8px 12px 16px; display: flex; flex-direction: column; gap: 10px; }

.palette-preview { width: 72px; height: 20px; border-radius: 6px; flex-shrink: 0;
  border: 1px solid var(--border); }

.preset-row { display: flex; align-items: center; gap: 10px; min-height: 44px;
  padding: 6px 12px; border-radius: var(--radius-control); }
.preset-row:hover { background: var(--surface-2); }
.preset-name { flex: 1; }
.preset-swatches { display: flex; gap: 4px; }

.color-tab { display: flex; flex-direction: column; gap: 14px; align-items: stretch; }
.color-wheel { align-self: center; }
.slot-row { display: flex; gap: 8px; align-items: center; }
.slot-swatch { min-width: 56px; min-height: 40px; border-radius: var(--radius-control);
  border: 2px solid var(--border); color: var(--text); font-size: 0.8rem; cursor: pointer;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7); }
.slot-swatch.active { border-color: var(--accent); }
.hex-row { display: flex; gap: 8px; }
.kelvin-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.kelvin-chip { min-height: 40px; padding: 0 14px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text);
  cursor: pointer; }
.kelvin-chip:hover { border-color: var(--accent); }
.recent-colors { display: flex; gap: 6px; flex-wrap: wrap; }
.swatch { width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--border);
  cursor: pointer; padding: 0; }

.cs-toast-msg { font-weight: 600; margin: 0; }
.cs-toast-details summary { cursor: pointer; color: var(--text-muted); }
.cs-toast-details ul { margin: 6px 0 0; padding-left: 18px; }

@media (max-width: 900px) {
  .palette-preview { width: 56px; }
}
```

- [ ] Create `client/src/control/ControlSurface.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyControl,
  type ApplyResult, type ControlPatch, type CustomTheme, type DevicePreset, type Target
} from '../api/client';
import {
  useCapabilitiesMap, useControllers, useDevicePresets, useGroups, useThemes
} from '../api/queries';
import { useLiveStatus } from '../api/live';
import {
  aggregateControlState, applyOverrides, expandTargets, mergeEffects, mergePalettes,
  targetControllerIds, type ControlOverrides
} from './controlState';
import { throttleTrailing, type Throttled } from '../lib/throttle';
import { Drawer } from '../components/ui/Drawer';
import { Tabs } from '../components/ui/Tabs';
import { Slider } from '../components/ui/Slider';
import { Toggle } from '../components/ui/Toggle';
import { Chip } from '../components/ui/Chip';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Select } from '../components/ui/Select';
import { ColorTab } from './ColorTab';
import { EffectsTab, type EffectOptionKey, type EffectParamKey } from './EffectsTab';
import { PalettesTab } from './PalettesTab';
import { PresetsTab } from './PresetsTab';
import './control.css';

const TABS = [
  { id: 'colors', label: 'Colors' },
  { id: 'effects', label: 'Effects' },
  { id: 'palettes', label: 'Palettes' },
  { id: 'presets', label: 'Presets' }
];

const NL_MODES: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: 'Instant' },
  { value: 1, label: 'Fade' },
  { value: 2, label: 'Color fade' },
  { value: 3, label: 'Sunrise' }
];

const THROTTLE_MS = 250; // ≤ 4 writes/sec per control

export interface ControlSurfaceProps {
  targets: Target[];
  open: boolean;
  onClose: () => void;
}

export function ControlSurface({ targets, open, onClose }: ControlSurfaceProps) {
  const { data: controllers = [] } = useControllers();
  const { data: groups = [] } = useGroups();
  const { data: themes = [] } = useThemes();

  const [localTargets, setLocalTargets] = useState<Target[]>(targets);
  useEffect(() => { setLocalTargets(targets); }, [targets, open]);
  const localTargetsRef = useRef(localTargets);
  localTargetsRef.current = localTargets;

  const controllerIds = useMemo(
    () => targetControllerIds(localTargets, groups),
    [localTargets, groups]
  );
  const live = useLiveStatus(open ? controllerIds : []);
  const caps = useCapabilitiesMap(controllerIds);

  const [overrides, setOverrides] = useState<ControlOverrides>({});
  useEffect(() => { setOverrides({}); }, [open, localTargets]);

  const agg = useMemo(
    () => aggregateControlState(localTargets, groups, live, caps),
    [localTargets, groups, live, caps]
  );
  const eff = useMemo(() => applyOverrides(agg, overrides), [agg, overrides]);

  const effects = useMemo(() => mergeEffects(controllerIds, caps), [controllerIds, caps]);
  const palettes = useMemo(() => mergePalettes(controllerIds, caps), [controllerIds, caps]);
  const selectedFxMeta = typeof eff.fxName === 'string'
    ? (effects.find((e) => e.name === eff.fxName)?.meta ?? null)
    : null;

  const anyRgbw = controllerIds.some((id) => live.get(id)?.info?.leds.rgbw === true);
  const cctSupported = controllerIds.some((id) => {
    const cct = live.get(id)?.info?.leds.cct;
    return cct === true || (typeof cct === 'number' && cct > 0);
  });

  const expanded = useMemo(
    () => expandTargets(localTargets, groups, live),
    [localTargets, groups, live]
  );
  const singleControllerId =
    expanded.length > 0 && expanded.every((t) => t.controllerId === expanded[0].controllerId)
      ? expanded[0].controllerId
      : null;
  const { data: devicePresets } = useDevicePresets(singleControllerId);

  const [failures, setFailures] = useState<ApplyResult[] | null>(null);
  const [activeTab, setActiveTab] = useState('colors');
  const [nlOpen, setNlOpen] = useState(false);
  const [nlDraft, setNlDraft] = useState<{ on: boolean; dur: number; mode: 0 | 1 | 2 | 3; tbri: number }>(
    { on: false, dur: 60, mode: 1, tbri: 0 }
  );
  useEffect(() => { if (agg.nl) setNlDraft(agg.nl); }, [agg.nl]);

  const doApply = useCallback((patch: ControlPatch, targetsOverride?: Target[]) => {
    applyControl(targetsOverride ?? localTargetsRef.current, patch)
      .then(({ results }) => {
        const failed = results.filter((r) => !r.ok);
        if (failed.length > 0) setFailures(failed);
      })
      .catch((err: Error) => {
        setFailures([{ controllerId: '(request)', wledSegId: null, ok: false, error: err.message }]);
      });
  }, []);

  const throttlersRef = useRef(new Map<string, Throttled<[ControlPatch]>>());
  useEffect(() => {
    const throttlers = throttlersRef.current;
    return () => {
      for (const throttler of throttlers.values()) throttler.cancel();
      throttlers.clear();
    };
  }, []);
  const applyThrottled = useCallback((key: string, patch: ControlPatch) => {
    let throttler = throttlersRef.current.get(key);
    if (!throttler) {
      throttler = throttleTrailing((p: ControlPatch) => doApply(p), THROTTLE_MS);
      throttlersRef.current.set(key, throttler);
    }
    throttler.call(patch);
  }, [doApply]);

  const override = (patch: ControlOverrides) => setOverrides((prev) => ({ ...prev, ...patch }));

  const setPower = (on: boolean) => { override({ power: on }); doApply({ on }); };
  const setBri = (bri: number) => { override({ bri }); applyThrottled('bri', { bri }); };
  const setTransition = (transition: number) => { override({ transition }); doApply({ transition }); };
  const selectEffect = (fxName: string) => { override({ fxName }); doApply({ seg: { fxName } }); };
  const selectPalette = (palName: string) => { override({ palName }); doApply({ seg: { palName } }); };
  const setParam = (key: EffectParamKey, value: number) => {
    override({ [key]: value });
    applyThrottled(key, { seg: { [key]: value } });
  };
  const setOption = (key: EffectOptionKey, value: boolean) => {
    override({ [key]: value });
    doApply({ seg: { [key]: value } });
  };
  const setCct = (cct: number) => { override({ cct }); applyThrottled('cct', { seg: { cct } }); };
  const setSlotColor = (slot: number, rgb: number[]) => {
    override({ colors: { ...overrides.colors, [slot]: rgb } });
    const col: number[][] = [[], [], []];
    col[slot] = rgb;
    applyThrottled(`col${slot}`, { seg: { col: col.slice(0, slot + 1) } });
  };
  const applyTheme = (theme: CustomTheme) => {
    override({ bri: theme.brightness });
    doApply({ bri: theme.brightness, seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors } });
  };
  const applyDevicePreset = (preset: DevicePreset) => {
    // Device preset ids are device-local, so the surface gates preset apply
    // to single-controller selections and sends the master's ControlPatch.ps
    // through the v2 route as a whole-controller target (no dedicated
    // preset-apply route exists — see master contract).
    if (singleControllerId === null) return;
    doApply({ ps: preset.id }, [{ kind: 'controller', controllerId: singleControllerId }]);
  };
  const applyNightlight = () => { doApply({ nl: nlDraft }); setNlOpen(false); };
  const removeTarget = (index: number) =>
    setLocalTargets((prev) => prev.filter((_, i) => i !== index));

  const targetLabel = (target: Target): string => {
    if (target.kind === 'group') return groups.find((g) => g.id === target.groupId)?.name ?? 'Room';
    const name = controllers.find((c) => c.id === target.controllerId)?.name ?? target.controllerId;
    return target.kind === 'segment' ? `${name} · seg ${target.wledSegId}` : name;
  };

  const transitionUnits = typeof eff.transition === 'number' ? eff.transition : 7;
  const failureCount = failures?.length ?? 0;

  return (
    <Drawer open={open} onClose={onClose} title="Control">
      <div className="control-surface">
        <div className="cs-header">
          <div className="cs-chips">
            {localTargets.map((target, i) => (
              <Chip key={`${targetLabel(target)}-${i}`} onRemove={() => removeTarget(i)}>
                {targetLabel(target)}
              </Chip>
            ))}
            {agg.anyUnreachable && <Chip variant="warning">Some targets offline</Chip>}
          </div>
          <div className="cs-row">
            {/* mixed power renders the switch off (write-only); the chip flags it */}
            <Toggle label="Power" checked={eff.power === 'on'} onChange={setPower} />
            {eff.power === 'mixed' && <Chip variant="warning">Mixed</Chip>}
          </div>
          <div className="cs-row">
            {/* mixed brightness → deterministic 128 fallback until the user drags */}
            <Slider label="Brightness" min={1} max={255}
              value={typeof eff.bri === 'number' ? eff.bri : 128}
              onChange={setBri} />
            {eff.bri === 'mixed' && <Chip variant="warning">Mixed</Chip>}
          </div>
          <div className="cs-row transition-stepper">
            <span className="control-label">Transition</span>
            <IconButton label="decrease transition"
              onClick={() => setTransition(Math.max(0, transitionUnits - 1))}>−</IconButton>
            <span className="transition-value">{(transitionUnits / 10).toFixed(1)}s</span>
            <IconButton label="increase transition"
              onClick={() => setTransition(Math.min(650, transitionUnits + 1))}>+</IconButton>
            {eff.fxName === 'mixed' && <Chip variant="warning">Mixed effects</Chip>}
            {eff.palName === 'mixed' && <Chip variant="warning">Mixed palettes</Chip>}
          </div>
          <div className="cs-row">
            <Button variant="secondary" onClick={() => setNlOpen((v) => !v)}>Nightlight</Button>
            {nlOpen && (
              <div className="nl-popover">
                <Toggle label="Nightlight on" checked={nlDraft.on}
                  onChange={(on) => setNlDraft({ ...nlDraft, on })} />
                <label className="control-label">
                  Duration (min)
                  <input type="number" min={1} max={255} value={nlDraft.dur} className="input"
                    onChange={(e) => setNlDraft({ ...nlDraft, dur: Number(e.target.value) })} />
                </label>
                <Select label="Mode" value={String(nlDraft.mode)}
                  options={NL_MODES.map((m) => ({ value: String(m.value), label: m.label }))}
                  onChange={(v) => setNlDraft({ ...nlDraft, mode: Number(v) as 0 | 1 | 2 | 3 })} />
                <Slider label="Target brightness" min={0} max={255} value={nlDraft.tbri}
                  onChange={(tbri) => setNlDraft({ ...nlDraft, tbri })} />
                <Button onClick={applyNightlight}>Apply nightlight</Button>
              </div>
            )}
          </div>
        </div>

        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
        <div className="cs-tab-body">
          {activeTab === 'colors' && (
            <ColorTab agg={eff} fxMeta={selectedFxMeta} anyRgbw={anyRgbw} cctSupported={cctSupported}
              onColorChange={setSlotColor} onCctChange={setCct} />
          )}
          {activeTab === 'effects' && (
            <EffectsTab effects={effects} agg={eff}
              onSelectEffect={selectEffect} onParamChange={setParam} onOptionChange={setOption} />
          )}
          {activeTab === 'palettes' && (
            <PalettesTab palettes={palettes} agg={eff} onSelectPalette={selectPalette} />
          )}
          {activeTab === 'presets' && (
            <PresetsTab themes={themes}
              devicePresets={singleControllerId !== null ? (devicePresets ?? []) : null}
              onApplyTheme={applyTheme} onApplyDevicePreset={applyDevicePreset} />
          )}
        </div>

        <Toast open={failures !== null} onClose={() => setFailures(null)}>
          <p className="cs-toast-msg">
            {`${failureCount} ${failureCount === 1 ? 'target' : 'targets'} failed`}
          </p>
          <details className="cs-toast-details">
            <summary>Details</summary>
            <ul>
              {(failures ?? []).map((failure, i) => (
                <li key={i}>
                  {failure.controllerId}
                  {failure.wledSegId != null ? ` seg ${failure.wledSegId}` : ''}
                  {': '}
                  {failure.error ?? 'unknown error'}
                </li>
              ))}
            </ul>
          </details>
        </Toast>
      </div>
    </Drawer>
  );
}
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/control/ControlSurface.test.tsx` — expect PASS (9 tests). If a kit prop mismatch surfaces here (e.g. `Toggle` renders a `button role="switch"` instead of a checkbox), fix the ControlSurface call site / test query per the kit-contract preflight — never the kit semantics.
- [ ] Run the full client suite and build: `cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build` — expect both green.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "Phase D task 11: ControlSurface with header controls, 4 tabs, optimistic throttled writes, partial-failure toast"`

---

## Phase completion gate

- `cd /Users/bwwilliams/github/uber-wled/client && npm test` — all green.
- `cd /Users/bwwilliams/github/uber-wled/client && npm run build` — green.
- `cd /Users/bwwilliams/github/uber-wled/server && npm test` — green (this phase touches no server code; run to prove it).
- No version bumps in this phase: master reserves `1.0.0` for Phase I.
- Optional live smoke (state-level only, per hardware policy): with the dev servers running and a real controller registered, open the Control surface, capture the device state via `GET http://192.168.1.86/json/state`, change brightness once, verify the SSE-driven UI reflects it, then restore the captured `on`/`bri` values through the same UI. No config/preset/reboot writes.
