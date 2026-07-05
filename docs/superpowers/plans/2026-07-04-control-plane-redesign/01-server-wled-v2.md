# Phase A — Server: WLED Client v2, Parsers & Capability Cache

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Give the server full WLED-parity device access — fxdata/palx parsers, a widened client (config, presets, nightlight, reboot, full-state, `udpn:{nn:true}`-capable setState), and a per-controller capability cache exposed at `GET /api/controllers/:id/capabilities`.

**Architecture:** Pure parsing logic and the binding capability types live in a new `server/src/wled/capabilities.ts`; new HTTP calls extend the existing thin fetch wrapper in `server/src/wled/client.ts`; the cache is a better-sqlite3 repository (`server/src/controllers/capabilitiesRepository.ts`) fed by a refresh service that the status poller triggers on `info.vid` change and the capabilities route triggers on-demand.

**Tech Stack:** Node 20 + TypeScript (ESM, `.js` import suffixes) + Express + better-sqlite3; Vitest + supertest for tests. **No new dependencies.**

## Global Constraints

(copied verbatim from `00-master.md` — binding)

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

## Phase-scoped rules

- **All unit tests are network-free.** Every device response in test code below is a **verbatim capture** from the real controller at `192.168.1.86` (WLED 16.0.0 "Niji", `info.vid = 2605030`, RGBW, 48 LEDs), taken read-only on 2026-07-04. Do not "improve" fixture strings — they encode real edge cases.
- Fan-out v2, SSE live stream, and device-management routes (presets CRUD, config dry-run, reboot route) are **Phase B**. Phase A only ships the client functions, parsers, cache, and the one capabilities route.
- No version bump and no README rewrite in this phase (master plan reserves both for Phase I). Phase A is server-internal plus one additive route.
- v1 `POST /api/control/apply` and its callers in `server/src/control/routes.ts` must keep compiling and passing untouched.
- **Preset apply gets no new function or route in this phase.** Per the master contract, device-preset apply travels through fan-out v2 as `ControlPatch.ps` (Phase B); on the wire it is exactly `WledStatePatch.ps` from Task 1 (`POST /json/state {ps}`). The existing v1 `applyPreset` helper in `client.ts` stays untouched for v1 callers until Phase I deletes v1.

## Decisions made in this plan (binding for Phase A)

1. **Module placement:** parsers + capability types → `server/src/wled/capabilities.ts` (per master); DB repository → `server/src/controllers/capabilitiesRepository.ts` (beside `statusRepository.ts`, matching the repo's better-sqlite3 repositories pattern); refresh orchestration → `server/src/controllers/capabilityService.ts`.
2. **The `fxdata` DB column stores the parsed `FxMeta[]` JSON** (parsed once at refresh). The repository maps column `fxdata` → field `fxMeta` so the API shape matches the `ControllerCapabilities` contract exactly.
3. **Empty fxdata entry** (`""` — real for Solid at id 0 and the `RSVD` placeholders at ids 142/169/170/171): mirror the native WLED UI's "no controls defined" fallback — default speed/intensity slider labels, all three color slots with default labels, `usesPalette: false`, `flags: ['1']`, `defaults: {}`.
4. **Missing or empty flags section → `['1']`** (WLED treats effects as 1D by default).
5. **Palette entry classification:** any `'r'` element → `{type:'random'}`; otherwise any string elements → `{type:'slots'}` (keeping only `c1|c2|c3`, order preserved); otherwise `{type:'stops'}`.
6. **`savePreset` with no `id`** reads `/presets.json` and takes the lowest free slot in 1–250 (slot 0 is reserved — the real device returns `{"0":{}}`).
7. **Refresh requires `info.vid`**; if a device reports no numeric `vid`, `refreshCapabilities` throws (nothing cached). The poller only attempts refresh when `typeof info.vid === 'number'`, so old mocks/firmware never trigger it.

---

## Task 1: Widen WLED wire types + `setState` patch type

**Files:**
- Modify: `server/src/wled/types.ts` (full replacement — currently 31 lines)
- Modify: `server/src/wled/client.ts` (lines 1, 30–35: import + `setState` signature)
- Test: `server/test/wled/client.test.ts` (append one test)

**Interfaces:**
- Consumes: existing `setState(host, patch)` / `postJson` in `client.ts`; existing callers in `server/src/control/routes.ts:28-41` pass `{on}`, `{bri}`, `{bri, seg:[...]}` — all subsets of the new patch type, so they keep compiling.
- Produces (used by Tasks 4, 5 and Phase B): exported types `WledNightlight`, `WledUdpn`, `WledSegmentPatch`, `WledStatePatch`, `WledFullState`; widened `WledSegment`/`WledState`/`WledInfo` (`vid?: number`); `setState(host: string, patch: WledStatePatch): Promise<WledState>`. `WledStatePatch.ps` is the wire field Phase B's `ControlPatch.ps` (device-preset apply via `POST /api/control/apply`) resolves onto.

**Note on TDD for this task:** the runtime behavior of `setState` (forward body verbatim) is unchanged — this is a type-level widening, so the new test passes even before the change (Vitest does not type-check). The test's job is to pin the wire format (incl. `udpn:{nn:true}`); the real gate for the widening is `npm run build` (tsc strict) staying green after `types.ts` is replaced.

- [ ] Append this test to `server/test/wled/client.test.ts` (inside the existing `describe('wled client', ...)`; the file's `stubFetchOnce` helper and `HOST` const already exist at lines 4–18):

```ts
  it('setState forwards the full widened patch verbatim (nightlight, udpn nn, transition, full segment fields)', async () => {
    const patch = {
      on: true,
      bri: 190,
      transition: 7,
      mainseg: 0,
      nl: { on: true, dur: 30, mode: 1 as const, tbri: 10 },
      udpn: { nn: true },
      seg: [{
        id: 0, start: 0, stop: 48, grp: 1, spc: 0, of: 0, on: true, frz: false,
        bri: 255, cct: 127, n: 'Cabinet', col: [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        fx: 65, sx: 128, ix: 112, pal: 6, c1: 0, c2: 128, c3: 16,
        sel: true, rev: false, mi: false, o1: true, o2: false, o3: true
      }]
    };
    stubFetchOnce(
      { url: `http://${HOST}/json/state`, method: 'POST', body: patch },
      { on: true, bri: 190, ps: -1, seg: [] }
    );
    const state = await setState(HOST, patch);
    expect(state.bri).toBe(190);
  });
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/client.test.ts` — expect **pass** (characterization; see note above).
- [ ] Replace `server/src/wled/types.ts` with:

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

export interface WledState {
  on: boolean;
  bri: number;
  ps: number;
  seg: WledSegment[];
  transition?: number;
  pl?: number;
  nl?: WledNightlight;
  udpn?: WledUdpn;
  lor?: 0 | 1 | 2;
  mainseg?: number;
}

/** Partial segment for writes: any subset of segment fields (plus id). */
export type WledSegmentPatch = Partial<WledSegment>;

/** Body accepted by POST /json/state (the fields uber-wled writes). */
export interface WledStatePatch {
  on?: boolean;
  bri?: number;
  transition?: number;
  /** Apply device preset id — Phase B's ControlPatch.ps lands here. */
  ps?: number;
  pl?: number;
  nl?: Partial<WledNightlight>;
  udpn?: WledUdpn;
  lor?: 0 | 1 | 2;
  mainseg?: number;
  seg?: WledSegmentPatch[];
}

export interface WledInfo {
  name: string;
  ver: string;
  leds: {
    count: number;
    rgbw?: boolean;
    cct?: number;
    maxseg?: number;
    fps?: number;
    pwr?: number;
    seglc?: number[];
    lc?: number;
  };
  arch: string;
  /** Build id (e.g. 2605030 on WLED 16.0.0) — drives capability-cache refresh. */
  vid?: number;
}

export interface WledPreset {
  id: number;
  name: string;
}

/** GET /json — the combined object. */
export interface WledFullState {
  state: WledState;
  info: WledInfo;
  effects: string[];
  palettes: string[];
}
```

- [ ] In `server/src/wled/client.ts` change line 1 to
  `import type { WledInfo, WledState, WledStatePatch, WledPreset } from './types.js';`
  and replace the `setState` declaration (lines 30–35) with:

