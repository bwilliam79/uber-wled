# Phase C — Client Foundation: Tokens, UI Kit, react-query, AppShell v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Ship the new design system (tokens + global styles + 15-component UI kit), self-hosted fonts, react-query wiring, and AppShell v2 (sidebar ≥900px / bottom nav <900px, 7 sections) while keeping every existing section building, testing, and running.

**Architecture:** All design values live in `client/src/design/tokens.css` (master-contract values, verbatim); `client/src/design/global.css` owns reset/body/focus/scrollbars; legacy `--color-*` variables become aliases onto the new tokens so untouched old sections instantly adopt the new palette. The UI kit is 15 standalone `.tsx` files under `client/src/components/ui/` sharing **one stylesheet `client/src/components/ui/ui.css`** (decision: single ui.css, not per-component files — one import, no cascade-ordering surprises, kit is small enough). AppShell v2 renders both a Sidebar and a BottomNav; a 900px CSS media query shows exactly one.

**Tech Stack:** React 19 + Vite + TypeScript (strict, `verbatimModuleSyntax`), Vitest + Testing Library (jsdom, setup at `client/src/test/setup.ts`), plain CSS (no UI framework). New deps this phase: `@tanstack/react-query`, `@jaames/iro` (installed now, consumed in Phase D), `@fontsource/plus-jakarta-sans`.

**Phase dependencies:** None (Phase C runs in parallel with Phase A). Nothing in this phase calls the new server routes.

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

## Phase-wide notes for implementers

- Repo root: `/Users/bwwilliams/github/uber-wled`. Client tests run as
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- <file>`.
- `tsconfig.app.json` has `noUnusedLocals`, `noUnusedParameters`,
  `verbatimModuleSyntax` — use `import type` for type-only imports and never
  leave dead imports.
- jsdom does not compute media queries or the CSS cascade. Responsive
  show/hide and track-fill styling are asserted at the *mechanism* level
  (class names, inline `style` custom properties) per the
  vitest-testing-gotchas skill; real-browser verification of both widths
  happens in Phase I's walkthrough.
- Mock `fetch` with `vi.stubGlobal('fetch', vi.fn(...))` (existing repo
  pattern in `client/src/test/AppShell.test.tsx`), never nock/undici.
- **Do NOT bump `client/package.json` `"version"`** in this phase (stays
  `0.8.2`; 1.0.0 happens in Phase I per master contract).

---

## Task 1 — Dependencies, self-hosted fonts, react-query provider

**Files:**
- Modify: `client/package.json` (deps added by npm install)
- Create: `client/src/api/queryClient.ts`
- Modify: `client/src/main.tsx` (full rewrite, currently 10 lines)
- Modify: `client/src/index.css` (delete line 1 — the Google Fonts `@import`)
- Test: `client/src/test/api/queryClient.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createQueryClient(): QueryClient` — defaults `staleTime: 15_000`, `refetchOnWindowFocus: false`, `retry: 1`. Every later phase's hooks inherit these defaults. Fonts: Plus Jakarta Sans weights 400/500/600/700 self-hosted (no CDN).

**Steps:**

- [ ] Write the failing test `client/src/test/api/queryClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createQueryClient } from '../../api/queryClient';

describe('createQueryClient', () => {
  it('sets LAN-friendly defaults: no focus refetch, 15s staleTime, single retry', () => {
    const qc = createQueryClient();
    const defaults = qc.getDefaultOptions().queries;
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.staleTime).toBe(15_000);
    expect(defaults?.retry).toBe(1);
  });
});
```

- [ ] Run it — expected FAIL (`Failed to resolve import "../../api/queryClient"`):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/queryClient.test.ts
```

- [ ] Install the three new deps (exact names from the master contract; no others):

```
cd /Users/bwwilliams/github/uber-wled/client && npm install @tanstack/react-query @jaames/iro @fontsource/plus-jakarta-sans
```

- [ ] Create `client/src/api/queryClient.ts`:

```ts
import { QueryClient } from '@tanstack/react-query';

/**
 * Single source of react-query defaults. The app is LAN-only and mostly
 * polling-driven, so window-focus refetches are noise; 15s staleTime keeps
 * section switches instant without hammering controllers.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: 1
      }
    }
  });
}
```

- [ ] Run the test again — expected PASS:

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/queryClient.test.ts
```

- [ ] Rewrite `client/src/main.tsx` (fonts first so `font-family` resolves immediately; provider wraps App):

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'
import App from './App.tsx'
import { createQueryClient } from './api/queryClient'

const queryClient = createQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] Delete line 1 of `client/src/index.css` (the entire
  `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans...');` line).
  `client/index.html` has no font `<link>` (verified — only the favicon link); no change needed there.

- [ ] Verify zero font-CDN references remain and everything still builds:

```
grep -rn "googleapis\|fonts.g" /Users/bwwilliams/github/uber-wled/client/src /Users/bwwilliams/github/uber-wled/client/index.html ; echo "exit=$?"
cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build
```

  Expected: grep exits 1 (no matches); full suite green; build succeeds.

- [ ] Commit:

```
cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "client: add react-query/iro/fontsource deps, self-host Plus Jakarta Sans, wire QueryClientProvider"
```

---

## Task 2 — Design tokens + global styles, index.css transition refactor

**Files:**
- Create: `client/src/design/tokens.css`
- Create: `client/src/design/global.css`
- Modify: `client/src/index.css` (replace lines 1–106 after Task 1's deletion — the `:root` block through the `:focus-visible` rule — with imports + legacy aliases; everything from `/* ---------- Layout primitives ---------- */` down stays byte-identical this task)
- Test: `client/src/test/design/tokens.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties per the master contract — `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-soft`, `--success`, `--danger`, `--warning`, `--radius-card`, `--radius-control` — plus `--font-sans`, `--space-xs/sm/md/lg/xl/2xl`, `--shadow-sm/md/lg`. Every later phase styles against these names only.

**Steps:**

- [ ] Write the failing test `client/src/test/design/tokens.test.ts` (locks the binding token values to the master contract — value drift fails CI):

```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('../../design/tokens.css', import.meta.url), 'utf-8');

describe('design tokens (master-plan binding contract)', () => {
  it.each([
    ['--bg', '#0B0F1A'],
    ['--surface', '#131A2A'],
    ['--surface-2', '#1A2338'],
    ['--border', 'rgba(148,163,184,.10)'],
    ['--text', '#E6EAF2'],
    ['--text-muted', '#8A94A8'],
    ['--accent', '#7C6CFF'],
    ['--accent-soft', 'rgba(124,108,255,.16)'],
    ['--success', '#22C55E'],
    ['--danger', '#EF4444'],
    ['--warning', '#F59E0B'],
    ['--radius-card', '16px'],
    ['--radius-control', '10px']
  ])('defines %s: %s', (name, value) => {
    expect(css).toContain(`${name}: ${value};`);
  });

  it('declares the Plus Jakarta Sans stack with a system-ui fallback', () => {
    expect(css).toContain("--font-sans: 'Plus Jakarta Sans', system-ui");
  });
});
```

- [ ] Run it — expected FAIL (`ENOENT ... design/tokens.css`):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/design/tokens.test.ts
```

- [ ] Create `client/src/design/tokens.css` (binding values copied VERBATIM from the master plan — do not reformat the color strings):

```css
/* ============================================================
   uber-wled design tokens — sleek smart-home direction.
   Binding values from docs/superpowers/plans/
   2026-07-04-control-plane-redesign/00-master.md — do not edit
   the color/radius values without updating the master contract.
   ============================================================ */

:root {
  /* Surfaces & text */
  --bg: #0B0F1A;
  --surface: #131A2A;
  --surface-2: #1A2338;
  --border: rgba(148,163,184,.10);
  --text: #E6EAF2;
  --text-muted: #8A94A8;

  /* Accent & status */
  --accent: #7C6CFF;
  --accent-soft: rgba(124,108,255,.16);
  --success: #22C55E;
  --danger: #EF4444;
  --warning: #F59E0B;

  /* Shape */
  --radius-card: 16px;
  --radius-control: 10px;

  /* Type — self-hosted via @fontsource (imported in main.tsx) */
  --font-sans: 'Plus Jakarta Sans', system-ui, 'Segoe UI', Roboto, sans-serif;

  /* Spacing scale (carried over — old sections depend on these names) */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  --space-2xl: 3rem;

  /* Elevation */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-md: 0 4px 10px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.45);
}
```

