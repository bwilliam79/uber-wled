# uber-wled v2.0.0 Reskin — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. This is a
> **reskin**: presentation only. No behavior, data-flow, API, or route
> changes. If a step would alter what a screen *does*, stop — that's out of
> scope.

**Goal:** Apply the `design/README.md` visual language (teal dark-first system
+ light mode) across every uber-wled screen — mocked and un-mocked — and ship
as a single 2.0.0 cutover.

**Architecture:** New CSS-variable token system is the source of truth; legacy
token names are aliased to it (bridge) so the whole app reskins immediately,
then each section migrates to native recipes and the aliases are removed. A
`ThemeProvider` sets `data-theme` on the root and persists the choice. Shared
UI-kit primitives are restyled first so the change cascades; sections follow.

**Tech Stack:** React + Vite + TypeScript, existing `components/ui` kit,
`@fontsource` self-hosted fonts, vitest.

## Global Constraints (verbatim from `design/README.md`)

- **Preserve every existing feature and flow. Only presentation changes.**
- Theme via CSS variables on a `data-theme` root attr (`"dark"` default,
  `"light"`); dark/light is a single switch.
- **Prototype is the source of exact values** — read `Uber-WLED Prototype.dc.html`
  for precise color/spacing/radius/motion, not just the README table.
- **LED/effect preview colors are literal hex, NOT themed**; preview housings
  stay dark (`#0c0c0e`/`#000`) in both themes so glow reads like real light.
- Text/icon on accent fill = `#04140f`. Destructive = `#ff6b6b`. Warning =
  `#ffb020`.
- Reuse the small set of component recipes everywhere, incl. un-mocked screens.

### Token reference (from prototype `:root` / `[data-theme="light"]`)

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#0e0e11` | `#ebe9e4` |
| `--rail` | `#08080a` | `#e3e1db` |
| `--panel` | `#18181c` | `#f5f4f1` |
| `--toast` | `#1c2b26` | `#dbeee8` |
| `--text` | `#f4f4f6` | `#191a1c` |
| `--text2` | `#c9c9d0` | `#44464c` |
| `--m1` | `#9797a1` | `#63656d` |
| `--m2` | `#7a7a84` | `#7c7e88` |
| `--m3` | `#63636c` | `#9a9ca4` |
| `--accent` | `#2ee6c0` | `#0c917a` |
| `--w3…--w28` | `rgba(255,255,255,.03–.28)` | `rgba(0,0,0,.035–.34)` |

Fonts: **Space Grotesk** (UI, 400/500/600/700), **IBM Plex Mono** (numeric/
metadata, 400/500/600). Radii: chips 6–9 · controls 10–12 · cards 14–16 ·
modal 20 · pills/toggles round. Card shadow `0 12px 40px rgba(0,0,0,.16)`;
modal `0 24px 60px rgba(0,0,0,.5)`. Theme transition: 0.35s ease on
bg/border/color. Accent glow drop-shadow `rgba(46,230,192,.85/.5)`.

---

## Phase 0 — Token foundation, fonts, theming

**Files:** `src/design/tokens.css` (rewrite), `src/index.css` (legacy aliases),
`src/design/global.css`, `src/main.tsx` (fonts), new
`src/theme/ThemeProvider.tsx` + `src/theme/useTheme.ts`, `package.json`
(fontsource deps), `src/test/design/tokens.test.ts` (update), new
`src/test/theme/ThemeProvider.test.tsx`.

- [ ] Add `@fontsource/space-grotesk` (400/500/600/700) and
  `@fontsource/ibm-plex-mono` (400/500/600); import in `main.tsx`; remove the
  Plus Jakarta imports. Add `--font-sans: 'Space Grotesk', system-ui, …` and
  `--font-mono: 'IBM Plex Mono', ui-monospace, monospace`.
- [ ] Rewrite `tokens.css`: define the full new vocabulary under `:root`
  (dark) and `[data-theme="light"]` with the exact hex above, plus literal LED
  hex constants (`--led-1: #2ee6c0` … per README list) and status
  (`--danger:#ff6b6b`, `--warning:#ffb020`, on-accent `#04140f`).
- [ ] **Alias bridge:** map every legacy name still used across the app to the
  new tokens so existing CSS keeps working — `--surface: var(--panel)`,
  `--surface-2: var(--panel)` (revisit per-section), `--border: var(--w8)`,
  `--text-muted: var(--m1)`, `--accent-soft: rgba(46,230,192,.12)`,
  `--radius-card: 15px`, `--radius-control: 11px`, keep spacing/control-height
  scale as-is. (grep confirms consumers: `--surface`, `--surface-2`,
  `--border`, `--text-muted`, `--accent-soft`, `--success/danger/warning`.)