```ts
export function setState(host: string, patch: WledStatePatch): Promise<WledState> {
  return postJson<WledState>(host, '/json/state', patch);
}
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/client.test.ts` — expect all tests pass.
- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test && npm run build` — expect full suite green and tsc clean (proves `control/routes.ts` v1 callers still compile).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/wled/types.ts server/src/wled/client.ts server/test/wled/client.test.ts && git commit -m "Widen WLED wire types and setState patch to the full state/segment field set"`

---

## Task 2: fxdata parser (`parseFxData` → `FxMeta[]`)

**Files:**
- Create: `server/src/wled/capabilities.ts`
- Test: `server/test/wled/capabilities.test.ts` (new)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `FxMeta`, `PalettePreview`, `ControllerCapabilities` (all **verbatim from the master contract**), and
  `parseFxData(fxdata: string[], effectNames: string[]): FxMeta[]`.
  Task 3 adds `parsePalettePreviewPage` to this same file; Tasks 6/7/9 and Phases B/D/H consume the types.

- [ ] Create `server/test/wled/capabilities.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFxData } from '../../src/wled/capabilities.js';

// Verbatim /json/eff + /json/fxdata entries captured from 192.168.1.86
// (WLED 16.0.0 "Niji", vid 2605030) on 2026-07-04. Test index = effect id
// here; the original device index is noted per entry.
const NAMES = [
  'Solid',        // device idx 0   — empty fxdata entry
  'Blink',        // idx 1          — '!' defaults, flags '01'
  'Wipe',         // idx 3          — no flags/defaults sections at all
  'Dynamic',      // idx 7          — o1 at position 5, empty colors section
  'Scan',         // idx 10         — o2 at position 6, 3 default color slots
  'Aurora',       // idx 38         — custom color labels, EMPTY flags section
  'Tetrix',       // idx 44         — o1 label + 4-key defaults incl. m12
  'Two Dots',     // idx 50         — mixed custom/default color labels
  'Palette',      // idx 65         — c1 slider + all three options + o-defaults
  'Copy Segment', // idx 77         — sx hidden, c1-c3 sliders, NO palette
  'Glitter',      // idx 87         — only color slot 3 labeled
  'Pixels',       // idx 128        — audio flag '1v'
  'Spaceships'    // idx 118        — 2D flag '2'
];
const FXDATA = [
  '',
  '!,Duty cycle;!,!;!;01',
  '!,!;!,!;!',
  '!,!,,,,Smooth;;!',
  '!,# of dots,,,,,Overlay;!,!,!;!',
  '!,!;1,2,3;!;;sx=24,pal=50',
  '!,Width,,,,One color;!,!;!;;sx=0,ix=0,pal=11,m12=1',
  '!,Dot size,,,,,Overlay;1,2,Bg;!',
  'Shift,Size,Rotation,,,Animate Shift,Animate Rotation,Anamorphic;;!;12;ix=112,c1=0,o1=1,o2=0,o3=1',
  ',Color shift,Lighten,Brighten,ID,Axis(2D),FullStack(last frame);;;12;ix=0,c1=0,c2=0,c3=0',
  '!,!,,,,,Overlay;,,Glitter color;!;;pal=11,m12=0',
  'Fade rate,# of pixels;!,!;!;1v;m12=0,si=0',
  '!,Blur,,,,Smear;;!;2'
];

describe('parseFxData', () => {
  const fx = parseFxData(FXDATA, NAMES);

  it('produces one FxMeta per effect id with matching id and name', () => {
    expect(fx).toHaveLength(NAMES.length);
    fx.forEach((meta, i) => {
      expect(meta.id).toBe(i);
      expect(meta.name).toBe(NAMES[i]);
    });
  });

  it('empty entry (Solid): default sx/ix labels, all color slots, no palette, 1D', () => {
    expect(fx[0]).toEqual({
      id: 0,
      name: 'Solid',
      sliders: { sx: 'Effect speed', ix: 'Effect intensity', c1: null, c2: null, c3: null },
      options: { o1: null, o2: null, o3: null },
      colorLabels: ['Fx', 'Bg', 'Cs'],
      usesPalette: false,
      flags: ['1'],
      defaults: {}
    });
  });

  it("maps '!' slider labels to defaults and keeps custom ones (Blink)", () => {
    expect(fx[1].sliders).toEqual({
      sx: 'Effect speed', ix: 'Duty cycle', c1: null, c2: null, c3: null
    });
    expect(fx[1].colorLabels).toEqual(['Fx', 'Bg', null]);
    expect(fx[1].usesPalette).toBe(true);
    expect(fx[1].flags).toEqual(['0', '1']);
    expect(fx[1].defaults).toEqual({});
  });

  it("defaults flags to ['1'] when the flags section is missing entirely (Wipe)", () => {
    expect(fx[2].flags).toEqual(['1']);
  });

  it('reads checkbox option at position 5 as o1 and empty colors as unused slots (Dynamic)', () => {
    expect(fx[3].options).toEqual({ o1: 'Smooth', o2: null, o3: null });
    expect(fx[3].colorLabels).toEqual([null, null, null]);
  });

  it('reads checkbox option at position 6 as o2 (Scan) with all-default color labels', () => {
    expect(fx[4].options).toEqual({ o1: null, o2: 'Overlay', o3: null });
    expect(fx[4].colorLabels).toEqual(['Fx', 'Bg', 'Cs']);
  });

  it("defaults flags to ['1'] when the flags section is present but empty, keeps custom color labels and parses defaults (Aurora)", () => {
    expect(fx[5].colorLabels).toEqual(['1', '2', '3']);
    expect(fx[5].flags).toEqual(['1']);
    expect(fx[5].defaults).toEqual({ sx: 24, pal: 50 });
  });

  it('parses multi-key defaults including m12 (Tetrix)', () => {
    expect(fx[6].options.o1).toBe('One color');
    expect(fx[6].defaults).toEqual({ sx: 0, ix: 0, pal: 11, m12: 1 });
  });

  it('keeps mixed custom/default color labels in slot order (Two Dots)', () => {
    expect(fx[7].colorLabels).toEqual(['1', '2', 'Bg']);
  });

  it('parses c1 slider, all three options, 1D+2D flags and o-defaults (Palette)', () => {
    expect(fx[8].sliders).toEqual({
      sx: 'Shift', ix: 'Size', c1: 'Rotation', c2: null, c3: null
    });
    expect(fx[8].options).toEqual({
      o1: 'Animate Shift', o2: 'Animate Rotation', o3: 'Anamorphic'
    });
    expect(fx[8].usesPalette).toBe(true);
    expect(fx[8].flags).toEqual(['1', '2']);
    expect(fx[8].defaults).toEqual({ ix: 112, c1: 0, o1: 1, o2: 0, o3: 1 });
  });

  it('hides sx when position 0 is empty and reports usesPalette false for an empty palette section (Copy Segment)', () => {
    expect(fx[9].sliders).toEqual({
      sx: null, ix: 'Color shift', c1: 'Lighten', c2: 'Brighten', c3: 'ID'
    });
    expect(fx[9].options).toEqual({
      o1: 'Axis(2D)', o2: 'FullStack(last frame)', o3: null
    });
    expect(fx[9].usesPalette).toBe(false);
    expect(fx[9].flags).toEqual(['1', '2']);
    expect(fx[9].defaults).toEqual({ ix: 0, c1: 0, c2: 0, c3: 0 });
  });

  it('labels only color slot 3 when slots 1-2 are empty (Glitter)', () => {
    expect(fx[10].colorLabels).toEqual([null, null, 'Glitter color']);
    expect(fx[10].defaults).toEqual({ pal: 11, m12: 0 });
  });

  it("splits audio flags into chars (Pixels '1v')", () => {
    expect(fx[11].flags).toEqual(['1', 'v']);
    expect(fx[11].sliders.sx).toBe('Fade rate');
  });

  it("parses pure 2D flag (Spaceships '2') with o1 'Smear'", () => {
    expect(fx[12].flags).toEqual(['2']);
    expect(fx[12].options.o1).toBe('Smear');
  });

  it('treats fxdata entries missing for a given effect id as empty (real RSVD placeholders)', () => {
    // On the real device, ids 142/169/170/171 are named 'RSVD' with '' fxdata;
    // fxdata may also simply be shorter than the effect list.
    const meta = parseFxData([''], ['Solid', 'RSVD']);
    expect(meta[1].name).toBe('RSVD');
    expect(meta[1].sliders.sx).toBe('Effect speed');
    expect(meta[1].usesPalette).toBe(false);
  });
});
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/capabilities.test.ts` — expect **failure**: `Failed to load .../src/wled/capabilities.js` (module does not exist yet).
- [ ] Create `server/src/wled/capabilities.ts`:

