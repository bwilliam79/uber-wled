# Control Plane Redesign — Master Plan & Contracts

> **For agentic workers:** This master plan defines the phase breakdown and the
> BINDING cross-phase contracts. Each phase has its own plan document
> (`0N-<phase>.md`, same directory) written in
> superpowers:writing-plans format. Implement phases in dependency order.
> Contracts in this file OVERRIDE anything conflicting in a phase plan.

**Goal:** Rebuild uber-wled as a WLED-parity, multi-controller control plane
per `docs/superpowers/specs/2026-07-04-uber-wled-control-plane-redesign-design.md`.

**Architecture:** Extend the Express/SQLite backend with a WLED client v2
(capabilities, config, presets, nightlight), a per-controller capability
cache, an abstract fan-out control API (name-based effect/palette
resolution), and an SSE fast-poll live stream. Rewrite the React client on a
new design system with a shared Control surface used by Home, Layout, and
Devices.

**Tech Stack:** Existing: Node 20 + TypeScript + Express + better-sqlite3;
React 18 + Vite + Vitest + Testing Library. New client deps (exact):
`@tanstack/react-query`, `@jaames/iro`, `@fontsource/plus-jakarta-sans`.
No other new runtime deps on either side.

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

## Phase index & dependency order

| # | Plan file | Scope | Depends on |
|---|-----------|-------|------------|
| A | `01-server-wled-v2.md` | WLED client v2: fxdata/palx parsers, cfg/preset/nightlight/reboot calls, capability cache table + refresh + `GET /api/controllers/:id/capabilities` | — |
| B | `02-server-control-live.md` | Fan-out v2 `POST /api/control/apply` (targets+patch, name resolution), SSE `GET /api/live`, device mgmt routes (presets CRUD, config get/dry-run/apply, reboot), segments field widening, schema adds (groups.icon/sort_order, settings.live_poll_interval_seconds) | A |
| C | `03-client-foundation.md` | Design tokens + `components/ui/*` kit, @fontsource, react-query setup, AppShell v2 (sidebar + phone bottom nav, 7 sections), design-system/MASTER.md update | — |
| D | `04-control-surface.md` | Shared Control surface (Drawer/BottomSheet + 4 tabs + header), mixed-state logic, SSE client hook, optimistic writes | B, C |
| E | `05-home.md` | Home tile grid v2, dynamic glow, multi-select → Control, inline room (group) editing + reorder | D |
| F | `06-devices.md` | Devices list + detail tabs (Info/Segments/Presets/Config/Update), diff-and-confirm config flow, liveview peek iframe, reboot | D |
| G | `07-layout-canvas.md` | Canvas rebuild: draw/edit/zoom/pan/marquee, selection → Control surface, SSE live colors | D |
| H | `08-restyle-sections.md` | Themes (capability-cache pickers + previews), Schedule, Firmware, Settings (+ live-poll-interval setting UI) restyles | C (+A for Themes) |
| I | `09-migration-release.md` | Scheduler/calendar on fan-out v2, delete v1 route + GroupManager screen, README rewrite, 1.0.0 bumps, full browser verification, deploy | all |

Phases C and A can be built in parallel; everything else follows the table.

## Binding contracts

### Server types (new module `server/src/wled/capabilities.ts` unless noted)

```ts
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
```

### Fan-out v2 (`server/src/control/applyV2.ts` + route in `control/routes.ts`)

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
// Semantics: groups expand to segment targets; duplicate (controller,seg)
// pairs dedupe; controller-kind targets patch ALL segments of that
// controller; every device write includes udpn:{nn:true}; per-target
// isolation with exactly one retry (match v1 behavior).
```

### Live stream

```
GET /api/live?controllers=<id>,<id>   (SSE)
event: status
data: { "controllerId": string, "reachable": boolean,
        "state"?: WledState, "info"?: WledInfo }
```
Server keeps one refcounted fast-poll session per controller
(interval = settings.live_poll_interval_seconds, default 2; info refreshed
every 10th tick). Session stops when its last SSE subscriber disconnects.
Module: `server/src/live/sessions.ts` + `server/src/live/routes.ts`.

### Device management routes (extend `server/src/controllers/routes.ts` or new `server/src/devices/routes.ts`)

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

### Schema additions (idempotent column adds, existing pattern in `schema.ts`)

```sql
ALTER TABLE groups ADD COLUMN icon TEXT;                                   -- nullable
ALTER TABLE groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN live_poll_interval_seconds INTEGER NOT NULL DEFAULT 2;
CREATE TABLE IF NOT EXISTS controller_capabilities (
  controller_id TEXT PRIMARY KEY REFERENCES controllers(id) ON DELETE CASCADE,
  vid INTEGER NOT NULL,
  effects TEXT NOT NULL, palettes TEXT NOT NULL, fxdata TEXT NOT NULL,
  palette_previews TEXT NOT NULL, fetched_at TEXT NOT NULL
);
```

### Client structure (rewrite target layout under `client/src/`)

```
design/tokens.css design/global.css
components/ui/{Button,IconButton,Card,Slider,Toggle,Tabs,SegmentedControl,
               SearchInput,Select,Modal,Drawer,Toast,Chip,Field,Skeleton}.tsx
api/client.ts          (typed fetch fns; extends existing)
api/queries.ts         (react-query hooks; keys: ['controllers'], ['capabilities',id],
                        ['groups'], ['themes'], ['status'], ['presets',id], ['config',id], ...)
api/live.ts            (useLiveStatus(controllerIds: string[]) → Map<string, {reachable, state?, info?}>; EventSource under the hood)
control/ControlSurface.tsx   (props: { targets: Target[]; open: boolean; onClose(): void })
control/{ColorTab,EffectsTab,PalettesTab,PresetsTab}.tsx
control/controlState.ts     (pure: aggregate target states → { power:'on'|'off'|'mixed', bri:number|'mixed', fxName:string|'mixed'|null, ... })
sections/home/  sections/devices/  sections/layout/  sections/themes/
sections/schedule/  sections/firmware/  sections/settings/
components/AppShell.tsx (rewritten: sidebar ≥900px, bottom nav <900px)
```
Client `Target` type mirrors the server contract exactly.
Old flat `components/*Section*.tsx` files are deleted as each phase replaces
them (deletion happens in the phase that ships the replacement).

### Design tokens (design/tokens.css, also reflected into design-system/MASTER.md)

```css
--bg:#0B0F1A; --surface:#131A2A; --surface-2:#1A2338;
--border:rgba(148,163,184,.10); --text:#E6EAF2; --text-muted:#8A94A8;
--accent:#6B7280; --accent-soft:rgba(107,114,128,.16);
--success:#22C55E; --danger:#EF4444; --warning:#F59E0B;
--radius-card:16px; --radius-control:10px;
font: 'Plus Jakarta Sans' (via @fontsource), fallback system-ui;
```

## Verification gates

- After each phase: `cd server && npm test` and `cd client && npm test` and
  `cd client && npm run build` all green; one commit per task, push after
  each phase completes review.
- Phase I ends with: browser walkthrough of all 7 sections at 390px and
  1440px against the dev server with real controllers; reversible live
  hardware check (capture → apply color/effect → restore); deploy to
  media-server; live production verification.