- [ ] Create `client/src/design/global.css`:

```css
/* Reset, base typography, focus ring, scrollbars. App-specific styles do
   NOT belong here — they live in section/component stylesheets. */

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  color-scheme: dark;
}

body {
  margin: 0;
  min-height: 100svh;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.5 var(--font-sans);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4 {
  margin: 0;
  color: var(--text);
}

p {
  margin: 0;
}

a {
  color: var(--accent);
}

button, input, select, textarea {
  font-family: var(--font-sans);
  font-size: 1rem;
  color: inherit;
}

button {
  cursor: pointer;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

/* Scrollbars: slim, surface-toned, invisible track */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--surface-2) transparent;
}

*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

*::-webkit-scrollbar-thumb {
  background: var(--surface-2);
  border-radius: 8px;
  border: 2px solid transparent;
  background-clip: content-box;
}

*::-webkit-scrollbar-track {
  background: transparent;
}
```

- [ ] In `client/src/index.css`, replace everything from the top of the file
  through the `:focus-visible { ... }` rule (i.e. the old `:root` variable
  block, the reduced-motion block, `* { box-sizing }`, `body`, `#root`,
  heading/p/a/button rules — after Task 1 this is lines 1–105) with the block
  below. **Everything from `/* ---------- Layout primitives ---------- */`
  onward is left untouched in this task.**

```css
@import './design/tokens.css';
@import './design/global.css';

/* ============================================================
   TRANSITION LAYER — everything below this banner is legacy
   app CSS kept alive until its owning phase (D–H) replaces the
   section that uses it. New code must style against tokens.css
   variables and the components/ui kit, never these aliases.
   ============================================================ */

:root {
  /* Legacy variable names remapped onto the new tokens so untouched
     sections pick up the new palette without edits. */
  --color-primary: var(--surface-2);
  --color-on-primary: #ffffff;
  --color-secondary: #334155;
  --color-accent: var(--accent);
  --color-accent-hover: #6A5BE6;
  --color-background: var(--bg);
  --color-surface: var(--surface);
  --color-foreground: var(--text);
  --color-foreground-muted: var(--text-muted);
  --color-muted: var(--surface-2);
  --color-border: rgba(148, 163, 184, 0.18);
  --color-destructive: var(--danger);
  --color-destructive-hover: #DC2626;
  --color-ring: var(--accent);

  --radius-sm: 6px;
  --radius-md: var(--radius-control);
  --radius-lg: var(--radius-card);
}

#root {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-xl) var(--space-lg);
}

/* Legacy heading treatment for old sections (Themes/Schedule/etc.). */
h1 {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

h2 {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: var(--space-sm);
}
```

- [ ] Run the tokens test — expected PASS:

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/design/tokens.test.ts
```

- [ ] Run the full suite + build (old sections must be unaffected structurally — only colors change):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build
```

- [ ] Commit:

```
cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "client: add design tokens + global styles, remap legacy CSS vars onto new palette"
```

---

## Task 3 — Icons + UI kit part 1: Button, IconButton, Card, Chip, Field, Skeleton

**Files:**
- Modify: `client/src/components/icons.tsx` (append 7 icons after `HomeIcon`, line 98)
- Create: `client/src/components/ui/ui.css`
- Create: `client/src/components/ui/Button.tsx`, `IconButton.tsx`, `Card.tsx`, `Chip.tsx`, `Field.tsx`, `Skeleton.tsx`, `index.ts`
- Modify: `client/src/index.css` (add `@import './components/ui/ui.css';` as the 3rd import line)
- Test: `client/src/test/components/ui/ui-basics.test.tsx`

**Interfaces:**
- Consumes: tokens from Task 2.
- Produces (exact signatures later phases import from `components/ui`):
  - `Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary'|'secondary'|'ghost'|'danger'; size?: 'md'|'sm' })`
  - `IconButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { label: string })` — `label` becomes `aria-label` + `title`
  - `Card(props: HTMLAttributes<HTMLDivElement>)`
  - `Chip({ children, variant?: 'default'|'accent'|'success'|'danger'|'warning', onRemove?: () => void })`
  - `Field({ label: string, hint?: string, error?: string, htmlFor?: string, children })`
  - `Skeleton({ width?: string, height?: string, radius?: string })`
  - Icons: `DownloadIcon, SearchIcon, XIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon` (all `{ className?: string }`, stroke-based, 24px grid, matching `strokeProps` at `icons.tsx:3`)

**Steps:**

- [ ] Write the failing test `client/src/test/components/ui/ui-basics.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, IconButton, Card, Chip, Field, Skeleton } from '../../../components/ui';
import { XIcon } from '../../../components/icons';

describe('Button', () => {
  it('defaults to type=button, secondary variant, md size', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.className).toContain('ui-btn-secondary');
    expect(btn.className).toContain('ui-btn-md');
  });

  it('applies variant/size classes and merges custom className', () => {
    render(<Button variant="danger" size="sm" className="extra">Delete</Button>);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn.className).toContain('ui-btn-danger');
    expect(btn.className).toContain('ui-btn-sm');
    expect(btn.className).toContain('extra');
  });
});

describe('IconButton', () => {
  it('exposes its label as accessible name', () => {
    render(<IconButton label="Close"><XIcon /></IconButton>);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

describe('Card', () => {
  it('renders children inside a ui-card and merges className', () => {
    render(<Card className="pad">hello</Card>);
    const el = screen.getByText('hello');
    expect(el.className).toContain('ui-card');
    expect(el.className).toContain('pad');
  });
});

describe('Chip', () => {
  it('renders a remove button only when onRemove is given', () => {
    const onRemove = vi.fn();
    const { rerender } = render(<Chip onRemove={onRemove}>Porch</Chip>);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    rerender(<Chip>Porch</Chip>);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

describe('Field', () => {
  it('associates the label and shows an error with role=alert', () => {
    render(
      <Field label="Host" htmlFor="host" error="Required">
        <input id="host" />
      </Field>
    );
    expect(screen.getByLabelText('Host')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Required');
  });
});

describe('Skeleton', () => {
  it('is aria-hidden and sized via inline style', () => {
    const { container } = render(<Skeleton width="120px" height="16px" />);
    const el = container.querySelector('.ui-skeleton') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('16px');
  });
});
```

- [ ] Run it — expected FAIL (`Failed to resolve import "../../../components/ui"`):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/ui-basics.test.tsx
```

- [ ] Append to `client/src/components/icons.tsx` (after `HomeIcon`, keeping the shared `strokeProps` pattern):

```tsx
export function DownloadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
```

- [ ] Create `client/src/components/ui/ui.css` (this file grows in Tasks 4–7; start with the shared header + part-1 styles):

```css
/* ============================================================
   uber-wled UI kit — single stylesheet for components/ui/*.
   Class contract: every component prefixes classes with `ui-`.
   ============================================================ */

/* ---------- Button ---------- */

.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.9375rem;
  border-radius: var(--radius-control);
  border: 1px solid transparent;
  padding: 0 18px;
  min-height: 44px;
  cursor: pointer;
  transition: background-color 180ms ease, border-color 180ms ease,
    color 180ms ease, opacity 180ms ease;
}

.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ui-btn-sm {
  min-height: 36px;
  padding: 0 12px;
  font-size: 0.875rem;
}

.ui-btn-primary {
  background: var(--accent);
  color: #ffffff;
}

.ui-btn-primary:hover:not(:disabled) {
  background: #6A5BE6;
}

.ui-btn-secondary {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--border);
}

.ui-btn-secondary:hover:not(:disabled) {
  border-color: var(--text-muted);
}

.ui-btn-ghost {
  background: transparent;
  color: var(--text-muted);
}

.ui-btn-ghost:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-2);
}

.ui-btn-danger {
  background: transparent;
  color: var(--danger);
  border-color: var(--danger);
}

.ui-btn-danger:hover:not(:disabled) {
  background: var(--danger);
  color: #ffffff;
}

.ui-btn svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* ---------- IconButton ---------- */

.ui-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-control);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 180ms ease, color 180ms ease;
}

.ui-iconbtn:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-2);
}

.ui-iconbtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ui-iconbtn svg {
  width: 20px;
  height: 20px;
}

/* ---------- Card ---------- */