```ts
// Capability types (BINDING contract from
// docs/superpowers/plans/2026-07-04-control-plane-redesign/00-master.md)
// plus the pure parsers for WLED's /json/fxdata and /json/palx formats.

// fxdata parser output — one entry per effect id
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

const DEFAULT_COLOR_LABELS = ['Fx', 'Bg', 'Cs'];

/**
 * fxdata entry format: `<sliders>;<colors>;<palette>;<flags>;<defaults>`
 * - sliders: comma list at positions 0-4 = sx,ix,c1,c2,c3 and 5-7 = o1,o2,o3
 *   checkboxes. '' = hidden, '!' = default label.
 * - colors: up to 3 slot labels ('' = slot unused, '!' = Fx/Bg/Cs).
 * - palette: non-empty = effect uses a palette.
 * - flags: char list, e.g. '01' 0D+1D, '12' 1D+2D, 'v'/'f' audio; missing or
 *   empty = 1D (WLED default).
 * - defaults: 'sx=24,m12=0' → numeric map.
 * An entirely empty entry means "no controls defined": the native WLED UI
 * shows default speed/intensity sliders and all three color slots (this is
 * what it does for Solid, id 0).
 */
export function parseFxData(fxdata: string[], effectNames: string[]): FxMeta[] {
  return effectNames.map((name, id) => parseFxEntry(fxdata[id] ?? '', id, name));
}

function parseFxEntry(raw: string, id: number, name: string): FxMeta {
  if (raw === '') {
    return {
      id,
      name,
      sliders: { sx: 'Effect speed', ix: 'Effect intensity', c1: null, c2: null, c3: null },
      options: { o1: null, o2: null, o3: null },
      colorLabels: ['Fx', 'Bg', 'Cs'],
      usesPalette: false,
      flags: ['1'],
      defaults: {}
    };
  }

  const [slidersSec = '', colorsSec = '', palSec = '', flagsSec = '', defaultsSec = ''] =
    raw.split(';');
  const sl = slidersSec.split(',');
  const co = colorsSec === '' ? [] : colorsSec.split(',');

  return {
    id,
    name,
    sliders: {
      sx: labelAt(sl, 0, 'Effect speed'),
      ix: labelAt(sl, 1, 'Effect intensity'),
      c1: labelAt(sl, 2, 'Custom 1'),
      c2: labelAt(sl, 3, 'Custom 2'),
      c3: labelAt(sl, 4, 'Custom 3')
    },
    options: {
      o1: labelAt(sl, 5, 'Option 1'),
      o2: labelAt(sl, 6, 'Option 2'),
      o3: labelAt(sl, 7, 'Option 3')
    },
    colorLabels: [0, 1, 2].map((i) => labelAt(co, i, DEFAULT_COLOR_LABELS[i])),
    usesPalette: palSec !== '',
    flags: flagsSec === '' ? ['1'] : flagsSec.split(''),
    defaults: parseDefaults(defaultsSec)
  };
}

function labelAt(parts: string[], index: number, defaultLabel: string): string | null {
  const raw = parts[index];
  if (raw === undefined || raw === '') return null;
  return raw === '!' ? defaultLabel : raw;
}

function parseDefaults(sec: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (sec === '') return out;
  for (const pair of sec.split(',')) {
    const [key, value] = pair.split('=');
    if (!key || value === undefined) continue;
    const num = Number(value);
    if (!Number.isNaN(num)) out[key] = num;
  }
  return out;
}
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/capabilities.test.ts` — expect all tests pass.
- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect full suite green.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/wled/capabilities.ts server/test/wled/capabilities.test.ts && git commit -m "Add fxdata parser producing FxMeta per capability contract"`

---

## Task 3: palx parser (`parsePalettePreviewPage`)

**Files:**
- Modify: `server/src/wled/capabilities.ts` (append one exported function + one helper)
- Test: `server/test/wled/capabilities.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `PalettePreview` from Task 2.
- Produces: `parsePalettePreviewPage(p: Record<string, unknown>): Record<number, PalettePreview>` — consumed by `getPalettePreviews` (Task 4).

- [ ] Append to `server/test/wled/capabilities.test.ts` (add `parsePalettePreviewPage` to the existing import from `'../../src/wled/capabilities.js'`):

```ts
// Verbatim /json/palx?page=0 `p` payload (ids 0-5) captured from
// 192.168.1.86 (WLED 16.0.0). Names for reference:
// 0 'Default', 1 '* Random Cycle', 2 '* Color 1', 3 '* Colors 1&2',
// 4 '* Color Gradient', 5 '* Colors Only'.
const PALX_PAGE0_P: Record<string, unknown> = {
  '0': [
    [0, 155, 0, 213], [16, 189, 0, 184], [32, 218, 0, 146], [48, 243, 0, 92],
    [64, 244, 85, 0], [80, 220, 143, 0], [96, 213, 180, 0], [112, 213, 213, 0],
    [128, 213, 155, 0], [144, 239, 102, 0], [160, 249, 0, 68], [176, 225, 0, 134],
    [192, 196, 0, 176], [208, 163, 0, 207], [224, 118, 0, 232], [240, 0, 50, 252]
  ],
  '1': ['r', 'r', 'r', 'r'],
  '2': ['c1'],
  '3': ['c1', 'c1', 'c2', 'c2'],
  '4': ['c3', 'c2', 'c1'],
  '5': ['c1', 'c1', 'c1', 'c1', 'c1', 'c2', 'c2', 'c2', 'c2', 'c2',
        'c3', 'c3', 'c3', 'c3', 'c3', 'c1']
};

describe('parsePalettePreviewPage', () => {
  const previews = parsePalettePreviewPage(PALX_PAGE0_P);

  it('classifies gradient-stop arrays as stops with numeric ids', () => {
    expect(previews[0]).toEqual({
      type: 'stops',
      stops: [
        [0, 155, 0, 213], [16, 189, 0, 184], [32, 218, 0, 146], [48, 243, 0, 92],
        [64, 244, 85, 0], [80, 220, 143, 0], [96, 213, 180, 0], [112, 213, 213, 0],
        [128, 213, 155, 0], [144, 239, 102, 0], [160, 249, 0, 68], [176, 225, 0, 134],
        [192, 196, 0, 176], [208, 163, 0, 207], [224, 118, 0, 232], [240, 0, 50, 252]
      ]
    });
  });

  it("classifies all-'r' entries as random", () => {
    expect(previews[1]).toEqual({ type: 'random' });
  });

  it('classifies color-slot entries as slots, preserving order', () => {
    expect(previews[2]).toEqual({ type: 'slots', slots: ['c1'] });
    expect(previews[3]).toEqual({ type: 'slots', slots: ['c1', 'c1', 'c2', 'c2'] });
    expect(previews[4]).toEqual({ type: 'slots', slots: ['c3', 'c2', 'c1'] });
  });

  it('handles the long mixed-slot palette (* Colors Only)', () => {
    expect(previews[5]).toEqual({
      type: 'slots',
      slots: ['c1', 'c1', 'c1', 'c1', 'c1', 'c2', 'c2', 'c2', 'c2', 'c2',
              'c3', 'c3', 'c3', 'c3', 'c3', 'c1']
    });
  });

  it('returns an empty record for an empty page (the real device serves { m: 9, p: {} } for its final page)', () => {
    expect(parsePalettePreviewPage({})).toEqual({});
  });
});
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/capabilities.test.ts` — expect **failure**: `parsePalettePreviewPage` is not exported (`SyntaxError: The requested module ... does not provide an export named 'parsePalettePreviewPage'`).
- [ ] Append to `server/src/wled/capabilities.ts`:

```ts
/**
 * One /json/palx page's `p` object → previews keyed by numeric palette id.
 * Entry shapes observed on real hardware:
 * - [[pos,r,g,b], ...]          → gradient stops
 * - ['r','r',...]               → randomized palette
 * - ['c1','c2',...]             → derived from the segment's color slots
 */
export function parsePalettePreviewPage(
  p: Record<string, unknown>
): Record<number, PalettePreview> {
  const out: Record<number, PalettePreview> = {};
  for (const [key, value] of Object.entries(p)) {
    if (!Array.isArray(value)) continue;
    out[Number(key)] = classifyPaletteEntry(value);
  }
  return out;
}

function classifyPaletteEntry(entry: unknown[]): PalettePreview {
  if (entry.some((e) => e === 'r')) return { type: 'random' };
  if (entry.some((e) => typeof e === 'string')) {
    const slots = entry.filter(
      (e): e is 'c1' | 'c2' | 'c3' => e === 'c1' || e === 'c2' || e === 'c3'
    );
    return { type: 'slots', slots };
  }
  return {
    type: 'stops',
    stops: entry.map((s) => (s as number[]).slice(0, 4) as [number, number, number, number])
  };
}
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/capabilities.test.ts` — expect all tests pass.
- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect full suite green.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/wled/capabilities.ts server/test/wled/capabilities.test.ts && git commit -m "Add palx palette-preview parser (stops/random/slots classification)"`

---

## Task 4: WLED client v2 read endpoints (`getFxData`, `getPalettePreviews`, `getConfig`, `getFullState`)

**Files:**
- Modify: `server/src/wled/client.ts` (append after `getPalettes`, currently line 61)
- Test: `server/test/wled/clientV2.test.ts` (new — keeps the growing v2 surface out of the v1 test file)

**Interfaces:**
- Consumes: `getJson` (client.ts line 4), `parsePalettePreviewPage` + `PalettePreview` (Task 3), `WledFullState` (Task 1).
- Note: the phase-scope items `getEffects`/`getPalettes` already exist in the v1 client (client.ts lines 55–61, tested in `test/wled/client.test.ts`) — do not re-add them; this task only adds the four missing reads.
- Produces:
  - `getFxData(host: string): Promise<string[]>`
  - `getPalettePreviews(host: string): Promise<Record<number, PalettePreview>>` — paginates `/json/palx?page=N` from 0 through `m` inclusive
  - `getConfig(host: string): Promise<Record<string, unknown>>`
  - `getFullState(host: string): Promise<WledFullState>`
  Consumed by Task 7 (refresh) and Phase B (config/device routes).

- [ ] Create `server/test/wled/clientV2.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getFxData,
  getPalettePreviews,
  getConfig,
  getFullState
} from '../../src/wled/client.js';

const HOST = '10.0.0.50';

/** Routes GET requests by `pathname+search`; throws on any unexpected URL. */
function stubFetchRoutes(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname, search } = new URL(url);
    const key = pathname + search;
    if (!(key in routes)) throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${key}`);
    return { ok: true, json: async () => routes[key] } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('wled client v2 reads', () => {
  it('getFxData fetches the raw fxdata string array', async () => {
    stubFetchRoutes({ '/json/fxdata': ['', '!,Duty cycle;!,!;!;01'] });
    expect(await getFxData(HOST)).toEqual(['', '!,Duty cycle;!,!;!;01']);
  });

  it('getPalettePreviews paginates page 0..m inclusive, merging and classifying every page', async () => {
    // Mirrors real device behavior: every page repeats m, and the final
    // page may be empty (192.168.1.86 serves m=9 with page 9 = {}).
    const fetchMock = stubFetchRoutes({
      '/json/palx?page=0': {
        m: 2,
        p: { '0': [[0, 155, 0, 213], [240, 0, 50, 252]], '1': ['r', 'r', 'r', 'r'] }
      },
      '/json/palx?page=1': { m: 2, p: { '8': [[0, 0, 0, 0], [255, 255, 0, 0]] } },
      '/json/palx?page=2': { m: 2, p: {} }
    });

    const previews = await getPalettePreviews(HOST);

    expect(previews).toEqual({
      0: { type: 'stops', stops: [[0, 155, 0, 213], [240, 0, 50, 252]] },
      1: { type: 'random' },
      8: { type: 'stops', stops: [[0, 0, 0, 0], [255, 255, 0, 0]] }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('getPalettePreviews stops after page 0 when m is 0', async () => {
    const fetchMock = stubFetchRoutes({
      '/json/palx?page=0': { m: 0, p: { '2': ['c1'] } }
    });
    expect(await getPalettePreviews(HOST)).toEqual({ 2: { type: 'slots', slots: ['c1'] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getConfig returns cfg.json untouched', async () => {
    // Trimmed verbatim from GET /json/cfg on 192.168.1.86.
    const cfg = {
      rev: [1, 0],
      vid: 2605030,
      id: { mdns: 'cabinet-lights', name: 'Cabinet Lights', inv: 'Cabinet Lights', sui: false }
    };
    stubFetchRoutes({ '/json/cfg': cfg });
    expect(await getConfig(HOST)).toEqual(cfg);
  });

  it('getFullState fetches the combined /json object', async () => {
    const full = {
      state: { on: true, bri: 128, ps: -1, seg: [] },
      info: { name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030, leds: { count: 48, rgbw: true }, arch: 'esp32' },
      effects: ['Solid', 'Blink'],
      palettes: ['Default', '* Random Cycle']
    };
    stubFetchRoutes({ '/json': full });
    expect(await getFullState(HOST)).toEqual(full);
  });
});
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/clientV2.test.ts` — expect **failure**: `does not provide an export named 'getFxData'`.
- [ ] In `server/src/wled/client.ts`: change line 1 to
  `import type { WledInfo, WledState, WledStatePatch, WledPreset, WledFullState } from './types.js';`
  and add below it
  `import { parsePalettePreviewPage, type PalettePreview } from './capabilities.js';`
  then append at the end of the file:

```ts
export function getFxData(host: string): Promise<string[]> {
  return getJson<string[]>(host, '/json/fxdata');
}

interface PalxPage {
  m: number;
  p: Record<string, unknown>;
}

export async function getPalettePreviews(host: string): Promise<Record<number, PalettePreview>> {
  const first = await getJson<PalxPage>(host, '/json/palx?page=0');
  const previews = parsePalettePreviewPage(first.p);
  for (let page = 1; page <= first.m; page++) {
    const next = await getJson<PalxPage>(host, `/json/palx?page=${page}`);
    Object.assign(previews, parsePalettePreviewPage(next.p));
  }
  return previews;
}

export function getConfig(host: string): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(host, '/json/cfg');
}

export function getFullState(host: string): Promise<WledFullState> {
  return getJson<WledFullState>(host, '/json');
}
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/clientV2.test.ts` — expect all tests pass.
- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test && npm run build` — expect green.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/wled/client.ts server/test/wled/clientV2.test.ts && git commit -m "Add WLED client v2 reads: fxdata, paginated palette previews, config, full state"`

---

## Task 5: WLED client v2 device ops (`patchConfig`, `savePreset`, `deletePreset`, `reboot`, `setNightlight`)

