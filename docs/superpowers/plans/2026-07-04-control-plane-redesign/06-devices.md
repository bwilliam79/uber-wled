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

// client/src/api/client.ts  (05 Task 4 alias; identical body to 04's applyControl)
export const applyControlV2: (targets: Target[], patch: ControlPatch) => Promise<{ results: ApplyResult[] }>;

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

- [ ] Drift-guard 2 — `grep -n "applyControlV2\|export const applyControl " /Users/bwwilliams/github/uber-wled/client/src/api/client.ts`. Phase E ships `applyControlV2`; if it is missing but Phase D's `applyControl(targets, patch)` exists, append the alias:

```ts
export const applyControlV2 = (targets: Target[], patch: ControlPatch) =>
  sendJson<{ results: ApplyResult[] }>('/api/control/apply', 'POST', { targets, patch });
```

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