.ui-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-lg);
}

/* ---------- Chip ---------- */

.ui-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  white-space: nowrap;
}

.ui-chip-accent {
  background: var(--accent-soft);
  color: var(--accent);
}

.ui-chip-success {
  background: rgba(34, 197, 94, 0.16);
  color: var(--success);
}

.ui-chip-danger {
  background: rgba(239, 68, 68, 0.16);
  color: #FCA5A5;
}

.ui-chip-warning {
  background: rgba(245, 158, 11, 0.16);
  color: var(--warning);
}

.ui-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ui-chip-remove:hover {
  background: rgba(148, 163, 184, 0.25);
}

.ui-chip-remove svg {
  width: 12px;
  height: 12px;
}

/* ---------- Field ---------- */

.ui-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ui-field-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.ui-field-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  opacity: 0.8;
}

.ui-field-error {
  font-size: 0.75rem;
  color: var(--danger);
}

/* ---------- Skeleton ---------- */

.ui-skeleton {
  display: inline-block;
  background: linear-gradient(
    90deg,
    var(--surface-2) 25%,
    rgba(148, 163, 184, 0.18) 50%,
    var(--surface-2) 75%
  );
  background-size: 200% 100%;
  animation: ui-shimmer 1.4s ease infinite;
}

@keyframes ui-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
```

- [ ] Create `client/src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  const cls = `ui-btn ui-btn-${variant} ui-btn-${size}${className ? ` ${className}` : ''}`;
  return <button type={type} className={cls} {...rest} />;
}
```

- [ ] Create `client/src/components/ui/IconButton.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; also shown as tooltip. */
  label: string;
}

export function IconButton({ label, className = '', type = 'button', ...rest }: IconButtonProps) {
  const cls = `ui-iconbtn${className ? ` ${className}` : ''}`;
  return <button type={type} aria-label={label} title={label} className={cls} {...rest} />;
}
```

- [ ] Create `client/src/components/ui/Card.tsx`:

```tsx
import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card${className ? ` ${className}` : ''}`} {...rest} />;
}
```

- [ ] Create `client/src/components/ui/Chip.tsx`:

```tsx
import type { ReactNode } from 'react';
import { XIcon } from '../icons';

export interface ChipProps {
  children: ReactNode;
  variant?: 'default' | 'accent' | 'success' | 'danger' | 'warning';
  onRemove?: () => void;
}

export function Chip({ children, variant = 'default', onRemove }: ChipProps) {
  const cls = `ui-chip${variant !== 'default' ? ` ui-chip-${variant}` : ''}`;
  return (
    <span className={cls}>
      {children}
      {onRemove && (
        <button type="button" className="ui-chip-remove" aria-label="Remove" onClick={onRemove}>
          <XIcon />
        </button>
      )}
    </span>
  );
}
```

- [ ] Create `client/src/components/ui/Field.tsx`:

```tsx
import type { ReactNode } from 'react';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** id of the wrapped control, for label association. */
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div className={`ui-field${error ? ' has-error' : ''}`}>
      <label className="ui-field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="ui-field-hint">{hint}</span>}
      {error && <span className="ui-field-error" role="alert">{error}</span>}
    </div>
  );
}
```

- [ ] Create `client/src/components/ui/Skeleton.tsx`:

```tsx
export interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
}

export function Skeleton({ width = '100%', height = '1rem', radius = 'var(--radius-control)' }: SkeletonProps) {
  return <span className="ui-skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius }} />;
}
```

- [ ] Create the barrel `client/src/components/ui/index.ts` (extended in Tasks 4–7):

```ts
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';
export { Card } from './Card';
export { Chip } from './Chip';
export type { ChipProps } from './Chip';
export { Field } from './Field';
export type { FieldProps } from './Field';
export { Skeleton } from './Skeleton';
export type { SkeletonProps } from './Skeleton';
```

- [ ] In `client/src/index.css` add the ui.css import directly under the two existing imports:

```css
@import './design/tokens.css';
@import './design/global.css';
@import './components/ui/ui.css';
```

- [ ] Run the test — expected PASS:

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/ui-basics.test.tsx
```

- [ ] Run full suite, then commit:

```
cd /Users/bwwilliams/github/uber-wled/client && npm test
cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "client: UI kit part 1 (Button, IconButton, Card, Chip, Field, Skeleton) + nav/kit icons"
```

---

## Task 4 — UI kit part 2: Slider (large touch target) + Toggle

**Files:**
- Create: `client/src/components/ui/Slider.tsx`, `client/src/components/ui/Toggle.tsx`
- Modify: `client/src/components/ui/ui.css` (append), `client/src/components/ui/index.ts` (append exports)
- Test: `client/src/test/components/ui/Slider.test.tsx`, `client/src/test/components/ui/Toggle.test.tsx`

**Interfaces:**
- Consumes: tokens (Task 2).
- Produces (Phase D's ControlSurface header/tabs depend on these exact props):

```ts
export interface SliderProps {
  value: number;
  min?: number;        // default 0
  max?: number;        // default 255 (WLED byte range)
  step?: number;       // default 1
  label: string;       // aria-label — required, sliders are icon-less
  disabled?: boolean;
  fillColor?: string;  // CSS color for the filled track; default var(--accent)
  onChange: (value: number) => void;   // every input event (drag/arrow)
  onCommit?: (value: number) => void;  // pointer release / arrow keyup — Phase D throttles writes on this
}
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;       // aria-label
  disabled?: boolean;
}
```

**Steps:**

- [ ] Write the failing test `client/src/test/components/ui/Slider.test.tsx`
  (values chosen so the fill % is exact; inline custom properties are asserted
  because jsdom cannot compute the cascade — the inline style *is* the
  mechanism that colors the track, per vitest-testing-gotchas):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Slider } from '../../../components/ui';

describe('Slider', () => {
  it('renders an accessible range input with the fill percentage as an inline custom property', () => {
    render(<Slider label="Brightness" value={51} min={0} max={255} onChange={() => {}} />);
    const input = screen.getByRole('slider', { name: 'Brightness' }) as HTMLInputElement;
    expect(input.value).toBe('51');
    expect(input.min).toBe('0');
    expect(input.max).toBe('255');
    expect(input.style.getPropertyValue('--ui-slider-fill')).toBe('20%');
    expect(input.className).toContain('ui-slider');
  });

  it('passes a custom fill color through as --ui-slider-color', () => {
    render(<Slider label="Red" value={0} max={255} fillColor="#ff0000" onChange={() => {}} />);
    const input = screen.getByRole('slider', { name: 'Red' });
    expect(input.style.getPropertyValue('--ui-slider-color')).toBe('#ff0000');
  });

  it('emits numeric onChange for every input and onCommit on pointer release', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Slider label="Brightness" value={51} max={255} onChange={onChange} onCommit={onCommit} />);
    const input = screen.getByRole('slider', { name: 'Brightness' });
    fireEvent.change(input, { target: { value: '200' } });
    expect(onChange).toHaveBeenCalledWith(200);
    fireEvent.pointerUp(input);
    expect(onCommit).toHaveBeenCalledWith(51); // controlled value at release time
  });

  it('emits onCommit when an arrow key is released (keyboard operation)', () => {
    const onCommit = vi.fn();
    render(<Slider label="Brightness" value={51} max={255} onChange={() => {}} onCommit={onCommit} />);
    fireEvent.keyUp(screen.getByRole('slider', { name: 'Brightness' }), { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledWith(51);
    fireEvent.keyUp(screen.getByRole('slider', { name: 'Brightness' }), { key: 'a' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Write the failing test `client/src/test/components/ui/Toggle.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from '../../../components/ui';