**Files:**
- Modify: `server/src/wled/client.ts` (append; also extend the type import with `WledNightlight`)
- Test: `server/test/wled/clientV2.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `postJson`, `getPresets`, `setState` (client.ts), `WledNightlight` (Task 1).
- Produces (consumed by Phase B routes and Phase F UI):
  - `patchConfig(host: string, patch: Record<string, unknown>): Promise<{ success?: boolean }>`
  - `savePreset(host: string, opts: { id?: number; name: string; includeBrightness: boolean; saveSegmentBounds: boolean }): Promise<{ id: number }>`
  - `deletePreset(host: string, presetId: number): Promise<void>`
  - `reboot(host: string): Promise<void>`
  - `setNightlight(host: string, nl: Partial<WledNightlight>): Promise<WledState>`

**Safety note:** these functions WRITE to devices. Their tests are 100% fetch-stubbed; per the Global Constraints they must never be exercised against real hardware autonomously.

- [ ] Append to `server/test/wled/clientV2.test.ts` (extend the top import with `patchConfig, savePreset, deletePreset, reboot, setNightlight`):

```ts
/** Captures every request; returns `responses[key]` or `{success:true}`. */
function stubFetchCapture(responses: Record<string, unknown> = {}) {
  const calls: { key: string; method: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname, search } = new URL(url);
    const key = pathname + search;
    calls.push({
      key,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined
    });
    return { ok: true, json: async () => responses[key] ?? { success: true } } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('wled client v2 device ops', () => {
  it('patchConfig POSTs a partial cfg patch to /json/cfg', async () => {
    const calls = stubFetchCapture();
    const result = await patchConfig(HOST, { id: { name: 'New Name' } });
    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      { key: '/json/cfg', method: 'POST', body: { id: { name: 'New Name' } } }
    ]);
  });

  it('savePreset with an explicit id POSTs psave/n/ib/sb and skips presets.json', async () => {
    const calls = stubFetchCapture();
    const result = await savePreset(HOST, {
      id: 7, name: 'Movie night', includeBrightness: true, saveSegmentBounds: false
    });
    expect(result).toEqual({ id: 7 });
    expect(calls).toEqual([
      { key: '/json/state', method: 'POST', body: { psave: 7, n: 'Movie night', ib: true, sb: false } }
    ]);
  });

  it('savePreset without id reads presets.json and takes the lowest free slot >= 1', async () => {
    // Slot 0 as a reserved empty object is verbatim real-device behavior.
    const calls = stubFetchCapture({
      '/presets.json': { '0': {}, '1': { n: 'Sunset' }, '2': { n: 'Party' } }
    });
    const result = await savePreset(HOST, {
      name: 'Movie night', includeBrightness: false, saveSegmentBounds: true
    });
    expect(result).toEqual({ id: 3 });
    expect(calls).toEqual([
      { key: '/presets.json', method: 'GET', body: undefined },
      { key: '/json/state', method: 'POST', body: { psave: 3, n: 'Movie night', ib: false, sb: true } }
    ]);
  });

  it('savePreset without id fills gaps in the preset id sequence', async () => {
    const calls = stubFetchCapture({
      '/presets.json': { '1': { n: 'A' }, '3': { n: 'B' } }
    });
    const result = await savePreset(HOST, {
      name: 'Gap', includeBrightness: true, saveSegmentBounds: true
    });
    expect(result).toEqual({ id: 2 });
    expect(calls[1].body).toEqual({ psave: 2, n: 'Gap', ib: true, sb: true });
  });

  it('deletePreset POSTs pdel', async () => {
    const calls = stubFetchCapture();
    await deletePreset(HOST, 3);
    expect(calls).toEqual([{ key: '/json/state', method: 'POST', body: { pdel: 3 } }]);
  });

  it('reboot POSTs rb:true', async () => {
    const calls = stubFetchCapture();
    await reboot(HOST);
    expect(calls).toEqual([{ key: '/json/state', method: 'POST', body: { rb: true } }]);
  });

  it('setNightlight wraps the nl object in a state patch', async () => {
    const calls = stubFetchCapture({
      '/json/state': { on: true, bri: 128, ps: -1, seg: [] }
    });
    await setNightlight(HOST, { on: true, dur: 30, mode: 1, tbri: 0 });
    expect(calls).toEqual([
      { key: '/json/state', method: 'POST', body: { nl: { on: true, dur: 30, mode: 1, tbri: 0 } } }
    ]);
  });
});
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/clientV2.test.ts` — expect **failure**: `does not provide an export named 'patchConfig'`.
- [ ] In `server/src/wled/client.ts`: extend the type import to include `WledNightlight`, then append:

```ts
export function patchConfig(
  host: string,
  patch: Record<string, unknown>
): Promise<{ success?: boolean }> {
  return postJson<{ success?: boolean }>(host, '/json/cfg', patch);
}

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

export async function reboot(host: string): Promise<void> {
  await postJson(host, '/json/state', { rb: true });
}

export function setNightlight(host: string, nl: Partial<WledNightlight>): Promise<WledState> {
  return setState(host, { nl });
}
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/wled/clientV2.test.ts` — expect all tests pass.
- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test && npm run build` — expect green.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/wled/client.ts server/test/wled/clientV2.test.ts && git commit -m "Add WLED client v2 device ops: patchConfig, savePreset, deletePreset, reboot, setNightlight"`

---

## Task 6: `controller_capabilities` table + capabilities repository

**Files:**
- Modify: `server/src/db/schema.ts` (add table inside the main `db.exec` block, after the `controller_status` table at lines 100–106)
- Create: `server/src/controllers/capabilitiesRepository.ts`
- Test: `server/test/controllers/capabilitiesRepository.test.ts` (new)

**Interfaces:**
- Consumes: `ControllerCapabilities` (Task 2), `createDb` (`server/src/db/client.ts`).
- Produces: `createCapabilitiesRepository(db)` with
  - `get(controllerId: string): ControllerCapabilities | undefined`
  - `upsert(controllerId: string, caps: ControllerCapabilities): void`
  Consumed by Tasks 7–9 and Phase B name resolution.

**Schema contract (verbatim from master — do not reshape):**

```sql
CREATE TABLE IF NOT EXISTS controller_capabilities (
  controller_id TEXT PRIMARY KEY REFERENCES controllers(id) ON DELETE CASCADE,
  vid INTEGER NOT NULL,
  effects TEXT NOT NULL, palettes TEXT NOT NULL, fxdata TEXT NOT NULL,
  palette_previews TEXT NOT NULL, fetched_at TEXT NOT NULL
);
```

(No idempotent `ALTER TABLE` needed — it is a brand-new table, and `CREATE TABLE IF NOT EXISTS` is the same pattern every other table in `schema.ts` uses. Note: the repo's `createDb` does not enable `PRAGMA foreign_keys`, so `ON DELETE CASCADE` is declared per contract but not enforced at runtime — do not write a cascade test.)

- [ ] Create `server/test/controllers/capabilitiesRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createCapabilitiesRepository } from '../../src/controllers/capabilitiesRepository.js';
import { parseFxData, type ControllerCapabilities } from '../../src/wled/capabilities.js';

function sampleCaps(): ControllerCapabilities {
  return {
    vid: 2605030,
    effects: ['Solid', 'Blink'],
    palettes: ['Default', '* Random Cycle'],
    fxMeta: parseFxData(['', '!,Duty cycle;!,!;!;01'], ['Solid', 'Blink']),
    palettePreviews: {
      0: { type: 'stops', stops: [[0, 155, 0, 213], [240, 0, 50, 252]] },
      1: { type: 'random' }
    },
    fetchedAt: '2026-07-04T22:00:00.000Z'
  };
}

describe('capabilities repository', () => {
  let db: ReturnType<typeof createDb>;
  let repo: ReturnType<typeof createCapabilitiesRepository>;
  let controllerId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    repo = createCapabilitiesRepository(db);
    controllerId = createControllerRepository(db)
      .add({ name: 'Cabinet Lights', host: '10.0.0.50', source: 'manual' }).id;
  });

  it('get returns undefined before any upsert', () => {
    expect(repo.get(controllerId)).toBeUndefined();
  });

  it('round-trips a full ControllerCapabilities object through JSON columns', () => {
    const caps = sampleCaps();
    repo.upsert(controllerId, caps);
    expect(repo.get(controllerId)).toEqual(caps);
  });

  it('upsert overwrites the existing row on conflict (new vid wins)', () => {
    repo.upsert(controllerId, sampleCaps());
    const updated: ControllerCapabilities = {
      ...sampleCaps(),
      vid: 2605031,
      effects: ['Solid', 'Blink', 'Breathe'],
      fetchedAt: '2026-07-05T01:00:00.000Z'
    };
    repo.upsert(controllerId, updated);
    const row = repo.get(controllerId);
    expect(row?.vid).toBe(2605031);
    expect(row?.effects).toEqual(['Solid', 'Blink', 'Breathe']);
    expect(row?.fetchedAt).toBe('2026-07-05T01:00:00.000Z');
  });
});
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/controllers/capabilitiesRepository.test.ts` — expect **failure**: cannot find module `capabilitiesRepository.js`.
- [ ] In `server/src/db/schema.ts`, inside the `db.exec(` template literal, immediately after the `controller_status` table definition (after line 106's `);`), add:

```sql
    CREATE TABLE IF NOT EXISTS controller_capabilities (
      controller_id TEXT PRIMARY KEY REFERENCES controllers(id) ON DELETE CASCADE,
      vid INTEGER NOT NULL,
      effects TEXT NOT NULL, palettes TEXT NOT NULL, fxdata TEXT NOT NULL,
      palette_previews TEXT NOT NULL, fetched_at TEXT NOT NULL
    );
```

- [ ] Create `server/src/controllers/capabilitiesRepository.ts`:

```ts
import type Database from 'better-sqlite3';
import type { ControllerCapabilities } from '../wled/capabilities.js';

