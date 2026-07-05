# Phase F — Devices Section: List + Detail (Info / Segments / Presets / Config / Update)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Replace the old Controllers screen with a Devices section: a live-status card list per controller plus a per-device detail page with Info, Segments, Presets, Config (structured forms + dry-run diff-and-confirm), and Update tabs.

**Architecture:** Pure client work under `client/src/sections/devices/` consuming Phase B's device-management routes (presets CRUD, `config?dryRun=1`, reboot, widened/CRUD segments), Phase C's `components/ui/*` kit + react-query setup, and Phase D's `ControlSurface` + `useLiveStatus` SSE hook. All config safety lives client-side: every save runs the server dry-run first and renders a `DiffConfirmModal` with per-path `{path, from, to}` rows, a reboot-required banner, and a strand-the-device warning for WiFi/GPIO paths. Patch construction is isolated in pure, unit-tested builder functions (`configPatches.ts`) that **merge into the probed cfg rows rather than replacing them**, so unknown device fields survive every save.

**Tech Stack:** React + TypeScript + Vite (repo is on React 19.2); `@tanstack/react-query` (installed in Phase C); Vitest + Testing Library (jsdom); plain CSS on Phase C design tokens. No new dependencies.

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
- Versions: client and server both become `1.0.0` in Phase I (not before) —
  this phase does NOT bump any version field.

## Binding contracts consumed (verbatim from 00-master.md)

Server routes (Phase B ships these; this phase only calls them):

```
GET    /api/controllers/:id/capabilities → ControllerCapabilities (503 {error} if never fetched & device unreachable)
GET    /api/controllers/:id/presets      → { presets: { id:number, name:string, isPlaylist:boolean, quicklook?: {fx?:number,pal?:number,on?:boolean,bri?:number} }[] }
POST   /api/controllers/:id/presets      → body { id?:number, name:string, includeBrightness:boolean, saveSegmentBounds:boolean } (id omitted = next free slot 1-250)
// Preset APPLY has no dedicated route: it goes through POST /api/control/apply
// with patch { ps } (see ControlPatch.ps); scheduler v1 'preset' actions map to it too.
DELETE /api/controllers/:id/presets/:pid
GET    /api/controllers/:id/config       → raw cfg.json passthrough
POST   /api/controllers/:id/config?dryRun=1 → body { patch: object } → { diff: {path:string, from:unknown, to:unknown}[], rebootRequired: boolean }
POST   /api/controllers/:id/config       → body { patch: object } → { ok:true, rebootRequired:boolean }
POST   /api/controllers/:id/reboot       → { ok: true }
```

`rebootRequired` = any diff path starts with `hw.`, `nw.`, `ap.`, or `eth.`.
Diff paths are dot-joined (`hw.led.ins.0.pin.0`).

Master `ControlPatch` (mirrored on the client in `client/src/api/client.ts`; note `ps` —
the master's device-preset apply field, which Phase F's Presets tab uses):

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

Segments routes (Phase B `02-server-control-live.md` Task 11 — BINDING, note the
body field is `name`, not `n`; the server maps `name → n` on the device write):

```
GET    /api/controllers/:id/segments        → 200 WledSegment[]
PUT    /api/controllers/:id/segments/:segId → body { start?, stop?, grp?, spc?, of?, rev?, mi?, name?, on?, bri? } → 200 WledSegment[]
POST   /api/controllers/:id/segments        → body { start:number, stop:number } → 201 WledSegment[] (server picks next free seg id)
DELETE /api/controllers/:id/segments/:segId → 200 WledSegment[]  (server sends stop:0 to the device)
```

Firmware routes (already shipped, `server/src/firmware/routes.ts:15,75,82`):
`GET /api/controllers/:id/firmware` → `FirmwareStatus`, `POST .../firmware/pin`
body `{assetPattern}` → 204, `POST .../firmware/update` → `{ ok, installedVersion?, error? }`.

Phase D client modules (per master client-structure contract, now shipped by `04-control-surface.md`):

```ts
// client/src/control/ControlSurface.tsx  (04 Task 11)
export interface ControlSurfaceProps { targets: Target[]; open: boolean; onClose: () => void }
export function ControlSurface(props: ControlSurfaceProps): JSX.Element;

// client/src/api/client.ts  (04 Task 1)
export type Target =
  | { kind: 'controller'; controllerId: string }
  | { kind: 'segment'; controllerId: string; wledSegId: number }
  | { kind: 'group'; groupId: string };
export interface DevicePreset { id: number; name: string; isPlaylist: boolean;
  quicklook?: { fx?: number; pal?: number; on?: boolean; bri?: number } }
export const listDevicePresets: (controllerId: string) => Promise<DevicePreset[]>; // unwraps { presets }

// client/src/api/client.ts  (04 Task 1)
export const applyControl: (targets: Target[], patch: ControlPatch) => Promise<{ results: ApplyResult[] }>;

// client/src/api/live.ts  (04 Task 3)
export interface LiveStatusEntry { reachable: boolean; state?: LiveState; info?: LiveInfo }
export function useLiveStatus(controllerIds: string[]): Map<string, LiveStatusEntry>;

// client/src/api/queries.ts  (04 Task 2)
export function useControllers(): UseQueryResult<Controller[]>;                   // key ['controllers']
export function useDevicePresets(controllerId: string | null): UseQueryResult<DevicePreset[]>; // key ['presets', id]
```