describe('Toggle', () => {
  it('is a switch with aria-checked reflecting state', () => {
    const { rerender } = render(<Toggle label="Power" checked={false} onChange={() => {}} />);
    const sw = screen.getByRole('switch', { name: 'Power' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    rerender(<Toggle label="Power" checked onChange={() => {}} />);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.className).toContain('on');
  });

  it('reports the inverted value on click', () => {
    const onChange = vi.fn();
    render(<Toggle label="Power" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Power' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing when disabled', () => {
    const onChange = vi.fn();
    render(<Toggle label="Power" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Power' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] Run both — expected FAIL (`"Slider" is not exported` / `"Toggle" is not exported` from the barrel):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/Slider.test.tsx src/test/components/ui/Toggle.test.tsx
```

- [ ] Create `client/src/components/ui/Slider.tsx` (native range input = free
  keyboard arrows + `role=slider` aria; the 40px hit area and track fill are
  CSS contract below):

```tsx
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  disabled?: boolean;
  fillColor?: string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}

const COMMIT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

export function Slider({
  value, min = 0, max = 255, step = 1, label, disabled, fillColor, onChange, onCommit
}: SliderProps) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const style = {
    '--ui-slider-fill': `${pct}%`,
    '--ui-slider-color': fillColor ?? 'var(--accent)'
  } as CSSProperties;

  function handlePointerUp(e: PointerEvent<HTMLInputElement>) {
    onCommit?.(Number(e.currentTarget.value));
  }

  function handleKeyUp(e: KeyboardEvent<HTMLInputElement>) {
    if (COMMIT_KEYS.includes(e.key)) onCommit?.(Number(e.currentTarget.value));
  }

  return (
    <input
      type="range"
      className="ui-slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      style={style}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={handlePointerUp}
      onKeyUp={handleKeyUp}
    />
  );
}
```

- [ ] Create `client/src/components/ui/Toggle.tsx`:

```tsx
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`ui-toggle${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-toggle-thumb" />
    </button>
  );
}
```

- [ ] Append to `client/src/components/ui/ui.css` (40px input height = the
  touch hit area; the visible track is 8px, thumb 24px):

```css
/* ---------- Slider ---------- */

.ui-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 40px; /* touch hit area ≥ 40px — the track itself is 8px */
  margin: 0;
  background: transparent;
  cursor: pointer;
  --ui-slider-fill: 0%;
  --ui-slider-color: var(--accent);
}

.ui-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ui-slider::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--ui-slider-color) var(--ui-slider-fill),
    var(--surface-2) var(--ui-slider-fill)
  );
}

.ui-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 24px;
  height: 24px;
  margin-top: -8px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid var(--ui-slider-color);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

.ui-slider::-moz-range-track {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-2);
}

.ui-slider::-moz-range-progress {
  height: 8px;
  border-radius: 999px;
  background: var(--ui-slider-color);
}

.ui-slider::-moz-range-thumb {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid var(--ui-slider-color);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

/* ---------- Toggle ---------- */

.ui-toggle {
  position: relative;
  width: 64px;
  height: 40px; /* touch target ≥ 40px */
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  padding: 0;
  cursor: pointer;
  transition: background-color 180ms ease, border-color 180ms ease;
}

.ui-toggle.on {
  background: var(--accent);
  border-color: var(--accent);
}

.ui-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ui-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 4px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  transition: transform 180ms ease;
}

.ui-toggle.on .ui-toggle-thumb {
  transform: translateX(22px);
}
```

- [ ] Append to `client/src/components/ui/index.ts`:

```ts
export { Slider } from './Slider';
export type { SliderProps } from './Slider';
export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';
```

- [ ] Run both tests — expected PASS; then full suite; commit:

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/Slider.test.tsx src/test/components/ui/Toggle.test.tsx
cd /Users/bwwilliams/github/uber-wled/client && npm test
cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "client: UI kit Slider (40px touch target, colored fill, commit events) + Toggle"
```

---

## Task 5 — UI kit part 3: Tabs, SegmentedControl, SearchInput, Select

**Files:**
- Create: `client/src/components/ui/Tabs.tsx`, `SegmentedControl.tsx`, `SearchInput.tsx`, `Select.tsx`
- Modify: `client/src/components/ui/ui.css` (append), `client/src/components/ui/index.ts` (append)
- Test: `client/src/test/components/ui/Tabs.test.tsx`, `client/src/test/components/ui/pickers.test.tsx`

**Interfaces:**
- Consumes: icons from Task 3 (`SearchIcon`, `XIcon`, `ChevronDownIcon`).
- Produces (Phase D tabs and effect/palette search consume these):

```ts
export interface TabDef { id: string; label: string }
Tabs({ tabs: TabDef[]; active: string; onChange(id: string): void; label?: string })
export interface SegmentOption { value: string; label: string }
SegmentedControl({ options: SegmentOption[]; value: string; onChange(v: string): void; label: string })
SearchInput({ value: string; onChange(v: string): void; placeholder?: string; label?: string })
export interface SelectOption { value: string; label: string }
Select({ value: string; onChange(v: string): void; options: SelectOption[]; label?: string; id?: string; disabled?: boolean })
```

**Steps:**

- [ ] Write the failing test `client/src/test/components/ui/Tabs.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../../../components/ui';

const TABS = [
  { id: 'colors', label: 'Colors' },
  { id: 'effects', label: 'Effects' },
  { id: 'palettes', label: 'Palettes' }
];

describe('Tabs', () => {
  it('renders a tablist and marks the active tab selected with roving tabindex', () => {
    render(<Tabs tabs={TABS} active="effects" onChange={() => {}} label="Control tabs" />);
    expect(screen.getByRole('tablist', { name: 'Control tabs' })).toBeTruthy();
    const active = screen.getByRole('tab', { name: 'Effects' });
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.tabIndex).toBe(0);
    const inactive = screen.getByRole('tab', { name: 'Colors' });
    expect(inactive.getAttribute('aria-selected')).toBe('false');
    expect(inactive.tabIndex).toBe(-1);
  });

  it('changes tab on click', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="colors" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Palettes' }));
    expect(onChange).toHaveBeenCalledWith('palettes');
  });

  it('moves with ArrowRight/ArrowLeft and wraps at the ends', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="palettes" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Palettes' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('colors'); // wraps
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Palettes' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('effects');
  });
});
```

- [ ] Write the failing test `client/src/test/components/ui/pickers.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl, SearchInput, Select } from '../../../components/ui';

describe('SegmentedControl', () => {
  const OPTS = [
    { value: 'controller', label: 'Whole controller' },
    { value: 'segment', label: 'Segment' }
  ];

  it('renders a radiogroup with aria-checked on the active option', () => {
    render(<SegmentedControl options={OPTS} value="segment" onChange={() => {}} label="Target kind" />);
    expect(screen.getByRole('radiogroup', { name: 'Target kind' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Segment' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Whole controller' }).getAttribute('aria-checked')).toBe('false');
  });

  it('emits the clicked value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTS} value="segment" onChange={onChange} label="Target kind" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Whole controller' }));
    expect(onChange).toHaveBeenCalledWith('controller');
  });
});

