# Phase H — Restyle Themes, Schedule, Firmware, Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Rebuild the Themes, Schedule, Firmware, and Settings sections on the Phase C UI kit under `client/src/sections/`, with Themes driven by the Phase A capability cache, Schedule previews on fan-out v2, Firmware deep-linking into Devices → Update, and Settings gaining the live-poll-interval field — deleting the old flat components as each replacement ships.

**Architecture:** Four independent section rewrites that consume (never modify) the Phase C design-token/component kit, the Phase A `GET /api/controllers/:id/capabilities` endpoint, the Phase B v2 `POST /api/control/apply` body and widened settings API, and Phase D's `useCapabilities` query hook, `applyControlV2` client function, and `ColorWheel` component. Each section lives in its own `client/src/sections/<name>/` folder with a section CSS file built on `design/tokens.css` variables; server state flows exclusively through `@tanstack/react-query` hooks in `client/src/api/queries.ts`.

**Tech Stack:** React 18 + Vite + TypeScript, `@tanstack/react-query` (v5 object API: `useQuery({ queryKey, queryFn })`, `isPending`), plain CSS on Phase C tokens, Vitest + Testing Library (jsdom). No new dependencies.

**Prerequisite phases:** C (kit + AppShell v2) and A (capabilities endpoint) are hard prerequisites; B (v2 apply + `livePollIntervalSeconds` in the settings API) and D (`useCapabilities`, `applyControlV2`, `ColorWheel`) are required for Tasks 8–11 and 4–5 respectively. Task 1 verifies all consumed interfaces and creates the small client-side pieces if an earlier phase has not shipped them yet (exact fallback code is included — nothing is left to invention).

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

## Pinned interface assumptions (from phases C/D — verify in Task 1)

Plans 03/04 were not yet written when this plan was authored, so the exact
signatures Phase H consumes are pinned HERE from the master contracts. If the
shipped Phase C/D code differs, reconcile toward the master plan
(00-master.md contracts always win) using the executing-plans-verification
skill; the master's names below are binding.

**UI kit (`client/src/components/ui/*.tsx`, Phase C):**

```tsx
Button:      { variant?: 'primary'|'secondary'|'danger'|'ghost'; type?: 'button'|'submit';
               disabled?: boolean; onClick?: () => void; 'aria-label'?: string; children: ReactNode }
Card:        { children: ReactNode; className?: string }
Chip:        { tone?: 'neutral'|'accent'|'success'|'warning'|'danger'; children: ReactNode }  // renders a <span>
Field:       { label: string; htmlFor?: string; hint?: string; children: ReactNode }          // renders <label htmlFor>
SearchInput: { value: string; onChange: (v: string) => void; placeholder?: string; 'aria-label'?: string }
Select:      { id?: string; value: string; onChange: (v: string) => void;
               options: { value: string; label: string }[]; disabled?: boolean; 'aria-label'?: string }
               // renders a native <select> (tests use fireEvent.change)
Slider:      { min: number; max: number; step?: number; value: number;
               onChange: (v: number) => void; 'aria-label'?: string }
               // renders an <input type="range"> carrying the aria-label
Toggle:      { checked: boolean; onChange: (c: boolean) => void; 'aria-label'?: string }
               // renders an <input type="checkbox"> carrying the aria-label
Modal:       { open: boolean; onClose: () => void; title: string; children: ReactNode }
               // renders children only when open, in a role="dialog"
```

**Phase D exports:**

```tsx
// client/src/api/queries.ts
useCapabilities(controllerId: string | null)   // useQuery keyed ['capabilities', controllerId], enabled when non-null
// client/src/api/client.ts
applyControlV2(targets: Target[], patch: ControlPatch): Promise<{ results: ApplyResult[] }>
// client/src/control/ColorWheel.tsx
ColorWheel: ({ color: string /* '#rrggbb' */, onChange: (hex: string) => void, size?: number }) => ReactElement
```

**AppShell v2 (Phase C):** renders each section behind `active === '<key>'`
checks in `client/src/components/AppShell.tsx` with section keys
`home | layout | devices | themes | schedule | firmware | settings`, and
derives the active section from the FIRST hash path segment
(`#/devices/c1/update` → section `devices`). The Firmware → Devices deep-link
contract this phase establishes: setting
`window.location.hash = '#/devices/<controllerId>/update'` navigates to the
Devices section; Phase F's detail view parses `<controllerId>` and the
`update` tab from the remaining segments.

---

## Task 1: Verify prerequisites; pin client API contracts and query hooks

**Files:**
- Modify: `client/src/api/client.ts` (append after line 267 — capability + v2 types/functions if Phase D has not added them; add `livePollIntervalSeconds` to `Settings` at lines 219–226)
- Create (only if missing): `client/src/api/queries.ts`
- Create (only if missing): `client/src/control/ColorWheel.tsx`
- Create (only if missing): `client/src/test/renderWithQuery.tsx`
- Test: `client/src/test/api/phaseHContracts.test.ts`

**Interfaces:**
- Consumes: master-plan binding contracts `Target`, `SegPatch`, `ControlPatch`, `ApplyResult`, `FxMeta`, `PalettePreview`, `ControllerCapabilities`; server routes `POST /api/control/apply` (Phase B) and `GET /api/controllers/:id/capabilities` (Phase A); `@tanstack/react-query` (Phase C dependency).
- Produces: `applyControlV2(targets, patch)`, `getCapabilities(controllerId)`, `Settings.livePollIntervalSeconds: number`, hooks `useControllers/useGroups/useThemes/useSchedules/useCalendarEvents/useSettings/useCapabilities/useFirmwareStatus`, test helper `renderWithQuery(ui: ReactElement)`, fallback `ColorWheel`.

**Steps:**

- [ ] Gate on prerequisite phases. Run:
  ```bash
  ls /Users/bwwilliams/github/uber-wled/client/src/components/ui/Button.tsx \
     /Users/bwwilliams/github/uber-wled/client/src/design/tokens.css
  grep -c '"@tanstack/react-query"' /Users/bwwilliams/github/uber-wled/client/package.json
  ```
  All three must exist/return ≥1. If any is missing, STOP — Phase C has not run; Phase H cannot start.
- [ ] Check what Phase D already shipped:
  ```bash
  grep -n "applyControlV2\|ControllerCapabilities\|getCapabilities" /Users/bwwilliams/github/uber-wled/client/src/api/client.ts
  ls /Users/bwwilliams/github/uber-wled/client/src/api/queries.ts /Users/bwwilliams/github/uber-wled/client/src/control/ColorWheel.tsx /Users/bwwilliams/github/uber-wled/client/src/test/renderWithQuery.tsx 2>&1
  ```
  Each of the following creation steps is SKIPPED for any symbol/file that already exists with the pinned signature; if one exists with a *different* signature, the master contract wins — fix the existing code to match and rerun its owning phase's tests.
- [ ] Write the failing contract test `client/src/test/api/phaseHContracts.test.ts`:
  ```tsx
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { applyControlV2, getCapabilities } from '../../api/client';

  afterEach(() => vi.unstubAllGlobals());

  describe('phase H api contracts', () => {
    it('applyControlV2 POSTs { targets, patch } to /api/control/apply', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
      vi.stubGlobal('fetch', fetchMock);
      await applyControlV2(
        [{ kind: 'group', groupId: 'g1' }],
        { on: true, bri: 128, seg: { fxId: 2, palId: 6, col: [[255, 0, 0]] } }
      );
      expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({ method: 'POST' }));
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        targets: [{ kind: 'group', groupId: 'g1' }],
        patch: { on: true, bri: 128, seg: { fxId: 2, palId: 6, col: [[255, 0, 0]] } }
      });
    });

    it('getCapabilities GETs /api/controllers/:id/capabilities', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ vid: 2605030, effects: [], palettes: [], fxMeta: [], palettePreviews: {}, fetchedAt: 'x' })
      });
      vi.stubGlobal('fetch', fetchMock);
      const caps = await getCapabilities('c1');
      expect(fetchMock).toHaveBeenCalledWith('/api/controllers/c1/capabilities');
      expect(caps.vid).toBe(2605030);
    });
  });
  ```
- [ ] Run it: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- phaseHContracts` — expect FAIL (`applyControlV2`/`getCapabilities` not exported) unless Phase D shipped them, in which case expect PASS and skip the next step.
- [ ] Append to `client/src/api/client.ts` (verbatim master contracts, client mirrors):
  ```ts
  // --- Capability cache (Phase A contract, mirrored from 00-master.md) ---
  export interface FxMeta {
    id: number;
    name: string;
    sliders: {
      sx: string | null;
      ix: string | null;
      c1: string | null;
      c2: string | null;
      c3: string | null;
    };
    options: {
      o1: string | null;
      o2: string | null;
      o3: string | null;
    };
    colorLabels: (string | null)[];
    usesPalette: boolean;
    flags: string[];
    defaults: Record<string, number>;
  }

  export type PalettePreview =
    | { type: 'stops'; stops: [number, number, number, number][] }
    | { type: 'random' }
    | { type: 'slots'; slots: ('c1' | 'c2' | 'c3')[] };

  export interface ControllerCapabilities {
    vid: number;
    effects: string[];
    palettes: string[];
    fxMeta: FxMeta[];
    palettePreviews: Record<number, PalettePreview>;
    fetchedAt: string;
  }

  export const getCapabilities = (controllerId: string) =>
    getJson<ControllerCapabilities>(`/api/controllers/${controllerId}/capabilities`);

  // --- Control fan-out v2 (Phase B contract, mirrored from 00-master.md) ---
  export type Target =
    | { kind: 'controller'; controllerId: string }
    | { kind: 'segment'; controllerId: string; wledSegId: number }
    | { kind: 'group'; groupId: string };

  export interface SegPatch {
    fxName?: string; fxId?: number;
    palName?: string; palId?: number;
    col?: number[][];
    sx?: number; ix?: number; c1?: number; c2?: number; c3?: number;
    o1?: boolean; o2?: boolean; o3?: boolean;
    cct?: number;
    on?: boolean; bri?: number;
  }

  export interface ControlPatch {
    on?: boolean;
    bri?: number;
    transition?: number;
    nl?: { on?: boolean; dur?: number; mode?: 0 | 1 | 2 | 3; tbri?: number };
    seg?: SegPatch;
  }

  export interface ApplyResult {
    controllerId: string;
    wledSegId: number | null;
    ok: boolean;
    error?: string;
  }

  export const applyControlV2 = (targets: Target[], patch: ControlPatch) =>
    sendJson<{ results: ApplyResult[] }>('/api/control/apply', 'POST', { targets, patch });
  ```
- [ ] In the `Settings` interface in `client/src/api/client.ts` (lines 219–226), add the Phase B field:
  ```ts
    livePollIntervalSeconds: number;
  ```
  (after `controllerStatusPollIntervalMinutes: number;`).
- [ ] Create `client/src/api/queries.ts` if missing (if it exists, append only the hooks it lacks, using these exact bodies):
  ```ts
  import { useQuery } from '@tanstack/react-query';
  import {
    listControllers, listGroups, listThemes, listSchedules, listCalendarEvents,
    getSettings, getCapabilities, getFirmwareStatus
  } from './client';

  export const useControllers = () =>
    useQuery({ queryKey: ['controllers'], queryFn: listControllers });

  export const useGroups = () =>
    useQuery({ queryKey: ['groups'], queryFn: listGroups });

  export const useThemes = () =>
    useQuery({ queryKey: ['themes'], queryFn: listThemes });

  export const useSchedules = () =>
    useQuery({ queryKey: ['schedules'], queryFn: listSchedules });

  export const useCalendarEvents = () =>
    useQuery({ queryKey: ['calendarEvents'], queryFn: listCalendarEvents });

  export const useSettings = () =>
    useQuery({ queryKey: ['settings'], queryFn: getSettings });

  export const useCapabilities = (controllerId: string | null) =>
    useQuery({
      queryKey: ['capabilities', controllerId],
      queryFn: () => getCapabilities(controllerId!),
      enabled: controllerId !== null
    });

  export const useFirmwareStatus = (controllerId: string) =>
    useQuery({ queryKey: ['firmware', controllerId], queryFn: () => getFirmwareStatus(controllerId) });
  ```
- [ ] Create `client/src/control/ColorWheel.tsx` ONLY if Phase D has not shipped it:
  ```tsx
  import { useEffect, useRef } from 'react';
  import iro from '@jaames/iro';

  export function ColorWheel({
    color,
    onChange,
    size = 200
  }: {
    color: string;
    onChange: (hex: string) => void;
    size?: number;
  }) {
    const mountRef = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pickerRef = useRef<any>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;
      const picker = iro.ColorPicker(mount, { width: size, color });
      picker.on('input:change', (c: { hexString: string }) => onChangeRef.current(c.hexString));
      pickerRef.current = picker;
      return () => {
        pickerRef.current = null;
        mount.innerHTML = '';
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size]);

    useEffect(() => {
      const picker = pickerRef.current;
      if (picker && picker.color.hexString.toLowerCase() !== color.toLowerCase()) {
        picker.color.hexString = color;
      }
    }, [color]);

    return <div ref={mountRef} className="color-wheel" data-testid="color-wheel" />;
  }
  ```
- [ ] Create `client/src/test/renderWithQuery.tsx` ONLY if missing:
  ```tsx
  import type { ReactElement } from 'react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { render } from '@testing-library/react';

  export function renderWithQuery(ui: ReactElement) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false }
      }
    });
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- phaseHContracts` — expect PASS (2 tests).
- [ ] Run the whole client suite to prove nothing regressed: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — expect PASS.
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add client/src && git commit -m "Phase H Task 1: pin client contracts for capabilities + control fan-out v2"
  ```