react-query keys used by this phase (master binds `['controllers']`, `['presets',id]`,
`['config',id]`, `['status',id]`; this phase additionally uses `['firmware',id]` and
`['segments',id]` — `['firmware',id]` matches the exact hook Phase H's Task 1 drift-checks for).

## Verified Phase C kit interfaces (from 03-client-foundation.md — reconcile at execution time)

These are quoted from the Phase C plan's actual component code (not assumptions). If the
shipped kit drifted, **the kit is authoritative** — adapt call sites here, never the kit.

```ts
// Button.tsx — extends ButtonHTMLAttributes (aria-label, type, disabled all forward)
Button({ variant?: 'primary'|'secondary'|'ghost'|'danger'; size?: 'md'|'sm'; ...rest })
IconButton({ label: string; ...rest })                    // renders aria-label={label}
Card({ className?, ...rest })                             // div.ui-card
Chip({ children; variant?: 'default'|'accent'|'success'|'danger'|'warning'; onRemove? })
Field({ label: string; hint?; error?; htmlFor?; children })  // error renders role="alert"
Skeleton({ width?; height?; radius? })
Slider({ value; min?=0; max?=255; step?=1; label: string; disabled?; fillColor?;
         onChange(v: number): void; onCommit?(v: number): void })
Toggle({ checked; onChange(checked: boolean): void; label: string; disabled? }) // role="switch"
Tabs({ tabs: { id: string; label: string }[]; active: string; onChange(id): void; label?: string })
SegmentedControl({ options: { value: string; label: string }[]; value; onChange(v): void; label: string })
SearchInput({ value; onChange(v): void; placeholder?; label? })
Select({ value: string; onChange(v: string): void; options: { value: string; label: string }[];
         label?; id?; disabled? })
Modal({ open; onClose(): void; title: string; children; footer?: ReactNode })   // portal
Drawer({ open; onClose(): void; title?; children; className? })
useToast(): { show(opts: { title: string; description?: string; variant?: 'info'|'success'|'error';
                           duration?: number; action?: { label: string; onClick(): void } }): void }
ToastProvider({ children })   // mounted once in main.tsx by Phase C
```

Text inputs have no kit component — use `<input className="input" />` inside `Field`
(the Phase C global stylesheet styles `.input`; Phase E uses the same pattern).

## Routing contract this phase produces (BINDING for Phase H)

- `#/devices` — Devices list.
- `#/devices/<controllerId>` — device detail, Info tab.
- `#/devices/<controllerId>/<tab>` — tab ∈ `info | segments | presets | config | update`.
- `client/src/components/AppShell.tsx`'s `sectionFromHash` maps the **first** hash path
  segment to the section, so `#/devices/c1/update` keeps Devices active (Phase H's
  Firmware fleet view deep-links to `#/devices/<id>/update`).

## Real-device fixture data

All fixture values in this plan were probed read-only from the real controller at
`http://192.168.1.86` (re-verified 2026-07-05: WLED 16.0.0 "Niji", vid 2605030, esp32,
48 RGBW LEDs, two outputs on GPIO 16 and 3, type 30, order 34, `wifi.signal` 98,
channel 6, uptime 2791487 s, freeheap 120876, fs 28/983 KiB, usermod AudioReactive).
Never POST to this device from tests — device I/O is always `vi.stubGlobal('fetch', …)`
or module mocks (see the vitest-testing-gotchas skill; never nock).

**LED output `type` ids** (verified: probed `hw.led.ins[*].type === 30` on an SK6812
RGBW strip with `info.leds.rgbw === true`; remaining ids from WLED `const.h`):

| id | chip | id | chip |
|----|------|----|------|
| 22 | WS281x (WS2812/WS2815 RGB) | 25 | TM1829 |
| 30 | SK6812 / WS2814 RGBW | 26 | UCS8903 (16-bit RGB) |
| 31 | TM1814 (RGBW) | 29 | UCS8904 (16-bit RGBW) |
| 24 | WS2811 400kHz | 50 | WS2801 (SPI) |
| 18 | WS2812 single-white | 51 | APA102 / SK9822 (SPI) |
| 20 | WS2812 CCT | 52 | LPD8806 (SPI) |
| 21 | WS2812 WWA | 53 | P9813 (SPI) |
| 27 | APA106 | 54 | LPD6803 (SPI) |

**`order` byte encoding** (verified on probe: `order: 34` = `0x22`): low nibble = color
order (0 GRB, 1 RGB, 2 BRG, 3 RBG, 4 BGR, 5 GBR), high nibble = white-channel swap.
This phase edits only the low nibble and preserves the high nibble verbatim.

**Per-output `rgbwm` (auto-white)**: 0 None, 1 Brighter, 2 Accurate (probed value),
3 Dual, 4 Max. Global `hw.led.rgbwm` is 255 on the probe (= "use per-bus setting")
and is never written by this phase.

**Probed cfg.json subset** (becomes the shared test fixture in Task 3): `id` {mdns
`cabinet-lights`, name `Cabinet Lights`}, `nw.ins[0]` {ssid `Williams`, pskl 10,
ip/gw `[0,0,0,0]`, sn `[255,255,255,0]`}, `ap` {ssid `WLED-AP`, chan 1, hide 0},
`hw.led` {total 48, maxpwr 0, rgbwm 255, ins ×2 with per-row `ledma: 55`, `freq: 0`,
`ref: false` that MUST survive saves}, `light` {'scale-bri' 100, gc {bri 1, col 2.8,
val 2.8}, tr {dur 7, rpc 5, hrp true}}, `def` {ps 1, on false, bri 128}, `if.sync`
{port0 21324, port1 65506, recv {bri,col,fx,pal true, grp 1, seg,sb false}, send
{en false, dir true, hue true, grp 1}}, `if.ntp` {en true, host `0.wled.pool.ntp.org`,
tz 5, offset 0, ampm false, ln -96.78, lt 33.24}, `um.AudioReactive` (unknown keys —
must be tolerated and never clobbered).

---

## Task 1: Pure helpers — uptime/signal formatting + segment validation

**Files:**
- Create: `client/src/sections/devices/format.ts`
- Create: `client/src/sections/devices/segmentLogic.ts`
- Test: `client/src/test/devices/format.test.ts`
- Test: `client/src/test/devices/segmentLogic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `humanizeUptime(seconds: number): string`, `signalBars(signal: number): 0|1|2|3|4`, `validateSegmentBounds(start: number, stop: number, ledCount: number): string | null`, `nextFreeSegmentId(segments: {id:number}[], maxSeg: number): number | null`.

**Steps:**

- [ ] Write the failing tests:

```ts
// client/src/test/devices/format.test.ts
import { describe, it, expect } from 'vitest';
import { humanizeUptime, signalBars } from '../../sections/devices/format';

describe('humanizeUptime', () => {
  it('renders bare seconds under a minute', () => expect(humanizeUptime(45)).toBe('45s'));
  it('renders minutes under an hour', () => expect(humanizeUptime(300)).toBe('5m'));
  it('renders hours + minutes under a day', () => expect(humanizeUptime(3720)).toBe('1h 2m'));
  it('renders days + hours (real probed uptime 2791487s)', () =>
    expect(humanizeUptime(2791487)).toBe('32d 7h'));
});

describe('signalBars', () => {
  it('maps the real probed signal 98 to 4 bars', () => expect(signalBars(98)).toBe(4));
  it('maps 65 to 3 bars', () => expect(signalBars(65)).toBe(3));
  it('maps 45 to 2 bars', () => expect(signalBars(45)).toBe(2));
  it('maps 10 to 1 bar', () => expect(signalBars(10)).toBe(1));
  it('maps 0 to 0 bars', () => expect(signalBars(0)).toBe(0));
});
```

```ts
// client/src/test/devices/segmentLogic.test.ts
import { describe, it, expect } from 'vitest';
import { validateSegmentBounds, nextFreeSegmentId } from '../../sections/devices/segmentLogic';

describe('validateSegmentBounds', () => {
  it('accepts the real probed segment 0..39 on a 48-LED device', () =>
    expect(validateSegmentBounds(0, 39, 48)).toBeNull());
  it('accepts a segment ending exactly at the LED count', () =>
    expect(validateSegmentBounds(39, 48, 48)).toBeNull());
  it('rejects negative start', () =>
    expect(validateSegmentBounds(-1, 10, 48)).toMatch(/0 or greater/i));
  it('rejects stop <= start', () =>
    expect(validateSegmentBounds(10, 10, 48)).toMatch(/greater than start/i));
  it('rejects stop beyond the LED count', () =>
    expect(validateSegmentBounds(0, 49, 48)).toMatch(/48/));
  it('rejects non-integers', () =>
    expect(validateSegmentBounds(0.5, 10, 48)).toMatch(/whole numbers/i));
});

describe('nextFreeSegmentId', () => {
  it('returns the next id after the real probed segments 0 and 1', () =>
    expect(nextFreeSegmentId([{ id: 0 }, { id: 1 }], 32)).toBe(2));
  it('fills gaps first', () =>
    expect(nextFreeSegmentId([{ id: 0 }, { id: 2 }], 32)).toBe(1));
  it('returns null when all slots are used', () => {
    const all = Array.from({ length: 32 }, (_, i) => ({ id: i }));
    expect(nextFreeSegmentId(all, 32)).toBeNull();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/format.test.ts src/test/devices/segmentLogic.test.ts` → expect FAIL: `Failed to resolve import "../../sections/devices/format"`.
- [ ] Implement:

```ts
// client/src/sections/devices/format.ts
export function humanizeUptime(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** WLED info.wifi.signal is 0-100 (probed: 98). */
export function signalBars(signal: number): 0 | 1 | 2 | 3 | 4 {
  if (signal >= 80) return 4;
  if (signal >= 60) return 3;
  if (signal >= 40) return 2;
  if (signal > 0) return 1;
  return 0;
}
```

```ts
// client/src/sections/devices/segmentLogic.ts
/** Returns an error message, or null when 0 <= start < stop <= ledCount. */
export function validateSegmentBounds(start: number, stop: number, ledCount: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(stop)) return 'Start and stop must be whole numbers';
  if (start < 0) return 'Start must be 0 or greater';
  if (stop <= start) return 'Stop must be greater than start';
  if (stop > ledCount) return `Stop cannot exceed the LED count (${ledCount})`;
  return null;
}

/** Smallest unused WLED segment id, or null when maxSeg slots are all taken. */
export function nextFreeSegmentId(segments: { id: number }[], maxSeg: number): number | null {
  const used = new Set(segments.map((s) => s.id));
  for (let i = 0; i < maxSeg; i++) if (!used.has(i)) return i;
  return null;
}
```

- [ ] Run the same command again → expect PASS (14 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: pure uptime/signal formatting and segment validation helpers"`

---

## Task 2: API client — config dry-run/apply, reboot, segment CRUD, preset save/delete + device query hooks

**Files:**
- Modify: `client/src/api/client.ts` (append at end; plus two guarded one-line edits, see steps)
- Modify: `client/src/api/live.ts` (widen `LiveInfo` with optional info fields — additive only)
- Modify: `client/src/api/queries.ts` (append three hooks)
- Test: `client/src/test/devices/apiClient.test.ts`

**Interfaces:**
- Consumes: existing `getJson`/`sendJson` helpers in `client/src/api/client.ts:87-101`; Phase D's `DevicePreset`, `listDevicePresets`, `Target`, `ControlPatch`, `ApplyResult`; Phase C/D's `queries.ts`; existing `getFirmwareStatus` (`client/src/api/client.ts:184`).
- Produces (all exported):

```ts
// client/src/api/client.ts
interface ConfigDiffEntry { path: string; from: unknown; to: unknown }
interface DeviceSegment { id: number; start: number; stop: number; len: number; grp: number;
  spc: number; of: number; on: boolean; bri: number; rev: boolean; mi: boolean; n?: string;
  fx: number; pal: number; col: number[][] }
interface SegmentUpdate { start?: number; stop?: number; grp?: number; spc?: number; of?: number;
  rev?: boolean; mi?: boolean; name?: string; on?: boolean; bri?: number }   // name, not n (Phase B route)
saveControllerPreset(controllerId, input: { id?: number; name: string;
  includeBrightness: boolean; saveSegmentBounds: boolean }): Promise<{ id: number; name: string }>
deleteControllerPreset(controllerId: string, presetId: number): Promise<Response>
getControllerConfig(controllerId: string): Promise<Record<string, unknown>>
dryRunControllerConfig(controllerId: string, patch: object): Promise<{ diff: ConfigDiffEntry[]; rebootRequired: boolean }>
applyControllerConfig(controllerId: string, patch: object): Promise<{ ok: true; rebootRequired: boolean }>
rebootController(controllerId: string): Promise<{ ok: true }>
getControllerSegments(controllerId: string): Promise<DeviceSegment[]>
updateControllerSegment(controllerId: string, segId: number, patch: SegmentUpdate): Promise<DeviceSegment[]>
createControllerSegment(controllerId: string, bounds: { start: number; stop: number }): Promise<DeviceSegment[]>
deleteControllerSegment(controllerId: string, segId: number): Promise<DeviceSegment[]>

// client/src/api/queries.ts
useFirmwareStatus(controllerId: string)   // key ['firmware', controllerId] — EXACT shape Phase H drift-checks for
useDeviceConfig(controllerId: string)     // key ['config', controllerId]
useDeviceSegments(controllerId: string)   // key ['segments', controllerId]
```

**Steps:**

- [ ] Drift-guard 1 — `grep -n "ps?: number" /Users/bwwilliams/github/uber-wled/client/src/api/client.ts`. If the client `ControlPatch` lacks `ps` (Phase D's mirror predates the master update), add it after the `transition` line, verbatim:

```ts
  ps?: number;                         // apply device preset id (device-local ids —
                                       // client restricts to single-controller selections)
```

- [ ] Drift-guard 2 — `grep -n "export const applyControl " /Users/bwwilliams/github/uber-wled/client/src/api/client.ts`. Phase D ships `applyControl(targets, patch)` (Task 1) — this phase consumes that name directly; there is no separate v2-named alias to create. If the grep has no hits, STOP — Phase D is incomplete and this phase depends on it.

- [ ] Drift-guard 3 — `grep -n "listDevicePresets\|interface DevicePreset" /Users/bwwilliams/github/uber-wled/client/src/api/client.ts`. Both must exist (Phase D Task 1). If missing, add:

```ts
export interface DevicePreset {
  id: number;
  name: string;
  isPlaylist: boolean;
  quicklook?: { fx?: number; pal?: number; on?: boolean; bri?: number };
}

export const listDevicePresets = (controllerId: string) =>
  getJson<{ presets: DevicePreset[] }>(`/api/controllers/${controllerId}/presets`).then((r) => r.presets);
```

- [ ] Write the failing test:

```ts
// client/src/test/devices/apiClient.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  saveControllerPreset, deleteControllerPreset,
  getControllerConfig, dryRunControllerConfig, applyControllerConfig,
  rebootController, getControllerSegments, updateControllerSegment,
  createControllerSegment, deleteControllerSegment,
  type ControlPatch
} from '../../api/client';

afterEach(() => vi.unstubAllGlobals());

function stubOk(payload: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok: true, status, json: async () => payload });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('devices api client', () => {
  it('ControlPatch carries the master ps field for device-preset apply', () => {
    const patch: ControlPatch = { ps: 3 };
    expect(patch.ps).toBe(3);
  });

  it('saveControllerPreset POSTs name and flags and returns { id, name }', async () => {
    const fn = stubOk({ id: 3, name: 'Evening' }, 201);
    const res = await saveControllerPreset('c1', { name: 'Evening', includeBrightness: true, saveSegmentBounds: false });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/presets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Evening', includeBrightness: true, saveSegmentBounds: false });
    expect(res).toEqual({ id: 3, name: 'Evening' });
  });

  it('deleteControllerPreset DELETEs the preset', async () => {
    const fn = stubOk({});
    await deleteControllerPreset('c1', 4);
    expect(fn).toHaveBeenCalledWith('/api/controllers/c1/presets/4', { method: 'DELETE' });
  });

  it('getControllerConfig GETs the raw cfg passthrough', async () => {
    const fn = stubOk({ id: { name: 'Cabinet Lights' } });
    const cfg = await getControllerConfig('c1');
    expect(fn).toHaveBeenCalledWith('/api/controllers/c1/config');
    expect((cfg.id as { name: string }).name).toBe('Cabinet Lights');
  });

  it('dryRunControllerConfig POSTs to ?dryRun=1 with a wrapped patch', async () => {
    const fn = stubOk({ diff: [], rebootRequired: false });
    await dryRunControllerConfig('c1', { id: { name: 'X' } });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/config?dryRun=1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ patch: { id: { name: 'X' } } });
  });

  it('applyControllerConfig POSTs to the config route without dryRun', async () => {
    const fn = stubOk({ ok: true, rebootRequired: true });
    const res = await applyControllerConfig('c1', { ap: { chan: 6 } });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/config');
    expect(JSON.parse(init.body)).toEqual({ patch: { ap: { chan: 6 } } });
    expect(res.rebootRequired).toBe(true);
  });

  it('rebootController POSTs the reboot route', async () => {
    const fn = stubOk({ ok: true });
    await rebootController('c1');
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/reboot');
    expect(init.method).toBe('POST');
  });

  it('getControllerSegments GETs the segments route', async () => {
    const fn = stubOk([{ id: 0, start: 0, stop: 39 }]);
    const segs = await getControllerSegments('c1');
    expect(fn).toHaveBeenCalledWith('/api/controllers/c1/segments');
    expect(segs[0].stop).toBe(39);
  });

  it('updateControllerSegment PUTs the widened field set with name (not n)', async () => {
    const fn = stubOk([]);
    await updateControllerSegment('c1', 0, {
      start: 0, stop: 40, grp: 1, spc: 0, of: 0, rev: true, mi: false, name: 'Left', on: true, bri: 200
    });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/segments/0');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      start: 0, stop: 40, grp: 1, spc: 0, of: 0, rev: true, mi: false, name: 'Left', on: true, bri: 200
    });
  });

  it('createControllerSegment POSTs start/stop', async () => {
    const fn = stubOk([{ id: 2, start: 48, stop: 60 }], 201);
    await createControllerSegment('c1', { start: 48, stop: 60 });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/segments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ start: 48, stop: 60 });
  });

  it('deleteControllerSegment DELETEs the segment id', async () => {
    const fn = stubOk([{ id: 0, start: 0, stop: 39 }]);
    const segs = await deleteControllerSegment('c1', 1);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/controllers/c1/segments/1');
    expect(init.method).toBe('DELETE');
    expect(segs).toHaveLength(1);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/apiClient.test.ts` → expect FAIL: `has no exported member 'saveControllerPreset'` (or unresolved import at runtime).
- [ ] Implement — append to `client/src/api/client.ts`:

```ts
// ---- Devices section (Phase F) ----

export interface ConfigDiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

export interface DeviceSegment {
  id: number;
  start: number;
  stop: number;
  len: number;
  grp: number;
  spc: number;
  of: number;
  on: boolean;
  bri: number;
  rev: boolean;
  mi: boolean;
  n?: string;
  fx: number;
  pal: number;
  col: number[][];
}

export interface SegmentUpdate {
  start?: number;
  stop?: number;
  grp?: number;
  spc?: number;
  of?: number;
  rev?: boolean;
  mi?: boolean;
  name?: string;
  on?: boolean;
  bri?: number;
}

export const saveControllerPreset = (
  controllerId: string,
  input: { id?: number; name: string; includeBrightness: boolean; saveSegmentBounds: boolean }
) => sendJson<{ id: number; name: string }>(`/api/controllers/${controllerId}/presets`, 'POST', input);

export const deleteControllerPreset = (controllerId: string, presetId: number) =>
  fetch(`/api/controllers/${controllerId}/presets/${presetId}`, { method: 'DELETE' });

export const getControllerConfig = (controllerId: string) =>
  getJson<Record<string, unknown>>(`/api/controllers/${controllerId}/config`);

export const dryRunControllerConfig = (controllerId: string, patch: object) =>
  sendJson<{ diff: ConfigDiffEntry[]; rebootRequired: boolean }>(
    `/api/controllers/${controllerId}/config?dryRun=1`, 'POST', { patch }
  );

export const applyControllerConfig = (controllerId: string, patch: object) =>
  sendJson<{ ok: true; rebootRequired: boolean }>(
    `/api/controllers/${controllerId}/config`, 'POST', { patch }
  );

export const rebootController = (controllerId: string) =>
  sendJson<{ ok: true }>(`/api/controllers/${controllerId}/reboot`, 'POST');

export const getControllerSegments = (controllerId: string) =>
  getJson<DeviceSegment[]>(`/api/controllers/${controllerId}/segments`);

export const updateControllerSegment = (controllerId: string, segId: number, patch: SegmentUpdate) =>
  sendJson<DeviceSegment[]>(`/api/controllers/${controllerId}/segments/${segId}`, 'PUT', patch);

export const createControllerSegment = (controllerId: string, bounds: { start: number; stop: number }) =>
  sendJson<DeviceSegment[]>(`/api/controllers/${controllerId}/segments`, 'POST', bounds);

export const deleteControllerSegment = (controllerId: string, segId: number) =>
  sendJson<DeviceSegment[]>(`/api/controllers/${controllerId}/segments/${segId}`, 'DELETE');
```

- [ ] In `client/src/api/live.ts`, replace the `LiveInfo` interface with this widened version (every added field optional — Phase D's tests and consumers are unaffected; fields verified against the real `/json/info` probe):

```ts
export interface LiveInfo {
  name: string; ver: string; vid?: number;
  leds: {
    count: number; rgbw: boolean; cct: number | boolean; seglc?: number[];
    fps?: number; pwr?: number; maxseg?: number;
  };
  wifi?: { bssid?: string; rssi?: number; signal: number; channel: number };
  fs?: { u: number; t: number };
  arch?: string; core?: string; mac?: string; ip?: string;
  uptime?: number; freeheap?: number;
  u?: Record<string, unknown>;
}
```

- [ ] In `client/src/api/queries.ts`, extend the import from `./client` with `getFirmwareStatus, getControllerConfig, getControllerSegments` (keep every existing import and hook) and append:

```ts
export const useFirmwareStatus = (controllerId: string) =>
  useQuery({ queryKey: ['firmware', controllerId], queryFn: () => getFirmwareStatus(controllerId) });

export const useDeviceConfig = (controllerId: string) =>
  useQuery({ queryKey: ['config', controllerId], queryFn: () => getControllerConfig(controllerId) });

export const useDeviceSegments = (controllerId: string) =>
  useQuery({ queryKey: ['segments', controllerId], queryFn: () => getControllerSegments(controllerId) });
```

- [ ] Run again → expect PASS (11 tests). Also run the whole api + live suites to prove the `LiveInfo` widening broke nothing: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api` → PASS.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/api client/src/test/devices && git commit -m "devices: typed api-client functions for config dry-run/apply, reboot, segment CRUD, preset save/delete + device query hooks"`

---

## Task 3: Shared test fixtures — probed cfg, live status, providers harness

**Files:**
- Create: `client/src/test/devices/fixtures.ts`
- Create: `client/src/test/devices/helpers.tsx`
- Test: `client/src/test/devices/fixtures.test.ts`

**Interfaces:**
- Consumes: `Controller`, `DeviceSegment`, `DevicePreset`, `FirmwareStatus` types (`client/src/api/client.ts`); `LiveInfo`, `LiveState`, `LiveStatusEntry` (`client/src/api/live.ts`, widened in Task 2); `ToastProvider` (`client/src/components/ui/Toast.tsx`, Phase C).
- Produces (every later component task in this phase consumes these):
  - `PROBED_CFG` (verbatim trimmed cfg.json probe), `probedCfg(): Record<string, any>` (deep copy)
  - `CONTROLLERS: Controller[]`, `LIVE_INFO: LiveInfo`, `LIVE_STATE: LiveState`, `SEGMENTS: DeviceSegment[]`, `DEVICE_PRESETS: DevicePreset[]`, `FIRMWARE_OK: FirmwareStatus`
  - `liveEntry(overrides?): LiveStatusEntry`, `liveMap(entries): Map<string, LiveStatusEntry>`
  - `makeQueryClient(): QueryClient`, `renderDevices(ui, client?)` (QueryClientProvider + ToastProvider wrapper), `stubFetchRoutes(routes)` (exact-match `"METHOD url"` fetch stub that rejects unknown requests)

**Steps:**

- [ ] Write the failing test:

```ts
// client/src/test/devices/fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { PROBED_CFG, probedCfg, SEGMENTS, LIVE_INFO } from './fixtures';

describe('devices fixtures (probed read-only from 192.168.1.86)', () => {
  it('probedCfg returns an independent deep copy', () => {
    const a = probedCfg();
    a.hw.led.ins[0].len = 999;
    expect(PROBED_CFG.hw.led.ins[0].len).toBe(39);
    expect(probedCfg().hw.led.ins[0].len).toBe(39);
  });

  it('LED output rows carry the unknown per-row keys that must survive saves', () => {
    for (const row of PROBED_CFG.hw.led.ins) {
      expect(row.ledma).toBe(55);
      expect(row.freq).toBe(0);
      expect(row.ref).toBe(false);
      expect(row.order).toBe(34);
    }
  });

  it('sync send block keeps unknown keys (btn/va/ret) for merge-preservation tests', () => {
    expect(PROBED_CFG.if.sync.send).toMatchObject({ btn: false, va: false, ret: 0 });
  });

  it('segments fixture matches the probed 48-LED two-output split', () => {
    expect(SEGMENTS.map((s) => s.id)).toEqual([0, 1]);
    expect(SEGMENTS[1].stop).toBe(48);
    expect(LIVE_INFO.leds.count).toBe(48);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/fixtures.test.ts` → expect FAIL: `Failed to resolve import "./fixtures"`.
- [ ] Create `client/src/test/devices/fixtures.ts`:

```ts
import type { Controller, DevicePreset, DeviceSegment, FirmwareStatus } from '../../api/client';
import type { LiveInfo, LiveState, LiveStatusEntry } from '../../api/live';

/**
 * Verbatim read-only probe of http://192.168.1.86/json/cfg (2026-07-05, WLED
 * 16.0.0 "Niji", vid 2605030), trimmed to the sections Phase F touches plus
 * the usermod block. The unknown per-row keys (ledma/freq/ref/drv/text) and
 * unknown sync keys (espnow/btn/va/ret) are the canary values: they MUST
 * survive every patch this phase builds.
 */
export const PROBED_CFG = {
  rev: [1, 0],
  vid: 2605030,
  id: { mdns: 'cabinet-lights', name: 'Cabinet Lights', inv: 'Cabinet Lights', sui: false },
  nw: {
    espnow: false,
    linked_remote: [''],
    ins: [
      { ssid: 'Williams', pskl: 10, bssid: '', ip: [0, 0, 0, 0], gw: [0, 0, 0, 0], sn: [255, 255, 255, 0] }
    ],
    dns: [8, 8, 8, 8]
  },
  ap: { ssid: 'WLED-AP', pskl: 8, chan: 1, hide: 0, behav: 0, ip: [4, 3, 2, 1] },
  wifi: { sleep: false, phy: false, txpwr: 78 },
  hw: {
    led: {
      total: 48, maxpwr: 0, cct: false, cr: false, ic: false, cb: 0, fps: 42, rgbwm: 255,
      ins: [
        { start: 0, len: 39, pin: [16], order: 34, rev: true, skip: 0, type: 30,
          ref: false, rgbwm: 2, freq: 0, maxpwr: 0, ledma: 55, drv: 0, text: '' },
        { start: 39, len: 9, pin: [3], order: 34, rev: true, skip: 0, type: 30,
          ref: false, rgbwm: 2, freq: 0, maxpwr: 0, ledma: 55, drv: 0, text: '' }
      ]
    },
    relay: { pin: 15, rev: true, odrain: false }
  },
  light: {
    'scale-bri': 100, 'pal-mode': 0, aseg: true,
    gc: { bri: 1, col: 2.8, val: 2.8 },
    tr: { dur: 7, rpc: 5, hrp: true },
    nl: { mode: 1, dur: 60, tbri: 0, macro: 0 }
  },
  def: { ps: 1, on: false, bri: 128 },
  if: {
    sync: {
      port0: 21324, port1: 65506, espnow: false,
      recv: { bri: true, col: true, fx: true, pal: true, grp: 1, seg: false, sb: false },
      send: { en: false, dir: true, btn: false, va: false, hue: true, grp: 1, ret: 0 }
    },
    ntp: { en: true, host: '0.wled.pool.ntp.org', tz: 5, offset: 0, ampm: false, ln: -96.78, lt: 33.24 }
  },
  um: {
    AudioReactive: {
      enabled: false, 'add-palettes': false,
      analogmic: { pin: -1 },
      config: { squelch: 10, gain: 30, AGC: 1 },
      sync: { port: 11988, mode: 0 }
    }
  }
};

/** Deep copy so tests can mutate freely. */
export function probedCfg(): Record<string, any> {
  return structuredClone(PROBED_CFG);
}

export const CONTROLLERS: Controller[] = [
  { id: 'c1', name: 'Cabinet Lights', host: '192.168.1.86', source: 'discovered', stale: false, pinnedAssetPattern: 'ESP32' },
  { id: 'c2', name: 'Porch', host: '10.0.0.51', source: 'manual', stale: true, pinnedAssetPattern: null }
];

/** /json/info probe subset (uptime 2791487 s = 32d 7h; signal 98; fs in KiB). */
export const LIVE_INFO: LiveInfo = {
  name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
  leds: { count: 48, rgbw: true, cct: false, seglc: [3, 3], fps: 42, pwr: 470, maxseg: 32 },
  wifi: { bssid: 'AA:BB:CC:DD:EE:FF', rssi: -51, signal: 98, channel: 6 },
  fs: { u: 28, t: 983 },
  arch: 'esp32', core: 'v3.3.6', mac: 'c0c3dc112233', ip: '192.168.1.86',
  uptime: 2791487, freeheap: 120876,
  u: { AudioReactive: {} }
};

export const SEGMENTS: DeviceSegment[] = [
  { id: 0, start: 0, stop: 39, len: 39, grp: 1, spc: 0, of: 0, on: true, bri: 255,
    rev: false, mi: false, n: 'Cabinet run', fx: 0, pal: 0,
    col: [[255, 160, 60, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
  { id: 1, start: 39, stop: 48, len: 9, grp: 1, spc: 0, of: 0, on: true, bri: 200,
    rev: false, mi: false, fx: 12, pal: 4,
    col: [[0, 80, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }
];

// Excess fields mirror the real /json/state payload; cast because Phase D's
// LiveSegment declares only the fields the Control surface reads.
export const LIVE_STATE = {
  on: true, bri: 128, transition: 7, ps: 1, pl: -1,
  nl: { on: false, dur: 60, mode: 1, tbri: 0, rem: -1 },
  mainseg: 0,
  seg: SEGMENTS
} as unknown as LiveState;

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 1, name: 'Warm evening', isPlaylist: false, quicklook: { fx: 0, pal: 0, on: true, bri: 128 } },
  { id: 2, name: 'Party loop', isPlaylist: true }
];

export const FIRMWARE_OK: FirmwareStatus = {
  installedVersion: '16.0.0', latestTag: 'v16.1.0', updateAvailable: true,
  isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: []
};

export function liveEntry(overrides: Partial<LiveStatusEntry> = {}): LiveStatusEntry {
  return { reachable: true, state: LIVE_STATE, info: LIVE_INFO, ...overrides };
}

export function liveMap(entries: Record<string, LiveStatusEntry>): Map<string, LiveStatusEntry> {
  return new Map(Object.entries(entries));
}
```

- [ ] Create `client/src/test/devices/helpers.tsx` (if the shipped kit exports `ToastProvider` only through the `components/ui` barrel, adjust the import — the kit is authoritative):

```tsx
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
}

export function renderDevices(ui: ReactElement, client: QueryClient = makeQueryClient()) {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return { client, ...render(ui, { wrapper: Providers }) };
}

/**
 * Stub the global fetch with an exact-match `"METHOD url"` route table.
 * Unknown requests reject loudly so a test can never silently hit the
 * network (vitest-testing-gotchas: stub fetch globally, never nock).
 */
export function stubFetchRoutes(routes: Record<string, unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    if (!(key in routes)) throw new Error(`unexpected fetch: ${key}`);
    return {
      ok: true,
      status: 200,
      json: async () => structuredClone(routes[key])
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
```

- [ ] Run again → expect PASS (4 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/test/devices && git commit -m "devices: shared probed-device fixtures + query/toast test harness"`

---

## Task 4: Pure config patch builders — `configPatches.ts` (merge, never replace)

**Files:**
- Create: `client/src/sections/devices/configPatches.ts`
- Test: `client/src/test/devices/configPatches.test.ts`

**Interfaces:**
- Consumes: Task 3 fixtures (tests only). No runtime imports — this module is pure.
- Produces (all exported; every Config form in Tasks 9–13 consumes these):

```ts
type Cfg = Record<string, any>
LED_TYPES / COLOR_ORDERS / AUTO_WHITE_MODES: { value: number; label: string }[]
interface OutputDraft { pin: number; type: number; len: number; start: number;
  colorOrder: number; rev: boolean; skip: number; rgbwm: number }
outputDraftFromRow(row: Cfg): OutputDraft            // decodes order low nibble
mergeOutputRow(row: Cfg, draft: OutputDraft): Cfg     // spreads row, keeps order high nibble
buildIdentityPatch(draft: { name: string; mdns: string }): Cfg
buildLedHardwarePatch(cfg: Cfg, drafts: OutputDraft[], globals: { total: number; maxpwr: number }): Cfg
interface WifiDraft { ssid: string; password: string; staticIp: string; gateway: string;
  subnet: string; apSsid: string; apPassword: string; apChannel: number; apHide: boolean }
buildWifiPatch(cfg: Cfg, draft: WifiDraft): Cfg       // '' password ⇒ psk omitted (write-only)
interface SyncDraft { port0: number; port1: number; recvBri: boolean; recvCol: boolean;
  recvFx: boolean; recvPal: boolean; recvSeg: boolean; recvSb: boolean; recvGroups: number;
  sendEn: boolean; sendDir: boolean; sendHue: boolean; sendGroups: number }
buildSyncPatch(draft: SyncDraft): Cfg
interface TimeDraft { ntpEnabled: boolean; ntpHost: string; timezone: number;
  offsetSeconds: number; ampm: boolean; latitude: number; longitude: number }
buildTimePatch(draft: TimeDraft): Cfg
interface LedPrefsDraft { bootPreset: number; bootOn: boolean; bootBri: number;
  transitionDurationMs: number; gammaColor: number; brightnessFactor: number }
buildLedPrefsPatch(draft: LedPrefsDraft): Cfg
parseIpv4(text: string): number[] | null
formatIpv4(value: unknown): string
isStrandRisk(path: string): boolean                   // nw.*, ap.*, any hw.* pin path
```

- Server semantics these builders are written against (Phase B `configDiff.ts`, BINDING): **objects deep-merge (only patched keys compared), arrays REPLACE wholesale** — so any builder that touches an array (`hw.led.ins`, `nw.ins`) must emit COMPLETE rows merged over the probed originals, and object-only builders emit minimal nested objects.

**Steps:**

- [ ] Write the failing test:

```ts
// client/src/test/devices/configPatches.test.ts
import { describe, it, expect } from 'vitest';
import {
  AUTO_WHITE_MODES, COLOR_ORDERS, LED_TYPES,
  buildIdentityPatch, buildLedHardwarePatch, buildLedPrefsPatch, buildSyncPatch,
  buildTimePatch, buildWifiPatch, formatIpv4, isStrandRisk, mergeOutputRow,
  outputDraftFromRow, parseIpv4
} from '../../sections/devices/configPatches';
import { probedCfg } from './fixtures';

describe('outputDraftFromRow', () => {
  it('decodes the probed row: GPIO 16, type 30, order 34 → color order BRG (2)', () => {
    const draft = outputDraftFromRow(probedCfg().hw.led.ins[0]);
    expect(draft).toEqual({ pin: 16, type: 30, len: 39, start: 0, colorOrder: 2, rev: true, skip: 0, rgbwm: 2 });
  });
  it('exposes labeled options for the probed values', () => {
    expect(COLOR_ORDERS.find((o) => o.value === 2)?.label).toBe('BRG');
    expect(LED_TYPES.find((t) => t.value === 30)?.label).toMatch(/SK6812/);
    expect(AUTO_WHITE_MODES.find((m) => m.value === 2)?.label).toBe('Accurate');
  });
});

describe('mergeOutputRow', () => {
  it('preserves unknown per-row keys verbatim (ledma, freq, ref, drv, text)', () => {
    const row = probedCfg().hw.led.ins[0];
    const merged = mergeOutputRow(row, { ...outputDraftFromRow(row), len: 40 });
    expect(merged).toMatchObject({ ledma: 55, freq: 0, ref: false, drv: 0, text: '', maxpwr: 0, len: 40 });
  });
  it('preserves the white-swap high nibble of order: 0x22 with new color order RGB(1) → 0x21', () => {
    const row = probedCfg().hw.led.ins[0];
    const merged = mergeOutputRow(row, { ...outputDraftFromRow(row), colorOrder: 1 });
    expect(merged.order).toBe(33);
  });
  it('writes the pin as the first element of the pin array', () => {
    const row = probedCfg().hw.led.ins[1];
    const merged = mergeOutputRow(row, { ...outputDraftFromRow(row), pin: 4 });
    expect(merged.pin).toEqual([4]);
  });
});

describe('buildLedHardwarePatch', () => {
  it('sends COMPLETE merged rows because arrays replace on the server merge', () => {
    const cfg = probedCfg();
    const drafts = cfg.hw.led.ins.map(outputDraftFromRow);
    drafts[0] = { ...drafts[0], len: 40 };
    const patch = buildLedHardwarePatch(cfg, drafts, { total: 49, maxpwr: 850 });
    expect(patch.hw.led.total).toBe(49);
    expect(patch.hw.led.maxpwr).toBe(850);
    expect(patch.hw.led.ins).toHaveLength(2);
    expect(patch.hw.led.ins[0]).toMatchObject({ len: 40, ledma: 55, ref: false });
    expect(patch.hw.led.ins[1]).toEqual(cfg.hw.led.ins[1]);
  });
  it('never writes the global auto-white mode (hw.led.rgbwm stays 255 = per-bus)', () => {
    const cfg = probedCfg();
    const patch = buildLedHardwarePatch(cfg, cfg.hw.led.ins.map(outputDraftFromRow), { total: 48, maxpwr: 0 });
    expect('rgbwm' in patch.hw.led).toBe(false);
  });
});

describe('ip helpers', () => {
  it('parses dotted quads', () => expect(parseIpv4('192.168.1.50')).toEqual([192, 168, 1, 50]));
  it('rejects malformed and out-of-range strings', () => {
    expect(parseIpv4('192.168.1')).toBeNull();
    expect(parseIpv4('192.168.1.256')).toBeNull();
    expect(parseIpv4('lights.local')).toBeNull();
  });
  it('formats the probed subnet mask back to text', () =>
    expect(formatIpv4([255, 255, 255, 0])).toBe('255.255.255.0'));
});

describe('buildWifiPatch', () => {
  const draft = {
    ssid: 'Williams', password: '', staticIp: '0.0.0.0', gateway: '0.0.0.0',
    subnet: '255.255.255.0', apSsid: 'WLED-AP', apPassword: '', apChannel: 6, apHide: false
  };
  it('omits psk entirely when the password field is blank (write-only semantics)', () => {
    const patch = buildWifiPatch(probedCfg(), draft);
    expect('psk' in patch.nw.ins[0]).toBe(false);
    expect('psk' in patch.ap).toBe(false);
  });
  it('carries unknown row keys and includes psk only when typed', () => {
    const patch = buildWifiPatch(probedCfg(), { ...draft, password: 'hunter22' });
    expect(patch.nw.ins[0]).toMatchObject({ ssid: 'Williams', pskl: 10, bssid: '', psk: 'hunter22' });
    expect(patch.nw.ins[0].sn).toEqual([255, 255, 255, 0]);
  });
  it('maps AP fields (chan + hide as 0/1)', () => {
    const patch = buildWifiPatch(probedCfg(), { ...draft, apHide: true });
    expect(patch.ap).toMatchObject({ ssid: 'WLED-AP', chan: 6, hide: 1 });
  });
});

describe('buildIdentityPatch / buildSyncPatch / buildTimePatch / buildLedPrefsPatch', () => {
  it('identity patch is a minimal object merge', () =>
    expect(buildIdentityPatch({ name: 'Cabinet Lights', mdns: 'cabinet-lights' }))
      .toEqual({ id: { name: 'Cabinet Lights', mdns: 'cabinet-lights' } }));
  it('sync patch nests only the edited keys (objects deep-merge server-side)', () => {
    const patch = buildSyncPatch({
      port0: 21324, port1: 65506,
      recvBri: true, recvCol: true, recvFx: true, recvPal: true, recvSeg: true, recvSb: false, recvGroups: 1,
      sendEn: false, sendDir: true, sendHue: true, sendGroups: 1
    });
    expect(patch.if.sync.recv.seg).toBe(true);
    expect('espnow' in patch.if.sync).toBe(false); // untouched keys stay out of the patch
  });
  it('time patch mirrors the probed if.ntp shape', () => {
    expect(buildTimePatch({
      ntpEnabled: true, ntpHost: '0.wled.pool.ntp.org', timezone: 5,
      offsetSeconds: 0, ampm: false, latitude: 33.24, longitude: -96.78
    })).toEqual({
      if: { ntp: { en: true, host: '0.wled.pool.ntp.org', tz: 5, offset: 0, ampm: false, lt: 33.24, ln: -96.78 } }
    });
  });
  it('led prefs patch converts transition ms to WLED 100ms units', () => {
    expect(buildLedPrefsPatch({
      bootPreset: 1, bootOn: false, bootBri: 128,
      transitionDurationMs: 700, gammaColor: 2.8, brightnessFactor: 100
    })).toEqual({
      def: { ps: 1, on: false, bri: 128 },
      light: { 'scale-bri': 100, gc: { col: 2.8 }, tr: { dur: 7 } }
    });
  });
});

describe('isStrandRisk', () => {
  it('flags WiFi client and AP paths', () => {
    expect(isStrandRisk('nw.ins.0.ssid')).toBe(true);
    expect(isStrandRisk('nw.ins.0.psk')).toBe(true);
    expect(isStrandRisk('ap.chan')).toBe(true);
  });
  it('flags GPIO pin paths anywhere under hw.', () => {
    expect(isStrandRisk('hw.led.ins.0.pin.0')).toBe(true);
    expect(isStrandRisk('hw.relay.pin')).toBe(true);
  });
  it('does not flag safe paths', () => {
    expect(isStrandRisk('hw.led.total')).toBe(false);
    expect(isStrandRisk('id.name')).toBe(false);
    expect(isStrandRisk('if.sync.port0')).toBe(false);
    expect(isStrandRisk('light.tr.dur')).toBe(false);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/configPatches.test.ts` → expect FAIL: `Failed to resolve import "../../sections/devices/configPatches"`.
- [ ] Create `client/src/sections/devices/configPatches.ts`:

```ts
/**
 * Pure patch builders for the Config tab. BINDING server semantics (Phase B
 * configDiff.ts): objects deep-merge — only patched keys are compared/applied;
 * arrays REPLACE wholesale. Therefore every array this module emits
 * (hw.led.ins, nw.ins) contains COMPLETE rows merged over the device's
 * current cfg rows, so unknown per-row fields (ledma, freq, ref, drv, text,
 * …) survive every save.
 */
export type Cfg = Record<string, any>;

/** WLED bus type ids — 30 verified on the probed SK6812 RGBW strip; the rest from WLED const.h. */
export const LED_TYPES: { value: number; label: string }[] = [
  { value: 22, label: 'WS281x (WS2812/WS2815 RGB)' },
  { value: 30, label: 'SK6812 / WS2814 RGBW' },
  { value: 31, label: 'TM1814 (RGBW)' },
  { value: 24, label: 'WS2811 400kHz' },
  { value: 18, label: 'WS2812 single-white' },
  { value: 20, label: 'WS2812 CCT' },
  { value: 21, label: 'WS2812 WWA' },
  { value: 27, label: 'APA106' },
  { value: 25, label: 'TM1829' },
  { value: 26, label: 'UCS8903 (16-bit RGB)' },
  { value: 29, label: 'UCS8904 (16-bit RGBW)' },
  { value: 50, label: 'WS2801 (SPI)' },
  { value: 51, label: 'APA102 / SK9822 (SPI)' },
  { value: 52, label: 'LPD8806 (SPI)' },
  { value: 53, label: 'P9813 (SPI)' },
  { value: 54, label: 'LPD6803 (SPI)' }
];

/** Low nibble of the per-output `order` byte (probed 34 = 0x22 → BRG). */
export const COLOR_ORDERS: { value: number; label: string }[] = [
  { value: 0, label: 'GRB' }, { value: 1, label: 'RGB' }, { value: 2, label: 'BRG' },
  { value: 3, label: 'RBG' }, { value: 4, label: 'BGR' }, { value: 5, label: 'GBR' }
];

/** Per-output rgbwm (probed 2 = Accurate). Global hw.led.rgbwm 255 = per-bus and is never written. */
export const AUTO_WHITE_MODES: { value: number; label: string }[] = [
  { value: 0, label: 'None' }, { value: 1, label: 'Brighter' }, { value: 2, label: 'Accurate' },
  { value: 3, label: 'Dual' }, { value: 4, label: 'Max' }
];

export interface OutputDraft {
  pin: number;
  type: number;
  len: number;
  start: number;
  colorOrder: number; // low nibble of `order` only
  rev: boolean;
  skip: number;
  rgbwm: number;
}

export function outputDraftFromRow(row: Cfg): OutputDraft {
  return {
    pin: Array.isArray(row.pin) ? Number(row.pin[0]) : Number(row.pin),
    type: Number(row.type),
    len: Number(row.len),
    start: Number(row.start),
    colorOrder: (Number(row.order) || 0) & 0x0f,
    rev: Boolean(row.rev),
    skip: Number(row.skip ?? 0),
    rgbwm: Number(row.rgbwm ?? 0)
  };
}

/**
 * Full replacement row for hw.led.ins[i]. Spreads the probed row first so
 * unknown keys survive; preserves the white-swap high nibble of `order`.
 */
export function mergeOutputRow(row: Cfg, draft: OutputDraft): Cfg {
  const highNibble = (Number(row.order) || 0) & 0xf0;
  const pin = Array.isArray(row.pin) ? [draft.pin, ...row.pin.slice(1)] : [draft.pin];
  return {
    ...row,
    pin,
    type: draft.type,
    len: draft.len,
    start: draft.start,
    order: highNibble | (draft.colorOrder & 0x0f),
    rev: draft.rev,
    skip: draft.skip,
    rgbwm: draft.rgbwm
  };
}

export function buildIdentityPatch(draft: { name: string; mdns: string }): Cfg {
  return { id: { name: draft.name, mdns: draft.mdns } };
}

export function buildLedHardwarePatch(
  cfg: Cfg,
  drafts: OutputDraft[],
  globals: { total: number; maxpwr: number }
): Cfg {
  const rows: Cfg[] = Array.isArray(cfg.hw?.led?.ins) ? cfg.hw.led.ins : [];
  const ins = rows.map((row, i) => (drafts[i] ? mergeOutputRow(row, drafts[i]) : row));
  return { hw: { led: { total: globals.total, maxpwr: globals.maxpwr, ins } } };
}

export function parseIpv4(text: string): number[] | null {
  const m = text.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

export function formatIpv4(value: unknown): string {
  return Array.isArray(value) && value.length === 4 ? value.join('.') : '0.0.0.0';
}

export interface WifiDraft {
  ssid: string;
  password: string; // '' = keep the stored password (WLED never returns it, only pskl)
  staticIp: string;
  gateway: string;
  subnet: string;
  apSsid: string;
  apPassword: string;
  apChannel: number;
  apHide: boolean;
}

export function buildWifiPatch(cfg: Cfg, draft: WifiDraft): Cfg {
  const row0: Cfg = (cfg.nw?.ins?.[0] as Cfg) ?? {};
  const merged: Cfg = {
    ...row0,
    ssid: draft.ssid,
    ip: parseIpv4(draft.staticIp) ?? [0, 0, 0, 0],
    gw: parseIpv4(draft.gateway) ?? [0, 0, 0, 0],
    sn: parseIpv4(draft.subnet) ?? [255, 255, 255, 0]
  };
  if (draft.password !== '') merged.psk = draft.password;
  const ap: Cfg = { ssid: draft.apSsid, chan: draft.apChannel, hide: draft.apHide ? 1 : 0 };
  if (draft.apPassword !== '') ap.psk = draft.apPassword;
  return { nw: { ins: [merged] }, ap };
}

export interface SyncDraft {
  port0: number; port1: number;
  recvBri: boolean; recvCol: boolean; recvFx: boolean; recvPal: boolean;
  recvSeg: boolean; recvSb: boolean; recvGroups: number;
  sendEn: boolean; sendDir: boolean; sendHue: boolean; sendGroups: number;
}

export function buildSyncPatch(draft: SyncDraft): Cfg {
  return {
    if: {
      sync: {
        port0: draft.port0,
        port1: draft.port1,
        recv: {
          bri: draft.recvBri, col: draft.recvCol, fx: draft.recvFx, pal: draft.recvPal,
          seg: draft.recvSeg, sb: draft.recvSb, grp: draft.recvGroups
        },
        send: { en: draft.sendEn, dir: draft.sendDir, hue: draft.sendHue, grp: draft.sendGroups }
      }
    }
  };
}

export interface TimeDraft {
  ntpEnabled: boolean; ntpHost: string; timezone: number;
  offsetSeconds: number; ampm: boolean; latitude: number; longitude: number;
}

export function buildTimePatch(draft: TimeDraft): Cfg {
  return {
    if: {
      ntp: {
        en: draft.ntpEnabled, host: draft.ntpHost, tz: draft.timezone,
        offset: draft.offsetSeconds, ampm: draft.ampm, lt: draft.latitude, ln: draft.longitude
      }
    }
  };
}

export interface LedPrefsDraft {
  bootPreset: number; bootOn: boolean; bootBri: number;
  transitionDurationMs: number; gammaColor: number; brightnessFactor: number;
}

export function buildLedPrefsPatch(draft: LedPrefsDraft): Cfg {
  return {
    def: { ps: draft.bootPreset, on: draft.bootOn, bri: draft.bootBri },
    light: {
      'scale-bri': draft.brightnessFactor,
      gc: { col: draft.gammaColor },
      tr: { dur: Math.round(draft.transitionDurationMs / 100) }
    }
  };
}

/**
 * Diff paths whose change can strand the device off the network or kill its
 * LED output: any WiFi client/AP setting, or any GPIO pin assignment under hw.
 * (Paths are the server's dot-joined form, e.g. `hw.led.ins.0.pin.0`.)
 */
export function isStrandRisk(path: string): boolean {
  if (path.startsWith('nw.') || path.startsWith('ap.')) return true;
  return path.startsWith('hw.') && path.split('.').includes('pin');
}
```

- [ ] Run again → expect PASS (20 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: pure config patch builders that merge probed cfg rows (order nibble, write-only psk, strand-risk paths)"`

---

## Task 5: `DiffConfirmModal` + the section stylesheet

**Files:**
- Create: `client/src/sections/devices/DiffConfirmModal.tsx`
- Create: `client/src/sections/devices/devices.css` (the whole section's stylesheet — later tasks only consume it)
- Test: `client/src/test/devices/DiffConfirmModal.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `Button`, `Chip` (Phase C kit); `ConfigDiffEntry` (Task 2); `isStrandRisk` (Task 4).
- Produces:
  - `interface DiffConfirmModalProps { open: boolean; diff: ConfigDiffEntry[]; rebootRequired: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void }`
  - `DiffConfirmModal(props)` — one row per `{path, from, to}`; `rebootRequired` renders a warning note; any strand-risk path (WiFi/GPIO) renders a `role="alert"` warning and gates the confirm button behind an explicit checkbox.

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/DiffConfirmModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffConfirmModal } from '../../sections/devices/DiffConfirmModal';

const SAFE_DIFF = [
  { path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen Cabinets' },
  { path: 'hw.led.total', from: 48, to: 49 }
];
const RISKY_DIFF = [
  { path: 'nw.ins.0.ssid', from: 'Williams', to: 'Williams-5G' },
  { path: 'hw.led.ins.0.pin.0', from: 16, to: 4 }
];

describe('DiffConfirmModal', () => {
  it('renders one row per diff entry with path, from, and to', () => {
    render(<DiffConfirmModal open diff={SAFE_DIFF} rebootRequired={false}
      onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('id.name')).toBeTruthy();
    expect(screen.getByText('"Cabinet Lights"')).toBeTruthy();
    expect(screen.getByText('"Kitchen Cabinets"')).toBeTruthy();
    expect(screen.getByText('hw.led.total')).toBeTruthy();
  });

  it('enables Apply immediately for a safe diff and confirms', () => {
    const onConfirm = vi.fn();
    render(<DiffConfirmModal open diff={SAFE_DIFF} rebootRequired={false}
      onConfirm={onConfirm} onCancel={vi.fn()} />);
    const apply = screen.getByRole('button', { name: 'Apply 2 changes' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows the reboot-required note when flagged', () => {
    render(<DiffConfirmModal open diff={SAFE_DIFF} rebootRequired
      onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Reboot required')).toBeTruthy();
  });

  it('blocks a risky (WiFi/GPIO) diff behind an explicit acknowledgement', () => {
    const onConfirm = vi.fn();
    render(<DiffConfirmModal open diff={RISKY_DIFF} rebootRequired
      onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/strand the device/i);
    expect((screen.getByRole('button', { name: 'Apply 2 changes' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I understand this device may become unreachable'));
    const apply = screen.getByRole('button', { name: 'Apply 2 changes' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('renders (unset) for values removed by the patch', () => {
    render(<DiffConfirmModal open diff={[{ path: 'nw.ins.1.ssid', from: 'Old', to: undefined }]}
      rebootRequired={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('(unset)')).toBeTruthy();
  });

  it('calls onCancel from the Cancel button', () => {
    const onCancel = vi.fn();
    render(<DiffConfirmModal open diff={SAFE_DIFF} rebootRequired={false}
      onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/DiffConfirmModal.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/DiffConfirmModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { ConfigDiffEntry } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { isStrandRisk } from './configPatches';
import './devices.css';

export interface DiffConfirmModalProps {
  open: boolean;
  diff: ConfigDiffEntry[];
  rebootRequired: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(unset)';
  return JSON.stringify(value);
}

export function DiffConfirmModal({
  open, diff, rebootRequired, busy = false, onConfirm, onCancel
}: DiffConfirmModalProps) {
  const risky = diff.some((entry) => isStrandRisk(entry.path));
  const [ackRisk, setAckRisk] = useState(false);
  useEffect(() => {
    if (!open) setAckRisk(false);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Review config changes"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant={risky ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy || diff.length === 0 || (risky && !ackRisk)}
          >
            {busy ? 'Applying…' : `Apply ${diff.length} change${diff.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      {diff.length === 0 ? (
        <p className="diff-empty">No changes — the device already matches this form.</p>
      ) : (
        <ul className="diff-list">
          {diff.map((entry) => (
            <li key={entry.path}
              className={isStrandRisk(entry.path) ? 'diff-row diff-row-risky' : 'diff-row'}>
              <code className="diff-path">{entry.path}</code>
              <span className="diff-values">
                <span className="diff-from">{formatValue(entry.from)}</span>
                <span aria-hidden="true"> → </span>
                <span className="diff-to">{formatValue(entry.to)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {rebootRequired && (
        <p className="diff-reboot-note" role="status">
          <Chip variant="warning">Reboot required</Chip> The device reboots (or must be rebooted)
          before these changes take effect — lights blink out for a few seconds.
        </p>
      )}
      {risky && (
        <div className="diff-risk-warning" role="alert">
          <p>
            <strong>This change touches WiFi or GPIO settings.</strong> A wrong SSID, password, or
            pin assignment can strand the device off the network or stop its LED output entirely —
            recovery may require joining its WLED-AP fallback or reflashing over USB.
          </p>
          <label className="diff-risk-ack">
            <input type="checkbox" checked={ackRisk} onChange={(e) => setAckRisk(e.target.checked)} />
            I understand this device may become unreachable
          </label>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] Create `client/src/sections/devices/devices.css` (the entire section's styles, on Phase C tokens; later tasks import components that already pull this file in via `DiffConfirmModal`/`DeviceCard`):

```css
/* ===== Devices section (Phase F) ===== */

.devices-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.devices-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-md);
}

@media (max-width: 480px) {
  .devices-grid { grid-template-columns: 1fr; }
}

/* ---------- Device card (list view) ---------- */

.device-card { display: flex; flex-direction: column; gap: var(--space-sm); }

.device-card-header { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }

.device-card-title {
  background: none;
  border: 0;
  padding: 0;
  color: var(--text);
  font-size: 1.05rem;
  font-weight: 600;
  cursor: pointer;
  min-height: 40px;
  text-align: left;
}

.device-card-title:hover { color: var(--accent); }

.device-card-host { color: var(--text-muted); font-size: 0.85rem; margin: 0; }

.device-card-live { display: flex; align-items: center; gap: var(--space-md); flex-wrap: wrap; }

.device-card-metric { color: var(--text-muted); font-size: 0.85rem; }

.device-card-actions { display: flex; gap: var(--space-sm); margin-top: auto; }

.signal-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 16px; }
.signal-bar { width: 4px; background: var(--border); border-radius: 1px; }
.signal-bar:nth-child(1) { height: 4px; }
.signal-bar:nth-child(2) { height: 8px; }
.signal-bar:nth-child(3) { height: 12px; }
.signal-bar:nth-child(4) { height: 16px; }
.signal-bar-on { background: var(--success); }

/* ---------- Device detail ---------- */

.device-detail-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.device-detail-titles h2 { margin: 0; }

.info-tab, .segments-tab, .presets-tab-device, .config-tab, .update-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.facts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-md);
  margin: 0;
}

.fact dt {
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fact dd { margin: 2px 0 0; overflow-wrap: anywhere; }

.info-liveview {
  width: 100%;
  height: 48px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: #000;
}

.info-actions-row { display: flex; gap: var(--space-sm); flex-wrap: wrap; align-items: center; }

/* ---------- Segments editor ---------- */

.segment-grid, .config-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-sm) var(--space-md);
}

.segment-row-header { display: flex; justify-content: space-between; align-items: center; }
.segment-switches { display: flex; gap: var(--space-lg); flex-wrap: wrap; }
.segment-row-actions, .config-form-actions { display: flex; gap: var(--space-sm); }

/* ---------- Device presets ---------- */

.device-preset-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
.device-preset-row { display: flex; align-items: center; gap: var(--space-sm); min-height: 40px; }
.device-preset-id { color: var(--text-muted); font-variant-numeric: tabular-nums; min-width: 2ch; }
.device-preset-name { flex: 1; overflow-wrap: anywhere; }
.preset-save-flags { display: flex; gap: var(--space-lg); flex-wrap: wrap; margin: var(--space-sm) 0; }

/* ---------- Config forms ---------- */

.config-form { display: flex; flex-direction: column; gap: var(--space-sm); }
.config-warning { color: var(--warning); font-size: 0.85rem; margin: 0; }

.output-editor {
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: var(--space-md);
  margin: 0;
}

.config-json-editor {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  width: 100%;
  resize: vertical;
}

.config-reboot-offer {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  padding: var(--space-md);
  border: 1px solid var(--warning);
  border-radius: var(--radius-control);
}

.config-reboot-offer p { margin: 0; flex: 1; }

/* ---------- Diff confirm modal ---------- */

.diff-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
}

.diff-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: var(--radius-control);
  background: var(--surface-2);
}

.diff-row-risky { outline: 1px solid var(--danger); }
.diff-path { color: var(--text-muted); font-size: 0.75rem; overflow-wrap: anywhere; }
.diff-from { color: var(--danger); text-decoration: line-through; }
.diff-to { color: var(--success); }
.diff-values { overflow-wrap: anywhere; }

.diff-risk-warning {
  border: 1px solid var(--danger);
  border-radius: var(--radius-control);
  padding: var(--space-md);
  margin-top: var(--space-sm);
}

.diff-risk-ack { display: flex; align-items: center; gap: 8px; margin-top: 8px; min-height: 40px; }
```

- [ ] Run again → expect PASS (6 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: DiffConfirmModal with per-path diff rows, reboot banner, WiFi/GPIO strand-risk gate + section stylesheet"`

---

## Task 6: Info tab — facts grid, liveview peek, reboot/remove confirms, native UI link

**Files:**
- Create: `client/src/sections/devices/InfoTab.tsx`
- Test: `client/src/test/devices/InfoTab.test.tsx`

**Interfaces:**
- Consumes: `deleteController`, `importSchedules` (existing, `client/src/api/client.ts:107,109`), `rebootController` (Task 2); `LiveStatusEntry` (Phase D); `Button`, `Card`, `Chip`, `Modal`, `useToast` (Phase C kit); `humanizeUptime`, `signalBars` (Task 1); Task 3 harness.
- Produces: `InfoTab({ controller: Controller; live: LiveStatusEntry | undefined; onRemoved: () => void })`.
- Parity relocation (deliberate): the old `ControllerList.tsx` (deleted in Task 18) owned **Remove controller** and **Import schedules**; both move here so no feature is lost. The `disableOnDevice` import flag defaults to `false` (the Settings default; per-import toggling returns with the Phase H Settings restyle).

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/InfoTab.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { InfoTab } from '../../sections/devices/InfoTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { CONTROLLERS, liveEntry } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function renderTab(routes: Record<string, unknown> = {}, onRemoved = vi.fn()) {
  const fn = stubFetchRoutes(routes);
  renderDevices(<InfoTab controller={CONTROLLERS[0]} live={liveEntry()} onRemoved={onRemoved} />);
  return { fn, onRemoved };
}

describe('InfoTab', () => {
  it('renders the probed facts grid', () => {
    renderTab();
    expect(screen.getByText('32d 7h')).toBeTruthy(); // uptime 2791487 s
    expect(screen.getByText('98% (4/4 bars), channel 6')).toBeTruthy();
    expect(screen.getByText('118 KiB')).toBeTruthy(); // freeheap 120876
    expect(screen.getByText('28 / 983 KiB')).toBeTruthy();
    expect(screen.getByText('48 RGBW')).toBeTruthy();
    expect(screen.getByText('AudioReactive')).toBeTruthy();
  });

  it('embeds the liveview peek iframe pointing at the device', () => {
    renderTab();
    const frame = screen.getByTitle('Live output of Cabinet Lights') as HTMLIFrameElement;
    expect(frame.src).toBe('http://192.168.1.86/liveview');
  });

  it('links to the native UI in a new tab', () => {
    renderTab();
    const link = screen.getByRole('link', { name: 'Open native UI' }) as HTMLAnchorElement;
    expect(link.href).toBe('http://192.168.1.86/');
    expect(link.target).toBe('_blank');
  });

  it('reboots only after modal confirmation', async () => {
    const { fn } = renderTab({ 'POST /api/controllers/c1/reboot': { ok: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
    await screen.findByText(/Reboot “Cabinet Lights”\?/);
    expect(fn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reboot' }));
    await waitFor(() => expect(fn).toHaveBeenCalledWith(
      '/api/controllers/c1/reboot', expect.objectContaining({ method: 'POST' })));
  });

  it('removes the controller after confirmation and calls onRemoved', async () => {
    const { fn, onRemoved } = renderTab({ 'DELETE /api/controllers/c1': {} });
    fireEvent.click(screen.getByRole('button', { name: 'Remove controller' }));
    await screen.findByText(/Remove “Cabinet Lights” from uber-wled\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(fn).toHaveBeenCalledWith('/api/controllers/c1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('imports device schedules and toasts the result', async () => {
    const { fn } = renderTab({
      'POST /api/controllers/c1/import-schedules': { imported: [{}, {}], skipped: [] }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import schedules' }));
    await screen.findByText('Schedules imported');
    expect(JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string))
      .toEqual({ disableOnDevice: false });
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/InfoTab.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/InfoTab.tsx`:

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteController, importSchedules, rebootController, type Controller
} from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { humanizeUptime, signalBars } from './format';
import './devices.css';

export interface InfoTabProps {
  controller: Controller;
  live: LiveStatusEntry | undefined;
  onRemoved: () => void;
}

export function InfoTab({ controller, live, onRemoved }: InfoTabProps) {
  const info = live?.info;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmReboot, setConfirmReboot] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const facts: [string, string][] = [
    ['IP address', info?.ip ?? controller.host],
    ['MAC', info?.mac ?? '—'],
    ['Version', info ? `${info.ver} (build ${info.vid ?? '—'})` : '—'],
    ['Architecture', info?.arch ?? '—'],
    ['Uptime', info?.uptime !== undefined ? humanizeUptime(info.uptime) : '—'],
    ['WiFi signal', info?.wifi
      ? `${info.wifi.signal}% (${signalBars(info.wifi.signal)}/4 bars), channel ${info.wifi.channel}`
      : '—'],
    ['BSSID', info?.wifi?.bssid ?? '—'],
    ['FPS', info?.leds.fps !== undefined ? String(info.leds.fps) : '—'],
    ['Free heap', info?.freeheap !== undefined ? `${Math.round(info.freeheap / 1024)} KiB` : '—'],
    ['Filesystem', info?.fs ? `${info.fs.u} / ${info.fs.t} KiB` : '—'],
    ['LEDs', info ? `${info.leds.count}${info.leds.rgbw ? ' RGBW' : ''}` : '—'],
    ['Usermods', info?.u && Object.keys(info.u).length > 0 ? Object.keys(info.u).join(', ') : 'none']
  ];

  async function handleReboot() {
    setBusy(true);
    try {
      await rebootController(controller.id);
      setConfirmReboot(false);
      toast.show({
        title: 'Rebooting',
        description: `${controller.name} is restarting — it drops offline for a few seconds.`,
        variant: 'info'
      });
    } catch {
      toast.show({ title: 'Reboot failed', variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await deleteController(controller.id);
      await queryClient.invalidateQueries({ queryKey: ['controllers'] });
      onRemoved();
    } finally {
      setBusy(false);
    }
  }

  async function handleImportSchedules() {
    setImporting(true);
    try {
      const res = await importSchedules(controller.id, false);
      toast.show({
        title: 'Schedules imported',
        description: `Imported ${res.imported.length}, skipped ${res.skipped.length}.`,
        variant: 'success'
      });
    } catch {
      toast.show({ title: 'Schedule import failed', variant: 'error' });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="info-tab">
      {live !== undefined && !live.reachable && <Chip variant="danger">Offline</Chip>}
      <Card>
        <h3>Live output</h3>
        <iframe
          className="info-liveview"
          src={`http://${controller.host}/liveview`}
          title={`Live output of ${controller.name}`}
        />
      </Card>
      <Card>
        <h3>Device facts</h3>
        <dl className="facts-grid">
          {facts.map(([label, value]) => (
            <div className="fact" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card>
        <h3>Actions</h3>
        <div className="info-actions-row">
          <a href={`http://${controller.host}`} target="_blank" rel="noreferrer">Open native UI</a>
          <Button variant="secondary" onClick={handleImportSchedules} disabled={importing}>
            {importing ? 'Importing…' : 'Import schedules'}
          </Button>
          <Button variant="danger" onClick={() => setConfirmReboot(true)}>Reboot</Button>
          <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove controller</Button>
        </div>
      </Card>
      <Modal open={confirmReboot} onClose={() => setConfirmReboot(false)} title="Reboot device"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReboot(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReboot} disabled={busy}>Confirm reboot</Button>
          </>
        }>
        <p>Reboot “{controller.name}”? Lights turn off until it restarts (a few seconds).</p>
      </Modal>
      <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove controller"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRemove} disabled={busy}>Remove</Button>
          </>
        }>
        <p>
          Remove “{controller.name}” from uber-wled? The device itself is not changed; groups,
          strips, and schedules that reference it will stop matching.
        </p>
      </Modal>
    </div>
  );
}
```

- [ ] Run again → expect PASS (6 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: Info tab - facts grid, liveview peek, reboot/remove confirms, native UI link, schedule import"`

---

## Task 7: Full segments editor — `SegmentsTab.tsx`

**Files:**
- Create: `client/src/sections/devices/SegmentsTab.tsx`
- Test: `client/src/test/devices/SegmentsTab.test.tsx`

**Interfaces:**
- Consumes: `useDeviceSegments` (Task 2); `updateControllerSegment`, `createControllerSegment`, `deleteControllerSegment`, `DeviceSegment`, `SegmentUpdate` (Task 2 — the PUT body field is `name`, never `n`); `validateSegmentBounds`, `nextFreeSegmentId` (Task 1); `Button`, `Card`, `Field`, `Modal`, `Skeleton`, `Slider`, `Toggle`, `useToast` (kit).
- Produces:
  - `SegmentsTab({ controllerId: string; ledCount: number; maxSeg: number })` — `ledCount <= 0` (device offline, no live info yet) disables only the upper-bound check, everything else still validates; `maxSeg` caps creation via `nextFreeSegmentId`.
  - `SegmentRow({ segment, ledCount, busy, onApply(segId, patch), onDelete(segId) })` (exported for reuse/testing).
- Write behavior: every segment route returns the fresh `DeviceSegment[]`, which is absorbed straight into the `['segments', controllerId]` query cache — no refetch. On/brightness/reverse/mirror apply immediately (single-field PUTs, "applies live" per spec); bounds/grouping/spacing/offset/name go through the row's validated Apply button.

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/SegmentsTab.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SegmentsTab } from '../../sections/devices/SegmentsTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { SEGMENTS } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function renderTab(routes: Record<string, unknown> = {}) {
  const fn = stubFetchRoutes({ 'GET /api/controllers/c1/segments': SEGMENTS, ...routes });
  const utils = renderDevices(<SegmentsTab controllerId="c1" ledCount={48} maxSeg={32} />);
  return { fn, ...utils };
}

describe('SegmentsTab', () => {
  it('renders one editor card per segment with the probed bounds', async () => {
    renderTab();
    const seg0 = await screen.findByTestId('segment-0');
    expect(screen.getByText('Segment 1')).toBeTruthy();
    expect((within(seg0).getByLabelText('Start') as HTMLInputElement).value).toBe('0');
    expect((within(seg0).getByLabelText('Stop') as HTMLInputElement).value).toBe('39');
    expect((within(seg0).getByLabelText('Name') as HTMLInputElement).value).toBe('Cabinet run');
  });

  it('validates bounds live and blocks Apply with an error', async () => {
    renderTab();
    const seg0 = await screen.findByTestId('segment-0');
    fireEvent.change(within(seg0).getByLabelText('Stop'), { target: { value: '49' } });
    expect(within(seg0).getByRole('alert').textContent).toMatch(/48/);
    expect((within(seg0).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('PUTs the widened field set (name, not n) on Apply', async () => {
    const { fn } = renderTab({ 'PUT /api/controllers/c1/segments/0': SEGMENTS });
    const seg0 = await screen.findByTestId('segment-0');
    fireEvent.change(within(seg0).getByLabelText('Name'), { target: { value: 'Left run' } });
    fireEvent.change(within(seg0).getByLabelText('Stop'), { target: { value: '40' } });
    fireEvent.click(within(seg0).getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const call = fn.mock.calls.find(([url]) => String(url).endsWith('/segments/0'));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        name: 'Left run', start: 0, stop: 40, grp: 1, spc: 0, of: 0
      });
    });
  });

  it('applies live toggles (reverse) as single-field PUTs', async () => {
    const { fn } = renderTab({ 'PUT /api/controllers/c1/segments/1': SEGMENTS });
    await screen.findByTestId('segment-1');
    fireEvent.click(screen.getByRole('switch', { name: 'Segment 1 reverse' }));
    await waitFor(() => {
      const call = fn.mock.calls.find(([url]) => String(url).endsWith('/segments/1'));
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ rev: true });
    });
  });

  it('deletes a segment only after modal confirmation', async () => {
    const { fn } = renderTab({ 'DELETE /api/controllers/c1/segments/1': [SEGMENTS[0]] });
    const seg1 = await screen.findByTestId('segment-1');
    fireEvent.click(within(seg1).getByRole('button', { name: 'Delete' }));
    await screen.findByText(/Delete segment 1\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete segment' }));
    await waitFor(() => expect(fn).toHaveBeenCalledWith(
      '/api/controllers/c1/segments/1', expect.objectContaining({ method: 'DELETE' })));
  });

  it('creates a segment from the new-segment form', async () => {
    const { fn } = renderTab({
      'POST /api/controllers/c1/segments': [...SEGMENTS, { ...SEGMENTS[1], id: 2, start: 0, stop: 12 }]
    });
    const create = await screen.findByTestId('segment-create');
    fireEvent.change(within(create).getByLabelText('Start'), { target: { value: '0' } });
    fireEvent.change(within(create).getByLabelText('Stop'), { target: { value: '12' } });
    fireEvent.click(within(create).getByRole('button', { name: 'Add segment' }));
    await waitFor(() => {
      const call = fn.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ start: 0, stop: 12 });
    });
  });

  it('disables Add segment when every slot is used', async () => {
    const all = Array.from({ length: 32 }, (_, i) => ({ ...SEGMENTS[0], id: i }));
    stubFetchRoutes({ 'GET /api/controllers/c1/segments': all });
    renderDevices(<SegmentsTab controllerId="c1" ledCount={48} maxSeg={32} />);
    await screen.findByText('Segment 31');
    expect(screen.getByText(/All 32 segment slots are in use/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add segment' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/SegmentsTab.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/SegmentsTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createControllerSegment, deleteControllerSegment, updateControllerSegment,
  type DeviceSegment, type SegmentUpdate
} from '../../api/client';
import { useDeviceSegments } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { Slider } from '../../components/ui/Slider';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';
import { nextFreeSegmentId, validateSegmentBounds } from './segmentLogic';
import './devices.css';

export interface SegmentsTabProps {
  controllerId: string;
  ledCount: number;
  maxSeg: number;
}

export interface SegmentRowProps {
  segment: DeviceSegment;
  ledCount: number;
  busy: boolean;
  onApply: (segId: number, patch: SegmentUpdate) => void;
  onDelete: (segId: number) => void;
}

export function SegmentRow({ segment, ledCount, busy, onApply, onDelete }: SegmentRowProps) {
  const [name, setName] = useState(segment.n ?? '');
  const [start, setStart] = useState(String(segment.start));
  const [stop, setStop] = useState(String(segment.stop));
  const [grp, setGrp] = useState(String(segment.grp));
  const [spc, setSpc] = useState(String(segment.spc));
  const [of, setOf] = useState(String(segment.of));
  const [bri, setBri] = useState(segment.bri);
  useEffect(() => setBri(segment.bri), [segment.bri]);

  const limit = ledCount > 0 ? ledCount : Number.MAX_SAFE_INTEGER;
  const boundsError = validateSegmentBounds(Number(start), Number(stop), limit);

  function apply() {
    if (boundsError) return;
    onApply(segment.id, {
      name,
      start: Number(start),
      stop: Number(stop),
      grp: Number(grp),
      spc: Number(spc),
      of: Number(of)
    });
  }

  return (
    <Card className="segment-row" data-testid={`segment-${segment.id}`}>
      <div className="segment-row-header">
        <h3>Segment {segment.id}</h3>
        <Toggle label={`Segment ${segment.id} power`} checked={segment.on}
          onChange={(on) => onApply(segment.id, { on })} disabled={busy} />
      </div>
      <div className="segment-grid">
        <Field label="Name" htmlFor={`seg-${segment.id}-name`}>
          <input id={`seg-${segment.id}-name`} className="input" value={name}
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Start" htmlFor={`seg-${segment.id}-start`} error={boundsError ?? undefined}>
          <input id={`seg-${segment.id}-start`} className="input" type="number" inputMode="numeric"
            value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Stop" htmlFor={`seg-${segment.id}-stop`}
          hint={ledCount > 0 ? `Device has ${ledCount} LEDs` : undefined}>
          <input id={`seg-${segment.id}-stop`} className="input" type="number" inputMode="numeric"
            value={stop} onChange={(e) => setStop(e.target.value)} />
        </Field>
        <Field label="Grouping" htmlFor={`seg-${segment.id}-grp`}>
          <input id={`seg-${segment.id}-grp`} className="input" type="number" inputMode="numeric"
            value={grp} onChange={(e) => setGrp(e.target.value)} />
        </Field>
        <Field label="Spacing" htmlFor={`seg-${segment.id}-spc`}>
          <input id={`seg-${segment.id}-spc`} className="input" type="number" inputMode="numeric"
            value={spc} onChange={(e) => setSpc(e.target.value)} />
        </Field>
        <Field label="Offset" htmlFor={`seg-${segment.id}-of`}>
          <input id={`seg-${segment.id}-of`} className="input" type="number" inputMode="numeric"
            value={of} onChange={(e) => setOf(e.target.value)} />
        </Field>
      </div>
      <div className="segment-switches">
        <Toggle label={`Segment ${segment.id} reverse`} checked={segment.rev}
          onChange={(rev) => onApply(segment.id, { rev })} disabled={busy} />
        <Toggle label={`Segment ${segment.id} mirror`} checked={segment.mi}
          onChange={(mi) => onApply(segment.id, { mi })} disabled={busy} />
      </div>
      <Slider label={`Segment ${segment.id} brightness`} value={bri} min={1} max={255}
        onChange={setBri} onCommit={(v) => onApply(segment.id, { bri: v })} disabled={busy} />
      <div className="segment-row-actions">
        <Button variant="primary" onClick={apply} disabled={busy || boundsError !== null}>Apply</Button>
        <Button variant="danger" onClick={() => onDelete(segment.id)} disabled={busy}>Delete</Button>
      </div>
    </Card>
  );
}

export function SegmentsTab({ controllerId, ledCount, maxSeg }: SegmentsTabProps) {
  const segments = useDeviceSegments(controllerId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [newStart, setNewStart] = useState('0');
  const [newStop, setNewStop] = useState('');

  async function run(op: () => Promise<DeviceSegment[]>, errorTitle: string) {
    setBusy(true);
    try {
      const next = await op();
      queryClient.setQueryData(['segments', controllerId], next);
    } catch {
      toast.show({ title: errorTitle, variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const list = segments.data ?? [];
  const nextId = nextFreeSegmentId(list, maxSeg);
  const limit = ledCount > 0 ? ledCount : Number.MAX_SAFE_INTEGER;
  const createError = newStop === '' ? null : validateSegmentBounds(Number(newStart), Number(newStop), limit);

  if (segments.isLoading) return <Skeleton height="120px" />;
  if (segments.isError) return <p role="alert">Could not load segments — is the device reachable?</p>;

  return (
    <div className="segments-tab">
      {list.map((segment) => (
        <SegmentRow key={segment.id} segment={segment} ledCount={ledCount} busy={busy}
          onApply={(segId, patch) =>
            run(() => updateControllerSegment(controllerId, segId, patch), 'Segment update failed')}
          onDelete={setDeleteId} />
      ))}
      <Card className="segment-create" data-testid="segment-create">
        <h3>New segment</h3>
        <div className="segment-grid">
          <Field label="Start" htmlFor="seg-new-start" error={createError ?? undefined}>
            <input id="seg-new-start" className="input" type="number" inputMode="numeric"
              value={newStart} onChange={(e) => setNewStart(e.target.value)} />
          </Field>
          <Field label="Stop" htmlFor="seg-new-stop"
            hint={ledCount > 0 ? `Up to ${ledCount}` : undefined}>
            <input id="seg-new-stop" className="input" type="number" inputMode="numeric"
              value={newStop} onChange={(e) => setNewStop(e.target.value)} />
          </Field>
        </div>
        {nextId === null && <p role="alert">All {maxSeg} segment slots are in use.</p>}
        <Button variant="primary"
          disabled={busy || nextId === null || newStop === '' || createError !== null}
          onClick={() =>
            run(
              () => createControllerSegment(controllerId, { start: Number(newStart), stop: Number(newStop) }),
              'Segment create failed'
            ).then(() => setNewStop(''))
          }>
          Add segment
        </Button>
      </Card>
      <Modal open={deleteId !== null} onClose={() => setDeleteId(null)} title="Delete segment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" disabled={busy}
              onClick={() => {
                const id = deleteId;
                setDeleteId(null);
                if (id !== null) run(() => deleteControllerSegment(controllerId, id), 'Segment delete failed');
              }}>
              Delete segment
            </Button>
          </>
        }>
        <p>Delete segment {deleteId}? Its LEDs go dark until another segment covers them.</p>
      </Modal>
    </div>
  );
}
```

- [ ] Run again → expect PASS (7 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: full segments editor with validated bounds, live toggles, create/delete"`

---

## Task 8: Device presets tab — apply via `ps` patch, delete, save-current

**Files:**
- Create: `client/src/sections/devices/DevicePresetsTab.tsx`
- Test: `client/src/test/devices/DevicePresetsTab.test.tsx`

**Interfaces:**
- Consumes: `useDevicePresets` (Phase D Task 2, key `['presets', id]`); `applyControl`, `saveControllerPreset`, `deleteControllerPreset`, `DevicePreset` (Task 2 + drift guards); kit `Button`, `Card`, `Chip`, `Field`, `Modal`, `Skeleton`, `Toggle`, `useToast`.
- Produces: `DevicePresetsTab({ controllerId: string })`.
- BINDING transport (master + `04-control-surface.md` Task 10 decision): preset APPLY has **no dedicated route** — it is `applyControl([{ kind: 'controller', controllerId }], { ps: preset.id })`. Single-controller by construction here (the tab lives inside one device's detail page). Do NOT fall back to the v1 preset action.

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/DevicePresetsTab.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { DevicePresetsTab } from '../../sections/devices/DevicePresetsTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { DEVICE_PRESETS } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function renderTab(routes: Record<string, unknown> = {}) {
  const fn = stubFetchRoutes({
    'GET /api/controllers/c1/presets': { presets: DEVICE_PRESETS },
    ...routes
  });
  const utils = renderDevices(<DevicePresetsTab controllerId="c1" />);
  return { fn, ...utils };
}

describe('DevicePresetsTab', () => {
  it('lists device presets with ids and a playlist badge', async () => {
    renderTab();
    expect(await screen.findByText('Warm evening')).toBeTruthy();
    const partyRow = screen.getByText('Party loop').closest('li')!;
    expect(partyRow.textContent).toContain('Playlist');
  });

  it('applies a preset through the v2 fan-out with a { ps } patch', async () => {
    const { fn } = renderTab({
      'POST /api/control/apply': { results: [{ controllerId: 'c1', wledSegId: null, ok: true }] }
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply preset Warm evening' }));
    await screen.findByText('Applied “Warm evening”');
    const call = fn.mock.calls.find(([url]) => String(url) === '/api/control/apply');
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      targets: [{ kind: 'controller', controllerId: 'c1' }],
      patch: { ps: 1 }
    });
  });

  it('surfaces a per-target apply failure as an error toast', async () => {
    renderTab({
      'POST /api/control/apply': {
        results: [{ controllerId: 'c1', wledSegId: null, ok: false, error: 'unreachable' }]
      }
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply preset Warm evening' }));
    expect(await screen.findByText('Could not apply “Warm evening”')).toBeTruthy();
  });

  it('deletes a preset only after modal confirmation', async () => {
    const { fn } = renderTab({ 'DELETE /api/controllers/c1/presets/2': {} });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete preset Party loop' }));
    await screen.findByText(/Delete “Party loop” \(id 2\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }));
    await waitFor(() => expect(fn).toHaveBeenCalledWith(
      '/api/controllers/c1/presets/2', expect.objectContaining({ method: 'DELETE' })));
  });

  it('saves the current state with the two flags', async () => {
    const { fn } = renderTab({ 'POST /api/controllers/c1/presets': { id: 3, name: 'Evening warm' } });
    await screen.findByText('Warm evening');
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Evening warm' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Save segment bounds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    await screen.findByText('Saved preset 3: Evening warm');
    const call = fn.mock.calls.find(([url]) => String(url) === '/api/controllers/c1/presets');
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      name: 'Evening warm', includeBrightness: true, saveSegmentBounds: true
    });
  });

  it('disables Save preset while the name is empty', async () => {
    renderTab();
    await screen.findByText('Warm evening');
    expect((screen.getByRole('button', { name: 'Save preset' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/DevicePresetsTab.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/DevicePresetsTab.tsx`:

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  applyControl, deleteControllerPreset, saveControllerPreset, type DevicePreset
} from '../../api/client';
import { useDevicePresets } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { Toggle } from '../../components/ui/Toggle';
import { useToast } from '../../components/ui/Toast';
import './devices.css';

export function DevicePresetsTab({ controllerId }: { controllerId: string }) {
  const presets = useDevicePresets(controllerId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<DevicePreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [includeBrightness, setIncludeBrightness] = useState(true);
  const [saveSegmentBounds, setSaveSegmentBounds] = useState(false);

  async function applyPreset(preset: DevicePreset) {
    try {
      const { results } = await applyControl(
        [{ kind: 'controller', controllerId }],
        { ps: preset.id }
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.show({ title: `Applied “${preset.name}”`, variant: 'success' });
      } else {
        toast.show({ title: `Could not apply “${preset.name}”`, description: failed[0].error, variant: 'error' });
      }
    } catch {
      toast.show({ title: `Could not apply “${preset.name}”`, variant: 'error' });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteControllerPreset(controllerId, deleteTarget.id);
      await queryClient.invalidateQueries({ queryKey: ['presets', controllerId] });
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrent() {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      const saved = await saveControllerPreset(controllerId, {
        name: name.trim(), includeBrightness, saveSegmentBounds
      });
      await queryClient.invalidateQueries({ queryKey: ['presets', controllerId] });
      toast.show({ title: `Saved preset ${saved.id}: ${saved.name}`, variant: 'success' });
      setName('');
    } catch {
      toast.show({ title: 'Preset save failed', variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (presets.isLoading) return <Skeleton height="120px" />;
  if (presets.isError) return <p role="alert">Could not load presets — is the device reachable?</p>;

  const list = presets.data ?? [];

  return (
    <div className="presets-tab-device">
      <Card>
        <h3>Device presets</h3>
        {list.length === 0 && <p className="empty-state">No presets saved on this device yet.</p>}
        <ul className="device-preset-list">
          {list.map((preset) => (
            <li key={preset.id} className="device-preset-row">
              <span className="device-preset-id">{preset.id}</span>
              <span className="device-preset-name">{preset.name}</span>
              {preset.isPlaylist && <Chip variant="accent">Playlist</Chip>}
              <Button size="sm" onClick={() => applyPreset(preset)}
                aria-label={`Apply preset ${preset.name}`}>Apply</Button>
              <Button size="sm" variant="danger" onClick={() => setDeleteTarget(preset)}
                aria-label={`Delete preset ${preset.name}`}>Delete</Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3>Save current state as preset</h3>
        <Field label="Preset name" htmlFor="preset-save-name">
          <input id="preset-save-name" className="input" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="Evening warm" />
        </Field>
        <div className="preset-save-flags">
          <Toggle label="Include brightness" checked={includeBrightness} onChange={setIncludeBrightness} />
          <Toggle label="Save segment bounds" checked={saveSegmentBounds} onChange={setSaveSegmentBounds} />
        </div>
        <Button variant="primary" onClick={saveCurrent} disabled={busy || name.trim() === ''}>
          Save preset
        </Button>
      </Card>
      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete preset"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={busy}>Delete preset</Button>
          </>
        }>
        <p>
          Delete “{deleteTarget?.name}” (id {deleteTarget?.id}) from the device? This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
```

- [ ] Run again → expect PASS (6 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: device presets tab - apply via ps patch, delete confirm, save-current with flags"`

---

## Task 9: Config tab shell — dry-run → diff → confirm pipeline + Identity form

**Files:**
- Create: `client/src/sections/devices/ConfigTab.tsx`
- Create: `client/src/sections/devices/config/types.ts`
- Create: `client/src/sections/devices/config/IdentityForm.tsx`
- Test: `client/src/test/devices/ConfigTab.test.tsx`

**Interfaces:**
- Consumes: `useDeviceConfig` (Task 2, key `['config', id]`); `dryRunControllerConfig`, `applyControllerConfig`, `rebootController`, `ConfigDiffEntry` (Task 2); `DiffConfirmModal` (Task 5); `buildIdentityPatch`, `Cfg` (Task 4); kit `Button`, `Card`, `Field`, `Skeleton`, `Tabs`, `useToast`.
- Produces:
  - `ConfigTab({ controllerId: string })` — owns the ONE save pipeline every config form uses: `onSave(patch)` → `POST …/config?dryRun=1` → empty diff ⇒ info toast, else `DiffConfirmModal` → confirm ⇒ `POST …/config` → invalidate `['config', id]` → `rebootRequired` ⇒ inline "Reboot now / Later" offer (never reboots silently).
  - `config/types.ts`: `interface ConfigFormProps { cfg: Cfg; busy: boolean; onSave: (patch: Cfg) => void }` — shared by all six forms (Tasks 9–13).
  - `IdentityForm(props: ConfigFormProps)` — `id.name`, `id.mdns`.
- Tasks 10–13 EXTEND `ConfigTab.tsx`'s `CONFIG_PAGES` + render block with exact edits; this task ships it with the Identity page only.

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/ConfigTab.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfigTab } from '../../sections/devices/ConfigTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { PROBED_CFG } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

const GET_CFG = 'GET /api/controllers/c1/config';
const DRY = 'POST /api/controllers/c1/config?dryRun=1';
const APPLY = 'POST /api/controllers/c1/config';
const REBOOT = 'POST /api/controllers/c1/reboot';

function renderTab(routes: Record<string, unknown> = {}) {
  const fn = stubFetchRoutes({ [GET_CFG]: PROBED_CFG, ...routes });
  const utils = renderDevices(<ConfigTab controllerId="c1" />);
  return { fn, ...utils };
}

describe('ConfigTab', () => {
  it('loads the device config and seeds the Identity form from the probe', async () => {
    renderTab();
    expect(((await screen.findByLabelText('Device name')) as HTMLInputElement).value)
      .toBe('Cabinet Lights');
    expect((screen.getByLabelText('mDNS hostname') as HTMLInputElement).value)
      .toBe('cabinet-lights');
  });

  it('save runs the dry-run first and opens the diff modal', async () => {
    const { fn } = renderTab({
      [DRY]: { diff: [{ path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen' }], rebootRequired: false }
    });
    fireEvent.change(await screen.findByLabelText('Device name'), { target: { value: 'Kitchen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save identity' }));
    expect(await screen.findByText('id.name')).toBeTruthy();
    const call = fn.mock.calls.find(([url]) => String(url).includes('dryRun=1'));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      patch: { id: { name: 'Kitchen', mdns: 'cabinet-lights' } }
    });
  });

  it('confirm applies the same patch and toasts success (no reboot needed)', async () => {
    const { fn } = renderTab({
      [DRY]: { diff: [{ path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen' }], rebootRequired: false },
      [APPLY]: { ok: true, rebootRequired: false }
    });
    fireEvent.change(await screen.findByLabelText('Device name'), { target: { value: 'Kitchen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save identity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));
    await screen.findByText('Config saved');
    const call = fn.mock.calls.find(
      ([url, init]) => String(url) === '/api/controllers/c1/config' && (init as RequestInit).method === 'POST'
    );
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
      patch: { id: { name: 'Kitchen', mdns: 'cabinet-lights' } }
    });
  });

  it('an empty diff short-circuits to a "No changes" toast without a modal', async () => {
    renderTab({ [DRY]: { diff: [], rebootRequired: false } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save identity' }));
    expect(await screen.findByText('No changes to save')).toBeTruthy();
    expect(screen.queryByText('Review config changes')).toBeNull();
  });

  it('rebootRequired saves surface a Reboot now offer instead of rebooting silently', async () => {
    const { fn } = renderTab({
      [DRY]: { diff: [{ path: 'hw.led.total', from: 48, to: 49 }], rebootRequired: true },
      [APPLY]: { ok: true, rebootRequired: true },
      [REBOOT]: { ok: true }
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Save identity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reboot now' }));
    await waitFor(() => expect(fn).toHaveBeenCalledWith(
      '/api/controllers/c1/reboot', expect.objectContaining({ method: 'POST' })));
  });

  it('a failed dry-run toasts an error and opens nothing', async () => {
    renderTab(); // no DRY route registered → the stub rejects the dry-run fetch
    fireEvent.click(await screen.findByRole('button', { name: 'Save identity' }));
    expect(await screen.findByText('Could not preview changes')).toBeTruthy();
    expect(screen.queryByText('Review config changes')).toBeNull();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/ConfigTab.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/config/types.ts`:

```ts
import type { Cfg } from '../configPatches';

/** Contract between ConfigTab (owns the dry-run→diff→confirm pipeline) and every config form. */
export interface ConfigFormProps {
  cfg: Cfg;
  busy: boolean;
  onSave: (patch: Cfg) => void;
}
```

- [ ] Create `client/src/sections/devices/config/IdentityForm.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { buildIdentityPatch, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function IdentityForm({ cfg, busy, onSave }: ConfigFormProps) {
  const id = (cfg.id ?? {}) as Cfg;
  const [name, setName] = useState(String(id.name ?? ''));
  const [mdns, setMdns] = useState(String(id.mdns ?? ''));

  return (
    <Card className="config-form">
      <h3>Identity</h3>
      <Field label="Device name" htmlFor="cfg-id-name">
        <input id="cfg-id-name" className="input" value={name}
          onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="mDNS hostname" htmlFor="cfg-id-mdns"
        hint="Reachable as http://<hostname>.local">
        <input id="cfg-id-mdns" className="input" value={mdns}
          onChange={(e) => setMdns(e.target.value)} />
      </Field>
      <Button variant="primary" disabled={busy}
        onClick={() => onSave(buildIdentityPatch({ name, mdns }))}>
        Save identity
      </Button>
    </Card>
  );
}
```

- [ ] Create `client/src/sections/devices/ConfigTab.tsx`:

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  applyControllerConfig, dryRunControllerConfig, rebootController, type ConfigDiffEntry
} from '../../api/client';
import { useDeviceConfig } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import type { Cfg } from './configPatches';
import { DiffConfirmModal } from './DiffConfirmModal';
import { IdentityForm } from './config/IdentityForm';
import './devices.css';

const CONFIG_PAGES = [
  { id: 'identity', label: 'Identity' }
];

interface PendingSave {
  patch: Cfg;
  diff: ConfigDiffEntry[];
  rebootRequired: boolean;
}

export function ConfigTab({ controllerId }: { controllerId: string }) {
  const config = useDeviceConfig(controllerId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState('identity');
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebootOffer, setRebootOffer] = useState(false);

  async function requestSave(patch: Cfg) {
    setBusy(true);
    try {
      const res = await dryRunControllerConfig(controllerId, patch);
      if (res.diff.length === 0) {
        toast.show({ title: 'No changes to save', variant: 'info' });
        return;
      }
      setPending({ patch, diff: res.diff, rebootRequired: res.rebootRequired });
    } catch {
      toast.show({
        title: 'Could not preview changes',
        description: 'Dry-run failed — is the device reachable?',
        variant: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmSave() {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await applyControllerConfig(controllerId, pending.patch);
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ['config', controllerId] });
      if (res.rebootRequired) setRebootOffer(true);
      else toast.show({ title: 'Config saved', variant: 'success' });
    } catch {
      toast.show({ title: 'Config save failed', variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function rebootNow() {
    setRebootOffer(false);
    try {
      await rebootController(controllerId);
      toast.show({ title: 'Rebooting', description: 'The device drops offline for a few seconds.', variant: 'info' });
    } catch {
      toast.show({ title: 'Reboot failed', variant: 'error' });
    }
  }

  if (config.isLoading) return <Skeleton height="200px" />;
  if (config.isError || !config.data) {
    return <p role="alert">Could not load the device config — is it reachable?</p>;
  }

  const cfg = config.data as Cfg;

  return (
    <div className="config-tab">
      <Tabs label="Config pages" tabs={CONFIG_PAGES} active={page} onChange={setPage} />
      {page === 'identity' && <IdentityForm cfg={cfg} busy={busy} onSave={requestSave} />}
      <DiffConfirmModal
        open={pending !== null}
        diff={pending?.diff ?? []}
        rebootRequired={pending?.rebootRequired ?? false}
        busy={busy}
        onConfirm={confirmSave}
        onCancel={() => setPending(null)}
      />
      {rebootOffer && (
        <div className="config-reboot-offer" role="status">
          <p>Saved. These changes need a reboot to take effect.</p>
          <Button variant="primary" onClick={rebootNow}>Reboot now</Button>
          <Button variant="ghost" onClick={() => setRebootOffer(false)}>Later</Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] Run again → expect PASS (6 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: Config tab dry-run->diff->confirm pipeline + Identity form"`

---

## Task 10: LED & Hardware config form (per-output editor)

**Files:**
- Create: `client/src/sections/devices/config/LedHardwareForm.tsx`
- Modify: `client/src/sections/devices/ConfigTab.tsx` (add the page)
- Test: `client/src/test/devices/LedHardwareForm.test.tsx`

**Interfaces:**
- Consumes: `ConfigFormProps` (Task 9); `LED_TYPES`, `COLOR_ORDERS`, `AUTO_WHITE_MODES`, `outputDraftFromRow`, `buildLedHardwarePatch`, `OutputDraft` (Task 4); kit `Button`, `Card`, `Field`, `Select`, `Toggle`.
- Produces: `LedHardwareForm(props: ConfigFormProps)` — edits `hw.led.total`, `hw.led.maxpwr`, and per `hw.led.ins[i]`: GPIO pin, type, length, start, color order (low nibble only), reversed, skip, per-output auto-white. Output rows can be edited but not added/removed (spec scope); global `hw.led.rgbwm` is never written.

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/LedHardwareForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LedHardwareForm } from '../../sections/devices/config/LedHardwareForm';
import { probedCfg } from './fixtures';

function renderForm(onSave = vi.fn()) {
  render(<LedHardwareForm cfg={probedCfg()} busy={false} onSave={onSave} />);
  return onSave;
}

describe('LedHardwareForm', () => {
  it('seeds both probed outputs: GPIO 16/3, type SK6812, color order BRG', () => {
    renderForm();
    const pins = screen.getAllByLabelText('GPIO pin') as HTMLInputElement[];
    expect(pins.map((p) => p.value)).toEqual(['16', '3']);
    expect((screen.getByLabelText('Output 1 LED type') as HTMLSelectElement).value).toBe('30');
    expect((screen.getByLabelText('Output 1 color order') as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText('Output 1 auto-white mode') as HTMLSelectElement).value).toBe('2');
  });

  it('editing output 1 length emits a merged-row patch that keeps unknown keys', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getAllByLabelText('Length')[0], { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED & hardware' }));
    const patch = onSave.mock.calls[0][0];
    expect(patch.hw.led.ins[0]).toMatchObject({ len: 40, ledma: 55, freq: 0, ref: false });
    expect(patch.hw.led.ins[1].len).toBe(9);
  });

  it('changing the color order preserves the white-swap high nibble (0x22 → 0x21)', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('Output 1 color order'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED & hardware' }));
    expect(onSave.mock.calls[0][0].hw.led.ins[0].order).toBe(33);
  });

  it('total and max power map to the hw.led globals and rgbwm is never written', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('Total LED count'), { target: { value: '49' } });
    fireEvent.change(screen.getByLabelText('Max power (mA, 0 = unlimited)'), { target: { value: '850' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED & hardware' }));
    const patch = onSave.mock.calls[0][0];
    expect(patch.hw.led.total).toBe(49);
    expect(patch.hw.led.maxpwr).toBe(850);
    expect('rgbwm' in patch.hw.led).toBe(false);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/LedHardwareForm.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/config/LedHardwareForm.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Select } from '../../../components/ui/Select';
import { Toggle } from '../../../components/ui/Toggle';
import {
  AUTO_WHITE_MODES, COLOR_ORDERS, LED_TYPES,
  buildLedHardwarePatch, outputDraftFromRow, type Cfg, type OutputDraft
} from '../configPatches';
import type { ConfigFormProps } from './types';

export function LedHardwareForm({ cfg, busy, onSave }: ConfigFormProps) {
  const led = (cfg.hw?.led ?? {}) as Cfg;
  const rows: Cfg[] = Array.isArray(led.ins) ? led.ins : [];
  const [total, setTotal] = useState(String(led.total ?? 0));
  const [maxpwr, setMaxpwr] = useState(String(led.maxpwr ?? 0));
  const [drafts, setDrafts] = useState<OutputDraft[]>(rows.map(outputDraftFromRow));

  function patchDraft(i: number, change: Partial<OutputDraft>) {
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...change } : d)));
  }

  return (
    <Card className="config-form">
      <h3>LED &amp; Hardware</h3>
      <p className="config-warning" role="note">
        Changing pins or output types can stop LED output or strand the device — every save here
        previews the exact diff and asks again before writing.
      </p>
      <div className="config-form-grid">
        <Field label="Total LED count" htmlFor="cfg-led-total">
          <input id="cfg-led-total" className="input" type="number" inputMode="numeric"
            value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <Field label="Max power (mA, 0 = unlimited)" htmlFor="cfg-led-maxpwr">
          <input id="cfg-led-maxpwr" className="input" type="number" inputMode="numeric"
            value={maxpwr} onChange={(e) => setMaxpwr(e.target.value)} />
        </Field>
      </div>
      {drafts.map((draft, i) => (
        <fieldset className="output-editor" key={i}>
          <legend>Output {i + 1}</legend>
          <div className="config-form-grid">
            <Field label="GPIO pin" htmlFor={`cfg-out-${i}-pin`}>
              <input id={`cfg-out-${i}-pin`} className="input" type="number" inputMode="numeric"
                value={String(draft.pin)}
                onChange={(e) => patchDraft(i, { pin: Number(e.target.value) })} />
            </Field>
            <Select label={`Output ${i + 1} LED type`} value={String(draft.type)}
              onChange={(v) => patchDraft(i, { type: Number(v) })}
              options={LED_TYPES.map((t) => ({ value: String(t.value), label: t.label }))} />
            <Field label="Length" htmlFor={`cfg-out-${i}-len`}>
              <input id={`cfg-out-${i}-len`} className="input" type="number" inputMode="numeric"
                value={String(draft.len)}
                onChange={(e) => patchDraft(i, { len: Number(e.target.value) })} />
            </Field>
            <Field label="Start" htmlFor={`cfg-out-${i}-start`}>
              <input id={`cfg-out-${i}-start`} className="input" type="number" inputMode="numeric"
                value={String(draft.start)}
                onChange={(e) => patchDraft(i, { start: Number(e.target.value) })} />
            </Field>
            <Select label={`Output ${i + 1} color order`} value={String(draft.colorOrder)}
              onChange={(v) => patchDraft(i, { colorOrder: Number(v) })}
              options={COLOR_ORDERS.map((o) => ({ value: String(o.value), label: o.label }))} />
            <Field label="Skip first LEDs" htmlFor={`cfg-out-${i}-skip`}>
              <input id={`cfg-out-${i}-skip`} className="input" type="number" inputMode="numeric"
                value={String(draft.skip)}
                onChange={(e) => patchDraft(i, { skip: Number(e.target.value) })} />
            </Field>
            <Select label={`Output ${i + 1} auto-white mode`} value={String(draft.rgbwm)}
              onChange={(v) => patchDraft(i, { rgbwm: Number(v) })}
              options={AUTO_WHITE_MODES.map((m) => ({ value: String(m.value), label: m.label }))} />
          </div>
          <Toggle label={`Output ${i + 1} reversed`} checked={draft.rev}
            onChange={(rev) => patchDraft(i, { rev })} />
        </fieldset>
      ))}
      <Button variant="primary" disabled={busy}
        onClick={() =>
          onSave(buildLedHardwarePatch(cfg, drafts, { total: Number(total), maxpwr: Number(maxpwr) }))
        }>
        Save LED &amp; hardware
      </Button>
    </Card>
  );
}
```

- [ ] Wire the page into `client/src/sections/devices/ConfigTab.tsx` — three exact edits:
  1. Add to the imports: `import { LedHardwareForm } from './config/LedHardwareForm';`
  2. Extend `CONFIG_PAGES`:

```ts
const CONFIG_PAGES = [
  { id: 'identity', label: 'Identity' },
  { id: 'led', label: 'LED & Hardware' }
];
```

  3. Add after the `identity` render line: `{page === 'led' && <LedHardwareForm cfg={cfg} busy={busy} onSave={requestSave} />}`
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/LedHardwareForm.test.tsx src/test/devices/ConfigTab.test.tsx` → expect PASS (4 + 6 tests, ConfigTab unbroken).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: LED & Hardware config form with per-output editor (pin/type/order/skip/auto-white)"`

---

## Task 11: WiFi config form (write-only passwords, static IP validation)

**Files:**
- Create: `client/src/sections/devices/config/WifiForm.tsx`
- Modify: `client/src/sections/devices/ConfigTab.tsx` (add the page)
- Test: `client/src/test/devices/WifiForm.test.tsx`

**Interfaces:**
- Consumes: `ConfigFormProps` (Task 9); `buildWifiPatch`, `parseIpv4`, `formatIpv4` (Task 4); kit `Button`, `Card`, `Field`, `Toggle`.
- Produces: `WifiForm(props: ConfigFormProps)` — `nw.ins[0]` (ssid, write-only psk, static ip/gw/sn as dotted quads, `0.0.0.0` = DHCP) + `ap` (ssid, write-only psk, chan, hide). The strand-the-device warning is repeated inline here; the hard gate stays in `DiffConfirmModal` (every `nw.*`/`ap.*` diff path is strand-risk).

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/WifiForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WifiForm } from '../../sections/devices/config/WifiForm';
import { probedCfg } from './fixtures';

function renderForm(onSave = vi.fn()) {
  render(<WifiForm cfg={probedCfg()} busy={false} onSave={onSave} />);
  return onSave;
}

describe('WifiForm', () => {
  it('seeds from the probe and shows the saved-password hint', () => {
    renderForm();
    expect((screen.getByLabelText('Network SSID') as HTMLInputElement).value).toBe('Williams');
    expect((screen.getByLabelText('Static IP (0.0.0.0 = DHCP)') as HTMLInputElement).value).toBe('0.0.0.0');
    expect((screen.getByLabelText('Subnet mask') as HTMLInputElement).value).toBe('255.255.255.0');
    expect(screen.getByText(/A 10-character password is saved/)).toBeTruthy();
  });

  it('a blank password never enters the patch (write-only)', () => {
    const onSave = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save WiFi' }));
    const patch = onSave.mock.calls[0][0];
    expect('psk' in patch.nw.ins[0]).toBe(false);
    expect('psk' in patch.ap).toBe(false);
  });

  it('a typed password is included once', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('Network password'), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save WiFi' }));
    expect(onSave.mock.calls[0][0].nw.ins[0].psk).toBe('hunter22');
  });

  it('an invalid static IP shows an error and blocks the save', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('Static IP (0.0.0.0 = DHCP)'), { target: { value: 'lights.local' } });
    expect(screen.getByRole('alert').textContent).toMatch(/dotted-quad/i);
    expect((screen.getByRole('button', { name: 'Save WiFi' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/WifiForm.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/config/WifiForm.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Toggle } from '../../../components/ui/Toggle';
import { buildWifiPatch, formatIpv4, parseIpv4, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

const IP_ERROR = 'Use dotted-quad form, e.g. 192.168.1.50';

export function WifiForm({ cfg, busy, onSave }: ConfigFormProps) {
  const row0 = (cfg.nw?.ins?.[0] ?? {}) as Cfg;
  const ap = (cfg.ap ?? {}) as Cfg;
  const [ssid, setSsid] = useState(String(row0.ssid ?? ''));
  const [password, setPassword] = useState('');
  const [staticIp, setStaticIp] = useState(formatIpv4(row0.ip));
  const [gateway, setGateway] = useState(formatIpv4(row0.gw));
  const [subnet, setSubnet] = useState(formatIpv4(row0.sn));
  const [apSsid, setApSsid] = useState(String(ap.ssid ?? ''));
  const [apPassword, setApPassword] = useState('');
  const [apChannel, setApChannel] = useState(String(ap.chan ?? 1));
  const [apHide, setApHide] = useState(Boolean(ap.hide));

  const ipError = parseIpv4(staticIp) === null ? IP_ERROR : null;
  const gwError = parseIpv4(gateway) === null ? IP_ERROR : null;
  const snError = parseIpv4(subnet) === null ? IP_ERROR : null;
  const valid = !ipError && !gwError && !snError;

  return (
    <Card className="config-form">
      <h3>WiFi</h3>
      <p className="config-warning" role="note">
        A wrong SSID or password strands the device: it falls back to its own WLED-AP access
        point and disappears from this app until you rejoin it to the network.
      </p>
      <Field label="Network SSID" htmlFor="cfg-wifi-ssid">
        <input id="cfg-wifi-ssid" className="input" value={ssid}
          onChange={(e) => setSsid(e.target.value)} />
      </Field>
      <Field label="Network password" htmlFor="cfg-wifi-psk"
        hint={row0.pskl
          ? `A ${row0.pskl}-character password is saved — leave blank to keep it`
          : 'Leave blank to keep the saved password'}>
        <input id="cfg-wifi-psk" className="input" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      <div className="config-form-grid">
        <Field label="Static IP (0.0.0.0 = DHCP)" htmlFor="cfg-wifi-ip" error={ipError ?? undefined}>
          <input id="cfg-wifi-ip" className="input" value={staticIp}
            onChange={(e) => setStaticIp(e.target.value)} />
        </Field>
        <Field label="Gateway" htmlFor="cfg-wifi-gw" error={gwError ?? undefined}>
          <input id="cfg-wifi-gw" className="input" value={gateway}
            onChange={(e) => setGateway(e.target.value)} />
        </Field>
        <Field label="Subnet mask" htmlFor="cfg-wifi-sn" error={snError ?? undefined}>
          <input id="cfg-wifi-sn" className="input" value={subnet}
            onChange={(e) => setSubnet(e.target.value)} />
        </Field>
      </div>
      <h4>AP fallback</h4>
      <div className="config-form-grid">
        <Field label="AP SSID" htmlFor="cfg-ap-ssid">
          <input id="cfg-ap-ssid" className="input" value={apSsid}
            onChange={(e) => setApSsid(e.target.value)} />
        </Field>
        <Field label="AP password" htmlFor="cfg-ap-psk" hint="Leave blank to keep the saved password">
          <input id="cfg-ap-psk" className="input" type="password" value={apPassword}
            onChange={(e) => setApPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="AP channel" htmlFor="cfg-ap-chan">
          <input id="cfg-ap-chan" className="input" type="number" inputMode="numeric" min={1} max={13}
            value={apChannel} onChange={(e) => setApChannel(e.target.value)} />
        </Field>
      </div>
      <Toggle label="Hide AP SSID" checked={apHide} onChange={setApHide} />
      <Button variant="primary" disabled={busy || !valid}
        onClick={() =>
          onSave(buildWifiPatch(cfg, {
            ssid, password, staticIp, gateway, subnet,
            apSsid, apPassword, apChannel: Number(apChannel), apHide
          }))
        }>
        Save WiFi
      </Button>
    </Card>
  );
}
```

- [ ] Wire the page into `ConfigTab.tsx`: import `WifiForm`, add `{ id: 'wifi', label: 'WiFi' }` to `CONFIG_PAGES`, add `{page === 'wifi' && <WifiForm cfg={cfg} busy={busy} onSave={requestSave} />}` after the `led` render line.
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/WifiForm.test.tsx src/test/devices/ConfigTab.test.tsx` → expect PASS (4 + 6 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: WiFi config form with write-only passwords and static IP validation"`

---

## Task 12: Sync, Time, and LED-preferences config forms

**Files:**
- Create: `client/src/sections/devices/config/SyncForm.tsx`
- Create: `client/src/sections/devices/config/TimeForm.tsx`
- Create: `client/src/sections/devices/config/LedPrefsForm.tsx`
- Modify: `client/src/sections/devices/ConfigTab.tsx` (add the three pages)
- Test: `client/src/test/devices/configFormsMisc.test.tsx`

**Interfaces:**
- Consumes: `ConfigFormProps` (Task 9); `buildSyncPatch`, `buildTimePatch`, `buildLedPrefsPatch` (Task 4); kit `Button`, `Card`, `Field`, `Slider`, `Toggle`.
- Produces:
  - `SyncForm` — `if.sync` ports, recv flags (bri/col/fx/pal/seg/sb) + recv group, send flags (en/dir/hue) + send group. Untouched sync keys (espnow, btn, va, ret) stay out of the patch and survive via the server's object merge.
  - `TimeForm` — `if.ntp` (en, host, tz index, offset seconds, ampm, lat/lon).
  - `LedPrefsForm` — `def` (boot preset/on/brightness) + `light` (transition ms → `tr.dur` in 100 ms units, `gc.col` gamma, `scale-bri` factor).

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/configFormsMisc.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncForm } from '../../sections/devices/config/SyncForm';
import { TimeForm } from '../../sections/devices/config/TimeForm';
import { LedPrefsForm } from '../../sections/devices/config/LedPrefsForm';
import { probedCfg } from './fixtures';

describe('SyncForm', () => {
  it('seeds the probed ports and receive flags', () => {
    render(<SyncForm cfg={probedCfg()} busy={false} onSave={vi.fn()} />);
    expect((screen.getByLabelText('UDP port') as HTMLInputElement).value).toBe('21324');
    expect((screen.getByLabelText('UDP port 2') as HTMLInputElement).value).toBe('65506');
    expect(screen.getByRole('switch', { name: 'Receive brightness' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Receive segment options' }).getAttribute('aria-checked')).toBe('false');
  });

  it('saves only the edited sync keys (unknown keys stay server-side)', () => {
    const onSave = vi.fn();
    render(<SyncForm cfg={probedCfg()} busy={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Receive segment options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save sync' }));
    const patch = onSave.mock.calls[0][0];
    expect(patch.if.sync.recv).toEqual({
      bri: true, col: true, fx: true, pal: true, seg: true, sb: false, grp: 1
    });
    expect(patch.if.sync.port0).toBe(21324);
    expect('espnow' in patch.if.sync).toBe(false);
  });
});

describe('TimeForm', () => {
  it('seeds the probed NTP settings', () => {
    render(<TimeForm cfg={probedCfg()} busy={false} onSave={vi.fn()} />);
    expect((screen.getByLabelText('NTP server') as HTMLInputElement).value).toBe('0.wled.pool.ntp.org');
    expect((screen.getByLabelText('Timezone index (WLED table)') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('33.24');
  });

  it('saves the exact if.ntp shape', () => {
    const onSave = vi.fn();
    render(<TimeForm cfg={probedCfg()} busy={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Timezone index (WLED table)'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save time' }));
    expect(onSave.mock.calls[0][0]).toEqual({
      if: { ntp: { en: true, host: '0.wled.pool.ntp.org', tz: 6, offset: 0, ampm: false, lt: 33.24, ln: -96.78 } }
    });
  });
});

describe('LedPrefsForm', () => {
  it('seeds boot preset 1, boot brightness 128, transition 700 ms', () => {
    render(<LedPrefsForm cfg={probedCfg()} busy={false} onSave={vi.fn()} />);
    expect((screen.getByLabelText('Boot preset id (0 = none)') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Transition duration (ms)') as HTMLInputElement).value).toBe('700');
    expect((screen.getByLabelText('Boot brightness') as HTMLInputElement).value).toBe('128');
  });

  it('converts transition ms back to WLED 100ms units on save', () => {
    const onSave = vi.fn();
    render(<LedPrefsForm cfg={probedCfg()} busy={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Transition duration (ms)'), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED preferences' }));
    expect(onSave.mock.calls[0][0]).toEqual({
      def: { ps: 1, on: false, bri: 128 },
      light: { 'scale-bri': 100, gc: { col: 2.8 }, tr: { dur: 12 } }
    });
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/configFormsMisc.test.tsx` → expect FAIL: modules not found.
- [ ] Create `client/src/sections/devices/config/SyncForm.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Toggle } from '../../../components/ui/Toggle';
import { buildSyncPatch, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function SyncForm({ cfg, busy, onSave }: ConfigFormProps) {
  const sync = (cfg.if?.sync ?? {}) as Cfg;
  const recv = (sync.recv ?? {}) as Cfg;
  const send = (sync.send ?? {}) as Cfg;
  const [port0, setPort0] = useState(String(sync.port0 ?? 21324));
  const [port1, setPort1] = useState(String(sync.port1 ?? 65506));
  const [recvBri, setRecvBri] = useState(Boolean(recv.bri));
  const [recvCol, setRecvCol] = useState(Boolean(recv.col));
  const [recvFx, setRecvFx] = useState(Boolean(recv.fx));
  const [recvPal, setRecvPal] = useState(Boolean(recv.pal));
  const [recvSeg, setRecvSeg] = useState(Boolean(recv.seg));
  const [recvSb, setRecvSb] = useState(Boolean(recv.sb));
  const [recvGroups, setRecvGroups] = useState(String(recv.grp ?? 1));
  const [sendEn, setSendEn] = useState(Boolean(send.en));
  const [sendDir, setSendDir] = useState(Boolean(send.dir));
  const [sendHue, setSendHue] = useState(Boolean(send.hue));
  const [sendGroups, setSendGroups] = useState(String(send.grp ?? 1));

  return (
    <Card className="config-form">
      <h3>Sync interfaces</h3>
      <div className="config-form-grid">
        <Field label="UDP port" htmlFor="cfg-sync-port0">
          <input id="cfg-sync-port0" className="input" type="number" inputMode="numeric"
            value={port0} onChange={(e) => setPort0(e.target.value)} />
        </Field>
        <Field label="UDP port 2" htmlFor="cfg-sync-port1">
          <input id="cfg-sync-port1" className="input" type="number" inputMode="numeric"
            value={port1} onChange={(e) => setPort1(e.target.value)} />
        </Field>
        <Field label="Receive groups (bitmap)" htmlFor="cfg-sync-recv-grp">
          <input id="cfg-sync-recv-grp" className="input" type="number" inputMode="numeric"
            value={recvGroups} onChange={(e) => setRecvGroups(e.target.value)} />
        </Field>
        <Field label="Send groups (bitmap)" htmlFor="cfg-sync-send-grp">
          <input id="cfg-sync-send-grp" className="input" type="number" inputMode="numeric"
            value={sendGroups} onChange={(e) => setSendGroups(e.target.value)} />
        </Field>
      </div>
      <div className="segment-switches">
        <Toggle label="Receive brightness" checked={recvBri} onChange={setRecvBri} />
        <Toggle label="Receive color" checked={recvCol} onChange={setRecvCol} />
        <Toggle label="Receive effects" checked={recvFx} onChange={setRecvFx} />
        <Toggle label="Receive palette" checked={recvPal} onChange={setRecvPal} />
        <Toggle label="Receive segment options" checked={recvSeg} onChange={setRecvSeg} />
        <Toggle label="Receive segment bounds" checked={recvSb} onChange={setRecvSb} />
        <Toggle label="Send on change" checked={sendEn} onChange={setSendEn} />
        <Toggle label="Notify on direct change" checked={sendDir} onChange={setSendDir} />
        <Toggle label="Sync with Hue" checked={sendHue} onChange={setSendHue} />
      </div>
      <Button variant="primary" disabled={busy}
        onClick={() =>
          onSave(buildSyncPatch({
            port0: Number(port0), port1: Number(port1),
            recvBri, recvCol, recvFx, recvPal, recvSeg, recvSb, recvGroups: Number(recvGroups),
            sendEn, sendDir, sendHue, sendGroups: Number(sendGroups)
          }))
        }>
        Save sync
      </Button>
    </Card>
  );
}
```

- [ ] Create `client/src/sections/devices/config/TimeForm.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Toggle } from '../../../components/ui/Toggle';
import { buildTimePatch, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function TimeForm({ cfg, busy, onSave }: ConfigFormProps) {
  const ntp = (cfg.if?.ntp ?? {}) as Cfg;
  const [enabled, setEnabled] = useState(Boolean(ntp.en));
  const [host, setHost] = useState(String(ntp.host ?? '0.wled.pool.ntp.org'));
  const [tz, setTz] = useState(String(ntp.tz ?? 0));
  const [offset, setOffset] = useState(String(ntp.offset ?? 0));
  const [ampm, setAmpm] = useState(Boolean(ntp.ampm));
  const [lat, setLat] = useState(String(ntp.lt ?? 0));
  const [lon, setLon] = useState(String(ntp.ln ?? 0));

  return (
    <Card className="config-form">
      <h3>Time</h3>
      <Toggle label="Use NTP" checked={enabled} onChange={setEnabled} />
      <Field label="NTP server" htmlFor="cfg-ntp-host">
        <input id="cfg-ntp-host" className="input" value={host}
          onChange={(e) => setHost(e.target.value)} />
      </Field>
      <div className="config-form-grid">
        <Field label="Timezone index (WLED table)" htmlFor="cfg-ntp-tz"
          hint="Index into WLED's timezone list (probed 5 = US Central)">
          <input id="cfg-ntp-tz" className="input" type="number" inputMode="numeric"
            value={tz} onChange={(e) => setTz(e.target.value)} />
        </Field>
        <Field label="UTC offset (seconds)" htmlFor="cfg-ntp-offset">
          <input id="cfg-ntp-offset" className="input" type="number" inputMode="numeric"
            value={offset} onChange={(e) => setOffset(e.target.value)} />
        </Field>
        <Field label="Latitude" htmlFor="cfg-ntp-lat">
          <input id="cfg-ntp-lat" className="input" type="number" step="0.01"
            value={lat} onChange={(e) => setLat(e.target.value)} />
        </Field>
        <Field label="Longitude" htmlFor="cfg-ntp-lon">
          <input id="cfg-ntp-lon" className="input" type="number" step="0.01"
            value={lon} onChange={(e) => setLon(e.target.value)} />
        </Field>
      </div>
      <Toggle label="12-hour clock (AM/PM)" checked={ampm} onChange={setAmpm} />
      <Button variant="primary" disabled={busy}
        onClick={() =>
          onSave(buildTimePatch({
            ntpEnabled: enabled, ntpHost: host, timezone: Number(tz),
            offsetSeconds: Number(offset), ampm, latitude: Number(lat), longitude: Number(lon)
          }))
        }>
        Save time
      </Button>
    </Card>
  );
}
```

- [ ] Create `client/src/sections/devices/config/LedPrefsForm.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Toggle } from '../../../components/ui/Toggle';
import { buildLedPrefsPatch, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function LedPrefsForm({ cfg, busy, onSave }: ConfigFormProps) {
  const def = (cfg.def ?? {}) as Cfg;
  const light = (cfg.light ?? {}) as Cfg;
  const tr = (light.tr ?? {}) as Cfg;
  const gc = (light.gc ?? {}) as Cfg;
  const [bootPreset, setBootPreset] = useState(String(def.ps ?? 0));
  const [bootOn, setBootOn] = useState(Boolean(def.on));
  const [bootBri, setBootBri] = useState(String(def.bri ?? 128));
  const [transitionMs, setTransitionMs] = useState(String(Number(tr.dur ?? 7) * 100));
  const [gammaColor, setGammaColor] = useState(String(gc.col ?? 2.8));
  const [brightnessFactor, setBrightnessFactor] = useState(String(light['scale-bri'] ?? 100));

  return (
    <Card className="config-form">
      <h3>LED preferences</h3>
      <div className="config-form-grid">
        <Field label="Boot preset id (0 = none)" htmlFor="cfg-def-ps">
          <input id="cfg-def-ps" className="input" type="number" inputMode="numeric"
            value={bootPreset} onChange={(e) => setBootPreset(e.target.value)} />
        </Field>
        <Field label="Boot brightness" htmlFor="cfg-def-bri">
          <input id="cfg-def-bri" className="input" type="number" inputMode="numeric" min={1} max={255}
            value={bootBri} onChange={(e) => setBootBri(e.target.value)} />
        </Field>
        <Field label="Transition duration (ms)" htmlFor="cfg-light-tr">
          <input id="cfg-light-tr" className="input" type="number" inputMode="numeric" step={100}
            value={transitionMs} onChange={(e) => setTransitionMs(e.target.value)} />
        </Field>
        <Field label="Color gamma" htmlFor="cfg-light-gc">
          <input id="cfg-light-gc" className="input" type="number" step="0.1"
            value={gammaColor} onChange={(e) => setGammaColor(e.target.value)} />
        </Field>
        <Field label="Brightness factor (%)" htmlFor="cfg-light-scale">
          <input id="cfg-light-scale" className="input" type="number" inputMode="numeric"
            value={brightnessFactor} onChange={(e) => setBrightnessFactor(e.target.value)} />
        </Field>
      </div>
      <Toggle label="Turn on at boot" checked={bootOn} onChange={setBootOn} />
      <Button variant="primary" disabled={busy}
        onClick={() =>
          onSave(buildLedPrefsPatch({
            bootPreset: Number(bootPreset), bootOn, bootBri: Number(bootBri),
            transitionDurationMs: Number(transitionMs),
            gammaColor: Number(gammaColor), brightnessFactor: Number(brightnessFactor)
          }))
        }>
        Save LED preferences
      </Button>
    </Card>
  );
}
```

- [ ] Wire the three pages into `ConfigTab.tsx`: import `SyncForm`, `TimeForm`, `LedPrefsForm`; extend `CONFIG_PAGES` with `{ id: 'sync', label: 'Sync' }, { id: 'time', label: 'Time' }, { id: 'prefs', label: 'LED Prefs' }`; add the three render lines (`{page === 'sync' && <SyncForm …/>}` etc.) after the `wifi` line, all passing `cfg={cfg} busy={busy} onSave={requestSave}`.
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/configFormsMisc.test.tsx src/test/devices/ConfigTab.test.tsx` → expect PASS (6 + 6 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: Sync, Time, and LED-preferences config forms"`

---

## Task 13: Advanced raw-JSON config editor

**Files:**
- Create: `client/src/sections/devices/config/AdvancedJsonForm.tsx`
- Modify: `client/src/sections/devices/ConfigTab.tsx` (add the page)
- Test: `client/src/test/devices/AdvancedJsonForm.test.tsx`

**Interfaces:**
- Consumes: `ConfigFormProps` (Task 9); kit `Button`, `Card`, `Field`.
- Produces: `AdvancedJsonForm(props: ConfigFormProps)` — a `<textarea>` seeded with the full pretty-printed cfg. On save it parses (parse errors render in the `Field` error slot, `role="alert"`) and hands the WHOLE edited object to the shared pipeline: the server diff then contains only actually-changed paths, so usermod/exotic sections get full parity with the same DiffConfirmModal guardrail.

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/AdvancedJsonForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedJsonForm } from '../../sections/devices/config/AdvancedJsonForm';
import { probedCfg } from './fixtures';

function renderForm(onSave = vi.fn()) {
  render(<AdvancedJsonForm cfg={probedCfg()} busy={false} onSave={onSave} />);
  return onSave;
}

describe('AdvancedJsonForm', () => {
  it('seeds the editor with the full pretty-printed cfg (usermods included)', () => {
    renderForm();
    const editor = screen.getByLabelText('cfg.json') as HTMLTextAreaElement;
    expect(editor.value).toContain('"cabinet-lights"');
    expect(editor.value).toContain('"AudioReactive"');
  });

  it('invalid JSON shows a parse error and never calls onSave', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('cfg.json'), { target: { value: '{ nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save raw config' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a top-level non-object is rejected', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('cfg.json'), { target: { value: '[1,2]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save raw config' }));
    expect(screen.getByRole('alert').textContent).toMatch(/JSON object/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('an edited usermod value round-trips with every other field intact', () => {
    const onSave = renderForm();
    const cfg = probedCfg();
    cfg.um.AudioReactive.config.gain = 35;
    fireEvent.change(screen.getByLabelText('cfg.json'),
      { target: { value: JSON.stringify(cfg, null, 2) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save raw config' }));
    const patch = onSave.mock.calls[0][0];
    expect(patch.um.AudioReactive.config.gain).toBe(35);
    expect(patch.hw.led.ins[0].ledma).toBe(55);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/AdvancedJsonForm.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/config/AdvancedJsonForm.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import type { Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function AdvancedJsonForm({ cfg, busy, onSave }: ConfigFormProps) {
  const [text, setText] = useState(() => JSON.stringify(cfg, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('The config must be a JSON object');
      return;
    }
    setParseError(null);
    onSave(parsed as Cfg);
  }

  return (
    <Card className="config-form">
      <h3>Advanced (raw JSON)</h3>
      <p className="config-warning" role="note">
        Full cfg.json parity — usermod settings and every exotic section live here. The same
        dry-run diff preview runs before anything is written; only paths you actually changed
        are shown and applied.
      </p>
      <Field label="cfg.json" htmlFor="cfg-raw-json" error={parseError ?? undefined}>
        <textarea id="cfg-raw-json" className="input config-json-editor" spellCheck={false}
          rows={24} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="config-form-actions">
        <Button variant="secondary"
          onClick={() => { setText(JSON.stringify(cfg, null, 2)); setParseError(null); }}>
          Reset to device config
        </Button>
        <Button variant="primary" disabled={busy} onClick={save}>Save raw config</Button>
      </div>
    </Card>
  );
}
```

- [ ] Wire the page into `ConfigTab.tsx`: import `AdvancedJsonForm`, append `{ id: 'advanced', label: 'Advanced' }` to `CONFIG_PAGES`, add `{page === 'advanced' && <AdvancedJsonForm cfg={cfg} busy={busy} onSave={requestSave} />}` as the last render line. Final `CONFIG_PAGES` (target state):

```ts
const CONFIG_PAGES = [
  { id: 'identity', label: 'Identity' },
  { id: 'led', label: 'LED & Hardware' },
  { id: 'wifi', label: 'WiFi' },
  { id: 'sync', label: 'Sync' },
  { id: 'time', label: 'Time' },
  { id: 'prefs', label: 'LED Prefs' },
  { id: 'advanced', label: 'Advanced' }
];
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices` → expect PASS (whole devices suite so far).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: Advanced raw-JSON config editor with parse validation"`

---

## Task 14: Update tab — reuse the firmware pin/OTA flow

**Files:**
- Create: `client/src/sections/devices/UpdateTab.tsx`
- Test: `client/src/test/devices/UpdateTab.test.tsx`

**Interfaces:**
- Consumes: the EXISTING `FirmwareStatus` component (`client/src/components/FirmwareStatus.tsx:16` — installed-version line, update badge, `AssetPickerModal` pin flow, OTA push button; it fetches `GET /api/controllers/:id/firmware` itself). Kit `Card`.
- Produces: `UpdateTab({ controllerId: string })`.
- Cross-phase agreement (BINDING, `08-restyle-sections.md:2331,2500`): `FirmwareStatus.tsx` and `AssetPickerModal.tsx` are **kept** through Phases F and H (Phase H deletes only `FirmwareSection.tsx`; Phase I removes any leftovers). Do NOT delete or rewrite them here. The list card's `useFirmwareStatus` query (`['firmware', id]`) and this component's internal fetch intentionally coexist until Phase I consolidates.

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/UpdateTab.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { UpdateTab } from '../../sections/devices/UpdateTab';
import { renderDevices, stubFetchRoutes } from './helpers';
import { FIRMWARE_OK } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

describe('UpdateTab', () => {
  it('renders the reused firmware status with installed version and update badge', async () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': FIRMWARE_OK });
    renderDevices(<UpdateTab controllerId="c1" />);
    expect(await screen.findByText('Installed: 16.0.0')).toBeTruthy();
    expect(screen.getByText(/Update available \(v16\.1\.0\)/)).toBeTruthy();
  });

  it('offers the asset picker when the chip family is ambiguous', async () => {
    stubFetchRoutes({
      'GET /api/controllers/c1/firmware': {
        ...FIRMWARE_OK,
        pinnedAssetPattern: null,
        candidateAssets: [
          { name: 'WLED_16.1.0_ESP32.bin', downloadUrl: 'https://example/a' },
          { name: 'WLED_16.1.0_ESP32_audioreactive.bin', downloadUrl: 'https://example/b' }
        ]
      }
    });
    renderDevices(<UpdateTab controllerId="c1" />);
    expect(await screen.findByRole('button', { name: 'Pick firmware asset' })).toBeTruthy();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/UpdateTab.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/UpdateTab.tsx`:

```tsx
import { Card } from '../../components/ui/Card';
import { FirmwareStatus } from '../../components/FirmwareStatus';
import './devices.css';

export function UpdateTab({ controllerId }: { controllerId: string }) {
  return (
    <div className="update-tab">
      <Card>
        <h3>Firmware update</h3>
        <p className="config-warning" role="note">
          OTA updates flash the device and reboot it. Pin the exact asset for this board once —
          the pin is remembered for future releases. Fleet-wide status stays in the Firmware
          section.
        </p>
        <FirmwareStatus controllerId={controllerId} />
      </Card>
    </div>
  );
}
```

- [ ] Run again → expect PASS (2 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: Update tab reusing the firmware pin/OTA flow"`

---

## Task 15: Device list card — live status, signal bars, fps, uptime, update badge

**Files:**
- Create: `client/src/sections/devices/DeviceCard.tsx`
- Test: `client/src/test/devices/DeviceCard.test.tsx`

**Interfaces:**
- Consumes: `useFirmwareStatus` (Task 2, key `['firmware', id]`); `LiveStatusEntry` (Phase D); `humanizeUptime`, `signalBars` (Task 1); kit `Button`, `Card`, `Chip`.
- Produces:
  - `DeviceCard({ controller: Controller; live: LiveStatusEntry | undefined; onControl: (controllerId: string) => void; onOpen: (controllerId: string) => void })`
  - Rendered facts: name (button → `onOpen`), host, firmware version chip (live `info.ver`), power chip from live state, WiFi signal bars (`role="img"`, label `WiFi signal N of 4 bars`), FPS, uptime, `Offline` chip (`live.reachable === false`), `Stale` chip (poller flag, only when not live-offline), `Update available` chip (`useFirmwareStatus`), Control button (→ `onControl`, Phase D surface).

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/DeviceCard.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { DeviceCard } from '../../sections/devices/DeviceCard';
import { renderDevices, stubFetchRoutes } from './helpers';
import { CONTROLLERS, FIRMWARE_OK, liveEntry } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

const NO_UPDATE = { ...FIRMWARE_OK, updateAvailable: false };

describe('DeviceCard', () => {
  it('shows name, host, version chip and the live metrics', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    renderDevices(<DeviceCard controller={CONTROLLERS[0]} live={liveEntry()}
      onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Cabinet Lights')).toBeTruthy();
    expect(screen.getByText('192.168.1.86')).toBeTruthy();
    expect(screen.getByText('v16.0.0')).toBeTruthy();
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByText('42 FPS')).toBeTruthy();
    expect(screen.getByText('Up 32d 7h')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'WiFi signal 4 of 4 bars' })).toBeTruthy();
  });

  it('shows the update badge from the firmware query', async () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': FIRMWARE_OK });
    renderDevices(<DeviceCard controller={CONTROLLERS[0]} live={liveEntry()}
      onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(await screen.findByText('Update available')).toBeTruthy();
  });

  it('an unreachable live entry renders Offline and hides the power chip', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    renderDevices(<DeviceCard controller={CONTROLLERS[0]}
      live={{ reachable: false }} onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('On')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
  });

  it('a stale controller without live data shows the Stale chip', () => {
    stubFetchRoutes({ 'GET /api/controllers/c2/firmware': NO_UPDATE });
    renderDevices(<DeviceCard controller={CONTROLLERS[1]} live={undefined}
      onControl={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Stale')).toBeTruthy();
  });

  it('the Control button reports the controller id', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    const onControl = vi.fn();
    renderDevices(<DeviceCard controller={CONTROLLERS[0]} live={liveEntry()}
      onControl={onControl} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Control Cabinet Lights' }));
    expect(onControl).toHaveBeenCalledWith('c1');
  });

  it('the name opens the detail page', () => {
    stubFetchRoutes({ 'GET /api/controllers/c1/firmware': NO_UPDATE });
    const onOpen = vi.fn();
    renderDevices(<DeviceCard controller={CONTROLLERS[0]} live={liveEntry()}
      onControl={vi.fn()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Cabinet Lights' }));
    expect(onOpen).toHaveBeenCalledWith('c1');
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/DeviceCard.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/DeviceCard.tsx`:

```tsx
import type { Controller } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { useFirmwareStatus } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { humanizeUptime, signalBars } from './format';
import './devices.css';

export interface DeviceCardProps {
  controller: Controller;
  live: LiveStatusEntry | undefined;
  onControl: (controllerId: string) => void;
  onOpen: (controllerId: string) => void;
}

function SignalBars({ signal }: { signal: number }) {
  const bars = signalBars(signal);
  return (
    <span className="signal-bars" role="img" aria-label={`WiFi signal ${bars} of 4 bars`}>
      {[1, 2, 3, 4].map((level) => (
        <span key={level} className={level <= bars ? 'signal-bar signal-bar-on' : 'signal-bar'} />
      ))}
    </span>
  );
}

export function DeviceCard({ controller, live, onControl, onOpen }: DeviceCardProps) {
  const firmware = useFirmwareStatus(controller.id);
  const info = live?.info;
  const state = live?.state;
  const offline = live !== undefined && !live.reachable;

  return (
    <Card className="device-card">
      <div className="device-card-header">
        <button type="button" className="device-card-title"
          onClick={() => onOpen(controller.id)} aria-label={`Open ${controller.name}`}>
          {controller.name}
        </button>
        {info?.ver && <Chip>v{info.ver}</Chip>}
        {offline && <Chip variant="danger">Offline</Chip>}
        {!offline && controller.stale && <Chip variant="warning">Stale</Chip>}
        {firmware.data?.updateAvailable && <Chip variant="warning">Update available</Chip>}
      </div>
      <p className="device-card-host">{controller.host}</p>
      <div className="device-card-live">
        {state && <Chip variant={state.on ? 'success' : 'default'}>{state.on ? 'On' : 'Off'}</Chip>}
        {info?.wifi && <SignalBars signal={info.wifi.signal} />}
        {info?.leds.fps !== undefined && (
          <span className="device-card-metric">{info.leds.fps} FPS</span>
        )}
        {info?.uptime !== undefined && (
          <span className="device-card-metric">Up {humanizeUptime(info.uptime)}</span>
        )}
      </div>
      <div className="device-card-actions">
        <Button variant="primary" size="sm" onClick={() => onControl(controller.id)}
          aria-label={`Control ${controller.name}`}>
          Control
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onOpen(controller.id)}
          aria-label={`Details for ${controller.name}`}>
          Details
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] Run again → expect PASS (6 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: live-status device card with signal bars, fps, uptime, update badge"`

---

## Task 16: Hash route helpers + `DeviceDetail` tab shell

**Files:**
- Create: `client/src/sections/devices/route.ts`
- Create: `client/src/sections/devices/DeviceDetail.tsx`
- Test: `client/src/test/devices/route.test.ts`
- Test: `client/src/test/devices/DeviceDetail.test.tsx`

**Interfaces:**
- Consumes: all five tab components (Tasks 6–14); kit `Chip`, `IconButton`, `Tabs`.
- Produces (BINDING routing contract for Phase H's `#/devices/<id>/update` deep link):
  - `type DeviceTab = 'info' | 'segments' | 'presets' | 'config' | 'update'`, `const DEVICE_TABS: DeviceTab[]`
  - `parseDevicesHash(hash: string): { controllerId: string | null; tab: DeviceTab }` — `#/devices` → list; unknown tab falls back to `info`.
  - `deviceHash(controllerId: string, tab?: DeviceTab): string` — `'#/devices/<id>'` for info, `'#/devices/<id>/<tab>'` otherwise.
  - `DeviceDetail({ controller: Controller; live: LiveStatusEntry | undefined; tab: DeviceTab; onTabChange: (tab: DeviceTab) => void; onBack: () => void })` — header (back, name, host, offline chip) + kit `Tabs` + the active tab panel. `ledCount`/`maxSeg` for Segments come from `live.info.leds` (`count`, `maxseg`, defaults 0/32 when offline).

**Steps:**

- [ ] Write the failing tests:

```ts
// client/src/test/devices/route.test.ts
import { describe, it, expect } from 'vitest';
import { deviceHash, parseDevicesHash } from '../../sections/devices/route';

describe('parseDevicesHash', () => {
  it('parses the list route', () =>
    expect(parseDevicesHash('#/devices')).toEqual({ controllerId: null, tab: 'info' }));
  it('parses a bare detail route as the Info tab', () =>
    expect(parseDevicesHash('#/devices/c1')).toEqual({ controllerId: 'c1', tab: 'info' }));
  it('parses an explicit tab (Phase H deep-links to update)', () =>
    expect(parseDevicesHash('#/devices/c1/update')).toEqual({ controllerId: 'c1', tab: 'update' }));
  it('falls back to info for unknown tabs', () =>
    expect(parseDevicesHash('#/devices/c1/bogus')).toEqual({ controllerId: 'c1', tab: 'info' }));
});

describe('deviceHash', () => {
  it('round-trips both forms', () => {
    expect(deviceHash('c1')).toBe('#/devices/c1');
    expect(deviceHash('c1', 'config')).toBe('#/devices/c1/config');
    expect(parseDevicesHash(deviceHash('c1', 'segments'))).toEqual({ controllerId: 'c1', tab: 'segments' });
  });
});
```

```tsx
// client/src/test/devices/DeviceDetail.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { DeviceDetail } from '../../sections/devices/DeviceDetail';
import type { DeviceTab } from '../../sections/devices/route';
import { renderDevices } from './helpers';
import { CONTROLLERS, liveEntry } from './fixtures';

vi.mock('../../sections/devices/SegmentsTab', () => ({
  SegmentsTab: (p: { ledCount: number; maxSeg: number }) => (
    <div data-testid="segments-tab">{p.ledCount}:{p.maxSeg}</div>
  )
}));
vi.mock('../../sections/devices/DevicePresetsTab', () => ({
  DevicePresetsTab: () => <div data-testid="presets-tab" />
}));
vi.mock('../../sections/devices/ConfigTab', () => ({
  ConfigTab: () => <div data-testid="config-tab" />
}));
vi.mock('../../sections/devices/UpdateTab', () => ({
  UpdateTab: () => <div data-testid="update-tab" />
}));

function renderDetail(tab: DeviceTab = 'info', overrides: Partial<Parameters<typeof DeviceDetail>[0]> = {}) {
  const onTabChange = vi.fn();
  const onBack = vi.fn();
  renderDevices(
    <DeviceDetail controller={CONTROLLERS[0]} live={liveEntry()} tab={tab}
      onTabChange={onTabChange} onBack={onBack} {...overrides} />
  );
  return { onTabChange, onBack };
}

describe('DeviceDetail', () => {
  it('renders the header and all five tabs, Info panel by default', () => {
    renderDetail();
    expect(screen.getByRole('heading', { name: 'Cabinet Lights' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent))
      .toEqual(['Info', 'Segments', 'Presets', 'Config', 'Update']);
    expect(screen.getByText('Device facts')).toBeTruthy();
  });

  it('feeds Segments the live ledCount and maxseg', () => {
    renderDetail('segments');
    expect(screen.getByTestId('segments-tab').textContent).toBe('48:32');
  });

  it('tab clicks report the tab id upward (routing owns the hash)', () => {
    const { onTabChange } = renderDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Config' }));
    expect(onTabChange).toHaveBeenCalledWith('config');
  });

  it('the back control calls onBack', () => {
    const { onBack } = renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Back to devices' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows the offline chip for an unreachable device', () => {
    renderDetail('info', { live: { reachable: false } });
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/route.test.ts src/test/devices/DeviceDetail.test.tsx` → expect FAIL: modules not found.
- [ ] Create `client/src/sections/devices/route.ts`:

```ts
export type DeviceTab = 'info' | 'segments' | 'presets' | 'config' | 'update';

export const DEVICE_TABS: DeviceTab[] = ['info', 'segments', 'presets', 'config', 'update'];

export interface DevicesRoute {
  controllerId: string | null;
  tab: DeviceTab;
}

/** BINDING (master + Phase H): #/devices, #/devices/<id>, #/devices/<id>/<tab>. */
export function parseDevicesHash(hash: string): DevicesRoute {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const controllerId = parts[1] ?? null;
  const tab = (DEVICE_TABS as string[]).includes(parts[2] ?? '') ? (parts[2] as DeviceTab) : 'info';
  return { controllerId, tab };
}

export function deviceHash(controllerId: string, tab: DeviceTab = 'info'): string {
  return tab === 'info' ? `#/devices/${controllerId}` : `#/devices/${controllerId}/${tab}`;
}
```

- [ ] Create `client/src/sections/devices/DeviceDetail.tsx`:

```tsx
import type { Controller } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Chip } from '../../components/ui/Chip';
import { IconButton } from '../../components/ui/IconButton';
import { Tabs } from '../../components/ui/Tabs';
import { ConfigTab } from './ConfigTab';
import { DevicePresetsTab } from './DevicePresetsTab';
import { InfoTab } from './InfoTab';
import { SegmentsTab } from './SegmentsTab';
import { UpdateTab } from './UpdateTab';
import type { DeviceTab } from './route';
import './devices.css';

export interface DeviceDetailProps {
  controller: Controller;
  live: LiveStatusEntry | undefined;
  tab: DeviceTab;
  onTabChange: (tab: DeviceTab) => void;
  onBack: () => void;
}

const TAB_ITEMS: { id: DeviceTab; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'segments', label: 'Segments' },
  { id: 'presets', label: 'Presets' },
  { id: 'config', label: 'Config' },
  { id: 'update', label: 'Update' }
];

export function DeviceDetail({ controller, live, tab, onTabChange, onBack }: DeviceDetailProps) {
  const ledCount = live?.info?.leds.count ?? 0;
  const maxSeg = live?.info?.leds.maxseg ?? 32;

  return (
    <div className="device-detail">
      <header className="device-detail-header">
        <IconButton label="Back to devices" onClick={onBack}>←</IconButton>
        <div className="device-detail-titles">
          <h2>{controller.name}</h2>
          <p className="device-card-host">{controller.host}</p>
        </div>
        {live !== undefined && !live.reachable && <Chip variant="danger">Offline</Chip>}
      </header>
      <Tabs label="Device tabs" tabs={TAB_ITEMS} active={tab}
        onChange={(id) => onTabChange(id as DeviceTab)} />
      {tab === 'info' && <InfoTab controller={controller} live={live} onRemoved={onBack} />}
      {tab === 'segments' && (
        <SegmentsTab controllerId={controller.id} ledCount={ledCount} maxSeg={maxSeg} />
      )}
      {tab === 'presets' && <DevicePresetsTab controllerId={controller.id} />}
      {tab === 'config' && <ConfigTab controllerId={controller.id} />}
      {tab === 'update' && <UpdateTab controllerId={controller.id} />}
    </div>
  );
}
```

- [ ] Run again → expect PASS (5 + 5 tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: hash route helpers + DeviceDetail tab shell"`

---

## Task 17: `DevicesSection` — list + detail routing, add-controller, Control surface

**Files:**
- Create: `client/src/sections/devices/DevicesSection.tsx`
- Test: `client/src/test/devices/DevicesSection.test.tsx`

**Interfaces:**
- Consumes: `useControllers` (Phase D, key `['controllers']`); `useLiveStatus` (Phase D — subscribed to ALL list ids on the list view, ONLY the open id on the detail view, so the server's refcounted fast-poll narrows automatically); `addController` (existing `client/src/api/client.ts:104`); `ControlSurface` (Phase D Task 11, props `{ targets, open, onClose }`); `DeviceCard` (Task 15); `DeviceDetail`, `parseDevicesHash`, `deviceHash` (Task 16); kit `Button`, `Field`, `Modal`, `Skeleton`, `useToast`.
- Produces: `DevicesSection()` — the section root Phase F's AppShell swap (Task 18) mounts under `#/devices`.

**Steps:**

- [ ] Write the failing test:

```tsx
// client/src/test/devices/DevicesSection.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { DevicesSection } from '../../sections/devices/DevicesSection';
import { renderDevices, stubFetchRoutes } from './helpers';
import { CONTROLLERS, FIRMWARE_OK, liveEntry, liveMap } from './fixtures';

vi.mock('../../api/live', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../api/live')>();
  return {
    ...mod,
    useLiveStatus: vi.fn(() => liveMap({ c1: liveEntry(), c2: { reachable: false } }))
  };
});
vi.mock('../../control/ControlSurface', () => ({
  ControlSurface: (p: { open: boolean; targets: unknown[] }) =>
    p.open ? <div data-testid="control-surface">{JSON.stringify(p.targets)}</div> : null
}));
vi.mock('../../sections/devices/DeviceDetail', () => ({
  DeviceDetail: (p: { controller: { id: string }; tab: string }) => (
    <div data-testid="device-detail">{p.controller.id}:{p.tab}</div>
  )
}));

beforeEach(() => {
  window.location.hash = '#/devices';
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const BASE_ROUTES = {
  'GET /api/controllers': CONTROLLERS,
  'GET /api/controllers/c1/firmware': FIRMWARE_OK,
  'GET /api/controllers/c2/firmware': { ...FIRMWARE_OK, updateAvailable: false }
};

describe('DevicesSection', () => {
  it('renders one card per controller', async () => {
    stubFetchRoutes(BASE_ROUTES);
    renderDevices(<DevicesSection />);
    expect(await screen.findByText('Cabinet Lights')).toBeTruthy();
    expect(screen.getByText('Porch')).toBeTruthy();
  });

  it('Control opens the shared surface targeting that controller', async () => {
    stubFetchRoutes(BASE_ROUTES);
    renderDevices(<DevicesSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Control Cabinet Lights' }));
    expect(screen.getByTestId('control-surface').textContent)
      .toContain('"controllerId":"c1"');
  });

  it('a deep-linked hash renders the detail with the requested tab', async () => {
    window.location.hash = '#/devices/c1/segments';
    stubFetchRoutes(BASE_ROUTES);
    renderDevices(<DevicesSection />);
    expect((await screen.findByTestId('device-detail')).textContent).toBe('c1:segments');
  });

  it('an unknown controller id shows a recovery path back to the list', async () => {
    window.location.hash = '#/devices/nope';
    stubFetchRoutes(BASE_ROUTES);
    renderDevices(<DevicesSection />);
    expect(await screen.findByText('Unknown device.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to devices' })).toBeTruthy();
  });

  it('adds a controller through the modal', async () => {
    const fn = stubFetchRoutes({
      ...BASE_ROUTES,
      'POST /api/controllers': { id: 'c3', name: 'Attic', host: '10.0.0.60', source: 'manual', stale: false, pinnedAssetPattern: null }
    });
    renderDevices(<DevicesSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add controller' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Attic' } });
    fireEvent.change(screen.getByLabelText('Host / IP'), { target: { value: '10.0.0.60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      const call = fn.mock.calls.find(
        ([url, init]) => String(url) === '/api/controllers' && (init as RequestInit)?.method === 'POST'
      );
      expect(JSON.parse((call![1] as RequestInit).body as string))
        .toEqual({ name: 'Attic', host: '10.0.0.60' });
    });
  });

  it('renders the empty state when no controllers exist', async () => {
    stubFetchRoutes({ ...BASE_ROUTES, 'GET /api/controllers': [] });
    renderDevices(<DevicesSection />);
    expect(await screen.findByText(/No controllers yet/)).toBeTruthy();
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices/DevicesSection.test.tsx` → expect FAIL: module not found.
- [ ] Create `client/src/sections/devices/DevicesSection.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addController } from '../../api/client';
import { useLiveStatus } from '../../api/live';
import { useControllers } from '../../api/queries';
import { ControlSurface } from '../../control/ControlSurface';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { DeviceCard } from './DeviceCard';
import { DeviceDetail } from './DeviceDetail';
import { deviceHash, parseDevicesHash, type DeviceTab } from './route';
import './devices.css';

export function DevicesSection() {
  const [route, setRoute] = useState(() => parseDevicesHash(window.location.hash));
  const controllers = useControllers();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [controlId, setControlId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newHost, setNewHost] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseDevicesHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const list = controllers.data ?? [];
  const liveIds = useMemo(
    () => (route.controllerId ? [route.controllerId] : list.map((c) => c.id)),
    [route.controllerId, list]
  );
  const live = useLiveStatus(liveIds);

  function openDetail(controllerId: string, tab: DeviceTab = 'info') {
    window.location.hash = deviceHash(controllerId, tab);
    setRoute({ controllerId, tab });
  }

  function backToList() {
    window.location.hash = '#/devices';
    setRoute({ controllerId: null, tab: 'info' });
  }

  async function handleAdd() {
    if (!newName.trim() || !newHost.trim()) return;
    setAdding(true);
    try {
      await addController(newName.trim(), newHost.trim());
      await queryClient.invalidateQueries({ queryKey: ['controllers'] });
      setAddOpen(false);
      setNewName('');
      setNewHost('');
    } catch (e) {
      toast.show({
        title: 'Could not add controller',
        description: e instanceof Error ? e.message : undefined,
        variant: 'error'
      });
    } finally {
      setAdding(false);
    }
  }

  if (route.controllerId) {
    if (controllers.isLoading) {
      return (
        <section className="section devices-section">
          <Skeleton height="200px" />
        </section>
      );
    }
    const controller = list.find((c) => c.id === route.controllerId);
    if (!controller) {
      return (
        <section className="section devices-section">
          <p role="alert">Unknown device.</p>
          <Button variant="secondary" onClick={backToList}>Back to devices</Button>
        </section>
      );
    }
    return (
      <section className="section devices-section">
        <DeviceDetail controller={controller} live={live.get(controller.id)} tab={route.tab}
          onTabChange={(tab) => openDetail(controller.id, tab)} onBack={backToList} />
      </section>
    );
  }

  return (
    <section className="section devices-section">
      <header className="devices-header">
        <h2>Devices</h2>
        <Button variant="primary" onClick={() => setAddOpen(true)}>Add controller</Button>
      </header>
      {controllers.isLoading && (
        <div className="devices-grid">
          <Skeleton height="140px" />
          <Skeleton height="140px" />
        </div>
      )}
      {controllers.isError && <p role="alert">Could not load controllers.</p>}
      {!controllers.isLoading && !controllers.isError && list.length === 0 && (
        <p className="empty-state">
          No controllers yet — discovery adds them automatically, or add one by IP.
        </p>
      )}
      <div className="devices-grid">
        {list.map((c) => (
          <DeviceCard key={c.id} controller={c} live={live.get(c.id)}
            onControl={setControlId} onOpen={openDetail} />
        ))}
      </div>
      <ControlSurface
        targets={controlId ? [{ kind: 'controller', controllerId: controlId }] : []}
        open={controlId !== null}
        onClose={() => setControlId(null)}
      />
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add controller"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={adding}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAdd}
              disabled={adding || !newName.trim() || !newHost.trim()}>
              {adding ? 'Adding…' : 'Add'}
            </Button>
          </>
        }>
        <Field label="Name" htmlFor="add-controller-name">
          <input id="add-controller-name" className="input" value={newName}
            onChange={(e) => setNewName(e.target.value)} placeholder="Front Porch" />
        </Field>
        <Field label="Host / IP" htmlFor="add-controller-host">
          <input id="add-controller-host" className="input" value={newHost}
            onChange={(e) => setNewHost(e.target.value)} placeholder="10.0.0.50" />
        </Field>
      </Modal>
    </section>
  );
}
```

- [ ] Run again → expect PASS (6 tests). Also run the whole devices suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/devices` → PASS.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/devices client/src/test/devices && git commit -m "devices: DevicesSection list + detail routing, add-controller modal, Control surface wiring"`

---

## Task 18: AppShell swap + deep-link hash fix + delete the old Controllers screen

**Files:**
- Modify: `client/src/components/AppShell.tsx` (Phase C's rewritten shell: swap the devices route import, make `sectionFromHash` first-segment-aware and exported)
- Modify: `client/src/test/AppShell.test.tsx` (append deep-link tests)
- Delete: `client/src/components/ControllersSection.tsx`, `client/src/components/ControllerList.tsx`, `client/src/test/ControllersSection.test.tsx`, `client/src/test/ControllerList.test.tsx`

**Interfaces:**
- Consumes: `DevicesSection` (Task 17).
- Produces: the app renders `sections/devices/DevicesSection` under the `devices` nav key; `sectionFromHash` maps the FIRST hash path segment to the section (BINDING routing contract — `#/devices/c1/update` keeps Devices active for Phase H's Firmware deep link; legacy `#/controllers` still aliases to devices).
- Deletion boundary (BINDING with Phase H, `08-restyle-sections.md:2331,2500`): `FirmwareStatus.tsx`, `AssetPickerModal.tsx`, `FirmwareSection.tsx` and their tests are NOT touched here — `FirmwareSection` still renders the fleet view until Phase H, and the first two are consumed by Task 14's Update tab until Phase I. Remove-controller, add-controller, and schedule import survive inside the new section (Tasks 6 and 17), so deleting `ControllersSection`/`ControllerList` loses no functionality.

**Steps:**

- [ ] Drift-guard — confirm the Phase C shell wiring this task edits: `grep -n "ControllersSection\|sectionFromHash" /Users/bwwilliams/github/uber-wled/client/src/components/AppShell.tsx` → expect the import line, the `{active === 'devices' && <ControllersSection />}` render line, and a non-exported `function sectionFromHash()`. If Phase C drifted, adapt the edits below to the shipped shell — the target behavior is binding, not the exact lines.
- [ ] Write the failing tests — append to `client/src/test/AppShell.test.tsx` (and extend its import to `import { AppShell, sectionFromHash } from '../components/AppShell';`):

```tsx
describe('sectionFromHash deep links (Phase F)', () => {
  it('maps #/devices/c1/update to the devices section (Phase H deep link)', () => {
    window.location.hash = '#/devices/c1/update';
    expect(sectionFromHash()).toBe('devices');
  });

  it('still maps the legacy #/controllers alias to devices', () => {
    window.location.hash = '#/controllers';
    expect(sectionFromHash()).toBe('devices');
  });
});
```

- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/AppShell.test.tsx` → expect FAIL: `AppShell.tsx` has no exported member `sectionFromHash` (and, once exported, the deep link resolves to `home` because the old implementation matches the whole hash string).
- [ ] Edit `client/src/components/AppShell.tsx` — three changes:
  1. Replace the old import:

```tsx
// old: import { ControllersSection } from './ControllersSection';
import { DevicesSection } from '../sections/devices/DevicesSection';
```

  2. Replace the render line `{active === 'devices' && <ControllersSection />}` with:

```tsx
{active === 'devices' && <DevicesSection />}
```

  3. Replace `function sectionFromHash()` with the exported, first-segment version (only the `export` keyword and the `.split('/')[0]` change):

```tsx
export function sectionFromHash(): SectionKey {
  const raw = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  const mapped = LEGACY_ALIASES[raw] ?? raw;
  return (KEYS as string[]).includes(mapped) ? (mapped as SectionKey) : DEFAULT_SECTION;
}
```

- [ ] If any existing AppShell test asserted old Controllers-screen content (e.g. the `Controllers` heading) for the devices route, update that assertion to the new list heading `Devices` — check with `grep -n "Controllers" /Users/bwwilliams/github/uber-wled/client/src/test/AppShell.test.tsx`.
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/AppShell.test.tsx` → expect PASS (Phase C's suite + 2 new tests).
- [ ] Delete the replaced files:

```
git -C /Users/bwwilliams/github/uber-wled rm client/src/components/ControllersSection.tsx client/src/components/ControllerList.tsx client/src/test/ControllersSection.test.tsx client/src/test/ControllerList.test.tsx
```

- [ ] Verify zero dangling references: `grep -rn "ControllersSection\|ControllerList" /Users/bwwilliams/github/uber-wled/client/src --include='*.ts*'` → expect no hits. Then confirm the kept firmware components still have their consumers: `grep -rln "FirmwareStatus" /Users/bwwilliams/github/uber-wled/client/src/components /Users/bwwilliams/github/uber-wled/client/src/sections` → expect `FirmwareSection.tsx` (until Phase H) and `sections/devices/UpdateTab.tsx`.
- [ ] Run the full client suite and build:
  - `cd /Users/bwwilliams/github/uber-wled/client && npm test` → green
  - `cd /Users/bwwilliams/github/uber-wled/client && npm run build` → succeeds
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add -A client/src && git commit -m "devices: AppShell renders DevicesSection, first-segment hash routing; delete old Controllers screen"`

---

## Task 19: Phase F verification gate

**Files:**
- No new files. Full-suite runs, contract greps, and a browser walkthrough. Fixes discovered here are committed under this task.

**Interfaces:**
- Consumes: everything this phase shipped.
- Produces: evidence that Phase F meets the master verification gate and its BINDING contracts, before review + push.

**Steps:**

- [ ] Full suites and build, all green:
  - `cd /Users/bwwilliams/github/uber-wled/server && npm test`
  - `cd /Users/bwwilliams/github/uber-wled/client && npm test`
  - `cd /Users/bwwilliams/github/uber-wled/client && npm run build`
- [ ] Contract greps (each must hit):
  - Phase H firmware-hook drift target: `grep -n "queryKey: \['firmware', controllerId\]" /Users/bwwilliams/github/uber-wled/client/src/api/queries.ts`
  - Routing contract: `grep -rn "#/devices" /Users/bwwilliams/github/uber-wled/client/src/sections/devices/route.ts /Users/bwwilliams/github/uber-wled/client/src/sections/devices/DevicesSection.tsx` and `grep -n "split('/')\[0\]" /Users/bwwilliams/github/uber-wled/client/src/components/AppShell.tsx`
  - Preset apply transport (no dedicated route): `grep -n "applyControl" /Users/bwwilliams/github/uber-wled/client/src/sections/devices/DevicePresetsTab.tsx` and `grep -rn "presets/apply" /Users/bwwilliams/github/uber-wled/client/src` → the second must have NO hits.
  - No version bumps slipped in: `git -C /Users/bwwilliams/github/uber-wled diff main --stat -- client/package.json server/package.json` shows no `"version"` change (1.0.0 happens in Phase I).
- [ ] Browser walkthrough against the dev server with the real controller (start with `cd /Users/bwwilliams/github/uber-wled && npm run dev` or the repo's documented dev command), at BOTH 390px and 1440px widths. **Hardware policy for this walkthrough** — reads are unrestricted; the ONLY permitted write is the reversible segment power toggle below; NEVER confirm a config diff, save/delete a device preset, reboot, or OTA-update the real device:
  - `#/devices`: cards show live version, signal bars, FPS, uptime; Cabinet Lights reachable; Control button opens the shared surface (close it without changes); touch targets ≥ 40px; no horizontal scroll at 390px.
  - Detail Info: facts grid matches the device (esp32, 48 RGBW), liveview iframe renders the live strip, native-UI link opens the device in a new tab. Open the reboot confirm, then CANCEL it.
  - Segments: rows match the device's real segments; capture segment 0's power state, toggle it off, confirm the strip reacts, toggle it back to the captured state (capture-then-restore).
  - Presets: list renders with ids/names. Do not apply/delete/save.
  - Config: every page (Identity, LED & Hardware, WiFi, Sync, Time, LED Prefs, Advanced) seeds with the device's real values; change the device name in Identity, click Save identity, verify the DiffConfirmModal shows exactly one `id.name` row, then CANCEL. On WiFi, edit the SSID, save, verify the strand-risk warning + disabled Apply appear, then CANCEL.
  - Update: `#/devices/<id>/update` deep link lands on the Update tab showing the installed version. Do not press Update.
- [ ] Fix anything the walkthrough surfaces; re-run the failing suite; commit fixes: `cd /Users/bwwilliams/github/uber-wled && git add -A client && git commit -m "devices: phase F verification fixes"` (skip if nothing changed).
- [ ] After phase review passes: `git -C /Users/bwwilliams/github/uber-wled push origin main`

---

## Phase completion gate

- `cd /Users/bwwilliams/github/uber-wled/server && npm test` green
- `cd /Users/bwwilliams/github/uber-wled/client && npm test` green
- `cd /Users/bwwilliams/github/uber-wled/client && npm run build` green
- Devices list + all five detail tabs verified in-browser at 390px and 1440px (Task 19 walkthrough, hardware policy respected: dry-runs cancelled, no config/preset/reboot/OTA writes to the real device, segment toggle capture-then-restored)
- Every config save path goes dry-run → DiffConfirmModal → confirm POST; WiFi/GPIO diffs gated behind the explicit acknowledgement; rebootRequired saves end in the "Reboot now / Later" offer
- Routing contract live: `#/devices`, `#/devices/<id>`, `#/devices/<id>/<tab>`; `sectionFromHash` keys off the first segment; `['firmware', id]` hook in place for Phase H
- Old `ControllersSection.tsx`/`ControllerList.tsx` deleted with zero dangling references; `FirmwareStatus.tsx`/`AssetPickerModal.tsx`/`FirmwareSection.tsx` intact for Phases H/I
- One commit per task (19 minimum), pushed after review