describe('SearchInput', () => {
  it('emits typed text and clears via the clear button', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchInput value="" onChange={onChange} label="Search effects" />);
    const box = screen.getByRole('searchbox', { name: 'Search effects' });
    fireEvent.change(box, { target: { value: 'rainbow' } });
    expect(onChange).toHaveBeenCalledWith('rainbow');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    rerender(<SearchInput value="rainbow" onChange={onChange} label="Search effects" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('Select', () => {
  it('renders options and emits the chosen value', () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Mode"
        value="a"
        onChange={onChange}
        options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]}
      />
    );
    const select = screen.getByRole('combobox', { name: 'Mode' }) as HTMLSelectElement;
    expect(select.value).toBe('a');
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
```

- [ ] Run both — expected FAIL (missing exports from the barrel):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/Tabs.test.tsx src/test/components/ui/pickers.test.tsx
```

- [ ] Create `client/src/components/ui/Tabs.tsx`:

```tsx
import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface TabDef {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  label?: string;
}

export function Tabs({ tabs, active, onChange, label }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (index + dir + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  }

  return (
    <div role="tablist" aria-label={label} className="ui-tabs">
      {tabs.map((tab, i) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`ui-tab${isActive ? ' active' : ''}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] Create `client/src/components/ui/SegmentedControl.tsx`:

```tsx
export interface SegmentOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}

export function SegmentedControl({ options, value, onChange, label }: SegmentedControlProps) {
  return (
    <div role="radiogroup" aria-label={label} className="ui-segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          className={`ui-segment${opt.value === value ? ' active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] Create `client/src/components/ui/SearchInput.tsx`:

```tsx
import { SearchIcon, XIcon } from '../icons';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search', label = 'Search' }: SearchInputProps) {
  return (
    <div className="ui-search">
      <SearchIcon className="ui-search-icon" />
      <input
        type="search"
        className="ui-search-input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== '' && (
        <button type="button" className="ui-search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <XIcon />
        </button>
      )}
    </div>
  );
}
```

- [ ] Create `client/src/components/ui/Select.tsx`:

```tsx
import { ChevronDownIcon } from '../icons';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  id?: string;
  disabled?: boolean;
}

export function Select({ value, onChange, options, label, id, disabled }: SelectProps) {
  return (
    <div className="ui-select-wrap">
      <select
        id={id}
        className="ui-select"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <ChevronDownIcon className="ui-select-chevron" />
    </div>
  );
}
```

- [ ] Append to `client/src/components/ui/ui.css`:

```css
/* ---------- Tabs ---------- */

.ui-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}

.ui-tab {
  padding: 10px 14px;
  min-height: 44px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  transition: color 180ms ease, border-color 180ms ease;
}

.ui-tab:hover {
  color: var(--text);
}

.ui-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* ---------- SegmentedControl ---------- */

.ui-segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}

.ui-segment {
  min-height: 34px;
  padding: 0 12px;
  border: none;
  border-radius: calc(var(--radius-control) - 3px);
  background: transparent;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background-color 180ms ease, color 180ms ease;
}

.ui-segment.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
}

/* ---------- SearchInput ---------- */

.ui-search {
  position: relative;
  display: flex;
  align-items: center;
}

.ui-search-icon {
  position: absolute;
  left: 12px;
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
}

.ui-search-input {
  width: 100%;
  min-height: 44px;
  padding: 0 40px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  color: var(--text);
}

.ui-search-input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.ui-search-input::placeholder {
  color: var(--text-muted);
}

.ui-search-clear {
  position: absolute;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.ui-search-clear:hover {
  color: var(--text);
  background: var(--surface-2);
}

.ui-search-clear svg {
  width: 14px;
  height: 14px;
}

/* ---------- Select ---------- */

.ui-select-wrap {
  position: relative;
  display: flex;
}

.ui-select {
  width: 100%;
  min-height: 44px;
  padding: 0 36px 0 12px;
  appearance: none;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  color: var(--text);
  cursor: pointer;
}

.ui-select:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.ui-select-chevron {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
}
```

- [ ] Append to `client/src/components/ui/index.ts`:

```ts
export { Tabs } from './Tabs';
export type { TabsProps, TabDef } from './Tabs';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentOption } from './SegmentedControl';
export { SearchInput } from './SearchInput';
export type { SearchInputProps } from './SearchInput';
export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';
```

- [ ] Run both tests — expected PASS; full suite; commit:

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/Tabs.test.tsx src/test/components/ui/pickers.test.tsx
cd /Users/bwwilliams/github/uber-wled/client && npm test
cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "client: UI kit Tabs, SegmentedControl, SearchInput, Select with keyboard + aria semantics"
```

---

## Task 6 — UI kit part 4: Modal (focus trap) + Drawer (slide-over / bottom sheet)

**Files:**
- Create: `client/src/components/ui/modalBehavior.ts`, `client/src/components/ui/Modal.tsx`, `client/src/components/ui/Drawer.tsx`
- Modify: `client/src/components/ui/ui.css` (append), `client/src/components/ui/index.ts` (append)
- Test: `client/src/test/components/ui/Modal.test.tsx`, `client/src/test/components/ui/Drawer.test.tsx`

**Interfaces:**
- Consumes: `IconButton` (Task 3), `XIcon` (Task 3).
- Produces (Phase D's ControlSurface mounts into `Drawer`; Phase F's config diff-confirm uses `Modal`):

```ts
ModalProps  { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }
DrawerProps { open: boolean; onClose: () => void; title?: string; children: ReactNode; className?: string }
// Drawer CSS contract: ≥900px → right slide-over, width min(480px, 100vw);
// <900px → full-height bottom sheet (rounded top corners). Same DOM both ways.
```

**Steps:**

- [ ] Write the failing test `client/src/test/components/ui/Modal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../../../components/ui';

function renderModal(onClose = vi.fn()) {
  render(
    <Modal open onClose={onClose} title="Confirm delete" footer={<button>OK</button>}>
      <button>body action</button>
    </Modal>
  );
  return onClose;
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden">x</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog and moves focus to its first focusable element', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Confirm delete' })).toBeTruthy();
    // header close button is the first focusable in DOM order
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Close');
  });

  it('traps Tab: forward from last wraps to first, Shift+Tab from first wraps to last', () => {
    renderModal();
    const ok = screen.getByRole('button', { name: 'OK' });
    ok.focus();
    fireEvent.keyDown(ok, { key: 'Tab' });
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Close');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ok);
  });

  it('closes on Escape and on overlay click, but not on panel click', () => {
    const onClose = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.ui-overlay') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] Write the failing test `client/src/test/components/ui/Drawer.test.tsx`
  (jsdom cannot flip the 900px media query — side-vs-sheet is a CSS contract
  verified in Phase I's browser walkthrough; here we verify structure and
  dismissal behavior):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Drawer } from '../../../components/ui';

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    render(<Drawer open={false} onClose={() => {}} title="Control">x</Drawer>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog panel inside the drawer overlay with a scrollable body', () => {
    render(<Drawer open onClose={() => {}} title="Control">content</Drawer>);
    const dialog = screen.getByRole('dialog', { name: 'Control' });
    expect(dialog.className).toContain('ui-drawer');
    expect(document.querySelector('.ui-overlay.ui-overlay-drawer')).toBeTruthy();
    expect(document.querySelector('.ui-drawer-body')?.textContent).toBe('content');
  });

  it('omits the header when no title is given (host renders its own)', () => {
    render(<Drawer open onClose={() => {}}>content</Drawer>);
    expect(document.querySelector('.ui-drawer-head')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Panel' })).toBeTruthy();
  });

  it('closes on Escape and overlay click, but not on panel click', () => {
    const onClose = vi.fn();
    render(<Drawer open onClose={onClose} title="Control">content</Drawer>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.ui-overlay-drawer') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] Run both — expected FAIL (missing exports):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/Modal.test.tsx src/test/components/ui/Drawer.test.tsx
```

- [ ] Create `client/src/components/ui/modalBehavior.ts` (shared by Modal and Drawer — DRY):

```ts
import { useEffect } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog behavior: focus the first focusable element on open, trap
 * Tab inside the panel, close on Escape, restore focus on unmount/close.
 */
export function useModalBehavior(
  panelRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose, panelRef]);
}
```

- [ ] Create `client/src/components/ui/Modal.tsx`:

```tsx
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { XIcon } from '../icons';
import { useModalBehavior } from './modalBehavior';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalBehavior(panelRef, open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="ui-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-modal-head">
          <h3 className="ui-modal-title">{title}</h3>
          <IconButton label="Close" onClick={onClose}><XIcon /></IconButton>
        </div>
        <div className="ui-modal-body">{children}</div>
        {footer !== undefined && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
```

- [ ] Create `client/src/components/ui/Drawer.tsx`:

```tsx
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { XIcon } from '../icons';
import { useModalBehavior } from './modalBehavior';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** When omitted, no header is rendered — the host owns the full body (Phase D ControlSurface). */
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, title, children, className }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalBehavior(panelRef, open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="ui-overlay ui-overlay-drawer" onClick={onClose}>
      <div
        ref={panelRef}
        className={`ui-drawer${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Panel'}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="ui-drawer-head">
            <h3 className="ui-drawer-title">{title}</h3>
            <IconButton label="Close" onClick={onClose}><XIcon /></IconButton>
          </div>
        )}
        <div className="ui-drawer-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] Append to `client/src/components/ui/ui.css`:

```css
/* ---------- Overlay (shared by Modal & Drawer) ---------- */

.ui-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
  background: rgba(4, 7, 14, 0.66);
  backdrop-filter: blur(3px);
}

/* ---------- Modal ---------- */

.ui-modal {
  width: 100%;
  max-width: 480px;
  max-height: min(85svh, 720px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lg);
}

.ui-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
}

.ui-modal-title {
  font-size: 1.0625rem;
  font-weight: 700;
}

.ui-modal-body {
  padding: var(--space-lg);
  overflow-y: auto;
}

.ui-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border);
}

/* ---------- Drawer: right slide-over ≥900px, bottom sheet <900px ---------- */

.ui-overlay.ui-overlay-drawer {
  padding: 0;
  align-items: stretch;
  justify-content: flex-end;
}

.ui-drawer {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--border);
  width: min(480px, 100vw);
  height: 100%;
  animation: ui-drawer-in-right 200ms ease;
}

.ui-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
}

.ui-drawer-title {
  font-size: 1.0625rem;
  font-weight: 700;
}

.ui-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-lg);
}