- [ ] `global.css`: add `[data-theme] * { transition: background-color .35s
  ease, border-color .35s ease, color .35s ease }`; set body `font-family:
  var(--font-sans)`.
- [ ] `ThemeProvider`: context holding `'dark'|'light'`, defaults to stored
  value → else `prefers-color-scheme` → else dark; writes `data-theme` on
  `document.documentElement`; persists to `localStorage('uwled.theme')`.
  Export `useTheme()` → `{ theme, toggle, setTheme }`. Wrap `<App/>` in
  `main.tsx` inside the provider (above ToastProvider).
- [ ] Tests: update `tokens.test.ts` to assert the new palette (dark + a light
  spot-check); add `ThemeProvider.test.tsx` (default dark, toggle flips
  `data-theme`, persists to localStorage, honors stored value on mount).
- [ ] Verify: `npx tsc --noEmit`, `npx vitest run`, `npm run build` all green.

**Deliverable:** app renders in the new palette everywhere via aliases; theme
toggle works programmatically (UI toggle wired in Phase 2).

## Phase 1 — Shared UI-kit recipes

**Files:** `src/components/ui/ui.css` + each primitive's styles: `Button`,
`Card`, `Toggle`, `Slider`, `Chip`, `SegmentedControl`, `Modal`, `Toast`,
`IconButton`, `Field`, `Select`, plus a new `ListRow` recipe (CSS class, reuse
existing row markup). Tests in `src/test/components/ui/*`.

- [ ] Button: primary = `--accent` fill / `#04140f` text; secondary = `--w6`
  fill / `--text2` / `--w10` border; destructive = `#ff6b6b`. Radius 10–12.
- [ ] Card/panel: `--panel` bg, `1px solid var(--w6)` border, radius 15,
  padding 18–22, card shadow.
- [ ] Toggle: 44×25 track (`--accent` on / `--w12` off), 21px white knob, 0.2s.
- [ ] Slider (click-to-set): `--w9` track, accent fill to value, white knob,
  mono `%` readout; keep existing `(clientX−trackLeft)/trackWidth` logic.
- [ ] Chip/SegmentedControl: selected = accent text on `rgba(46,230,192,.12)` +
  accent border; unselected = `--text2` on `--w5`/`--w9` border; radius 9.
- [ ] Modal: backdrop `rgba(0,0,0,.55)` + blur, `--panel` sheet, radius 20,
  modal shadow, header title + ✕, click-backdrop-to-close (already present).
- [ ] Toast: `--toast` bg, accent dot, `--text`, slide-up+fade, ~2.6s dismiss.
- [ ] "Slider-as-progress" utility class for firmware/upload progress (accent
  fill over `--w9`; mono status text: `--accent` active / `--m3` idle /
  `#ff6b6b` error).
- [ ] Verify: component tests green; visual spot-check in Chrome (dev server).

## Phase 2 — App shell (rail, logo, master bar, bottom nav)

**Files:** `src/components/appshell.css`, `AppShell.tsx`, `Sidebar.tsx`,
`BottomNav.tsx`, master-bar markup (view header), `nav.ts`.

- [ ] Nav rail → 82px: centered icon + 9px label; active = `--accent` on
  `rgba(46,230,192,.12)`, radius 12; inactive = `--m2`. (Collapsed-rail mode
  from v1.18.1 can remain as an option, but the target rail is the labeled
  82px form — confirm with user during execution.)
- [ ] Lightbulb logo: illuminated (accent + glow) when ≥1 controller is on;
  unlit gray when all off. Wire to live status already in context.
- [ ] Master bar: view title (19/600) + mono subtitle · master brightness
  click-to-set slider · status pill · **sun/moon theme toggle** (wire to
  `useTheme().toggle`).
- [ ] Bottom nav (mobile <900px): restyle to new tokens.
- [ ] Verify: nav/appshell tests green; both themes visually correct in Chrome.

## Phase 3 — Mocked screens (match prototype exactly)

Read the prototype per-screen markup for exact layout before each.

- [ ] **Devices** (`sections/devices`): 2-col controller cards — name +
  chevron (opens deep control), mono IP·px, power toggle, live strip,
  click-to-set brightness, effect chip, ONLINE/OFF; off dims strip + mutes
  label.