---

## Task 2: Color and palette-gradient helpers (`lib/color.ts`, `lib/paletteCss.ts`)

**Files:**
- Create: `client/src/lib/color.ts`
- Create: `client/src/lib/paletteCss.ts`
- Test: `client/src/test/lib/color.test.ts`, `client/src/test/lib/paletteCss.test.ts`

**Interfaces:**
- Consumes: `PalettePreview` from `client/src/api/client.ts` (Task 1).
- Produces: `hexToRgb(hex: string): [number, number, number]`, `rgbToHex(rgb: number[]): string`, `paletteGradientCss(preview: PalettePreview | undefined, slotColorsHex: string[]): string`.

**Steps:**

- [ ] Write failing test `client/src/test/lib/color.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { hexToRgb, rgbToHex } from '../../lib/color';

  describe('color helpers', () => {
    it('round-trips hex ↔ rgb', () => {
      expect(hexToRgb('#9b00d5')).toEqual([155, 0, 213]);
      expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
      expect(rgbToHex([155, 0, 213])).toBe('#9b00d5');
      expect(rgbToHex([0, 0, 0])).toBe('#000000');
    });

    it('rgbToHex clamps and tolerates short arrays', () => {
      expect(rgbToHex([300, -5])).toBe('#ff0000');
    });
  });
  ```