@keyframes ui-drawer-in-right {
  from { transform: translateX(32px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes ui-drawer-in-up {
  from { transform: translateY(48px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (max-width: 899px) {
  .ui-overlay.ui-overlay-drawer {
    align-items: flex-end;
    justify-content: stretch;
  }

  .ui-drawer {
    width: 100%;
    height: calc(100svh - env(safe-area-inset-top, 0px));
    border-left: none;
    border-top: 1px solid var(--border);
    border-radius: var(--radius-card) var(--radius-card) 0 0;
    animation: ui-drawer-in-up 240ms ease;
  }
}
```

- [ ] Append to `client/src/components/ui/index.ts`:

```ts
export { Modal } from './Modal';
export type { ModalProps } from './Modal';
export { Drawer } from './Drawer';
export type { DrawerProps } from './Drawer';
```

- [ ] Run both tests — expected PASS; full suite; commit:

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/Modal.test.tsx src/test/components/ui/Drawer.test.tsx
cd /Users/bwwilliams/github/uber-wled/client && npm test
cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "client: UI kit Modal (focus trap, Esc/overlay close) + Drawer (slide-over / bottom sheet)"
```

---

## Task 7 — UI kit part 5: Toast provider + useToast

**Files:**
- Create: `client/src/components/ui/Toast.tsx`
- Modify: `client/src/components/ui/ui.css` (append), `client/src/components/ui/index.ts` (append), `client/src/main.tsx` (wrap App in ToastProvider)
- Test: `client/src/test/components/ui/Toast.test.tsx`

**Interfaces:**
- Consumes: `XIcon` (Task 3).
- Produces (Phase D surfaces per-target apply failures through this API):

```ts
export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'info' | 'success' | 'error';  // default 'info'
  duration?: number;                        // ms; default 4000; 0 = sticky
  action?: { label: string; onClick: () => void };
}
ToastProvider({ children })   // mounted once in main.tsx
useToast(): { show(opts: ToastOptions): void }   // throws outside provider
```

**Steps:**

- [ ] Write the failing test `client/src/test/components/ui/Toast.test.tsx`
  (fake timers pair with direct unit renders — no real I/O beneath, per
  vitest-testing-gotchas; timer advance wrapped in `act`):

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../../../components/ui';

function Trigger({ duration }: { duration?: number }) {
  const { show } = useToast();
  return (
    <button onClick={() => show({ title: 'Applied to 3 targets', variant: 'success', duration })}>
      fire
    </button>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('shows a toast in the live region and auto-dismisses after the default 4s', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Applied to 3 targets')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText('Applied to 3 targets')).toBeNull();
  });

  it('keeps duration:0 toasts until manually dismissed', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger duration={0} /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText('Applied to 3 targets')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Applied to 3 targets')).toBeNull();
  });

  it('stacks multiple toasts', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getAllByText('Applied to 3 targets')).toHaveLength(2);
  });

  it('throws a clear error when useToast is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow('useToast must be used inside <ToastProvider>');
    spy.mockRestore();
  });
});
```

- [ ] Run it — expected FAIL (`"ToastProvider" is not exported`):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/Toast.test.tsx
```

- [ ] Create `client/src/components/ui/Toast.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from '../icons';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'info' | 'success' | 'error';
  /** ms; default 4000; 0 = sticky until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const DEFAULT_DURATION_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((opts: ToastOptions) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((prev) => [...prev, { ...opts, id }]);
    const duration = opts.duration ?? DEFAULT_DURATION_MS;
    if (duration > 0) setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="ui-toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`ui-toast ui-toast-${t.variant ?? 'info'}`}>
              <div className="ui-toast-content">
                <div className="ui-toast-title">{t.title}</div>
                {t.description && <div className="ui-toast-desc">{t.description}</div>}
                {t.action && (
                  <button
                    type="button"
                    className="ui-toast-action"
                    onClick={() => {
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button type="button" className="ui-toast-dismiss" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <XIcon />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
```

- [ ] Append to `client/src/components/ui/ui.css`:

```css
/* ---------- Toast ---------- */

.ui-toast-stack {
  position: fixed;
  z-index: 140;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 76px); /* clears the phone bottom nav */
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: min(420px, calc(100vw - 32px));
}

@media (min-width: 900px) {
  .ui-toast-stack {
    bottom: 24px;
    left: auto;
    right: 24px;
    transform: none;
  }
}

.ui-toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  box-shadow: var(--shadow-lg);
}

.ui-toast-success {
  border-color: rgba(34, 197, 94, 0.4);
}

.ui-toast-error {
  border-color: rgba(239, 68, 68, 0.5);
}

.ui-toast-content {
  flex: 1;
  min-width: 0;
}

.ui-toast-title {
  font-weight: 600;
  font-size: 0.9375rem;
}

.ui-toast-desc {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.ui-toast-action {
  background: none;
  border: none;
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  margin-top: 4px;
  font-size: 0.875rem;
}

.ui-toast-dismiss {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.ui-toast-dismiss svg {
  width: 14px;
  height: 14px;
}
```

- [ ] Append to `client/src/components/ui/index.ts`:

```ts
export { ToastProvider, useToast } from './Toast';
export type { ToastOptions } from './Toast';
```

- [ ] In `client/src/main.tsx`, wrap `<App />` with the provider (final render block):

```tsx
import { ToastProvider } from './components/ui'
```

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] Run the test — expected PASS; full suite; commit:

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/components/ui/Toast.test.tsx
cd /Users/bwwilliams/github/uber-wled/client && npm test
cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "client: UI kit Toast provider with useToast(), auto-dismiss, actions"
```

---

## Task 8 — AppShell v2: 7-section nav, Sidebar rewrite, BottomNav, react-query hooks

**Files:**
- Create: `client/src/components/nav.ts`, `client/src/components/BottomNav.tsx`, `client/src/components/appshell.css`, `client/src/api/queries.ts`
- Modify: `client/src/components/Sidebar.tsx` (full rewrite, currently 66 lines), `client/src/components/AppShell.tsx` (full rewrite, currently 82 lines), `client/src/index.css` (delete the old shell CSS block)
- Test: `client/src/test/AppShell.test.tsx` (full rewrite, currently 63 lines)

**Interfaces:**
- Consumes: `createQueryClient` (Task 1); icons incl. `DownloadIcon`, `ChevronLeftIcon`, `ChevronRightIcon` (Task 3); existing section components (`HomeSection`, `LayoutSection`, `ControllersSection`, `ThemeManager`, `ScheduleSection`, `FirmwareSection`, `SettingsSection`); `listControllers`/`getFirmwareStatus` from `client/src/api/client.ts:103,184`.
- Produces:
  - `SectionKey = 'home' | 'layout' | 'devices' | 'themes' | 'schedule' | 'firmware' | 'settings'` and `SECTIONS: { key: SectionKey; label: string; Icon }[]` from `components/nav.ts` — Phases E–H mount their rewritten sections against these keys.
  - `useControllers(): UseQueryResult<Controller[]>` (queryKey `['controllers']` — master contract key) and `useFirmwareUpdateAvailable(): boolean` (queryKey `['firmware-update-available']`, 60s refetch) from `api/queries.ts`. Later phases append more hooks to this file (`['capabilities', id]`, `['groups']`, `['themes']`, `['status']`, `['presets', id]`, `['config', id]`).
  - CSS contract: `.sidebar` visible ≥900px, `.bottom-nav` fixed bar visible <900px; `.app-main` gains bottom padding <900px so content clears the bar.
- Behavior notes: GroupManager is **removed from the nav** but `GroupManager.tsx` and its test stay untouched (deleted in Phase I after Home v2 ships room editing in Phase E). `ControllersSection` renders under `devices` until Phase F replaces it. Legacy hashes `#/controllers` → devices and `#/groups` → home.

**Steps:**

- [ ] Rewrite `client/src/test/AppShell.test.tsx` with the failing v2 spec:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '../components/AppShell';