- [ ] **Presets & Scenes / Effects** (`sections/themes` + control surface):
  live-preview cards, Save current look, Apply to all/N targets, delete on
  user presets; effects browser hero + Speed/Intensity/Palette + 3-col grid.
- [ ] **Segments editor** (`sections/layout`): per-zone effect/color/
  brightness/on-off, draggable boundary handles, Split/Merge — restyle only.
- [ ] **Schedule** (`sections/schedule`): time/label/days/action rows with
  enable toggles; dashed "New schedule" add row; keep Weekly/Calendar tabs and
  the v1 calendar overlay behavior.
- [ ] **Device deep-control modal** (`control/ControlSurface`, `ColorWheel`):
  power, live preview, conic color wheel, palette row, effect chips,
  brightness — new modal frame.
- [ ] (No Audio Reactive section exists in the app — N/A; skip.)
- [ ] Verify after each: that section's tests green; side-by-side vs prototype.

## Phase 4 — Home + un-mocked screens (recipe composition)

- [ ] **Home** (`sections/home`): reskin tiles as `--panel` cards with the new
  status dot / live strip / toggle / slider recipes; keep the v1.18 dynamic
  grid, sync-tile, and multi-select/edit behavior.
- [ ] **Firmware** (`sections/firmware`): `--panel` cards, mono version
  readouts, primary "Install/Update" + secondary "Check again", slider-as-
  progress bar with mono status during install.
- [ ] **Settings** (`sections/settings`): list-row recipe for each setting,
  cards for grouped blocks, three button styles, modal for dialogs; backup
  block styled as a card.
- [ ] **Sync** (`sections/sync`): list rows + cards; keep activate/member logic.
- [ ] Verify: all section tests green.

## Phase 5 — Live preview visual + behavior polish

**Files:** `components/ui/LiveOutputStrip.tsx`, `lib/liveOutputSwatches.ts`,
preview CSS; settings/persistence.

- [ ] Restyle `LiveOutputStrip` to the prototype look: dark housing both
  themes, glow via accent drop-shadow, dot spacing. **Feed real per-segment
  state** (already wired) — do not introduce the prototype's mock engine.
- [ ] Persist master brightness + last active view (localStorage or settings
  store), matching the theme persistence from Phase 0.
- [ ] Motion pass: theme fade, toast timing, preview rAF ~30fps consistent.
- [ ] Light-mode QA sweep across every screen; fix contrast/hardcoded-color
  regressions.

## Phase 6 — Remove aliases, release 2.0.0

- [ ] Migrate any remaining legacy-token usages to native new tokens; delete
  the alias bridge from `index.css`/`tokens.css`; `grep` confirms zero
  references to removed names.
- [ ] Full `npx tsc --noEmit` + `npx vitest run` green; update any snapshot/
  contract tests.
- [ ] Bump **server + client to 2.0.0**; revamp `README.md` (new look,
  theming, fonts); keep `design/` as the design source.
- [ ] Commit, push, **single deploy** to media-server, hard-reload, verify
  every screen in Chrome in **both** dark and light against the prototype.

---

## Risks / decisions to confirm during execution

1. **Nav rail form** — target is the labeled 82px rail; the app currently has a
   collapsible icon rail. Confirm whether to replace it or keep collapse as an
   option. (Default: adopt 82px labeled rail; revisit collapse after.)
2. **`--surface-2`** currently distinguishes nested surfaces; the new system
   has one `--panel`. Decide per-section whether nested surfaces use `--w4/w6`
   fills instead. (Default: nested = subtle `--w` fill over `--panel`.)
3. **Master brightness semantics** — the master bar slider implies a
   fleet-wide brightness. Confirm it maps to an existing "apply to all"
   action; if none exists cleanly, render it read-only/aggregate rather than
   inventing behavior (presentation-only rule).

## Self-review

- Spec coverage: every prototype "screen shown" (Devices, Effects, Segments,
  Presets, Schedule, deep-control modal) and every un-mocked screen (Firmware,
  Settings, Sync, Home) has a task; Audio is N/A (absent from app).
- No behavior changes: each phase is CSS/markup-structure + a theme layer;
  logic-bearing tasks (theme persistence, lightbulb-lit, master brightness)
  are flagged and constrained.
- Token consistency: new vocabulary defined once, legacy names bridged then
  removed — no dangling references at release.
