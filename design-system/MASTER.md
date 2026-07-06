# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** uber-wled
**Updated:** 2026-07-04 (control-plane redesign — "sleek smart-home" direction)
**Category:** Smart Home / IoT Control Plane

Source of truth for values: `client/src/design/tokens.css` (this file mirrors
it; if they ever disagree, tokens.css wins and this file must be fixed).

---

## Global Rules

### Color Palette

| Role | Value | CSS Variable |
|------|-------|--------------|
| App background (near-black blue) | `#0B0F1A` | `--bg` |
| Raised card surface | `#131A2A` | `--surface` |
| Second-level surface (inputs, hover) | `#1A2338` | `--surface-2` |
| Hairline border | `rgba(148,163,184,.10)` | `--border` |
| Text | `#E6EAF2` | `--text` |
| Muted text | `#8A94A8` | `--text-muted` |
| Accent / interactive / brand | `#3B82F6` | `--accent` |
| Accent wash (active backgrounds) | `rgba(59,130,246,.16)` | `--accent-soft` |
| Success | `#22C55E` | `--success` |
| Danger | `#EF4444` | `--danger` |
| Warning (update badges) | `#F59E0B` | `--warning` |

**Color Notes:** Deep dark navy surfaces with a clean blue accent.
Dynamic glows on Home tiles and Layout strips use the **lights' actual live
colors**, never the static accent. Legacy `--color-*` variables still exist in
`client/src/index.css` as aliases for not-yet-rebuilt sections — never use
them in new code.

### Typography

- **Font:** Plus Jakarta Sans (headings and body), weights 400/500/600/700.
- **Hosting:** self-hosted via `@fontsource/plus-jakarta-sans`, imported in
  `client/src/main.tsx`. **No Google Fonts CDN — the app is LAN-only and must
  work with no internet.**
- **Stack:** `--font-sans: 'Plus Jakarta Sans', system-ui, 'Segoe UI', Roboto, sans-serif`
- Base: 16px/1.5. H1 1.75rem/700/-0.02em. Section titles 1.0625rem/700.
  Labels 0.8125rem/600 muted. Chips/badges 0.75rem/600.

### Shape & Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-card` | `16px` | Cards, tiles, modals, drawers |
| `--radius-control` | `10px` | Buttons, inputs, sliders, toggles |
| `--space-xs/sm/md/lg/xl/2xl` | 4/8/16/24/32/48px | Spacing scale |

Borders are 1px `var(--border)` on every raised surface. Shadows
(`--shadow-sm/md/lg`) are soft and dark; glow effects are reserved for live
light colors.

### Component Kit

All primitives live in `client/src/components/ui/` (single stylesheet
`ui.css`, classes prefixed `ui-`): Button, IconButton, Card, Slider (40px
touch target, colored track fill via `--ui-slider-fill`/`--ui-slider-color`),
Toggle (64×40 switch), Tabs, SegmentedControl, SearchInput, Select, Modal
(focus trap, Esc/overlay close), Drawer (right slide-over ≥900px, full-height
bottom sheet <900px), Toast (`useToast()`), Chip, Field, Skeleton.
**Do not hand-roll new buttons/inputs/dialogs — extend the kit.**

### Responsive & Navigation

- Breakpoint: **900px**. Desktop = left sidebar (collapsible, icons+labels).
  Phone = fixed bottom nav (7 items, icon-only, label on active item).
- Every screen must work at 390px and 1440px. Touch targets ≥ 40px.
- Icons: inline stroke SVGs from `client/src/components/icons.tsx`
  (24px grid, `stroke-width: 2`, round caps). No icon fonts, no emoji icons.

---

## Anti-Patterns (Do NOT Use)

- ❌ **Google Fonts / any CDN asset** — LAN-only app
- ❌ **Emojis as icons** — use the shared inline SVG set
- ❌ **Missing cursor:pointer** on clickable elements
- ❌ **Layout-shifting hovers** — no scale transforms that reflow
- ❌ **Low contrast text** — 4.5:1 minimum
- ❌ **Instant state changes** — transitions 150–300ms
- ❌ **Invisible focus states** — `:focus-visible` ring is global, don't remove it
- ❌ **New `--color-*` legacy variables** — tokens.css names only

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] Styled with tokens.css variables (`--bg`, `--surface`, `--accent`, ...) only
- [ ] Uses components/ui primitives instead of bespoke controls
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected (global rule covers animations/transitions)
- [ ] Responsive at 390px and 900px+ (bottom nav clearance on phone)
- [ ] Touch targets ≥ 40px
- [ ] No content hidden behind the fixed bottom nav
- [ ] No horizontal scroll on mobile