- [ ] Write failing test `client/src/test/lib/paletteCss.test.ts` (stop data is REAL `/json/palx` output captured from 192.168.1.86, WLED 16.0.0 vid 2605030):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { paletteGradientCss, RANDOM_BAR, EMPTY_BAR } from '../../lib/paletteCss';

  describe('paletteGradientCss', () => {
    it('renders palx gradient stops as a left-to-right linear-gradient (positions 0-255 → %)', () => {
      // Subset of the real "Default" palette (id 0) stops from /json/palx?page=0
      const css = paletteGradientCss(
        { type: 'stops', stops: [[0, 155, 0, 213], [128, 213, 155, 0], [240, 0, 50, 252]] },
        []
      );
      expect(css).toBe('linear-gradient(90deg, rgb(155,0,213) 0%, rgb(213,155,0) 50%, rgb(0,50,252) 94%)');
    });

    it('renders randomized palettes as the deterministic multi-hue bar', () => {
      expect(paletteGradientCss({ type: 'random' }, [])).toBe(RANDOM_BAR);
    });

    it('renders color-slot palettes from the provided slot colors (real "* Colors 1&2" shape)', () => {
      const css = paletteGradientCss(
        { type: 'slots', slots: ['c1', 'c1', 'c2', 'c2'] },
        ['#ff0000', '#00ff00', '#0000ff']
      );
      expect(css).toBe('linear-gradient(90deg, #ff0000 0%, #ff0000 33%, #00ff00 67%, #00ff00 100%)');
    });

    it('falls back to a flat bar for missing previews and single-slot palettes', () => {
      expect(paletteGradientCss(undefined, [])).toBe(EMPTY_BAR);
      expect(paletteGradientCss({ type: 'slots', slots: ['c1'] }, ['#abcdef'])).toBe(
        'linear-gradient(90deg, #abcdef 0%, #abcdef 100%)'
      );
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- test/lib/color test/lib/paletteCss` — expect FAIL (modules missing).
- [ ] Create `client/src/lib/color.ts`:
  ```ts
  export function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16)
    ];
  }

  export function rgbToHex(rgb: number[]): string {
    const [r = 0, g = 0, b = 0] = rgb;
    return (
      '#' +
      [r, g, b]
        .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
        .join('')
    );
  }
  ```
- [ ] Create `client/src/lib/paletteCss.ts`:
  ```ts
  import type { PalettePreview } from '../api/client';

  /** Deterministic multi-hue bar shown (with a badge) for randomized palettes. */
  export const RANDOM_BAR =
    'linear-gradient(90deg, #e5484d 0%, #f5a524 20%, #2ec27e 40%, #3584e4 60%, #9141ac 80%, #e5484d 100%)';
  /** Flat placeholder when no preview data is available. */
  export const EMPTY_BAR = 'linear-gradient(90deg, #3a4358 0%, #232b3d 100%)';

  const SLOT_INDEX = { c1: 0, c2: 1, c3: 2 } as const;

  export function paletteGradientCss(
    preview: PalettePreview | undefined,
    slotColorsHex: string[]
  ): string {
    if (!preview) return EMPTY_BAR;
    if (preview.type === 'random') return RANDOM_BAR;
    if (preview.type === 'slots') {
      const colors = preview.slots.map((s) => slotColorsHex[SLOT_INDEX[s]] ?? '#000000');
      if (colors.length === 1) {
        return `linear-gradient(90deg, ${colors[0]} 0%, ${colors[0]} 100%)`;
      }
      const stops = colors.map(
        (c, i) => `${c} ${Math.round((i / (colors.length - 1)) * 100)}%`
      );
      return `linear-gradient(90deg, ${stops.join(', ')})`;
    }
    const stops = preview.stops.map(
      ([pos, r, g, b]) => `rgb(${r},${g},${b}) ${Math.round((pos / 255) * 100)}%`
    );
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- test/lib/color test/lib/paletteCss` — expect PASS (6 tests).
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add client/src/lib client/src/test/lib && git commit -m "Phase H Task 2: color + palette gradient helpers"
  ```

---

## Task 3: Themes v2 pickers — `EffectPicker` and `PalettePicker`

**Files:**
- Create: `client/src/sections/themes/EffectPicker.tsx`
- Create: `client/src/sections/themes/PalettePicker.tsx`
- Create: `client/src/test/fixtures/capabilities.ts`
- Test: `client/src/test/ThemePickers.test.tsx`

**Interfaces:**
- Consumes: `SearchInput` kit component; `FxMeta`, `PalettePreview` types (Task 1); `paletteGradientCss` (Task 2).
- Produces:
  ```tsx
  EffectPicker:  { fxMeta: FxMeta[]; selectedId: number; onSelect: (id: number) => void }
  PalettePicker: { palettes: string[]; previews: Record<number, PalettePreview>;
                   slotColorsHex: string[]; selectedId: number; onSelect: (id: number) => void }
  CAPS fixture:  ControllerCapabilities (trimmed real device data) exported from test/fixtures/capabilities.ts
  ```
  CSS class contract (styled in Task 5's `themes.css`): `.picker`, `.picker-list`, `.picker-row`, `.picker-row.selected`, `.picker-row-name`, `.picker-row-tags`, `.picker-tag`, `.picker-tag-id`, `.palette-bar`, `.palette-random-badge`.

**Steps:**

- [ ] Create the shared fixture `client/src/test/fixtures/capabilities.ts` (trimmed REAL data captured from http://192.168.1.86 — effect/palette names from `/json/eff` + `/json/pal`, preview stops from `/json/palx?page=0`, vid from `/json/info`):
  ```ts
  import type { ControllerCapabilities, FxMeta } from '../../api/client';

  function fx(id: number, name: string, flags: string[] = ['1']): FxMeta {
    return {
      id,
      name,
      sliders: { sx: 'Effect speed', ix: 'Effect intensity', c1: null, c2: null, c3: null },
      options: { o1: null, o2: null, o3: null },
      colorLabels: ['Fx', 'Bg', 'Cs'],
      usesPalette: true,
      flags,
      defaults: {}
    };
  }

  /** Trimmed real capability data from 192.168.1.86 (WLED 16.0.0 "Niji", vid 2605030). */
  export const CAPS: ControllerCapabilities = {
    vid: 2605030,
    effects: ['Solid', 'Blink', 'Breathe', 'Wipe'],
    palettes: [
      'Default', '* Random Cycle', '* Color 1', '* Colors 1&2',
      '* Color Gradient', '* Colors Only', 'Party', 'Cloud'
    ],
    fxMeta: [fx(0, 'Solid', []), fx(1, 'Blink'), fx(2, 'Breathe'), fx(3, 'Wipe', ['1', 'v'])],
    palettePreviews: {
      0: { type: 'stops', stops: [[0, 155, 0, 213], [128, 213, 155, 0], [240, 0, 50, 252]] },
      1: { type: 'random' },
      2: { type: 'slots', slots: ['c1'] },
      3: { type: 'slots', slots: ['c1', 'c1', 'c2', 'c2'] },
      6: {
        type: 'stops',
        stops: [
          [0, 155, 0, 213], [64, 244, 85, 0], [128, 213, 155, 0],
          [192, 196, 0, 176], [240, 0, 50, 252]
        ]
      },
      7: { type: 'stops', stops: [[0, 0, 0, 255], [144, 0, 0, 139], [208, 255, 255, 255], [240, 135, 206, 235]] }
    },
    fetchedAt: '2026-07-04T00:00:00.000Z'
  };
  ```
- [ ] Write failing test `client/src/test/ThemePickers.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent, within } from '@testing-library/react';
  import { EffectPicker } from '../sections/themes/EffectPicker';
  import { PalettePicker } from '../sections/themes/PalettePicker';
  import { paletteGradientCss } from '../lib/paletteCss';
  import { CAPS } from './fixtures/capabilities';

  describe('EffectPicker', () => {
    it('filters by search and reports the picked effect id', () => {
      const onSelect = vi.fn();
      render(<EffectPicker fxMeta={CAPS.fxMeta} selectedId={0} onSelect={onSelect} />);
      fireEvent.change(screen.getByLabelText('Search effects'), { target: { value: 'bli' } });
      expect(screen.queryByRole('option', { name: /Breathe/ })).toBeNull();
      fireEvent.click(screen.getByRole('option', { name: /Blink/ }));
      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it('marks the selected row and shows the audio badge from fxdata flags', () => {
      render(<EffectPicker fxMeta={CAPS.fxMeta} selectedId={3} onSelect={() => {}} />);
      const wipe = screen.getByRole('option', { name: /Wipe/ });
      expect(wipe.getAttribute('aria-selected')).toBe('true');
      expect(within(wipe).getByText('♪')).toBeTruthy();
    });
  });

  describe('PalettePicker', () => {
    it('renders gradient previews from palx stops and a randomized badge', () => {
      const slots = ['#ff0000', '#00ff00', '#0000ff'];
      render(
        <PalettePicker
          palettes={CAPS.palettes}
          previews={CAPS.palettePreviews}
          slotColorsHex={slots}
          selectedId={0}
          onSelect={() => {}}
        />
      );
      const party = screen.getByTestId('palette-bar-6') as HTMLElement;
      expect(party.style.backgroundImage).toBe(paletteGradientCss(CAPS.palettePreviews[6], slots));
      expect(within(screen.getByTestId('palette-bar-1')).getByText('randomized')).toBeTruthy();
    });

    it('filters by search and reports the picked palette id', () => {
      const onSelect = vi.fn();
      render(
        <PalettePicker
          palettes={CAPS.palettes}
          previews={CAPS.palettePreviews}
          slotColorsHex={[]}
          selectedId={0}
          onSelect={onSelect}
        />
      );
      fireEvent.change(screen.getByLabelText('Search palettes'), { target: { value: 'party' } });
      fireEvent.click(screen.getByRole('option', { name: /Party/ }));
      expect(onSelect).toHaveBeenCalledWith(6);
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- ThemePickers` — expect FAIL (components missing).
- [ ] Create `client/src/sections/themes/EffectPicker.tsx`:
  ```tsx
  import { useMemo, useState } from 'react';
  import type { FxMeta } from '../../api/client';
  import { SearchInput } from '../../components/ui/SearchInput';

  export function EffectPicker({
    fxMeta,
    selectedId,
    onSelect
  }: {
    fxMeta: FxMeta[];
    selectedId: number;
    onSelect: (id: number) => void;
  }) {
    const [query, setQuery] = useState('');
    const visible = useMemo(() => {
      const q = query.trim().toLowerCase();
      return q === '' ? fxMeta : fxMeta.filter((f) => f.name.toLowerCase().includes(q));
    }, [fxMeta, query]);

    return (
      <div className="picker">
        <SearchInput value={query} onChange={setQuery} placeholder="Search effects" aria-label="Search effects" />
        <ul className="picker-list" role="listbox" aria-label="Effects">
          {visible.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                role="option"
                aria-selected={f.id === selectedId}
                className={`picker-row${f.id === selectedId ? ' selected' : ''}`}
                onClick={() => onSelect(f.id)}
              >
                <span className="picker-row-name">{f.name}</span>
                <span className="picker-row-tags">
                  {f.flags.includes('2') && <span className="picker-tag">2D</span>}
                  {(f.flags.includes('v') || f.flags.includes('f')) && <span className="picker-tag">♪</span>}
                  <span className="picker-tag picker-tag-id">#{f.id}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  ```
- [ ] Create `client/src/sections/themes/PalettePicker.tsx`:
  ```tsx
  import { useMemo, useState } from 'react';
  import type { PalettePreview } from '../../api/client';
  import { SearchInput } from '../../components/ui/SearchInput';
  import { paletteGradientCss } from '../../lib/paletteCss';

  export function PalettePicker({
    palettes,
    previews,
    slotColorsHex,
    selectedId,
    onSelect
  }: {
    palettes: string[];
    previews: Record<number, PalettePreview>;
    slotColorsHex: string[];
    selectedId: number;
    onSelect: (id: number) => void;
  }) {
    const [query, setQuery] = useState('');
    const entries = useMemo(() => palettes.map((name, id) => ({ id, name })), [palettes]);
    const visible = useMemo(() => {
      const q = query.trim().toLowerCase();
      return q === '' ? entries : entries.filter((p) => p.name.toLowerCase().includes(q));
    }, [entries, query]);

    return (
      <div className="picker">
        <SearchInput value={query} onChange={setQuery} placeholder="Search palettes" aria-label="Search palettes" />
        <ul className="picker-list" role="listbox" aria-label="Palettes">
          {visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={p.id === selectedId}
                className={`picker-row${p.id === selectedId ? ' selected' : ''}`}
                onClick={() => onSelect(p.id)}
              >
                <span className="picker-row-name">{p.name}</span>
                <span
                  className="palette-bar"
                  data-testid={`palette-bar-${p.id}`}
                  style={{ backgroundImage: paletteGradientCss(previews[p.id], slotColorsHex) }}
                >
                  {previews[p.id]?.type === 'random' && (
                    <span className="palette-random-badge">randomized</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  ```
  Note: the gradient is set via inline `style={{ backgroundImage }}` deliberately — inline style wins the cascade and is the only style assertion jsdom can make honestly (vitest-testing-gotchas rule 3).
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- ThemePickers` — expect PASS (4 tests).
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/themes client/src/test && git commit -m "Phase H Task 3: themes effect + palette pickers with gradient previews"
  ```

---

## Task 4: Themes v2 form — `ColorSlotButton` + `ThemeForm`

**Files:**
- Create: `client/src/sections/themes/ColorSlotButton.tsx`
- Create: `client/src/sections/themes/ThemeForm.tsx`
- Test: `client/src/test/ThemeForm.test.tsx`

**Interfaces:**
- Consumes: `ColorWheel` (`client/src/control/ColorWheel.tsx`, Phase D / Task 1 fallback); `EffectPicker`, `PalettePicker` (Task 3); `hexToRgb` (Task 2); kit `Button`, `Field`, `Slider`; `addTheme` + `CustomTheme` from `api/client.ts`; react-query `useMutation`/`useQueryClient` with cache key `['themes']`.
- Produces:
  ```tsx
  ColorSlotButton: { label: string; color: string; onChange: (hex: string) => void }
  ThemeForm:       { capabilities: ControllerCapabilities }
  ```
  POST `/api/themes` payload shape (unchanged data model): `{ name, effect: number, palette: number, brightness: number, colors: number[][] }` with `colors` always 3 × `[r,g,b]`.
  CSS class contract (Task 5): `.theme-form`, `.theme-form-pickers`, `.theme-form-colors`, `.color-slot`, `.color-slot-swatch`, `.color-slot-label`, `.color-pop`, `.color-pop-hex`.

**Steps:**

- [ ] Write failing test `client/src/test/ThemeForm.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { screen, fireEvent, waitFor } from '@testing-library/react';
  import { renderWithQuery } from './renderWithQuery';
  import { ThemeForm } from '../sections/themes/ThemeForm';
  import { CAPS } from './fixtures/capabilities';

  vi.mock('../control/ColorWheel', () => ({
    ColorWheel: ({ color, onChange }: { color: string; onChange: (hex: string) => void }) => (
      <input aria-label="color wheel" value={color} onChange={(e) => onChange(e.target.value)} />
    )
  }));

  afterEach(() => vi.unstubAllGlobals());

  describe('ThemeForm', () => {
    it('builds the POST /api/themes payload from picker, color-slot, and brightness state', async () => {
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/themes' && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ id: 't9', ...JSON.parse(init.body as string) })
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithQuery(<ThemeForm capabilities={CAPS} />);

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sunset' } });
      fireEvent.click(screen.getByRole('option', { name: /Blink/ }));   // effect id 1
      fireEvent.click(screen.getByRole('option', { name: /Party/ }));   // palette id 6
      fireEvent.click(screen.getByLabelText('Color 1: #ffffff'));       // open slot 1 popover
      fireEvent.change(screen.getByLabelText('Color 1 hex'), { target: { value: '#ff8800' } });
      fireEvent.change(screen.getByLabelText('Brightness'), { target: { value: '200' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add theme' }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('/api/themes', expect.objectContaining({ method: 'POST' }))
      );
      const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/themes' && i?.method === 'POST')!;
      expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
        name: 'Sunset',
        effect: 1,
        palette: 6,
        brightness: 200,
        colors: [[255, 136, 0], [0, 0, 0], [0, 0, 0]]
      });
    });

    it('disables submit until a name is entered', () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
      renderWithQuery(<ThemeForm capabilities={CAPS} />);
      expect((screen.getByRole('button', { name: 'Add theme' }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- ThemeForm` — expect FAIL (components missing).
- [ ] Create `client/src/sections/themes/ColorSlotButton.tsx`:
  ```tsx
  import { useEffect, useRef, useState } from 'react';
  import { ColorWheel } from '../../control/ColorWheel';

  export function ColorSlotButton({
    label,
    color,
    onChange
  }: {
    label: string;
    color: string;
    onChange: (hex: string) => void;
  }) {
    const [open, setOpen] = useState(false);
    const [hexDraft, setHexDraft] = useState(color);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => setHexDraft(color), [color]);

    useEffect(() => {
      if (!open) return;
      function onDocPointerDown(e: PointerEvent) {
        if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
      }
      function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
      }
      document.addEventListener('pointerdown', onDocPointerDown);
      document.addEventListener('keydown', onKeyDown);
      return () => {
        document.removeEventListener('pointerdown', onDocPointerDown);
        document.removeEventListener('keydown', onKeyDown);
      };
    }, [open]);

    return (
      <div className="color-slot" ref={wrapRef}>
        <button
          type="button"
          className="color-slot-swatch"
          aria-label={`${label}: ${color}`}
          aria-expanded={open}
          style={{ backgroundColor: color }}
          onClick={() => setOpen((o) => !o)}
        />
        <span className="color-slot-label">{label}</span>
        {open && (
          <div className="color-pop" role="dialog" aria-label={`Pick ${label}`}>
            <ColorWheel color={color} onChange={onChange} />
            <input
              className="input color-pop-hex"
              aria-label={`${label} hex`}
              value={hexDraft}
              onChange={(e) => {
                setHexDraft(e.target.value);
                if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value);
              }}
            />
          </div>
        )}
      </div>
    );
  }
  ```
- [ ] Create `client/src/sections/themes/ThemeForm.tsx`:
  ```tsx
  import { useState } from 'react';
  import { useMutation, useQueryClient } from '@tanstack/react-query';
  import { addTheme, type ControllerCapabilities, type CustomTheme } from '../../api/client';
  import { hexToRgb } from '../../lib/color';
  import { Button } from '../../components/ui/Button';
  import { Field } from '../../components/ui/Field';
  import { Slider } from '../../components/ui/Slider';
  import { EffectPicker } from './EffectPicker';
  import { PalettePicker } from './PalettePicker';
  import { ColorSlotButton } from './ColorSlotButton';

  const DEFAULT_COLORS: [string, string, string] = ['#ffffff', '#000000', '#000000'];

  export function ThemeForm({ capabilities }: { capabilities: ControllerCapabilities }) {
    const [name, setName] = useState('');
    const [effectId, setEffectId] = useState(0);
    const [paletteId, setPaletteId] = useState(0);
    const [colors, setColors] = useState<[string, string, string]>(DEFAULT_COLORS);
    const [brightness, setBrightness] = useState(128);
    const queryClient = useQueryClient();

    const createTheme = useMutation({
      mutationFn: addTheme,
      onSuccess: (created: CustomTheme) => {
        queryClient.setQueryData<CustomTheme[]>(['themes'], (prev) => [...(prev ?? []), created]);
        setName('');
        setEffectId(0);
        setPaletteId(0);
        setColors(DEFAULT_COLORS);
        setBrightness(128);
      }
    });

    function setSlot(index: number, hex: string) {
      setColors((prev) => {
        const next = [...prev] as [string, string, string];
        next[index] = hex;
        return next;
      });
    }

    return (
      <div className="theme-form">
        <Field label="Name" htmlFor="theme-name">
          <input
            id="theme-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New theme name"
          />
        </Field>
        <div className="theme-form-pickers">
          <Field label="Effect">
            <EffectPicker fxMeta={capabilities.fxMeta} selectedId={effectId} onSelect={setEffectId} />
          </Field>
          <Field label="Palette">
            <PalettePicker
              palettes={capabilities.palettes}
              previews={capabilities.palettePreviews}
              slotColorsHex={colors}
              selectedId={paletteId}
              onSelect={setPaletteId}
            />
          </Field>
        </div>
        <div className="theme-form-colors" role="group" aria-label="Colors">
          <ColorSlotButton label="Color 1" color={colors[0]} onChange={(hex) => setSlot(0, hex)} />
          <ColorSlotButton label="Color 2" color={colors[1]} onChange={(hex) => setSlot(1, hex)} />
          <ColorSlotButton label="Color 3" color={colors[2]} onChange={(hex) => setSlot(2, hex)} />
        </div>
        <Field label={`Brightness (${brightness})`}>
          <Slider min={1} max={255} value={brightness} onChange={setBrightness} aria-label="Brightness" />
        </Field>
        {createTheme.isError && (
          <div className="error-banner" role="alert">Failed to save theme.</div>
        )}
        <Button
          variant="primary"
          disabled={name === '' || createTheme.isPending}
          onClick={() =>
            createTheme.mutate({
              name,
              effect: effectId,
              palette: paletteId,
              brightness,
              colors: colors.map(hexToRgb)
            })
          }
        >
          {createTheme.isPending ? 'Adding…' : 'Add theme'}
        </Button>
      </div>
    );
  }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- ThemeForm` — expect PASS (2 tests).
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/themes client/src/test/ThemeForm.test.tsx && git commit -m "Phase H Task 4: theme form with color-slot popovers and payload assembly"
  ```

---

## Task 5: `ThemesSection` — source controller select, list previews, AppShell swap, delete `ThemeManager`

**Files:**
- Create: `client/src/sections/themes/ThemesSection.tsx`
- Create: `client/src/sections/themes/themes.css`
- Modify: `client/src/components/AppShell.tsx` (themes import + render line)
- Delete: `client/src/components/ThemeManager.tsx`, `client/src/test/ThemeManager.test.tsx`
- Modify: `client/src/api/client.ts` (remove `EffectsPalettes` + `getEffectsPalettes`, lines 128–135, if unused)
- Test: `client/src/test/ThemesSection.test.tsx`

**Interfaces:**
- Consumes: `useControllers`, `useThemes`, `useCapabilities` (Task 1); `ThemeForm` (Task 4); `paletteGradientCss`, `rgbToHex` (Task 2); kit `Card`, `Button`, `Select`; `deleteTheme` from `api/client.ts`.
- Produces: `ThemesSection: () => ReactElement` (no props) — the component AppShell renders for section key `themes`. CSS classes: `.themes-section`, `.theme-list`, `.theme-row`, `.theme-row-info`, `.theme-row-name`, `.theme-row-meta`, `.theme-row-preview`, `.theme-row-swatches`, `.theme-row-swatch`, `.theme-form-source` plus the Task 3/4 picker/form classes.

**Steps:**

- [ ] Write failing test `client/src/test/ThemesSection.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { screen, fireEvent, waitFor, within } from '@testing-library/react';
  import { renderWithQuery } from './renderWithQuery';
  import { ThemesSection } from '../sections/themes/ThemesSection';
  import { CAPS } from './fixtures/capabilities';

  vi.mock('../control/ColorWheel', () => ({
    ColorWheel: ({ color, onChange }: { color: string; onChange: (hex: string) => void }) => (
      <input aria-label="color wheel" value={color} onChange={(e) => onChange(e.target.value)} />
    )
  }));

  afterEach(() => vi.unstubAllGlobals());

  const CONTROLLERS = [
    { id: 'c0', name: 'Attic', host: '10.0.0.40', source: 'manual', stale: true, pinnedAssetPattern: null },
    { id: 'c1', name: 'Cabinet Lights', host: '192.168.1.86', source: 'discovered', stale: false, pinnedAssetPattern: null }
  ];
  const THEMES = [
    { id: 't1', name: 'Sunset Party', effect: 1, palette: 6, colors: [[255, 136, 0], [0, 0, 0], [0, 0, 0]], brightness: 200 }
  ];

  function stubFetch() {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/controllers' && method === 'GET') {
        return Promise.resolve({ ok: true, json: async () => CONTROLLERS });
      }
      if (url === '/api/themes' && method === 'GET') {
        return Promise.resolve({ ok: true, json: async () => THEMES });
      }
      if (url === '/api/controllers/c1/capabilities') {
        return Promise.resolve({ ok: true, json: async () => CAPS });
      }
      if (url === '/api/controllers/c0/capabilities') {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'unreachable' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('ThemesSection', () => {
    it('defaults the source controller to the first reachable one and previews each theme row', async () => {
      stubFetch();
      renderWithQuery(<ThemesSection />);
      await waitFor(() =>
        expect((screen.getByLabelText('Source controller') as HTMLSelectElement).value).toBe('c1')
      );
      const row = (await screen.findByText('Sunset Party')).closest('li')!;
      // effect name resolved through the capability cache, not shown as a raw id
      expect(within(row as HTMLElement).getByText('Blink')).toBeTruthy();
      const bar = screen.getByTestId('theme-preview-t1') as HTMLElement;
      expect(bar.style.backgroundImage).not.toBe('');
      // three color swatches rendered from the stored theme colors
      expect((row as HTMLElement).querySelectorAll('.theme-row-swatch')).toHaveLength(3);
    });

    it('deletes a theme via DELETE /api/themes/:id', async () => {
      const fetchMock = stubFetch();
      renderWithQuery(<ThemesSection />);
      fireEvent.click(await screen.findByLabelText('Remove Sunset Party'));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('/api/themes/t1', expect.objectContaining({ method: 'DELETE' }))
      );
      await waitFor(() => expect(screen.queryByText('Sunset Party')).toBeNull());
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- ThemesSection` — expect FAIL (component missing).
- [ ] Create `client/src/sections/themes/ThemesSection.tsx`:
  ```tsx
  import { useMemo, useState } from 'react';
  import { useMutation, useQueryClient } from '@tanstack/react-query';
  import { deleteTheme, type ControllerCapabilities, type CustomTheme } from '../../api/client';
  import { useCapabilities, useControllers, useThemes } from '../../api/queries';
  import { Button } from '../../components/ui/Button';
  import { Card } from '../../components/ui/Card';
  import { Select } from '../../components/ui/Select';
  import { paletteGradientCss } from '../../lib/paletteCss';
  import { rgbToHex } from '../../lib/color';
  import { ThemeForm } from './ThemeForm';
  import './themes.css';

  function ThemeRow({
    theme,
    capabilities,
    onDelete
  }: {
    theme: CustomTheme;
    capabilities: ControllerCapabilities | undefined;
    onDelete: (id: string) => void;
  }) {
    const effectName = capabilities?.effects[theme.effect] ?? `Effect #${theme.effect}`;
    const slotHexes = theme.colors.map(rgbToHex);
    const gradient = paletteGradientCss(capabilities?.palettePreviews[theme.palette], slotHexes);
    return (
      <li className="theme-row">
        <div className="theme-row-info">
          <span className="theme-row-name">{theme.name}</span>
          <span className="theme-row-meta">{effectName}</span>
        </div>
        <div className="theme-row-preview">
          <span
            className="palette-bar"
            data-testid={`theme-preview-${theme.id}`}
            style={{ backgroundImage: gradient }}
          />
          <span className="theme-row-swatches">
            {slotHexes.map((hex, i) => (
              <span key={i} className="theme-row-swatch" style={{ backgroundColor: hex }} />
            ))}
          </span>
        </div>
        <Button variant="danger" aria-label={`Remove ${theme.name}`} onClick={() => onDelete(theme.id)}>
          Remove
        </Button>
      </li>
    );
  }

  export function ThemesSection() {
    const controllers = useControllers();
    const themes = useThemes();
    const [sourceId, setSourceId] = useState<string | null>(null);
    const defaultSource = useMemo(() => {
      const list = controllers.data ?? [];
      return (list.find((c) => !c.stale) ?? list[0])?.id ?? null;
    }, [controllers.data]);
    const effectiveSource = sourceId ?? defaultSource;
    const capabilities = useCapabilities(effectiveSource);
    const queryClient = useQueryClient();

    const removeTheme = useMutation({
      mutationFn: deleteTheme,
      onSuccess: (_res, id) => {
        queryClient.setQueryData<CustomTheme[]>(['themes'], (prev) =>
          (prev ?? []).filter((t) => t.id !== id)
        );
      }
    });

    return (
      <section className="section themes-section">
        <h2>Themes</h2>
        <Card className="themes-list-card">
          {themes.data && themes.data.length === 0 && (
            <p className="empty-state">No custom themes yet.</p>
          )}
          {themes.data && themes.data.length > 0 && (
            <ul className="theme-list">
              {themes.data.map((t) => (
                <ThemeRow
                  key={t.id}
                  theme={t}
                  capabilities={capabilities.data}
                  onDelete={(id) => removeTheme.mutate(id)}
                />
              ))}
            </ul>
          )}
        </Card>
        <Card className="theme-form-card">
          <div className="theme-form-source">
            <label htmlFor="theme-source">Source controller</label>
            <Select
              id="theme-source"
              aria-label="Source controller"
              value={effectiveSource ?? ''}
              onChange={(v) => setSourceId(v)}
              options={(controllers.data ?? []).map((c) => ({
                value: c.id,
                label: c.stale ? `${c.name} (offline)` : c.name
              }))}
            />
            <span className="field-hint">Effect and palette options are read from this controller</span>
          </div>
          {effectiveSource === null && controllers.data && (
            <p className="empty-state">Add a controller to create themes.</p>
          )}
          {effectiveSource !== null && capabilities.isPending && (
            <p className="empty-state">Loading effects and palettes…</p>
          )}
          {capabilities.isError && (
            <p className="empty-state" role="alert">
              Could not load capabilities for this controller — pick another source.
            </p>
          )}
          {capabilities.data && <ThemeForm capabilities={capabilities.data} />}
        </Card>
      </section>
    );
  }
  ```
- [ ] Create `client/src/sections/themes/themes.css`:
  ```css
  /* Themes section — Phase H. All colors/radii come from design/tokens.css. */
  .themes-section { display: flex; flex-direction: column; gap: 16px; }

  .theme-list { list-style: none; margin: 0; padding: 0; }
  .theme-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--border); }
  .theme-row:last-child { border-bottom: none; }
  .theme-row-info { display: flex; flex-direction: column; min-width: 140px; }
  .theme-row-name { color: var(--text); font-weight: 600; }
  .theme-row-meta { color: var(--text-muted); font-size: 0.85rem; }
  .theme-row-preview { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
  .theme-row-swatches { display: flex; gap: 4px; }
  .theme-row-swatch { width: 18px; height: 18px; border-radius: 6px; border: 1px solid var(--border); }

  .palette-bar { display: inline-block; flex: 1; min-width: 60px; height: 14px; border-radius: 7px; border: 1px solid var(--border); position: relative; overflow: hidden; }
  .palette-random-badge { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; letter-spacing: 0.06em; text-transform: uppercase; color: #fff; background: rgba(0, 0, 0, 0.35); }

  .theme-form { display: flex; flex-direction: column; gap: 14px; }
  .theme-form-source { display: flex; flex-direction: column; gap: 6px; max-width: 320px; margin-bottom: 14px; }
  .theme-form-pickers { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 700px) { .theme-form-pickers { grid-template-columns: 1fr; } }

  .picker { display: flex; flex-direction: column; gap: 8px; }
  .picker-list { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); }
  .picker-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 40px; padding: 8px 12px; background: none; border: none; color: var(--text); cursor: pointer; text-align: left; font: inherit; }
  .picker-row:hover { background: var(--surface-2); }
  .picker-row.selected { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
  .picker-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picker-row .palette-bar { flex: 0 0 96px; }
  .picker-row-tags { display: flex; gap: 4px; }
  .picker-tag { font-size: 0.65rem; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-muted); }

  .theme-form-colors { display: flex; gap: 18px; }
  .color-slot { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .color-slot-swatch { width: 44px; height: 44px; border-radius: 12px; border: 1px solid var(--border); cursor: pointer; }
  .color-slot-label { font-size: 0.75rem; color: var(--text-muted); }
  .color-pop { position: absolute; top: 52px; left: 0; z-index: 30; display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-card); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); }
  .color-pop-hex { width: 110px; }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- ThemesSection` — expect PASS (2 tests).
- [ ] Swap AppShell to the new section. In `client/src/components/AppShell.tsx`: replace the import of the component currently rendered for the `themes` key (in pre-Phase-C code that is `import { ThemeManager } from './ThemeManager';` at line 6) with
  `import { ThemesSection } from '../sections/themes/ThemesSection';`
  and replace the render line (`{active === 'themes' && <ThemeManager />}` at line 75 pre-Phase-C) with
  `{active === 'themes' && <ThemesSection />}`.
- [ ] If `client/src/test/AppShell.test.tsx` mocks or asserts on `ThemeManager`, update that reference to `ThemesSection` at path `../sections/themes/ThemesSection` (same assertion, new name).
- [ ] Delete the old component and test, and prune the now-dead API helper:
  ```bash
  cd /Users/bwwilliams/github/uber-wled
  git rm client/src/components/ThemeManager.tsx client/src/test/ThemeManager.test.tsx
  grep -rn "getEffectsPalettes\|EffectsPalettes" client/src --include='*.ts*'
  ```
  If the grep shows no consumers outside `client/src/api/client.ts` itself, delete the `EffectsPalettes` interface and `getEffectsPalettes` export (lines 128–135 of `client/src/api/client.ts`). The server route `/api/themes/effects-palettes` stays until Phase I.
- [ ] Run the full client suite and build: `cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add -A client/src && git commit -m "Phase H Task 5: ThemesSection v2 with capability-cache pickers; delete ThemeManager"
  ```

---

## Task 6: Schedule — restyled `CalendarGrid` + `schedule.css`

**Files:**
- Create: `client/src/sections/schedule/CalendarGrid.tsx`
- Create: `client/src/sections/schedule/schedule.css`
- Test: rewrite `client/src/test/CalendarGrid.test.tsx` (points at the new path)

**Interfaces:**
- Consumes: `CalendarEvent` type + `resolveDate` from `client/src/lib/dateRules.ts` (unchanged); kit `Button`.
- Produces (identical to the old component so `ScheduleSection` v2 is a drop-in):
  ```tsx
  eventsForDay(events: CalendarEvent[], year: number, month: number, day: number): CalendarEvent[]
  CalendarGrid: {
    events: CalendarEvent[]; year: number; month: number; selectedDay: number | null;
    onSelectDay: (day: number) => void; onPrev: () => void; onNext: () => void; onToday: () => void;
  }
  ```
  Test ids preserved: `calendar-grid`, `day-<n>`. CSS classes: `.calendar`, `.calendar-header`, `.calendar-title`, `.calendar-header-actions`, `.calendar-weekdays`, `.calendar-weekday`, `.calendar-grid`, `.calendar-cell` (+ `.empty`, `.selected`), `.calendar-day-num`, `.calendar-chips`, `.event-chip` (+ `.enabled`, `.disabled`, `.holiday`, `.custom`).

**Steps:**

- [ ] Rewrite `client/src/test/CalendarGrid.test.tsx` to target the new path (failing first):
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent, within } from '@testing-library/react';
  import { CalendarGrid, eventsForDay } from '../sections/schedule/CalendarGrid';
  import type { CalendarEvent } from '../api/client';

  const halloween: CalendarEvent = {
    id: 'e1', name: 'Halloween', category: 'holiday',
    dateRule: { kind: 'fixed', month: 10, day: 31 }, recursYearly: true, enabled: true,
    groupId: 'g1', triggerTime: { type: 'fixed', time: '18:00' },
    actionType: 'theme', actionPayload: { themeId: 't1' }
  };

  describe('CalendarGrid v2', () => {
    it('renders day cells with event chips and reports day selection', () => {
      const onSelectDay = vi.fn();
      render(
        <CalendarGrid
          events={[halloween]} year={2026} month={10} selectedDay={null}
          onSelectDay={onSelectDay} onPrev={() => {}} onNext={() => {}} onToday={() => {}}
        />
      );
      expect(screen.getByTestId('calendar-grid')).toBeTruthy();
      expect(within(screen.getByTestId('day-31')).getByText('Halloween')).toBeTruthy();
      fireEvent.click(screen.getByTestId('day-14'));
      expect(onSelectDay).toHaveBeenCalledWith(14);
    });

    it('wires prev/next/today buttons', () => {
      const onPrev = vi.fn(); const onNext = vi.fn(); const onToday = vi.fn();
      render(
        <CalendarGrid
          events={[]} year={2026} month={10} selectedDay={null}
          onSelectDay={() => {}} onPrev={onPrev} onNext={onNext} onToday={onToday}
        />
      );
      fireEvent.click(screen.getByLabelText('previous month'));
      fireEvent.click(screen.getByLabelText('next month'));
      fireEvent.click(screen.getByText('Today'));
      expect(onPrev).toHaveBeenCalled();
      expect(onNext).toHaveBeenCalled();
      expect(onToday).toHaveBeenCalled();
    });

    it('eventsForDay resolves fixed date rules', () => {
      expect(eventsForDay([halloween], 2026, 10, 31)).toHaveLength(1);
      expect(eventsForDay([halloween], 2026, 10, 30)).toHaveLength(0);
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- CalendarGrid` — expect FAIL (new module missing).
- [ ] Create `client/src/sections/schedule/CalendarGrid.tsx`:
  ```tsx
  import type { CalendarEvent } from '../../api/client';
  import { resolveDate } from '../../lib/dateRules';
  import { Button } from '../../components/ui/Button';

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  export function eventsForDay(
    events: CalendarEvent[], year: number, month: number, day: number
  ): CalendarEvent[] {
    return events.filter((e) => {
      const d = resolveDate(e.dateRule, year);
      return !!d && d.month === month && d.day === day;
    });
  }

  export function CalendarGrid({
    events, year, month, selectedDay, onSelectDay, onPrev, onNext, onToday
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
          <Button variant="ghost" aria-label="previous month" onClick={onPrev}>‹</Button>
          <h3 className="calendar-title">{MONTHS[month - 1]} {year}</h3>
          <div className="calendar-header-actions">
            <Button variant="secondary" onClick={onToday}>Today</Button>
            <Button variant="ghost" aria-label="next month" onClick={onNext}>›</Button>
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
- [ ] Create `client/src/sections/schedule/schedule.css`:
  ```css
  /* Schedule section — Phase H. All colors/radii come from design/tokens.css. */
  .schedule-section { display: flex; flex-direction: column; gap: 16px; }
  .schedule-body { display: grid; grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 900px) { .schedule-body { grid-template-columns: 1fr; } }

  .calendar { display: flex; flex-direction: column; gap: 10px; }
  .calendar-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .calendar-title { margin: 0; font-size: 1.05rem; color: var(--text); }
  .calendar-header-actions { display: flex; gap: 6px; }
  .calendar-weekdays, .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .calendar-weekday { text-align: center; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 4px 0; }
  .calendar-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 56px; padding: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-control); color: var(--text); cursor: pointer; font: inherit; text-align: left; }
  .calendar-cell:hover { background: var(--surface-2); }
  .calendar-cell.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .calendar-cell.empty { background: none; border: none; cursor: default; }
  .calendar-day-num { font-size: 0.8rem; color: var(--text-muted); }
  .calendar-cell.selected .calendar-day-num { color: var(--accent); font-weight: 700; }
  .calendar-chips { display: flex; flex-direction: column; gap: 2px; width: 100%; overflow: hidden; }
  .event-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.65rem; padding: 1px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--text); }
  .event-chip.holiday { background: var(--accent-soft); }
  .event-chip.custom { background: rgba(34, 197, 94, 0.16); }
  .event-chip.disabled { opacity: 0.45; }

  .schedule-detail { display: flex; flex-direction: column; gap: 10px; }
  .schedule-detail-event { display: flex; flex-direction: column; gap: 6px; padding: 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-control); }
  .schedule-detail-event-head { display: flex; align-items: center; gap: 8px; }
  .schedule-detail-event-name { font-weight: 600; color: var(--text); flex: 1; }
  .schedule-detail-meta { color: var(--text-muted); font-size: 0.85rem; }

  .schedules-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .schedules-card-header h3 { margin: 0; }
  .schedule-list { list-style: none; margin: 0; padding: 0; }
  .schedule-list-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--border); }
  .schedule-list-row:last-child { border-bottom: none; }
  .schedule-list-info { display: flex; align-items: center; gap: 8px; }
  .schedule-list-name { font-weight: 600; color: var(--text); }

  .schedule-form, .calendar-event-form { display: flex; flex-direction: column; gap: 12px; min-width: min(420px, 86vw); }
  .form-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .schedule-form-actions { display: flex; gap: 8px; }
  .day-toggle-group { display: flex; gap: 4px; flex-wrap: wrap; }
  .day-toggle { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 40px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-control); color: var(--text-muted); cursor: pointer; user-select: none; }
  .day-toggle input { position: absolute; opacity: 0; pointer-events: none; }
  .day-toggle.active { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
  .field-label { font-size: 0.8rem; color: var(--text-muted); }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- CalendarGrid` — expect PASS (3 tests). (The old `components/CalendarGrid.tsx` still exists and is still imported by the old `ScheduleSection`; both are deleted in Task 9.)
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/schedule client/src/test/CalendarGrid.test.tsx && git commit -m "Phase H Task 6: restyled CalendarGrid on the UI kit"
  ```

---

## Task 7: Schedule — restyled `CalendarEventForm` + `WeeklyScheduleForm`

**Files:**
- Create: `client/src/sections/schedule/CalendarEventForm.tsx`
- Create: `client/src/sections/schedule/WeeklyScheduleForm.tsx`
- Test: rewrite `client/src/test/CalendarEventForm.test.tsx` and `client/src/test/WeeklyScheduleForm.test.tsx`

**Interfaces:**
- Consumes: kit `Button`, `Field`, `Select`; `addCalendarEvent`, `ConflictError`, `Group`, `CustomTheme`, `CalendarEvent` from `api/client.ts`.
- Produces (props identical to the old components; both are rendered inside a kit `Modal` by their parents):
  ```tsx
  CalendarEventForm: { groups: Group[]; themes: CustomTheme[]; onCreated: (event: CalendarEvent) => void }
  WeeklyScheduleDraft: { name: string; daysOfWeek: number[]; timeOfDay: string; groupId: string;
                         actionType: 'power' | 'brightness' | 'preset' | 'theme'; actionPayload: unknown }
  WeeklyScheduleForm: { groups: Group[]; themes: CustomTheme[]; onPreview: (draft: WeeklyScheduleDraft) => void;
                        onApprove: () => void; onDiscard: () => void; previewing: boolean }
  ```

**Steps:**

- [ ] Rewrite `client/src/test/CalendarEventForm.test.tsx` (failing first — new import path):
  ```tsx
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { render, screen, fireEvent, waitFor } from '@testing-library/react';
  import { CalendarEventForm } from '../sections/schedule/CalendarEventForm';

  afterEach(() => vi.unstubAllGlobals());

  const groups = [{ id: 'g1', name: 'Front', members: [] }];
  const themes = [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0, 0, 0]], brightness: 128 }];

  describe('CalendarEventForm v2', () => {
    it('POSTs a fixed-date custom event and reports it to the parent', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'e9', name: 'Bday' })
      });
      vi.stubGlobal('fetch', fetchMock);
      const onCreated = vi.fn();
      render(<CalendarEventForm groups={groups} themes={themes} onCreated={onCreated} />);

      fireEvent.change(screen.getByLabelText('event name'), { target: { value: 'Bday' } });
      fireEvent.change(screen.getByLabelText('month'), { target: { value: '3' } });
      fireEvent.change(screen.getByLabelText('day'), { target: { value: '14' } });
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() => expect(onCreated).toHaveBeenCalled());
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.dateRule).toEqual({ kind: 'fixed', month: 3, day: 14 });
      expect(body.actionPayload).toEqual({ themeId: 't1' });
      expect(body.groupId).toBe('g1');
    });

    it('surfaces a 409 conflict as an inline error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'conflict', conflict: { id: 'x', name: 'Halloween', month: 10, day: 31 } })
      }));
      render(<CalendarEventForm groups={groups} themes={themes} onCreated={() => {}} />);
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Halloween/));
    });
  });
  ```
- [ ] Rewrite `client/src/test/WeeklyScheduleForm.test.tsx` (failing first):
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { WeeklyScheduleForm } from '../sections/schedule/WeeklyScheduleForm';

  const groups = [{ id: 'g1', name: 'Front', members: [] }];
  const themes = [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0, 0, 0]], brightness: 128 }];

  describe('WeeklyScheduleForm v2', () => {
    it('builds a draft from the selected days/time/group/theme on Preview', () => {
      const onPreview = vi.fn();
      render(
        <WeeklyScheduleForm
          groups={groups} themes={themes}
          onPreview={onPreview} onApprove={() => {}} onDiscard={() => {}} previewing={false}
        />
      );
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Evenings' } });
      fireEvent.click(screen.getByLabelText('Mon'));
      fireEvent.click(screen.getByLabelText('Fri'));
      fireEvent.change(screen.getByLabelText('time of day'), { target: { value: '20:30' } });
      fireEvent.click(screen.getByText('Preview'));
      expect(onPreview).toHaveBeenCalledWith({
        name: 'Evenings', daysOfWeek: [1, 5], timeOfDay: '20:30', groupId: 'g1',
        actionType: 'theme', actionPayload: { themeId: 't1' }
      });
    });

    it('swaps Preview for Approve/Discard while previewing', () => {
      const onApprove = vi.fn();
      render(
        <WeeklyScheduleForm
          groups={groups} themes={themes}
          onPreview={() => {}} onApprove={onApprove} onDiscard={() => {}} previewing={true}
        />
      );
      expect(screen.queryByText('Preview')).toBeNull();
      fireEvent.click(screen.getByText('Approve'));
      expect(onApprove).toHaveBeenCalled();
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- CalendarEventForm WeeklyScheduleForm` — expect FAIL (new modules missing).
- [ ] Create `client/src/sections/schedule/CalendarEventForm.tsx`:
  ```tsx
  import { useState } from 'react';
  import {
    addCalendarEvent, ConflictError,
    type CalendarEvent, type CustomTheme, type Group
  } from '../../api/client';
  import { Button } from '../../components/ui/Button';
  import { Field } from '../../components/ui/Field';
  import { Select } from '../../components/ui/Select';

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
          setError(
            `Conflicts with "${err.conflict.name}" on ${err.conflict.month}/${err.conflict.day}. Disable it first to save this event.`
          );
        } else {
          setError('Failed to save calendar event.');
        }
      }
    }

    return (
      <div className="calendar-event-form">
        <Field label="Event name" htmlFor="calendar-event-name">
          <input
            id="calendar-event-name" aria-label="event name" className="input"
            value={name} onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="form-row">
          <Field label="Month" htmlFor="calendar-event-month">
            <input
              id="calendar-event-month" aria-label="month" className="input" type="number"
              min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))}
            />
          </Field>
          <Field label="Day" htmlFor="calendar-event-day">
            <input
              id="calendar-event-day" aria-label="day" className="input" type="number"
              min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))}
            />
          </Field>
          <Field label="Time" htmlFor="calendar-event-time">
            <input
              id="calendar-event-time" aria-label="event time" className="input" type="time"
              value={time} onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Group" htmlFor="calendar-event-group">
          <Select
            id="calendar-event-group" aria-label="event group" value={groupId} onChange={setGroupId}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        </Field>
        <Field label="Theme" htmlFor="calendar-event-theme">
          <Select
            id="calendar-event-theme" aria-label="event theme" value={themeId} onChange={setThemeId}
            options={themes.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Field>
        <Button variant="primary" onClick={handleSave}>Save</Button>
        {error && <div className="error-banner" role="alert">{error}</div>}
      </div>
    );
  }
  ```
- [ ] Create `client/src/sections/schedule/WeeklyScheduleForm.tsx`:
  ```tsx
  import { useState } from 'react';
  import type { CustomTheme, Group } from '../../api/client';
  import { Button } from '../../components/ui/Button';
  import { Field } from '../../components/ui/Field';
  import { Select } from '../../components/ui/Select';

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
        if (next.has(day)) next.delete(day);
        else next.add(day);
        return next;
      });
    }

    return (
      <div className="schedule-form">
        <Field label="Name" htmlFor="weekly-schedule-name">
          <input
            id="weekly-schedule-name" className="input" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="Schedule name"
          />
        </Field>
        <div className="field">
          <span id="weekly-schedule-days-label" className="field-label">Days</span>
          <div className="day-toggle-group" role="group" aria-labelledby="weekly-schedule-days-label">
            {DAY_LABELS.map((label, day) => (
              <label key={day} className={`day-toggle${days.has(day) ? ' active' : ''}`}>
                <input
                  type="checkbox" aria-label={label} checked={days.has(day)}
                  onChange={() => toggleDay(day)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <Field label="Time of day" htmlFor="weekly-schedule-time">
          <input
            id="weekly-schedule-time" aria-label="time of day" className="input" type="time"
            value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)}
          />
        </Field>
        <Field label="Group" htmlFor="weekly-schedule-group">
          <Select
            id="weekly-schedule-group" aria-label="group" value={groupId} onChange={setGroupId}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        </Field>
        <Field label="Theme" htmlFor="weekly-schedule-theme">
          <Select
            id="weekly-schedule-theme" aria-label="theme" value={themeId} onChange={setThemeId}
            options={themes.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Field>
        <div className="schedule-form-actions">
          {!previewing && (
            <Button
              variant="primary"
              onClick={() =>
                onPreview({
                  name,
                  daysOfWeek: Array.from(days).sort((a, b) => a - b),
                  timeOfDay,
                  groupId,
                  actionType: 'theme',
                  actionPayload: { themeId }
                })
              }
            >
              Preview
            </Button>
          )}
          {previewing && (
            <>
              <Button variant="primary" onClick={onApprove}>Approve</Button>
              <Button variant="secondary" onClick={onDiscard}>Discard</Button>
            </>
          )}
        </div>
      </div>
    );
  }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- CalendarEventForm WeeklyScheduleForm` — expect PASS (4 tests).
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/schedule client/src/test && git commit -m "Phase H Task 7: restyled calendar event + weekly schedule forms"
  ```

---

## Task 8: `ScheduleManager` v2 — theme preview through fan-out v2

**Files:**
- Create: `client/src/sections/schedule/ScheduleManager.tsx`
- Test: `client/src/test/ScheduleManager.test.tsx` (new file)

**Interfaces:**
- Consumes: `applyControlV2`, `getSegmentsSnapshot`, `addSchedule`, `deleteSchedule` from `api/client.ts`; `useSchedules`, `useGroups`, `useThemes` (Task 1); `WeeklyScheduleForm` + `WeeklyScheduleDraft` (Task 7); kit `Card`, `Button`, `Chip`, `Modal`.
- Produces: `ScheduleManager: () => ReactElement` (no props). v2 wire contract exercised:
  - Preview: `POST /api/control/apply` body `{ targets: [{ kind: 'group', groupId }], patch: { on: true, bri: theme.brightness, seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors } } }`.
  - Revert: one call per snapshotted member, body `{ targets: [{ kind: 'segment', controllerId, wledSegId }], patch: { seg: { on, bri, fxId, palId, col } } }`.

**Steps:**

- [ ] Write failing test `client/src/test/ScheduleManager.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { screen, fireEvent, waitFor } from '@testing-library/react';
  import { renderWithQuery } from './renderWithQuery';
  import { ScheduleManager } from '../sections/schedule/ScheduleManager';

  afterEach(() => vi.unstubAllGlobals());

  function stub() {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/schedules' && method === 'GET') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url === '/api/groups') {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'g1', name: 'Front', members: [{ controllerId: 'c1', wledSegId: 0 }] }]
        });
      }
      if (url === '/api/themes') {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 't1', name: 'Spooky', effect: 2, palette: 6, colors: [[255, 140, 0]], brightness: 128 }]
        });
      }
      if (url === '/api/controllers/c1/segments') {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 0, start: 0, stop: 30, len: 30, on: true, bri: 90, fx: 5, pal: 3, col: [[10, 20, 30]] }]
        });
      }
      if (url === '/api/control/apply' && method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ results: [{ controllerId: 'c1', wledSegId: 0, ok: true }] })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  async function openFormAndPreview(fetchMock: ReturnType<typeof stub>) {
    const openBtn = await screen.findByRole('button', { name: '+ New schedule' });
    await waitFor(() => expect((openBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(openBtn);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Evenings' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/control/apply')).toBe(true)
    );
  }

  describe('ScheduleManager v2', () => {
    it('previews the theme via fan-out v2 with the group target', async () => {
      const fetchMock = stub();
      renderWithQuery(<ScheduleManager />);
      await openFormAndPreview(fetchMock);
      const call = fetchMock.mock.calls.find(([u]) => u === '/api/control/apply')!;
      expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
        targets: [{ kind: 'group', groupId: 'g1' }],
        patch: { on: true, bri: 128, seg: { fxId: 2, palId: 6, col: [[255, 140, 0]] } }
      });
    });

    it('Discard reverts each member segment to its snapshot via v2 segment targets', async () => {
      const fetchMock = stub();
      renderWithQuery(<ScheduleManager />);
      await openFormAndPreview(fetchMock);
      fireEvent.click(screen.getByText('Discard'));
      await waitFor(() => {
        const applies = fetchMock.mock.calls.filter(([u]) => u === '/api/control/apply');
        expect(applies).toHaveLength(2);
        expect(JSON.parse((applies[1][1] as RequestInit).body as string)).toEqual({
          targets: [{ kind: 'segment', controllerId: 'c1', wledSegId: 0 }],
          patch: { seg: { on: true, bri: 90, fxId: 5, palId: 3, col: [[10, 20, 30]] } }
        });
      });
    });

    it('Approve reverts, then POSTs the schedule', async () => {
      const fetchMock = stub();
      renderWithQuery(<ScheduleManager />);
      await openFormAndPreview(fetchMock);
      fireEvent.click(screen.getByText('Approve'));
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(([u, i]) => u === '/api/schedules' && (i as RequestInit)?.method === 'POST')
        ).toBe(true)
      );
      const post = fetchMock.mock.calls.find(
        ([u, i]) => u === '/api/schedules' && (i as RequestInit)?.method === 'POST'
      )!;
      const body = JSON.parse((post[1] as RequestInit).body as string);
      expect(body.triggerType).toBe('weekly');
      expect(body.daysOfWeek).toEqual([1]);
      expect(body.actionPayload).toEqual({ themeId: 't1' });
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- test/ScheduleManager` — expect FAIL (module missing).
- [ ] Create `client/src/sections/schedule/ScheduleManager.tsx`:
  ```tsx
  import { useState } from 'react';
  import { useQueryClient } from '@tanstack/react-query';
  import {
    addSchedule, applyControlV2, deleteSchedule, getSegmentsSnapshot,
    type CustomTheme, type Schedule
  } from '../../api/client';
  import { useGroups, useSchedules, useThemes } from '../../api/queries';
  import { Button } from '../../components/ui/Button';
  import { Card } from '../../components/ui/Card';
  import { Chip } from '../../components/ui/Chip';
  import { Modal } from '../../components/ui/Modal';
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
    const schedules = useSchedules();
    const groups = useGroups();
    const themes = useThemes();
    const queryClient = useQueryClient();
    const [formOpen, setFormOpen] = useState(false);
    const [draft, setDraft] = useState<WeeklyScheduleDraft | null>(null);
    const [snapshot, setSnapshot] = useState<MemberSnapshot[] | null>(null);
    const [revertError, setRevertError] = useState<string | null>(null);

    function themeFor(d: WeeklyScheduleDraft): CustomTheme | undefined {
      const themeId = (d.actionPayload as { themeId?: string })?.themeId;
      return (themes.data ?? []).find((t) => t.id === themeId);
    }

    async function handlePreview(nextDraft: WeeklyScheduleDraft) {
      const theme = themeFor(nextDraft);
      if (!theme) return;
      const members =
        (groups.data ?? []).find((g) => g.id === nextDraft.groupId)?.members ?? [];
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
      await applyControlV2(
        [{ kind: 'group', groupId: nextDraft.groupId }],
        {
          on: true,
          bri: theme.brightness,
          seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors }
        }
      );
    }

    /**
     * Reverts every previewed member to its snapshot. A revert failure must
     * surface as a visible error rather than silently leaving lights in the
     * previewed state; applyControlV2 never throws for per-target failures,
     * so results are checked for ok: false explicitly.
     */
    async function revertToSnapshot(): Promise<boolean> {
      if (!snapshot) return true;
      const failures: string[] = [];
      for (const s of snapshot) {
        const { results } = await applyControlV2(
          [{ kind: 'segment', controllerId: s.controllerId, wledSegId: s.wledSegId }],
          { seg: { on: s.on, bri: s.bri, fxId: s.fx, palId: s.pal, col: s.col } }
        );
        for (const r of results) {
          if (!r.ok) {
            failures.push(`${r.controllerId}/${r.wledSegId ?? 'all'}: ${r.error ?? 'unknown error'}`);
          }
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
      if (!(await revertToSnapshot())) return;
      const created = await addSchedule({
        name: draft.name, triggerType: 'weekly', cronExpr: null,
        daysOfWeek: draft.daysOfWeek, timeOfDay: draft.timeOfDay, offsetMinutes: 0,
        latitude: null, longitude: null, groupId: draft.groupId,
        actionType: draft.actionType, actionPayload: draft.actionPayload, enabled: true
      });
      queryClient.setQueryData<Schedule[]>(['schedules'], (prev) => [...(prev ?? []), created]);
      setDraft(null);
      setSnapshot(null);
      setFormOpen(false);
    }

    async function handleDiscard() {
      if (!(await revertToSnapshot())) return;
      setDraft(null);
      setSnapshot(null);
    }

    async function handleDelete(id: string) {
      await deleteSchedule(id);
      queryClient.setQueryData<Schedule[]>(['schedules'], (prev) =>
        (prev ?? []).filter((s) => s.id !== id)
      );
    }

    function handleModalClose() {
      if (draft) void handleDiscard();
      setFormOpen(false);
    }

    return (
      <Card className="schedules-card">
        <div className="schedules-card-header">
          <h3>Weekly schedules</h3>
          <Button
            variant="primary"
            disabled={!groups.data || !themes.data}
            onClick={() => setFormOpen(true)}
          >
            + New schedule
          </Button>
        </div>
        {revertError && <div className="error-banner" role="alert">{revertError}</div>}
        {schedules.data && schedules.data.length === 0 && (
          <p className="empty-state">No schedules yet.</p>
        )}
        {schedules.data && schedules.data.length > 0 && (
          <ul className="schedule-list">
            {schedules.data.map((s) => (
              <li key={s.id} className="schedule-list-row">
                <div className="schedule-list-info">
                  <span className="schedule-list-name">{s.name}</span>
                  <Chip tone="neutral">{s.triggerType}</Chip>
                </div>
                <Button variant="danger" aria-label={`Remove ${s.name}`} onClick={() => handleDelete(s.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Modal open={formOpen} title="New weekly schedule" onClose={handleModalClose}>
          <WeeklyScheduleForm
            groups={groups.data ?? []}
            themes={themes.data ?? []}
            onPreview={handlePreview}
            onApprove={handleApprove}
            onDiscard={handleDiscard}
            previewing={draft !== null}
          />
        </Modal>
      </Card>
    );
  }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- test/ScheduleManager` — expect PASS (3 tests).
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/schedule client/src/test/ScheduleManager.test.tsx && git commit -m "Phase H Task 8: ScheduleManager preview/revert on control fan-out v2"
  ```

---

## Task 9: `ScheduleSection` v2 assembly, AppShell swap, delete old schedule files

**Files:**
- Create: `client/src/sections/schedule/ScheduleSection.tsx`
- Modify: `client/src/components/AppShell.tsx` (schedule import + render line)
- Delete: `client/src/components/ScheduleSection.tsx`, `client/src/components/ScheduleManager.tsx`, `client/src/components/CalendarGrid.tsx`, `client/src/components/CalendarEventForm.tsx`, `client/src/components/WeeklyScheduleForm.tsx`
- Test: rewrite `client/src/test/ScheduleSection.test.tsx`

**Interfaces:**
- Consumes: `CalendarGrid` + `eventsForDay` (Task 6), `CalendarEventForm` (Task 7), `ScheduleManager` (Task 8); `useCalendarEvents`, `useGroups`, `useThemes` (Task 1); `updateCalendarEvent`, `deleteCalendarEvent` from `api/client.ts`; kit `Card`, `Button`, `Chip`, `Modal`, `Toggle`.
- Produces: `ScheduleSection: { initialYear?: number; initialMonth?: number }` — rendered by AppShell for section key `schedule`. Behavior identical to the old section (month nav, day panel, enable toggle, override badge, remove).

**Steps:**

- [ ] Rewrite `client/src/test/ScheduleSection.test.tsx` (failing first):
  ```tsx
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { screen, fireEvent, waitFor } from '@testing-library/react';
  import { renderWithQuery } from './renderWithQuery';
  import { ScheduleSection } from '../sections/schedule/ScheduleSection';

  afterEach(() => vi.unstubAllGlobals());

  const halloween = {
    id: 'e1', name: 'Halloween', category: 'holiday',
    dateRule: { kind: 'fixed', month: 10, day: 31 }, recursYearly: true, enabled: true,
    groupId: 'g1', triggerTime: { type: 'fixed', time: '18:00' },
    actionType: 'theme', actionPayload: { themeId: 't1' }
  };

  function stub(events: unknown[] = [halloween]) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/calendar-events') && method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ ...halloween, enabled: false }) });
      }
      if (url.startsWith('/api/calendar-events')) {
        return Promise.resolve({ ok: true, json: async () => events });
      }
      if (url.startsWith('/api/groups')) {
        return Promise.resolve({ ok: true, json: async () => [{ id: 'g1', name: 'Front', members: [] }] });
      }
      if (url.startsWith('/api/themes')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0, 0, 0]], brightness: 128 }]
        });
      }
      if (url.startsWith('/api/schedules')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('ScheduleSection v2', () => {
    it('shows the day panel with the override badge when an enabled event day is selected', async () => {
      stub();
      renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
      await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
      fireEvent.click(screen.getByTestId('day-31'));
      await waitFor(() => expect(screen.getByText(/Overrides the weekly schedule/i)).toBeTruthy());
      expect(screen.getByText(/theme · Spooky/)).toBeTruthy();
    });

    it('toggling an event PATCHes enabled', async () => {
      const fetchMock = stub();
      renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
      await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
      fireEvent.click(screen.getByTestId('day-31'));
      fireEvent.click(await screen.findByLabelText('Halloween enabled'));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('/api/calendar-events/e1', expect.objectContaining({ method: 'PATCH' }))
      );
    });

    it('renders the weekly schedules region', async () => {
      stub([]);
      renderWithQuery(<ScheduleSection initialYear={2026} initialMonth={10} />);
      await waitFor(() => expect(screen.getByText('Weekly schedules')).toBeTruthy());
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- test/ScheduleSection` — expect FAIL (new module missing).
- [ ] Create `client/src/sections/schedule/ScheduleSection.tsx`:
  ```tsx
  import { useState } from 'react';
  import { useQueryClient } from '@tanstack/react-query';
  import {
    deleteCalendarEvent, updateCalendarEvent, type CalendarEvent
  } from '../../api/client';
  import { useCalendarEvents, useGroups, useThemes } from '../../api/queries';
  import { Button } from '../../components/ui/Button';
  import { Card } from '../../components/ui/Card';
  import { Chip } from '../../components/ui/Chip';
  import { Modal } from '../../components/ui/Modal';
  import { Toggle } from '../../components/ui/Toggle';
  import { CalendarEventForm } from './CalendarEventForm';
  import { CalendarGrid, eventsForDay } from './CalendarGrid';
  import { ScheduleManager } from './ScheduleManager';
  import './schedule.css';

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
    const [eventFormOpen, setEventFormOpen] = useState(false);
    const events = useCalendarEvents();
    const groups = useGroups();
    const themes = useThemes();
    const queryClient = useQueryClient();

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
      queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prevData) =>
        (prevData ?? []).map((e) => (e.id === id ? updated : e))
      );
    }
    async function remove(id: string) {
      await deleteCalendarEvent(id);
      queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prevData) =>
        (prevData ?? []).filter((e) => e.id !== id)
      );
    }

    const eventList = events.data ?? [];
    const dayEvents = selectedDay === null ? [] : eventsForDay(eventList, year, month, selectedDay);
    const groupName = (id: string | null) =>
      (groups.data ?? []).find((g) => g.id === id)?.name ?? '—';
    const themeName = (payload: unknown) => {
      const themeId = (payload as { themeId?: string })?.themeId;
      return (themes.data ?? []).find((t) => t.id === themeId)?.name ?? themeId ?? '—';
    };
    function triggerLabel(e: CalendarEvent): string {
      return e.triggerTime.type === 'fixed'
        ? `at ${e.triggerTime.time}`
        : `${e.triggerTime.type} ${e.triggerTime.offsetMinutes >= 0 ? '+' : ''}${e.triggerTime.offsetMinutes} min`;
    }

    return (
      <section className="section schedule-section">
        <div className="schedule-body">
          <Card className="schedule-calendar">
            <CalendarGrid
              events={eventList} year={year} month={month} selectedDay={selectedDay}
              onSelectDay={setSelectedDay} onPrev={prev} onNext={next} onToday={today}
            />
            <Button variant="primary" onClick={() => setEventFormOpen(true)}>+ Event</Button>
          </Card>
          <Card className="schedule-detail">
            <h3>{selectedDay === null ? 'Select a day' : `Day ${selectedDay}`}</h3>
            {selectedDay === null && (
              <p className="empty-state">Click a date on the calendar to view or add events for that day.</p>
            )}
            {selectedDay !== null && dayEvents.length === 0 && (
              <p className="empty-state">No events on this day.</p>
            )}
            {dayEvents.map((e) => (
              <div key={e.id} className="schedule-detail-event">
                <div className="schedule-detail-event-head">
                  <Toggle
                    checked={e.enabled}
                    onChange={(checked) => toggleEnabled(e.id, checked)}
                    aria-label={`${e.name} enabled`}
                  />
                  <span className="schedule-detail-event-name">{e.name}</span>
                  <Chip tone={e.category === 'holiday' ? 'accent' : 'neutral'}>{e.category}</Chip>
                </div>
                <span className="schedule-detail-meta">
                  {e.actionType ?? 'action'} · {themeName(e.actionPayload)}
                </span>
                <span className="schedule-detail-meta">
                  Trigger {triggerLabel(e)} · Group {groupName(e.groupId)}
                </span>
                {e.enabled && <Chip tone="warning">Overrides the weekly schedule this day</Chip>}
                <Button variant="danger" onClick={() => remove(e.id)}>Remove</Button>
              </div>
            ))}
          </Card>
        </div>
        <Modal open={eventFormOpen} title="New calendar event" onClose={() => setEventFormOpen(false)}>
          <CalendarEventForm
            groups={groups.data ?? []}
            themes={themes.data ?? []}
            onCreated={(e) => {
              queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prevData) => [
                ...(prevData ?? []),
                e
              ]);
              setEventFormOpen(false);
            }}
          />
        </Modal>
        <ScheduleManager />
      </section>
    );
  }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- test/ScheduleSection` — expect PASS (3 tests).
- [ ] Swap AppShell: replace the schedule import (pre-Phase-C: `import { ScheduleSection } from './ScheduleSection';` at line 8) with `import { ScheduleSection } from '../sections/schedule/ScheduleSection';` — the render line `{active === 'schedule' && <ScheduleSection />}` is unchanged. If `client/src/test/AppShell.test.tsx` mocks `./ScheduleSection`, update the mock path to `../sections/schedule/ScheduleSection`.
- [ ] Delete the old schedule components:
  ```bash
  cd /Users/bwwilliams/github/uber-wled
  git rm client/src/components/ScheduleSection.tsx client/src/components/ScheduleManager.tsx \
         client/src/components/CalendarGrid.tsx client/src/components/CalendarEventForm.tsx \
         client/src/components/WeeklyScheduleForm.tsx
  grep -rn "components/ScheduleSection\|components/CalendarGrid\|components/ScheduleManager\|components/WeeklyScheduleForm\|components/CalendarEventForm" client/src || true
  ```
  The grep must return nothing (all references now point at `sections/schedule/`).
- [ ] Run the full client suite and build: `cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add -A client/src && git commit -m "Phase H Task 9: ScheduleSection v2 assembled; delete old schedule components"
  ```

---

## Task 10: Firmware section restyle with Devices → Update deep-link

**Files:**
- Create: `client/src/sections/firmware/FirmwareSection.tsx`
- Create: `client/src/sections/firmware/firmware.css`
- Modify: `client/src/components/AppShell.tsx` (firmware import + render line + `sectionFromHash` first-segment parsing)
- Delete: `client/src/components/FirmwareSection.tsx`
- Test: rewrite `client/src/test/FirmwareSection.test.tsx`

**Interfaces:**
- Consumes: `useControllers`, `useFirmwareStatus` (Task 1); kit `Card`, `Button`, `Chip`; `Controller` type.
- Produces:
  ```tsx
  FirmwareSection: { onOpenDeviceUpdate: (controllerId: string) => void }
  ```
  Deep-link contract (binding for Phase F): AppShell passes `onOpenDeviceUpdate` that sets `window.location.hash = '#/devices/<controllerId>/update'`; the Devices section (Phase F) opens that controller's detail on the Update tab. `components/FirmwareStatus.tsx` and `components/AssetPickerModal.tsx` are NOT deleted here — Phase F relocates the pin/OTA flow into Devices → Update, and Phase I removes any leftovers.

**Steps:**

- [ ] Rewrite `client/src/test/FirmwareSection.test.tsx` (failing first):
  ```tsx
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { screen, fireEvent, waitFor } from '@testing-library/react';
  import { renderWithQuery } from './renderWithQuery';
  import { FirmwareSection } from '../sections/firmware/FirmwareSection';

  afterEach(() => vi.unstubAllGlobals());

  function stub() {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/controllers/c1/firmware') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
            isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: []
          })
        });
      }
      if (url === '/api/controllers') {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: 'ESP32' }
          ]
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('FirmwareSection v2', () => {
    it('lists controllers with an update chip and deep-links into the device Update tab', async () => {
      stub();
      const onOpen = vi.fn();
      renderWithQuery(<FirmwareSection onOpenDeviceUpdate={onOpen} />);
      await waitFor(() => expect(screen.getByText('Porch')).toBeTruthy());
      await waitFor(() => expect(screen.getByText(/Update available \(v0\.15\.0\)/)).toBeTruthy());
      fireEvent.click(screen.getByLabelText('Open update for Porch'));
      expect(onOpen).toHaveBeenCalledWith('c1');
    });

    it('shows the empty state without controllers', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
      renderWithQuery(<FirmwareSection onOpenDeviceUpdate={() => {}} />);
      await waitFor(() => expect(screen.getByText('No controllers yet.')).toBeTruthy());
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- FirmwareSection` — expect FAIL (new module missing).
- [ ] Create `client/src/sections/firmware/FirmwareSection.tsx`:
  ```tsx
  import type { Controller } from '../../api/client';
  import { useControllers, useFirmwareStatus } from '../../api/queries';
  import { Button } from '../../components/ui/Button';
  import { Card } from '../../components/ui/Card';
  import { Chip } from '../../components/ui/Chip';
  import './firmware.css';

  function FirmwareRow({
    controller,
    onOpenDeviceUpdate
  }: {
    controller: Controller;
    onOpenDeviceUpdate: (controllerId: string) => void;
  }) {
    const status = useFirmwareStatus(controller.id);
    return (
      <li className="firmware-row">
        <div className="firmware-row-info">
          <span className="firmware-row-name">{controller.name}</span>
          <span className="firmware-row-host">{controller.host}</span>
        </div>
        <div className="firmware-row-status">
          {controller.stale && <Chip tone="warning">stale</Chip>}
          {status.isPending && <span className="firmware-row-meta">Checking firmware…</span>}
          {status.isError && <span className="firmware-row-meta">Firmware status unavailable</span>}
          {status.data?.unreachable && <span className="firmware-row-meta">Controller offline</span>}
          {status.data && !status.data.unreachable && (
            <>
              <span className="firmware-row-meta">
                Installed: {status.data.installedVersion ?? 'unknown'}
              </span>
              {status.data.isPrerelease && <Chip tone="accent">pre-release</Chip>}
              {status.data.updateAvailable && (
                <Chip tone="warning">Update available ({status.data.latestTag})</Chip>
              )}
            </>
          )}
        </div>
        <Button
          variant={status.data?.updateAvailable ? 'primary' : 'secondary'}
          aria-label={`Open update for ${controller.name}`}
          onClick={() => onOpenDeviceUpdate(controller.id)}
        >
          {status.data?.updateAvailable ? 'Update…' : 'Manage…'}
        </Button>
      </li>
    );
  }

  export function FirmwareSection({
    onOpenDeviceUpdate
  }: {
    onOpenDeviceUpdate: (controllerId: string) => void;
  }) {
    const controllers = useControllers();
    return (
      <section className="section firmware-section">
        <h2>Firmware</h2>
        <Card>
          {controllers.isError && (
            <div className="error-banner" role="alert">Failed to load controllers.</div>
          )}
          {controllers.data && controllers.data.length === 0 && (
            <p className="empty-state">No controllers yet.</p>
          )}
          {controllers.data && controllers.data.length > 0 && (
            <ul className="firmware-list">
              {controllers.data.map((c) => (
                <FirmwareRow key={c.id} controller={c} onOpenDeviceUpdate={onOpenDeviceUpdate} />
              ))}
            </ul>
          )}
        </Card>
      </section>
    );
  }
  ```
- [ ] Create `client/src/sections/firmware/firmware.css`:
  ```css
  /* Firmware section — Phase H. */
  .firmware-list { list-style: none; margin: 0; padding: 0; }
  .firmware-row { display: flex; align-items: center; gap: 12px; padding: 12px 4px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .firmware-row:last-child { border-bottom: none; }
  .firmware-row-info { display: flex; flex-direction: column; min-width: 140px; }
  .firmware-row-name { color: var(--text); font-weight: 600; }
  .firmware-row-host { color: var(--text-muted); font-size: 0.85rem; }
  .firmware-row-status { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; flex-wrap: wrap; }
  .firmware-row-meta { color: var(--text-muted); font-size: 0.85rem; }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- FirmwareSection` — expect PASS (2 tests).
- [ ] Wire AppShell. In `client/src/components/AppShell.tsx`:
  1. Replace the firmware import (pre-Phase-C: `import { FirmwareSection } from './FirmwareSection';` at line 9) with `import { FirmwareSection } from '../sections/firmware/FirmwareSection';`.
  2. Replace the render line (pre-Phase-C line 77) with:
     ```tsx
     {active === 'firmware' && (
       <FirmwareSection
         onOpenDeviceUpdate={(controllerId) => {
           window.location.hash = `#/devices/${controllerId}/update`;
         }}
       />
     )}
     ```
  3. Ensure `sectionFromHash` matches on the FIRST path segment so the deep-link lands on the Devices section (skip if Phase C already ships this exact behavior):
     ```ts
     function sectionFromHash(): SectionKey {
       const first = window.location.hash.replace(/^#\/?/, '').split('/')[0] as SectionKey;
       return (KEYS as string[]).includes(first) ? first : DEFAULT_SECTION;
     }
     ```
  If `client/src/test/AppShell.test.tsx` mocks `./FirmwareSection`, update the mock path to `../sections/firmware/FirmwareSection` (the mock component must now accept and ignore the `onOpenDeviceUpdate` prop).
- [ ] Delete the old fleet component: `cd /Users/bwwilliams/github/uber-wled && git rm client/src/components/FirmwareSection.tsx`. Leave `FirmwareStatus.tsx`, `AssetPickerModal.tsx`, and their tests in place (consumed by Phase F's Devices → Update tab).
- [ ] Run the full client suite and build: `cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add -A client/src && git commit -m "Phase H Task 10: Firmware fleet view on the kit with Devices Update deep-link"
  ```

---

## Task 11: Settings section restyle + live poll interval field

**Files:**
- Create: `client/src/sections/settings/SettingsSection.tsx`
- Create: `client/src/sections/settings/settings.css`
- Modify: `client/src/components/AppShell.tsx` (settings import line)
- Delete: `client/src/components/SettingsSection.tsx`
- Test: rewrite `client/src/test/SettingsSection.test.tsx`

**Interfaces:**
- Consumes: `useSettings` (Task 1); `updateSettings`, `rescanNow`, `Settings` (with `livePollIntervalSeconds: number`, Task 1) from `api/client.ts`; kit `Card`, `Button`, `Field`, `Toggle`. Server side: Phase B's widened `GET/PATCH /api/settings` maps camelCase `livePollIntervalSeconds` ↔ DB column `live_poll_interval_seconds` (default 2), same repository pattern as the existing fields in `server/src/settings/repository.ts:21-30`.
- Produces: `SettingsSection: () => ReactElement` for AppShell section key `settings`. `clampLivePoll(value: number): number` (module-private) clamps to [1, 30], NaN → 2.

**Steps:**

- [ ] Rewrite `client/src/test/SettingsSection.test.tsx` (failing first):
  ```tsx
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { screen, fireEvent, waitFor } from '@testing-library/react';
  import { renderWithQuery } from './renderWithQuery';
  import { SettingsSection } from '../sections/settings/SettingsSection';

  afterEach(() => vi.unstubAllGlobals());

  const initial = {
    includePrereleaseFirmware: false, homeLatitude: null, homeLongitude: null,
    discoveryRescanIntervalMinutes: 5, scheduleImportDisableOnDeviceDefault: false,
    controllerStatusPollIntervalMinutes: 5, livePollIntervalSeconds: 2
  };

  function stub(patchResponse: (body: Record<string, unknown>) => unknown = (b) => ({ ...initial, ...b })) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/settings' && method === 'PATCH') {
        const body = JSON.parse(init!.body as string);
        return Promise.resolve({ ok: true, json: async () => patchResponse(body) });
      }
      if (url === '/api/settings') {
        return Promise.resolve({ ok: true, json: async () => initial });
      }
      if (url.endsWith('/rescan')) {
        return Promise.resolve({ ok: true, json: async () => ({ controllers: [{ id: 'c1' }, { id: 'c2' }] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('SettingsSection v2', () => {
    it('round-trips the live poll interval: loads 2, saves the edited value in the PATCH body', async () => {
      const fetchMock = stub();
      renderWithQuery(<SettingsSection />);
      const field = (await screen.findByLabelText('Live poll interval (seconds)')) as HTMLInputElement;
      expect(field.value).toBe('2');
      fireEvent.change(field, { target: { value: '7' } });
      fireEvent.click(screen.getByText('Save settings'));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PATCH' }))
      );
      const patch = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PATCH')!;
      expect(JSON.parse((patch[1] as RequestInit).body as string).livePollIntervalSeconds).toBe(7);
      // saved value reflected back into the field
      await waitFor(() =>
        expect((screen.getByLabelText('Live poll interval (seconds)') as HTMLInputElement).value).toBe('7')
      );
    });

    it('clamps the live poll interval to 1–30 on save', async () => {
      const fetchMock = stub();
      renderWithQuery(<SettingsSection />);
      const field = await screen.findByLabelText('Live poll interval (seconds)');
      fireEvent.change(field, { target: { value: '45' } });
      fireEvent.click(screen.getByText('Save settings'));
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'PATCH')).toBe(true)
      );
      const patch = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PATCH')!;
      expect(JSON.parse((patch[1] as RequestInit).body as string).livePollIntervalSeconds).toBe(30);
    });

    it('surfaces an error instead of hanging on Loading when the initial load fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
      renderWithQuery(<SettingsSection />);
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    it('runs a re-scan and reports the result', async () => {
      stub();
      renderWithQuery(<SettingsSection />);
      fireEvent.click(await screen.findByText('Re-scan now'));
      await waitFor(() => expect(screen.getByText(/Re-scan complete — 2 controller/i)).toBeTruthy());
    });
  });
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- SettingsSection` — expect FAIL (new module missing).
- [ ] Create `client/src/sections/settings/SettingsSection.tsx`:
  ```tsx
  import { useEffect, useState } from 'react';
  import { useMutation, useQueryClient } from '@tanstack/react-query';
  import { rescanNow, updateSettings, type Settings } from '../../api/client';
  import { useSettings } from '../../api/queries';
  import { Button } from '../../components/ui/Button';
  import { Card } from '../../components/ui/Card';
  import { Field } from '../../components/ui/Field';
  import { Toggle } from '../../components/ui/Toggle';
  import './settings.css';

  function clampLivePoll(value: number): number {
    if (!Number.isFinite(value)) return 2;
    return Math.min(30, Math.max(1, Math.round(value)));
  }

  export function SettingsSection() {
    const settings = useSettings();
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState<Settings | null>(null);
    const [rescanMessage, setRescanMessage] = useState<string | null>(null);
    const [rescanError, setRescanError] = useState<string | null>(null);

    useEffect(() => {
      if (settings.data && draft === null) setDraft(settings.data);
    }, [settings.data, draft]);

    const save = useMutation({
      mutationFn: (next: Settings) => updateSettings(next),
      onSuccess: (saved) => {
        queryClient.setQueryData(['settings'], saved);
        setDraft(saved);
      }
    });

    function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
      setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    }

    async function handleRescan() {
      setRescanMessage(null);
      setRescanError(null);
      try {
        const { controllers } = await rescanNow();
        setRescanMessage(`Re-scan complete — ${controllers.length} controller(s) known.`);
      } catch (e: unknown) {
        setRescanError(e instanceof Error ? e.message : 'Re-scan failed');
      }
    }

    if (settings.isError) {
      return (
        <section className="section settings-section">
          <h2>Settings</h2>
          <div className="error-banner" role="alert">Failed to load settings.</div>
        </section>
      );
    }
    if (!draft) {
      return (
        <section className="section settings-section">
          <h2>Settings</h2>
          <p className="empty-state">Loading…</p>
        </section>
      );
    }

    return (
      <section className="section settings-section">
        <h2>Settings</h2>
        <Card className="settings-form">
          {save.isError && (
            <div className="error-banner" role="alert">Failed to save settings.</div>
          )}

          <div className="settings-toggle-row">
            <Toggle
              checked={draft.includePrereleaseFirmware}
              onChange={(c) => patch('includePrereleaseFirmware', c)}
              aria-label="Include pre-release firmware builds"
            />
            <span>Include pre-release firmware builds</span>
          </div>

          <Field label="Home latitude" htmlFor="settings-lat">
            <input
              id="settings-lat" className="input" type="number" step="any"
              value={draft.homeLatitude ?? ''}
              onChange={(e) =>
                patch('homeLatitude', e.target.value === '' ? null : Number(e.target.value))
              }
            />
          </Field>

          <Field label="Home longitude" htmlFor="settings-lon">
            <input
              id="settings-lon" className="input" type="number" step="any"
              value={draft.homeLongitude ?? ''}
              onChange={(e) =>
                patch('homeLongitude', e.target.value === '' ? null : Number(e.target.value))
              }
            />
          </Field>

          <Field label="Discovery re-scan interval (minutes)" htmlFor="settings-interval">
            <input
              id="settings-interval" aria-label="Discovery re-scan interval (minutes)"
              className="input" type="number" min={1}
              value={draft.discoveryRescanIntervalMinutes}
              onChange={(e) => patch('discoveryRescanIntervalMinutes', Number(e.target.value))}
            />
          </Field>

          <div className="settings-toggle-row">
            <Toggle
              checked={draft.scheduleImportDisableOnDeviceDefault}
              onChange={(c) => patch('scheduleImportDisableOnDeviceDefault', c)}
              aria-label="Default disable on device for schedule import"
            />
            <span>Default "disable on device" when importing WLED schedules</span>
          </div>

          <Field
            label="Controller status poll interval (minutes)"
            htmlFor="settings-status-poll-interval"
            hint="How often each controller's current state (power, brightness, effect, segments) is read and cached"
          >
            <input
              id="settings-status-poll-interval"
              aria-label="Controller status poll interval (minutes)"
              className="input" type="number" min={1}
              value={draft.controllerStatusPollIntervalMinutes}
              onChange={(e) => patch('controllerStatusPollIntervalMinutes', Number(e.target.value))}
            />
          </Field>

          <Field
            label="Live poll interval (seconds)"
            htmlFor="settings-live-poll"
            hint="How often watched controllers are polled while Home, Layout, or a Control panel is open (1–30 s)"
          >
            <input
              id="settings-live-poll" aria-label="Live poll interval (seconds)"
              className="input" type="number" min={1} max={30}
              value={draft.livePollIntervalSeconds}
              onChange={(e) => patch('livePollIntervalSeconds', Number(e.target.value))}
            />
          </Field>

          <div className="settings-actions">
            <Button
              variant="primary"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  ...draft,
                  livePollIntervalSeconds: clampLivePoll(draft.livePollIntervalSeconds)
                })
              }
            >
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
            <Button variant="secondary" onClick={handleRescan}>Re-scan now</Button>
          </div>
          {rescanMessage && <p className="settings-note">{rescanMessage}</p>}
          {rescanError && <div className="error-banner" role="alert">{rescanError}</div>}
        </Card>
      </section>
    );
  }
  ```
- [ ] Create `client/src/sections/settings/settings.css`:
  ```css
  /* Settings section — Phase H. */
  .settings-form { display: flex; flex-direction: column; gap: 14px; max-width: 560px; }
  .settings-toggle-row { display: flex; align-items: center; gap: 10px; min-height: 40px; color: var(--text); }
  .settings-actions { display: flex; gap: 8px; }
  .settings-note { color: var(--text-muted); font-size: 0.85rem; margin: 0; }
  ```
- [ ] Run: `cd /Users/bwwilliams/github/uber-wled/client && npm test -- SettingsSection` — expect PASS (4 tests).
- [ ] Swap AppShell: replace the settings import (pre-Phase-C: `import { SettingsSection } from './SettingsSection';` at line 10) with `import { SettingsSection } from '../sections/settings/SettingsSection';` — the render line is unchanged. Update any `./SettingsSection` mock path in `AppShell.test.tsx` to the new path.
- [ ] Delete the old component: `cd /Users/bwwilliams/github/uber-wled && git rm client/src/components/SettingsSection.tsx`.
- [ ] Run the full client suite and build: `cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build` — expect PASS.
- [ ] Commit:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add -A client/src && git commit -m "Phase H Task 11: Settings on the kit with live poll interval field"
  ```

---

## Task 12: Phase verification gate

**Files:**
- No new files. Verification only (per master plan "Verification gates").

**Interfaces:**
- Consumes: everything shipped in Tasks 1–11.
- Produces: green suites + build; evidence for the phase review.

**Steps:**

- [ ] Confirm no dangling references to deleted modules:
  ```bash
  cd /Users/bwwilliams/github/uber-wled
  grep -rn "components/ThemeManager\|components/ScheduleSection\|components/ScheduleManager\|components/CalendarGrid\|components/CalendarEventForm\|components/WeeklyScheduleForm\|components/FirmwareSection\|components/SettingsSection" client/src && echo "DANGLING REFERENCES — fix before proceeding" || echo OK
  ```
  Expected output: `OK`. (Note: `components/FirmwareStatus` is intentionally still present.)
- [ ] Full client suite: `cd /Users/bwwilliams/github/uber-wled/client && npm test` — expect PASS, zero skips.
- [ ] Client production build: `cd /Users/bwwilliams/github/uber-wled/client && npm run build` — expect success (tsc + vite).
- [ ] Full server suite (untouched by this phase, but the gate requires it): `cd /Users/bwwilliams/github/uber-wled/server && npm test` — expect PASS.
- [ ] Manual width check with the dev server (`cd /Users/bwwilliams/github/uber-wled/client && npm run dev`): open Themes, Schedule, Firmware, Settings at 390px and 1440px viewport widths; verify no horizontal scrolling, picker lists scroll internally, color popover stays on-screen at 390px, all touch targets ≥ 40px. This is a look-only check against real controllers — do NOT save themes/schedules or trigger updates against real hardware during it (read-only browsing is fine).
- [ ] If any fix was needed, commit it:
  ```bash
  cd /Users/bwwilliams/github/uber-wled && git add -A client/src && git commit -m "Phase H Task 12: verification fixes"
  ```
  Otherwise no commit — the phase ends with Tasks 1–11's commits, ready for phase review + push.