// The `fxdata` column stores the PARSED FxMeta[] JSON (parsed once at
// refresh time); the repository surfaces it as `fxMeta` per the
// ControllerCapabilities contract.
export function createCapabilitiesRepository(db: Database.Database) {
  return {
    get(controllerId: string): ControllerCapabilities | undefined {
      const row = db
        .prepare('SELECT * FROM controller_capabilities WHERE controller_id = ?')
        .get(controllerId) as any;
      if (!row) return undefined;
      return {
        vid: row.vid,
        effects: JSON.parse(row.effects),
        palettes: JSON.parse(row.palettes),
        fxMeta: JSON.parse(row.fxdata),
        palettePreviews: JSON.parse(row.palette_previews),
        fetchedAt: row.fetched_at
      };
    },
    upsert(controllerId: string, caps: ControllerCapabilities): void {
      db.prepare(
        `INSERT INTO controller_capabilities
           (controller_id, vid, effects, palettes, fxdata, palette_previews, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(controller_id) DO UPDATE SET
           vid = excluded.vid,
           effects = excluded.effects,
           palettes = excluded.palettes,
           fxdata = excluded.fxdata,
           palette_previews = excluded.palette_previews,
           fetched_at = excluded.fetched_at`
      ).run(
        controllerId,
        caps.vid,
        JSON.stringify(caps.effects),
        JSON.stringify(caps.palettes),
        JSON.stringify(caps.fxMeta),
        JSON.stringify(caps.palettePreviews),
        caps.fetchedAt
      );
    }
  };
}
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/controllers/capabilitiesRepository.test.ts` — expect all tests pass.
- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect full suite green (schema change must not break existing db tests).
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/db/schema.ts server/src/controllers/capabilitiesRepository.ts server/test/controllers/capabilitiesRepository.test.ts && git commit -m "Add controller_capabilities table and repository"`

---

## Task 7: Capability refresh service (`refreshCapabilities` / `maybeRefreshCapabilities`)

**Files:**
- Create: `server/src/controllers/capabilityService.ts`
- Test: `server/test/controllers/capabilityService.test.ts` (new)

**Interfaces:**
- Consumes: `getInfo, getEffects, getPalettes, getFxData, getPalettePreviews` (client, Tasks 1+4), `parseFxData` + `ControllerCapabilities` (Task 2), `createCapabilitiesRepository` (Task 6).
- Produces (consumed by Tasks 8–9 and Phase B name resolution):

```ts
export interface CapabilityFetchers {
  getInfo: typeof getInfo;
  getEffects: typeof getEffects;
  getPalettes: typeof getPalettes;
  getFxData: typeof getFxData;
  getPalettePreviews: typeof getPalettePreviews;
}
export function refreshCapabilities(
  db: Database.Database,
  controller: { id: string; host: string },
  wled?: CapabilityFetchers
): Promise<ControllerCapabilities>;
export function maybeRefreshCapabilities(
  db: Database.Database,
  controller: { id: string; host: string },
  seenVid: number,
  wled?: CapabilityFetchers
): Promise<void>;
```

- [ ] Create `server/test/controllers/capabilityService.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createCapabilitiesRepository } from '../../src/controllers/capabilitiesRepository.js';
import {
  refreshCapabilities,
  maybeRefreshCapabilities,
  type CapabilityFetchers
} from '../../src/controllers/capabilityService.js';
import { parseFxData, type PalettePreview } from '../../src/wled/capabilities.js';

const INFO = {
  name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
  leds: { count: 48, rgbw: true }, arch: 'esp32'
};
const EFFECTS = ['Solid', 'Blink'];
const PALETTES = ['Default', '* Random Cycle'];
const FXDATA = ['', '!,Duty cycle;!,!;!;01'];
const PREVIEWS: Record<number, PalettePreview> = {
  0: { type: 'stops', stops: [[0, 155, 0, 213], [240, 0, 50, 252]] },
  1: { type: 'random' }
};

function fakeFetchers(overrides: Partial<CapabilityFetchers> = {}): CapabilityFetchers {
  return {
    getInfo: vi.fn(async () => INFO),
    getEffects: vi.fn(async () => EFFECTS),
    getPalettes: vi.fn(async () => PALETTES),
    getFxData: vi.fn(async () => FXDATA),
    getPalettePreviews: vi.fn(async () => PREVIEWS),
    ...overrides
  };
}

describe('capability service', () => {
  let db: ReturnType<typeof createDb>;
  let capsRepo: ReturnType<typeof createCapabilitiesRepository>;
  let controller: { id: string; host: string };

  beforeEach(() => {
    db = createDb(':memory:');
    capsRepo = createCapabilitiesRepository(db);
    const added = createControllerRepository(db)
      .add({ name: 'Cabinet Lights', host: '10.0.0.50', source: 'manual' });
    controller = { id: added.id, host: added.host };
  });

  it('refreshCapabilities fetches all five datasets, parses, persists and returns', async () => {
    const caps = await refreshCapabilities(db, controller, fakeFetchers());

    expect(caps.vid).toBe(2605030);
    expect(caps.effects).toEqual(EFFECTS);
    expect(caps.palettes).toEqual(PALETTES);
    expect(caps.fxMeta).toEqual(parseFxData(FXDATA, EFFECTS));
    expect(caps.palettePreviews).toEqual(PREVIEWS);
    expect(caps.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(capsRepo.get(controller.id)).toEqual(caps);
  });

  it('refreshCapabilities throws and caches nothing when info has no vid', async () => {
    const fetchers = fakeFetchers({
      getInfo: vi.fn(async () => ({ name: 'Old', ver: '0.9.0', leds: { count: 30 }, arch: 'esp8266' }))
    });
    await expect(refreshCapabilities(db, controller, fetchers)).rejects.toThrow(/no vid/);
    expect(capsRepo.get(controller.id)).toBeUndefined();
  });

  it('maybeRefreshCapabilities refreshes when no row is cached', async () => {
    await maybeRefreshCapabilities(db, controller, 2605030, fakeFetchers());
    expect(capsRepo.get(controller.id)?.vid).toBe(2605030);
  });

  it('maybeRefreshCapabilities is a no-op when the cached vid matches', async () => {
    await refreshCapabilities(db, controller, fakeFetchers());
    const before = capsRepo.get(controller.id);

    const fetchers = fakeFetchers();
    await maybeRefreshCapabilities(db, controller, 2605030, fetchers);

    expect(fetchers.getEffects).not.toHaveBeenCalled();
    expect(fetchers.getInfo).not.toHaveBeenCalled();
    expect(capsRepo.get(controller.id)).toEqual(before);
  });

  it('maybeRefreshCapabilities re-fetches when the seen vid differs from the cache', async () => {
    await refreshCapabilities(db, controller, fakeFetchers());

    const newInfo = { ...INFO, vid: 2605031 };
    const fetchers = fakeFetchers({ getInfo: vi.fn(async () => newInfo) });
    await maybeRefreshCapabilities(db, controller, 2605031, fetchers);

    expect(capsRepo.get(controller.id)?.vid).toBe(2605031);
  });

  it('maybeRefreshCapabilities swallows fetch failures (poll must never break)', async () => {
    const fetchers = fakeFetchers({
      getFxData: vi.fn(async () => { throw new Error('ECONNREFUSED'); })
    });
    await expect(
      maybeRefreshCapabilities(db, controller, 2605030, fetchers)
    ).resolves.toBeUndefined();
    expect(capsRepo.get(controller.id)).toBeUndefined();
  });
});
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/controllers/capabilityService.test.ts` — expect **failure**: cannot find module `capabilityService.js`.
- [ ] Create `server/src/controllers/capabilityService.ts`:

```ts
import type Database from 'better-sqlite3';
import {
  getInfo,
  getEffects,
  getPalettes,
  getFxData,
  getPalettePreviews
} from '../wled/client.js';
import { parseFxData, type ControllerCapabilities } from '../wled/capabilities.js';
import { createCapabilitiesRepository } from './capabilitiesRepository.js';

export interface CapabilityFetchers {
  getInfo: typeof getInfo;
  getEffects: typeof getEffects;
  getPalettes: typeof getPalettes;
  getFxData: typeof getFxData;
  getPalettePreviews: typeof getPalettePreviews;
}

const defaultFetchers: CapabilityFetchers = {
  getInfo,
  getEffects,
  getPalettes,
  getFxData,
  getPalettePreviews
};

/** Fetch all five capability datasets from the device and upsert the cache. */
export async function refreshCapabilities(
  db: Database.Database,
  controller: { id: string; host: string },
  wled: CapabilityFetchers = defaultFetchers
): Promise<ControllerCapabilities> {
  const [info, effects, palettes, fxdata, palettePreviews] = await Promise.all([
    wled.getInfo(controller.host),
    wled.getEffects(controller.host),
    wled.getPalettes(controller.host),
    wled.getFxData(controller.host),
    wled.getPalettePreviews(controller.host)
  ]);
  if (typeof info.vid !== 'number') {
    throw new Error('device info reports no vid (firmware too old?)');
  }
  const caps: ControllerCapabilities = {
    vid: info.vid,
    effects,
    palettes,
    fxMeta: parseFxData(fxdata, effects),
    palettePreviews,
    fetchedAt: new Date().toISOString()
  };
  createCapabilitiesRepository(db).upsert(controller.id, caps);
  return caps;
}

/**
 * Refresh only when the cache is missing or its vid differs from the one
 * just observed. Errors are swallowed: a failed refresh must never break
 * the caller (the status poller); the next poll retries naturally.
 */
export async function maybeRefreshCapabilities(
  db: Database.Database,
  controller: { id: string; host: string },
  seenVid: number,
  wled: CapabilityFetchers = defaultFetchers
): Promise<void> {
  const cached = createCapabilitiesRepository(db).get(controller.id);
  if (cached && cached.vid === seenVid) return;
  try {
    await refreshCapabilities(db, controller, wled);
  } catch {
    // Swallowed by design — see doc comment.
  }
}
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/controllers/capabilityService.test.ts` — expect all tests pass.
- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect full suite green.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/controllers/capabilityService.ts server/test/controllers/capabilityService.test.ts && git commit -m "Add capability refresh service (fetch five datasets, upsert cache)"`

---

## Task 8: Trigger capability refresh from the status poller on `vid` change

**Files:**
- Modify: `server/src/controllers/statusPoller.ts` (full replacement — currently 31 lines)
- Test: `server/test/controllers/statusPoller.test.ts` (append a describe block; existing 4 tests must pass unchanged)

**Interfaces:**
- Consumes: `maybeRefreshCapabilities` + `CapabilityFetchers` (Task 7); existing `createControllerRepository` / `createControllerStatusRepository`.
- Produces: `pollAllControllerStatus(db, wled?)` — same name/behavior as today, with an optionally-widened DI bag:

```ts
export interface StatusPollerWled {
  getInfo: typeof getInfo;
  getState: typeof getState;
  getEffects?: typeof getEffects;
  getPalettes?: typeof getPalettes;
  getFxData?: typeof getFxData;
  getPalettePreviews?: typeof getPalettePreviews;
}
```

  Capability fetchers are optional so the four existing tests (which pass only `{getInfo, getState}` and infos **without** `vid`) keep passing untouched — no `vid` means no refresh attempt.

- [ ] Append to `server/test/controllers/statusPoller.test.ts` (add `vi` to the vitest import on line 1, and add `import { createCapabilitiesRepository } from '../../src/controllers/capabilitiesRepository.js';` to the imports):

```ts
describe('pollAllControllerStatus capability refresh wiring', () => {
  let db: ReturnType<typeof createDb>;
  let controllers: ReturnType<typeof createControllerRepository>;
  let statuses: ReturnType<typeof createControllerStatusRepository>;

  const info = {
    name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
    leds: { count: 48, rgbw: true }, arch: 'esp32'
  };
  const state = { on: true, bri: 128, ps: -1, seg: [] };

  function capFetchers() {
    return {
      getEffects: vi.fn(async () => ['Solid', 'Blink']),
      getPalettes: vi.fn(async () => ['Default', '* Random Cycle']),
      getFxData: vi.fn(async () => ['', '!,Duty cycle;!,!;!;01']),
      getPalettePreviews: vi.fn(async () => ({ 1: { type: 'random' as const } }))
    };
  }

  beforeEach(() => {
    db = createDb(':memory:');
    controllers = createControllerRepository(db);
    statuses = createControllerStatusRepository(db);
  });

  it('populates the capability cache on first sight of a controller with a vid', async () => {
    const id = controllers.add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' }).id;
    await pollAllControllerStatus(db, {
      getInfo: async () => info,
      getState: async () => state,
      ...capFetchers()
    });

    const caps = createCapabilitiesRepository(db).get(id);
    expect(caps?.vid).toBe(2605030);
    expect(caps?.fxMeta[1].sliders.ix).toBe('Duty cycle');
    expect(statuses.get(id)).toMatchObject({ reachable: true });
  });

  it('does not re-fetch capabilities when the cached vid matches', async () => {
    controllers.add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' });
    const first = capFetchers();
    await pollAllControllerStatus(db, { getInfo: async () => info, getState: async () => state, ...first });

    const second = capFetchers();
    await pollAllControllerStatus(db, { getInfo: async () => info, getState: async () => state, ...second });

    expect(second.getEffects).not.toHaveBeenCalled();
    expect(second.getFxData).not.toHaveBeenCalled();
  });

  it('re-fetches capabilities when the device vid changes (firmware update)', async () => {
    const id = controllers.add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' }).id;
    await pollAllControllerStatus(db, { getInfo: async () => info, getState: async () => state, ...capFetchers() });

    const upgraded = { ...info, vid: 2605031 };
    await pollAllControllerStatus(db, { getInfo: async () => upgraded, getState: async () => state, ...capFetchers() });

    expect(createCapabilitiesRepository(db).get(id)?.vid).toBe(2605031);
  });

  it('still records reachable status when the capability refresh itself fails', async () => {
    const id = controllers.add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' }).id;
    await pollAllControllerStatus(db, {
      getInfo: async () => info,
      getState: async () => state,
      ...capFetchers(),
      getFxData: vi.fn(async () => { throw new Error('ECONNREFUSED'); })
    });

    expect(statuses.get(id)).toMatchObject({ reachable: true, info, state });
    expect(createCapabilitiesRepository(db).get(id)).toBeUndefined();
  });

  it('does not attempt a refresh when info has no vid (old firmware / legacy mocks)', async () => {
    const id = controllers.add({ name: 'Old', host: '10.0.0.51', source: 'manual' }).id;
    const fetchers = capFetchers();
    await pollAllControllerStatus(db, {
      getInfo: async () => ({ name: 'Old', ver: '0.9.0', leds: { count: 30 }, arch: 'esp8266' }),
      getState: async () => state,
      ...fetchers
    });

    expect(fetchers.getEffects).not.toHaveBeenCalled();
    expect(createCapabilitiesRepository(db).get(id)).toBeUndefined();
  });
});
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/controllers/statusPoller.test.ts` — expect exactly **2 of the 5 new tests to fail**: "populates the capability cache on first sight" and "re-fetches capabilities when the device vid changes" (both `expected undefined to be 26050…` — the old poller never touches the cache). The 3 negative new tests ("does not re-fetch", "still records reachable status", "no vid") pass trivially before the change, and the 4 existing tests pass. (Vitest does not type-check, so the widened DI bag only compiles once the implementation lands — `npm run build` later in this task is the type gate.)
- [ ] Replace `server/src/controllers/statusPoller.ts` with:

```ts
import type Database from 'better-sqlite3';
import { createControllerRepository } from './repository.js';
import { createControllerStatusRepository } from './statusRepository.js';
import {
  getInfo,
  getState,
  getEffects,
  getPalettes,
  getFxData,
  getPalettePreviews
} from '../wled/client.js';
import { maybeRefreshCapabilities, type CapabilityFetchers } from './capabilityService.js';

export interface StatusPollerWled {
  getInfo: typeof getInfo;
  getState: typeof getState;
  getEffects?: typeof getEffects;
  getPalettes?: typeof getPalettes;
  getFxData?: typeof getFxData;
  getPalettePreviews?: typeof getPalettePreviews;
}