const SEVEN = ['Home', 'Layout', 'Devices', 'Themes', 'Schedule', 'Firmware', 'Settings'];

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell />
    </QueryClientProvider>
  );
}

function stubFetchEmpty() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { window.location.hash = ''; });

describe('AppShell v2', () => {
  it('opens on Home and lists exactly the seven sections in the sidebar (no Groups)', async () => {
    stubFetchEmpty();
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    await waitFor(() =>
      expect(within(sidebar).getByRole('button', { name: /Home/ }).className).toContain('active')
    );
    for (const name of SEVEN) {
      expect(within(sidebar).getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
    expect(within(sidebar).queryByRole('button', { name: /Groups/ })).toBeNull();
    expect(within(sidebar).queryByRole('button', { name: /Controllers/ })).toBeNull();
    expect(within(sidebar).getByText(/^v\d+\.\d+\.\d+$/)).toBeTruthy();
  });

  it('renders a bottom navigation with the same seven sections', () => {
    stubFetchEmpty();
    renderShell();
    const bottom = screen.getByRole('navigation', { name: 'Bottom navigation' });
    for (const name of SEVEN) {
      expect(within(bottom).getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it('renders the existing Controllers screen under the Devices section', async () => {
    stubFetchEmpty();
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    fireEvent.click(within(sidebar).getByRole('button', { name: /Devices/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Controllers' })).toBeTruthy());
    expect(window.location.hash).toBe('#/devices');
  });

  it('maps the legacy #/controllers hash to Devices', async () => {
    window.location.hash = '#/controllers';
    stubFetchEmpty();
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    await waitFor(() =>
      expect(within(sidebar).getByRole('button', { name: /Devices/ }).className).toContain('active')
    );
  });

  it('switches to the Themes section when its nav item is clicked', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url === '/api/themes/effects-palettes') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ effects: [], palettes: [], sourceControllerId: null, sourceControllerName: null })
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    fireEvent.click(within(sidebar).getByRole('button', { name: /Themes/ }));
    await waitFor(() => expect(screen.getByText(/No custom themes yet/)).toBeTruthy());
  });

  it('shows a firmware badge in both navs when any controller has an update available', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url === '/api/controllers') {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }]
        });
      }
      if (typeof url === 'string' && url.endsWith('/firmware')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            installedVersion: '0.14.0', latestTag: 'v0.15.0', updateAvailable: true,
            isPrerelease: false, pinnedAssetPattern: 'ESP32', candidateAssets: []
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderShell();
    const sidebar = screen.getByRole('navigation', { name: 'Sections' });
    const bottom = screen.getByRole('navigation', { name: 'Bottom navigation' });
    await waitFor(() =>
      expect(within(sidebar).getByRole('button', { name: /Firmware/ }).querySelector('.sidebar-link-badge')).toBeTruthy()
    );
    expect(within(bottom).getByRole('button', { name: /Firmware/ }).querySelector('.sidebar-link-badge')).toBeTruthy();
    expect(within(sidebar).getByRole('button', { name: /Layout/ }).querySelector('.sidebar-link-badge')).toBeNull();
  });
});
```

- [ ] Run it — expected FAIL (`Unable to find ... name: /Devices/` — old shell still has 8 sections incl. Groups/Controllers, no bottom nav):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/AppShell.test.tsx
```

- [ ] Create `client/src/components/nav.ts`:

```ts
import type { ReactElement } from 'react';
import {
  HomeIcon, GridIcon, ChipIcon, PaletteIcon, CalendarIcon, DownloadIcon, GearIcon
} from './icons';

export type SectionKey = 'home' | 'layout' | 'devices' | 'themes' | 'schedule' | 'firmware' | 'settings';

type IconComp = (p: { className?: string }) => ReactElement;

/** The seven sections of the 1.0 IA. Order here is render order in both navs. */
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'home', label: 'Home', Icon: HomeIcon },
  { key: 'layout', label: 'Layout', Icon: GridIcon },
  { key: 'devices', label: 'Devices', Icon: ChipIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon },
  { key: 'schedule', label: 'Schedule', Icon: CalendarIcon },
  { key: 'firmware', label: 'Firmware', Icon: DownloadIcon },
  { key: 'settings', label: 'Settings', Icon: GearIcon }
];
```

- [ ] Rewrite `client/src/components/Sidebar.tsx` (SECTIONS moves to nav.ts; icon collapse toggle; version display preserved):

```tsx
import { SECTIONS, type SectionKey } from './nav';
import { LightbulbIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';

export function Sidebar({
  active,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  badges
}: {
  active: SectionKey;
  onNavigate: (s: SectionKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  badges?: Partial<Record<SectionKey, boolean>>;
}) {
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sections">
      <div className="sidebar-brand">
        <LightbulbIcon className="logo-mark" />
        <div className="sidebar-brand-info">
          <span className="sidebar-brand-text">uber-wled</span>
          <span className="sidebar-version">v{__APP_VERSION__}</span>
        </div>
      </div>
      <ul className="sidebar-nav">
        {SECTIONS.map(({ key, label, Icon }) => (
          <li key={key}>
            <button
              type="button"
              className={`sidebar-link${active === key ? ' active' : ''}`}
              aria-current={active === key ? 'page' : undefined}
              onClick={() => onNavigate(key)}
            >
              <span className="sidebar-link-icon-wrap">
                <Icon className="sidebar-link-icon" />
                {badges?.[key] && <span className="sidebar-link-badge" title="Update available" />}
              </span>
              <span className="sidebar-link-label">{label}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="sidebar-collapse-toggle"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
      </button>
    </nav>
  );
}
```

- [ ] Create `client/src/components/BottomNav.tsx` (icon-only items, label shown on the active item only; `aria-label` keeps every item nameable):

```tsx
import { SECTIONS, type SectionKey } from './nav';

export function BottomNav({
  active,
  onNavigate,
  badges
}: {
  active: SectionKey;
  onNavigate: (s: SectionKey) => void;
  badges?: Partial<Record<SectionKey, boolean>>;
}) {
  return (
    <nav className="bottom-nav" aria-label="Bottom navigation">
      {SECTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`bottom-nav-item${active === key ? ' active' : ''}`}
          aria-label={label}
          aria-current={active === key ? 'page' : undefined}
          onClick={() => onNavigate(key)}
        >
          <span className="bottom-nav-icon-wrap">
            <Icon className="bottom-nav-icon" />
            {badges?.[key] && <span className="sidebar-link-badge" title="Update available" />}
          </span>
          {active === key && <span className="bottom-nav-label">{label}</span>}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] Create `client/src/api/queries.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { listControllers, getFirmwareStatus, type Controller } from './client';

export function useControllers(): UseQueryResult<Controller[]> {
  return useQuery({ queryKey: ['controllers'], queryFn: listControllers });
}

const FIRMWARE_CHECK_INTERVAL_MS = 60_000;

/**
 * True when any controller reports an available firmware update.
 * Best-effort: unreachable controllers are ignored; errors keep the last value.
 */
export function useFirmwareUpdateAvailable(): boolean {
  const query = useQuery({
    queryKey: ['firmware-update-available'],
    queryFn: async () => {
      const controllers = await listControllers();
      const statuses = await Promise.all(
        controllers.map((c) => getFirmwareStatus(c.id).catch(() => null))
      );
      return statuses.some((s) => s?.updateAvailable);
    },
    refetchInterval: FIRMWARE_CHECK_INTERVAL_MS
  });
  return query.data ?? false;
}
```

- [ ] Rewrite `client/src/components/AppShell.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { SECTIONS, type SectionKey } from './nav';
import { HomeSection } from './HomeSection';
import { ControllersSection } from './ControllersSection';
import { ThemeManager } from './ThemeManager';
import { LayoutSection } from './LayoutSection';
import { ScheduleSection } from './ScheduleSection';
import { FirmwareSection } from './FirmwareSection';
import { SettingsSection } from './SettingsSection';
import { useFirmwareUpdateAvailable } from '../api/queries';
import './appshell.css';

const DEFAULT_SECTION: SectionKey = 'home';
const KEYS = SECTIONS.map((s) => s.key);

/** Pre-1.0 bookmarks keep working: Controllers became Devices; Groups folded into Home. */
const LEGACY_ALIASES: Record<string, SectionKey> = { controllers: 'devices', groups: 'home' };