export async function pollAllControllerStatus(
  db: Database.Database,
  wled: StatusPollerWled = { getInfo, getState, getEffects, getPalettes, getFxData, getPalettePreviews }
): Promise<void> {
  const controllers = createControllerRepository(db);
  const statuses = createControllerStatusRepository(db);
  const fetchers: CapabilityFetchers = {
    getInfo: wled.getInfo,
    getEffects: wled.getEffects ?? getEffects,
    getPalettes: wled.getPalettes ?? getPalettes,
    getFxData: wled.getFxData ?? getFxData,
    getPalettePreviews: wled.getPalettePreviews ?? getPalettePreviews
  };

  await Promise.all(
    controllers.list().map(async (controller) => {
      const polledAt = new Date().toISOString();
      try {
        const [info, state] = await Promise.all([
          wled.getInfo(controller.host),
          wled.getState(controller.host)
        ]);
        statuses.upsert({ controllerId: controller.id, reachable: true, info, state, polledAt });
        if (typeof info.vid === 'number') {
          // First sighting or firmware change triggers a capability refresh;
          // maybeRefreshCapabilities swallows its own errors.
          await maybeRefreshCapabilities(db, controller, info.vid, fetchers);
        }
      } catch {
        // Offline/unreachable controllers are cached as such rather than
        // leaving stale data or throwing — one unreachable controller must
        // never abort the poll cycle for the rest.
        statuses.upsert({ controllerId: controller.id, reachable: false, info: null, state: null, polledAt });
      }
    })
  );
}
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/controllers/statusPoller.test.ts` — expect all 9 tests pass.
- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test && npm run build` — expect green.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/controllers/statusPoller.ts server/test/controllers/statusPoller.test.ts && git commit -m "Trigger capability refresh from status poller on vid change"`

---

## Task 9: `GET /api/controllers/:id/capabilities` route

**Files:**
- Modify: `server/src/controllers/routes.ts` (imports at lines 1–7; new handler inserted after the `/:id/status` handler ending at line 45)
- Test: `server/test/controllers/capabilitiesRoute.test.ts` (new)

**Interfaces:**
- Consumes: `createCapabilitiesRepository` (Task 6), `refreshCapabilities` (Task 7).
- Produces (master contract): `GET /api/controllers/:id/capabilities` →
  - `200` with a `ControllerCapabilities` body when cached **or** when an on-demand refresh succeeds,
  - `404 { error }` for an unknown controller id,
  - `503 { error }` when capabilities were never fetched and the device is unreachable.
  Router is already mounted at `/api/controllers` in `server/src/app.ts:23` — no app.ts change needed.

- [ ] Create `server/test/controllers/capabilitiesRoute.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllersRouter } from '../../src/controllers/routes.js';
import { createCapabilitiesRepository } from '../../src/controllers/capabilitiesRepository.js';
import { parseFxData, type ControllerCapabilities } from '../../src/wled/capabilities.js';

// Verbatim-shaped device responses (values captured from 192.168.1.86,
// WLED 16.0.0, vid 2605030; lists trimmed to two entries).
const DEVICE_ROUTES: Record<string, unknown> = {
  '/json/info': {
    name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
    leds: { count: 48, rgbw: true }, arch: 'esp32'
  },
  '/json/eff': ['Solid', 'Blink'],
  '/json/pal': ['Default', '* Random Cycle'],
  '/json/fxdata': ['', '!,Duty cycle;!,!;!;01'],
  '/json/palx?page=0': {
    m: 0,
    p: { '0': [[0, 155, 0, 213], [240, 0, 50, 252]], '1': ['r', 'r', 'r', 'r'] }
  }
};

function stubDeviceFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    const { pathname, search } = new URL(url);
    const key = pathname + search;
    if (!(key in DEVICE_ROUTES)) throw new Error(`unexpected fetch: ${key}`);
    return { ok: true, json: async () => DEVICE_ROUTES[key] } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('GET /api/controllers/:id/capabilities', () => {
  let app: express.Express;
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/controllers', createControllersRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  async function addController(): Promise<string> {
    const post = await request(app)
      .post('/api/controllers')
      .send({ name: 'Cabinet Lights', host: '10.0.0.50' });
    return post.body.id as string;
  }

  it('returns 404 for an unknown controller id', async () => {
    const res = await request(app).get('/api/controllers/does-not-exist/capabilities');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('serves the cached row without contacting the device', async () => {
    const id = await addController();
    const caps: ControllerCapabilities = {
      vid: 2605030,
      effects: ['Solid', 'Blink'],
      palettes: ['Default', '* Random Cycle'],
      fxMeta: parseFxData(['', '!,Duty cycle;!,!;!;01'], ['Solid', 'Blink']),
      palettePreviews: { 1: { type: 'random' } },
      fetchedAt: '2026-07-04T22:00:00.000Z'
    };
    createCapabilitiesRepository(db).upsert(id, caps);
    const fetchMock = vi.fn(async () => { throw new Error('must not be called'); });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get(`/api/controllers/${id}/capabilities`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(JSON.stringify(caps)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes on demand when no row exists and the device is reachable, then persists', async () => {
    const id = await addController();
    stubDeviceFetch();

    const res = await request(app).get(`/api/controllers/${id}/capabilities`);

    expect(res.status).toBe(200);
    expect(res.body.vid).toBe(2605030);
    expect(res.body.effects).toEqual(['Solid', 'Blink']);
    expect(res.body.fxMeta[1].sliders.ix).toBe('Duty cycle');
    expect(res.body.palettePreviews['1']).toEqual({ type: 'random' });
    expect(createCapabilitiesRepository(db).get(id)?.vid).toBe(2605030);

    // Second request is served from the cache: no further device traffic.
    const silent = vi.fn(async () => { throw new Error('must not be called'); });
    vi.stubGlobal('fetch', silent);
    const again = await request(app).get(`/api/controllers/${id}/capabilities`);
    expect(again.status).toBe(200);
    expect(silent).not.toHaveBeenCalled();
  });

  it('returns 503 {error} when never fetched and the device is unreachable', async () => {
    const id = await addController();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const res = await request(app).get(`/api/controllers/${id}/capabilities`);

    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
    expect(createCapabilitiesRepository(db).get(id)).toBeUndefined();
  });
});
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/controllers/capabilitiesRoute.test.ts` — expect **all 4 tests to fail**: the route does not exist yet, so Express falls through to its default HTML 404 — supertest reports `expected 404 to be 200` / `expected 404 to be 503` on the non-404 cases, and the unknown-id test fails on `expect(res.body.error).toBeTruthy()` (default 404 has no JSON body).
- [ ] Modify `server/src/controllers/routes.ts`:
  - Add imports after line 4 (`createControllerStatusRepository`):

```ts
import { createCapabilitiesRepository } from './capabilitiesRepository.js';
import { refreshCapabilities } from './capabilityService.js';
```

  - Add after line 12 (`const statusRepo = ...`):

```ts
  const capsRepo = createCapabilitiesRepository(db);
```

  - Insert this handler after the `/:id/status` handler (after line 45) and before `POST /:id/import-schedules`:

```ts
  router.get('/:id/capabilities', async (req, res) => {
    const controller = repo.list().find((c) => c.id === req.params.id);
    if (!controller) return res.status(404).json({ error: 'controller not found' });

    const cached = capsRepo.get(controller.id);
    if (cached) return res.json(cached);

    try {
      const fresh = await refreshCapabilities(db, controller);
      res.json(fresh);
    } catch (err: any) {
      res.status(503).json({
        error: `capabilities not cached and device fetch failed: ${err.message}`
      });
    }
  });
```

- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test -- test/controllers/capabilitiesRoute.test.ts` — expect all 4 tests pass.
- [ ] Run `cd /Users/bwwilliams/github/uber-wled/server && npm test && npm run build` — expect full suite green and tsc clean.
- [ ] Commit: `cd /Users/bwwilliams/github/uber-wled && git add server/src/controllers/routes.ts server/test/controllers/capabilitiesRoute.test.ts && git commit -m "Add GET /api/controllers/:id/capabilities with on-demand refresh and 503 fallback"`

---

## Phase A verification gate

- [ ] `cd /Users/bwwilliams/github/uber-wled/server && npm test` — full suite green (all pre-existing tests plus the 50 new ones: 1+14+5+5+7+3+6+5+4 across Tasks 1–9).
- [ ] `cd /Users/bwwilliams/github/uber-wled/server && npm run build` — tsc clean.
- [ ] `cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build` — untouched by this phase, but must still be green per the master verification gates.
- [ ] Optional live smoke check (read-only GETs only, allowed by the hardware policy): with the dev server running against the real DB, `curl http://localhost:3001/api/controllers/<id>/capabilities` for the controller at `192.168.1.86` and confirm `vid: 2605030`, 220 effects, 72 palettes, and `fxMeta[0].name === 'Solid'`. Do **not** exercise any write function against real hardware.
- [ ] Push only after the phase passes review (per master: "one commit per task, push after each phase completes review").