function sectionFromHash(): SectionKey {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const mapped = LEGACY_ALIASES[raw] ?? raw;
  return (KEYS as string[]).includes(mapped) ? (mapped as SectionKey) : DEFAULT_SECTION;
}

export function AppShell() {
  const [active, setActive] = useState<SectionKey>(sectionFromHash());
  const [collapsed, setCollapsed] = useState(false);
  const firmwareUpdateAvailable = useFirmwareUpdateAvailable();

  useEffect(() => {
    const onHash = () => setActive(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function navigate(s: SectionKey) {
    window.location.hash = `#/${s}`;
    setActive(s);
  }

  const badges = { firmware: firmwareUpdateAvailable };

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        badges={badges}
      />
      <main className="app-main">
        {active === 'home' && <HomeSection />}
        {active === 'layout' && <LayoutSection />}
        {active === 'devices' && <ControllersSection />}
        {active === 'themes' && <ThemeManager />}
        {active === 'schedule' && <ScheduleSection />}
        {active === 'firmware' && <FirmwareSection />}
        {active === 'settings' && <SettingsSection />}
      </main>
      <BottomNav active={active} onNavigate={navigate} badges={badges} />
    </div>
  );
}
```

  (Note: `GroupManager` import is gone; the old inline firmware-polling
  `useEffect` at `AppShell.tsx:33-54` is replaced by `useFirmwareUpdateAvailable`.)

- [ ] Create `client/src/components/appshell.css`:

```css
/* ===== App shell v2: sidebar ≥900px, bottom nav <900px ===== */

.app-shell {
  display: flex;
  align-items: stretch;
  min-height: 100svh;
}

.app-main {
  flex: 1;
  min-width: 0;
  padding: var(--space-xl) var(--space-lg);
  max-width: 1200px;
}

/* ---------- Sidebar (desktop) ---------- */

.sidebar {
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100svh;
  width: 230px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-md);
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.sidebar.collapsed {
  width: 68px;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-xs);
  margin-bottom: var(--space-md);
}

.logo-mark {
  width: 30px;
  height: 30px;
  color: var(--accent);
  flex-shrink: 0;
}

.sidebar-brand-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sidebar-brand-text {
  font-weight: 700;
  letter-spacing: -0.01em;
}

.sidebar-version {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.sidebar.collapsed .sidebar-brand-text,
.sidebar.collapsed .sidebar-version,
.sidebar.collapsed .sidebar-link-label {
  display: none;
}

.sidebar-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: 0.625rem 0.75rem;
  min-height: 44px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-weight: 600;
  transition: background-color 180ms ease, color 180ms ease;
}

.sidebar-link:hover {
  color: var(--text);
  background: var(--surface-2);
}

.sidebar-link.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: rgba(124, 108, 255, 0.35);
}

.sidebar-link-icon-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.sidebar-link-icon {
  width: 20px;
  height: 20px;
}

.sidebar-link-badge {
  position: absolute;
  top: -2px;
  right: -3px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--warning);
  box-shadow: 0 0 0 2px var(--surface);
}

.sidebar-collapse-toggle {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  color: var(--text-muted);
  cursor: pointer;
}

.sidebar-collapse-toggle svg {
  width: 16px;
  height: 16px;
}

/* ---------- Bottom navigation (phone) ---------- */

.bottom-nav {
  display: none;
}

@media (max-width: 899px) {
  .sidebar {
    display: none;
  }

  .app-main {
    padding: var(--space-lg) var(--space-md)
      calc(72px + env(safe-area-inset-bottom, 0px) + var(--space-lg));
  }

  .bottom-nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: flex;
    align-items: stretch;
    justify-content: space-around;
    height: calc(64px + env(safe-area-inset-bottom, 0px));
    padding: 0 var(--space-xs) env(safe-area-inset-bottom, 0px);
    background: rgba(19, 26, 42, 0.92);
    backdrop-filter: blur(12px);
    border-top: 1px solid var(--border);
  }

  .bottom-nav-item {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 40px; /* touch target */
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
  }

  .bottom-nav-item.active {
    color: var(--accent);
  }

  .bottom-nav-icon-wrap {
    position: relative;
    display: inline-flex;
  }

  .bottom-nav-icon {
    width: 24px;
    height: 24px;
  }

  .bottom-nav-label {
    font-size: 0.625rem;
    font-weight: 600;
  }
}
```

- [ ] In `client/src/index.css`, delete the entire old shell block: from the
  comment line `/* ---------- App shell ---------- */` down to (and
  including) the closing brace of the `@media (max-width: 640px) { ... }`
  block that hides sidebar labels — i.e. everything between the end of the
  `/* ---------- Group members editor ---------- */` section and
  `/* ---------- Strip canvas (Layout) ---------- */` (lines 481–631 of the
  pre-phase file; line numbers will have shifted after Tasks 1–3, so cut by
  the banner comments, not by number). This removes the old
  `.app-shell`, `#root:has(.app-shell)`, `.sidebar*`, `.app-main` rules (all
  superseded by `appshell.css`). Also delete the `#root { max-width: 960px;
  margin: 0 auto; padding: ...; }` rule added in Task 2 and replace it with:

```css
#root {
  min-height: 100svh;
}
```

  (AppShell v2 owns page width via `.app-main`; the `:has()` special case dies with it.)

- [ ] Run the test — expected PASS:

```
cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/AppShell.test.tsx
```

- [ ] Run the full suite + build; then eyeball both widths against the dev
  server (sidebar at 1440px, bottom nav at 390px; all seven sections render;
  Devices shows the old Controllers screen):

```
cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build
```

- [ ] Commit:

```
cd /Users/bwwilliams/github/uber-wled && git add client && git commit -m "client: AppShell v2 — 7-section IA, Devices replaces Controllers, bottom nav <900px, react-query firmware badge"
```

---

## Task 9 — design-system/MASTER.md refresh + phase verification

**Files:**
- Modify: `design-system/MASTER.md` (full rewrite, currently 208 lines)

**Interfaces:**
- Consumes: token values from Task 2 (must match `client/src/design/tokens.css` exactly).
- Produces: the design reference later phases (D–H) read before styling; keeps the `pages/` override mechanism note from the current file (lines 3–5).

**Steps:**

- [ ] Replace the full contents of `design-system/MASTER.md` with:

```markdown
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
| Accent / interactive / brand | `#7C6CFF` | `--accent` |
| Accent wash (active backgrounds) | `rgba(124,108,255,.16)` | `--accent-soft` |
| Success | `#22C55E` | `--success` |
| Danger | `#EF4444` | `--danger` |
| Warning (update badges) | `#F59E0B` | `--warning` |

**Color Notes:** Deep dark surfaces with an electric indigo-violet accent.
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
```

- [ ] Verify the doc's token values match `client/src/design/tokens.css` (spot-check `--bg`, `--border`, `--accent-soft` strings), and that no CDN references survive anywhere in the client or design system:

```
grep -rn "googleapis\|fonts.gstatic" /Users/bwwilliams/github/uber-wled/client/src /Users/bwwilliams/github/uber-wled/client/index.html /Users/bwwilliams/github/uber-wled/design-system ; echo "exit=$?"
```

  Expected: exit=1 (no matches).

- [ ] Phase verification gate (master plan): both suites + client build green:

```
cd /Users/bwwilliams/github/uber-wled/server && npm test
cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build
```

- [ ] Commit:

```
cd /Users/bwwilliams/github/uber-wled && git add design-system && git commit -m "design-system: rewrite MASTER.md for sleek smart-home tokens, self-hosted type, ui kit contract"
```

---

## Done criteria (phase gate)

- `cd client && npm test` and `npm run build` green; `cd server && npm test` green.
- App runs with ALL existing sections working inside the new shell: Home,
  Layout, Devices (old Controllers screen), Themes, Schedule, Firmware,
  Settings; Groups reachable nowhere in the nav; `#/controllers` and
  `#/groups` hashes redirect.
- No `fonts.googleapis.com` anywhere in the client bundle
  (`grep -r googleapis client/dist` after build → no matches).
- 15 UI kit components exist at
  `client/src/components/ui/{Button,IconButton,Card,Slider,Toggle,Tabs,SegmentedControl,SearchInput,Select,Modal,Drawer,Toast,Chip,Field,Skeleton}.tsx`
  (master-contract paths, verbatim).
- Client version still `0.8.2` (1.0.0 is Phase I's job).
