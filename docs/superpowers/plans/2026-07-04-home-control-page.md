# Home Control Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Home" section that becomes the app's default route — one control tile per Group (room/scene) plus one tile per ungrouped controller, with live on/off + brightness status, power/brightness/theme controls, all built on existing APIs.

**Architecture:** Client-only change. A new pure helper computes each tile's aggregate status from live WLED segment snapshots (reusing the exact polling pattern `LayoutSection` already uses). A new presentational `HomeTile` component renders one tile's UI and forwards control actions. A new `HomeSection` container fetches Groups/Controllers/Themes, builds the tile list, runs the live-status poll, and wires actions to the existing `applyControl` API. Sidebar/AppShell gain a `'home'` section as the new default, ahead of `'layout'`.

**Tech Stack:** React + TypeScript (client), Vitest + Testing Library for tests. No server changes.

## Global Constraints

- No new backend endpoints, no data model changes — Groups are reused as-is per the design spec.
- Reuse the existing `getSegmentsSnapshot` + 5-second `setInterval` polling pattern from `LayoutSection.tsx` exactly (start on mount, `clearInterval` on unmount) — do not invent a different polling mechanism and do not use the separate 5-minute `controller_status` cache built earlier.
- Reuse existing CSS design tokens (`--color-*`, `--space-*`, `--radius-*`) and existing classes (`.card`, `.btn`, `.btn-secondary`, `.badge`, `.badge-stale`, `.empty-state`, `.field`, `.input`, `.controller-meta`) — do not introduce new color/spacing values.
- Brightness aggregation: average only over reachable members that are currently on; `null`/blank if none are on. A member is "offline" if its controller is missing from the latest snapshot map, or its specific `wledSegId` isn't present in that controller's segment list.
- An empty Group (zero members) still renders a tile, with all controls present but `disabled`, plus a hint paragraph — never hide the tile or silently no-op a control.
- Every new component file matches this codebase's existing file organization: `client/src/lib/` for pure helpers, `client/src/components/` for components, `client/src/test/` (and `client/src/test/lib/`, `client/src/test/components/`) for tests — mirroring existing sibling files exactly.

---

## Task 1: Tile status aggregation helper

**Files:**
- Create: `client/src/lib/tileStatus.ts`
- Test: `client/src/test/lib/tileStatus.test.ts`

**Interfaces:**
- Produces: `WledSegmentSnapshot` (matches the inline type already returned by `getSegmentsSnapshot` in `client/src/api/client.ts:189-192`), `TileMember` (`{ controllerId: string; wledSegId: number }`), `TileStatus` (`{ power: 'on' | 'off' | 'mixed' | 'unknown'; brightness: number | null; anyOffline: boolean }`), `aggregateTileStatus(members: TileMember[], snapshots: Map<string, WledSegmentSnapshot[]>): TileStatus` — Task 2 and Task 3 both import these.

- [ ] **Step 1: Write the failing test**

Create `client/src/test/lib/tileStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateTileStatus, type WledSegmentSnapshot } from '../../lib/tileStatus';

function seg(overrides: Partial<WledSegmentSnapshot> & { id: number }): WledSegmentSnapshot {
  return {
    start: 0, stop: 10, len: 10, on: true, bri: 128, fx: 0, pal: 0, col: [[255, 255, 255]],
    ...overrides
  };
}

describe('aggregateTileStatus', () => {
  it('reports "on" with the exact brightness when every member is on at the same level', () => {
    const snapshots = new Map([['c1', [seg({ id: 0, on: true, bri: 200 })]]]);
    const result = aggregateTileStatus([{ controllerId: 'c1', wledSegId: 0 }], snapshots);
    expect(result).toEqual({ power: 'on', brightness: 200, anyOffline: false });
  });

  it('reports "off" with null brightness when every member is off', () => {
    const snapshots = new Map([['c1', [seg({ id: 0, on: false, bri: 0 })]]]);
    const result = aggregateTileStatus([{ controllerId: 'c1', wledSegId: 0 }], snapshots);
    expect(result).toEqual({ power: 'off', brightness: null, anyOffline: false });
  });

  it('reports "mixed" and averages brightness across only the members that are on', () => {
    const snapshots = new Map([
      ['c1', [seg({ id: 0, on: true, bri: 100 })]],
      ['c2', [seg({ id: 0, on: false, bri: 0 })]]
    ]);
    const result = aggregateTileStatus(
      [{ controllerId: 'c1', wledSegId: 0 }, { controllerId: 'c2', wledSegId: 0 }],
      snapshots
    );
    expect(result).toEqual({ power: 'mixed', brightness: 100, anyOffline: false });
  });

  it('excludes a member whose controller is missing from the snapshot map and flags anyOffline', () => {
    const snapshots = new Map([['c1', [seg({ id: 0, on: true, bri: 150 })]]]);
    const result = aggregateTileStatus(
      [{ controllerId: 'c1', wledSegId: 0 }, { controllerId: 'c2', wledSegId: 0 }],
      snapshots
    );
    expect(result).toEqual({ power: 'on', brightness: 150, anyOffline: true });
  });

  it('excludes a member whose specific segment id is missing from its controller snapshot', () => {
    const snapshots = new Map([['c1', [seg({ id: 1, on: true, bri: 150 })]]]);
    const result = aggregateTileStatus([{ controllerId: 'c1', wledSegId: 0 }], snapshots);
    expect(result).toEqual({ power: 'unknown', brightness: null, anyOffline: true });
  });

  it('reports "unknown" with no offline flag when every reachable member is off and the rest are unreachable', () => {
    const snapshots = new Map<string, WledSegmentSnapshot[]>();
    const result = aggregateTileStatus([{ controllerId: 'c1', wledSegId: 0 }], snapshots);
    expect(result).toEqual({ power: 'unknown', brightness: null, anyOffline: true });
  });

  it('reports "unknown" with no offline flag for an empty member list', () => {
    const result = aggregateTileStatus([], new Map());
    expect(result).toEqual({ power: 'unknown', brightness: null, anyOffline: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/test/lib/tileStatus.test.ts`
Expected: FAIL — `Cannot find module '../../lib/tileStatus'`

- [ ] **Step 3: Write the implementation**

Create `client/src/lib/tileStatus.ts`:

```ts
export interface WledSegmentSnapshot {
  id: number;
  start: number;
  stop: number;
  len: number;
  on: boolean;
  bri: number;
  fx: number;
  pal: number;
  col: number[][];
}

export interface TileMember {
  controllerId: string;
  wledSegId: number;
}

export interface TileStatus {
  power: 'on' | 'off' | 'mixed' | 'unknown';
  brightness: number | null;
  anyOffline: boolean;
}

export function aggregateTileStatus(
  members: TileMember[],
  snapshots: Map<string, WledSegmentSnapshot[]>
): TileStatus {
  if (members.length === 0) {
    return { power: 'unknown', brightness: null, anyOffline: false };
  }

  let anyOffline = false;
  const reachableOnStates: boolean[] = [];
  const onBrightnesses: number[] = [];

  for (const member of members) {
    const segs = snapshots.get(member.controllerId);
    const seg = segs?.find((s) => s.id === member.wledSegId);
    if (!seg) {
      anyOffline = true;
      continue;
    }
    reachableOnStates.push(seg.on);
    if (seg.on) onBrightnesses.push(seg.bri);
  }

  if (reachableOnStates.length === 0) {
    return { power: 'unknown', brightness: null, anyOffline };
  }

  const allOn = reachableOnStates.every((on) => on);
  const allOff = reachableOnStates.every((on) => !on);
  const power = allOn ? 'on' : allOff ? 'off' : 'mixed';
  const brightness = onBrightnesses.length > 0
    ? Math.round(onBrightnesses.reduce((sum, b) => sum + b, 0) / onBrightnesses.length)
    : null;

  return { power, brightness, anyOffline };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/test/lib/tileStatus.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/tileStatus.ts client/src/test/lib/tileStatus.test.ts
git commit -m "Add pure tile-status aggregation helper for the Home page"
```

---

## Task 2: HomeTile component

**Files:**
- Create: `client/src/components/HomeTile.tsx`
- Modify: `client/src/index.css` (append new "Home tile" block)
- Test: `client/src/test/components/HomeTile.test.tsx`

**Interfaces:**
- Consumes: `TileMember`, `TileStatus` from `client/src/lib/tileStatus.ts` (Task 1); `CustomTheme`, `ControlAction` from `client/src/api/client.ts`.
- Produces: `HomeTile` component with props `{ id: string; title: string; members: TileMember[]; status: TileStatus; themes: CustomTheme[]; onApply: (action: ControlAction) => void }` — Task 3 renders this per tile.

- [ ] **Step 1: Write the failing test**

Create `client/src/test/components/HomeTile.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomeTile } from '../../components/HomeTile';

const MEMBERS = [{ controllerId: 'c1', wledSegId: 0 }];
const THEMES = [{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }];

describe('HomeTile', () => {
  it('shows the title and "on" status with brightness', () => {
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'on', brightness: 200, anyOffline: false }}
        themes={THEMES} onApply={vi.fn()}
      />
    );
    expect(screen.getByText('Kitchen')).toBeTruthy();
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByText('200 / 255')).toBeTruthy();
    expect(screen.queryByText('offline')).toBeNull();
  });

  it('shows "Mixed" and an offline badge when applicable', () => {
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'mixed', brightness: 100, anyOffline: true }}
        themes={THEMES} onApply={vi.fn()}
      />
    );
    expect(screen.getByText('Mixed')).toBeTruthy();
    expect(screen.getByText('offline')).toBeTruthy();
  });

  it('shows a dash and no brightness reading when status is unknown', () => {
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'unknown', brightness: null, anyOffline: true }}
        themes={THEMES} onApply={vi.fn()}
      />
    );
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText(/\/ 255/)).toBeNull();
  });

  it('calls onApply with power actions when On/Off are clicked', () => {
    const onApply = vi.fn();
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'off', brightness: null, anyOffline: false }}
        themes={THEMES} onApply={onApply}
      />
    );
    screen.getByText('On').click();
    expect(onApply).toHaveBeenCalledWith({ type: 'power', on: true });
    screen.getByText('Off').click();
    expect(onApply).toHaveBeenCalledWith({ type: 'power', on: false });
  });

  it('calls onApply with a brightness action when the slider changes', () => {
    const onApply = vi.fn();
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'on', brightness: 128, anyOffline: false }}
        themes={THEMES} onApply={onApply}
      />
    );
    const slider = screen.getByLabelText(/brightness for kitchen/i);
    fireEvent.change(slider, { target: { value: '75' } });
    expect(onApply).toHaveBeenCalledWith({ type: 'brightness', value: 75 });
  });

  it('calls onApply with a theme action and resets the select back to the placeholder', () => {
    const onApply = vi.fn();
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'on', brightness: 128, anyOffline: false }}
        themes={THEMES} onApply={onApply}
      />
    );
    const select = screen.getByLabelText(/apply theme to kitchen/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 't1' } });
    expect(onApply).toHaveBeenCalledWith({ type: 'theme', themeId: 't1' });
    expect(select.value).toBe('');
  });

  it('disables all controls and shows a hint when there are no members', () => {
    render(
      <HomeTile
        id="g1" title="Empty Room" members={[]}
        status={{ power: 'unknown', brightness: null, anyOffline: false }}
        themes={THEMES} onApply={vi.fn()}
      />
    );
    expect(screen.getByText(/Add members in Groups/)).toBeTruthy();
    expect((screen.getByText('On') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/brightness for empty room/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/apply theme to empty room/i) as HTMLSelectElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/test/components/HomeTile.test.tsx`
Expected: FAIL — `Cannot find module '../../components/HomeTile'`

- [ ] **Step 3: Write the implementation**

Create `client/src/components/HomeTile.tsx`:

```tsx
import type { CustomTheme, ControlAction } from '../api/client';
import type { TileMember, TileStatus } from '../lib/tileStatus';

const POWER_LABEL: Record<TileStatus['power'], string> = {
  on: 'On',
  off: 'Off',
  mixed: 'Mixed',
  unknown: '—'
};

export function HomeTile({
  id,
  title,
  members,
  status,
  themes,
  onApply
}: {
  id: string;
  title: string;
  members: TileMember[];
  status: TileStatus;
  themes: CustomTheme[];
  onApply: (action: ControlAction) => void;
}) {
  const disabled = members.length === 0;

  return (
    <div className="card home-tile">
      <div className="home-tile-header">
        <span className="home-tile-name">{title}</span>
        {status.anyOffline && <span className="badge badge-stale">offline</span>}
      </div>
      <div className="home-tile-status">
        <span className="controller-meta">{POWER_LABEL[status.power]}</span>
        {status.brightness !== null && (
          <span className="controller-meta">{status.brightness} / 255</span>
        )}
      </div>
      {disabled && <p className="empty-state">Add members in Groups to control this room.</p>}
      <div className="home-tile-buttons">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          onClick={() => onApply({ type: 'power', on: true })}
        >
          On
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          onClick={() => onApply({ type: 'power', on: false })}
        >
          Off
        </button>
      </div>
      <div className="field">
        <label htmlFor={`home-tile-brightness-${id}`}>Brightness</label>
        <input
          id={`home-tile-brightness-${id}`}
          type="range"
          aria-label={`brightness for ${title}`}
          min={0}
          max={255}
          disabled={disabled}
          onChange={(e) => onApply({ type: 'brightness', value: Number(e.target.value) })}
        />
      </div>
      <select
        aria-label={`apply theme to ${title}`}
        className="input"
        value=""
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value) onApply({ type: 'theme', themeId: e.target.value });
        }}
      >
        <option value="">Apply theme…</option>
        {themes.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/test/components/HomeTile.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Add Home tile CSS**

Read the end of `client/src/index.css` first (`tail -20 client/src/index.css`) to confirm the current end-of-file content, then append:

```css

/* ---------- Home tile ---------- */

.home-tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.home-tile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.home-tile-name {
  font-weight: 600;
  color: var(--color-foreground);
}

.home-tile-status {
  display: flex;
  gap: var(--space-sm);
}

.home-tile-buttons {
  display: flex;
  gap: var(--space-sm);
}
```

- [ ] **Step 6: Run the full client test suite to confirm no regressions**

Run: `cd client && npm test -- --run`
Expected: all test files pass

- [ ] **Step 7: Commit**

```bash
git add client/src/components/HomeTile.tsx client/src/test/components/HomeTile.test.tsx client/src/index.css
git commit -m "Add HomeTile component: per-tile power/brightness/theme controls"
```

---

## Task 3: HomeSection container

**Files:**
- Create: `client/src/components/HomeSection.tsx`
- Modify: `client/src/index.css` (append "Home section" block)
- Test: `client/src/test/HomeSection.test.tsx`

**Interfaces:**
- Consumes: `HomeTile` (Task 2); `aggregateTileStatus`, `TileMember` (Task 1); from `client/src/api/client.ts`: `listGroups`, `listControllers`, `listThemes`, `applyControl`, `getSegmentsSnapshot`, and types `Group`, `Controller`, `CustomTheme`, `ControlAction`.
- Produces: `HomeSection` component (no props) — Task 4 renders it in `AppShell`.

- [ ] **Step 1: Write the failing test**

Create `client/src/test/HomeSection.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { HomeSection } from '../components/HomeSection';

afterEach(() => vi.unstubAllGlobals());

const GROUPS = [{ id: 'g1', name: 'Kitchen', members: [{ controllerId: 'c1', wledSegId: 0 }] }];
const CONTROLLERS = [
  { id: 'c1', name: 'Kitchen Strip', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Porch Strip', host: '10.0.0.51', source: 'manual', stale: false, pinnedAssetPattern: null }
];
const SEG_ON = [{ id: 0, start: 0, stop: 10, len: 10, on: true, bri: 200, fx: 0, pal: 0, col: [[255, 255, 255]] }];

function stubFetch(segmentsByController: Record<string, unknown> = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/groups') return Promise.resolve({ ok: true, json: async () => GROUPS });
    if (url === '/api/controllers') return Promise.resolve({ ok: true, json: async () => CONTROLLERS });
    if (url === '/api/themes') return Promise.resolve({ ok: true, json: async () => [] });
    if (url === '/api/control/apply') return Promise.resolve({ ok: true, json: async () => ({ results: [] }) });
    const segMatch = url.match(/^\/api\/controllers\/(.+)\/segments$/);
    if (segMatch) {
      const segs = segmentsByController[segMatch[1]];
      if (segs === 'offline') return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: true, json: async () => segs ?? [] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('HomeSection', () => {
  it('renders one tile per group and one tile per ungrouped controller', async () => {
    stubFetch({ c1: SEG_ON, c2: [] });
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    expect(screen.getByText('Porch Strip')).toBeTruthy();
    expect(screen.getByText('Ungrouped')).toBeTruthy();
  });

  it('shows an empty state when there are no controllers at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText(/Add a controller in Controllers/)).toBeTruthy());
  });

  it('shows a banner suggesting Groups when controllers exist but no groups do', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/controllers') return Promise.resolve({ ok: true, json: async () => CONTROLLERS });
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText(/create one in Groups/i)).toBeTruthy());
  });

  it('applies a power action to a group tile with exactly that group\'s members', async () => {
    const fetchMock = stubFetch({ c1: SEG_ON, c2: [] });
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());

    const kitchenTile = screen.getByText('Kitchen').closest('.home-tile') as HTMLElement;
    fireEvent.click(within(kitchenTile).getByText('On'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/control/apply', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ members: [{ controllerId: 'c1', wledSegId: 0 }], action: { type: 'power', on: true } })
      }))
    );
  });

  it('shows an offline badge on a tile whose member controller is unreachable', async () => {
    stubFetch({ c1: 'offline', c2: [] });
    render(<HomeSection />);
    await waitFor(() => expect(screen.getByText('Kitchen')).toBeTruthy());
    const kitchenTile = screen.getByText('Kitchen').closest('.home-tile') as HTMLElement;
    await waitFor(() => expect(within(kitchenTile).getByText('offline')).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/test/HomeSection.test.tsx`
Expected: FAIL — `Cannot find module '../components/HomeSection'`

- [ ] **Step 3: Write the implementation**

Create `client/src/components/HomeSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  listGroups, listControllers, listThemes, applyControl, getSegmentsSnapshot,
  type Group, type Controller, type CustomTheme, type ControlAction
} from '../api/client';
import { HomeTile } from './HomeTile';
import { aggregateTileStatus, type TileMember, type WledSegmentSnapshot } from '../lib/tileStatus';

const POLL_INTERVAL_MS = 5000;

interface Tile {
  id: string;
  title: string;
  members: TileMember[];
}

export function HomeSection() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [snapshots, setSnapshots] = useState<Map<string, WledSegmentSnapshot[]>>(new Map());

  useEffect(() => {
    listGroups().then(setGroups);
    listControllers().then(setControllers);
    listThemes().then(setThemes);
  }, []);

  const refreshSnapshots = useCallback(async () => {
    const ids = new Set(controllers.map((c) => c.id));
    for (const g of groups) for (const m of g.members) ids.add(m.controllerId);

    const next = new Map<string, WledSegmentSnapshot[]>();
    await Promise.all(
      Array.from(ids).map(async (cid) => {
        try {
          next.set(cid, await getSegmentsSnapshot(cid));
        } catch {
          /* left absent from the map: aggregateTileStatus treats a missing entry as offline */
        }
      })
    );
    setSnapshots(next);
  }, [groups, controllers]);

  useEffect(() => {
    refreshSnapshots();
    const t = setInterval(refreshSnapshots, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refreshSnapshots]);

  async function handleApply(members: TileMember[], action: ControlAction) {
    await applyControl(members, action);
    refreshSnapshots();
  }

  if (controllers.length === 0) {
    return (
      <section className="section home-section">
        <h2>Home</h2>
        <p className="empty-state">Add a controller in Controllers to get started.</p>
      </section>
    );
  }

  const groupedControllerIds = new Set(groups.flatMap((g) => g.members.map((m) => m.controllerId)));

  const groupTiles: Tile[] = groups
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({ id: g.id, title: g.name, members: g.members }));

  const ungroupedTiles: Tile[] = controllers
    .filter((c) => !groupedControllerIds.has(c.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: `ungrouped:${c.id}`, title: c.name, members: [{ controllerId: c.id, wledSegId: 0 }] }));

  function renderTile(tile: Tile) {
    return (
      <HomeTile
        key={tile.id}
        id={tile.id}
        title={tile.title}
        members={tile.members}
        status={aggregateTileStatus(tile.members, snapshots)}
        themes={themes}
        onApply={(action) => handleApply(tile.members, action)}
      />
    );
  }

  return (
    <section className="section home-section">
      <h2>Home</h2>
      {groups.length === 0 && (
        <p className="home-banner">No groups yet — create one in Groups for room-based control.</p>
      )}
      <div className="home-grid">
        {groupTiles.map(renderTile)}
      </div>
      {ungroupedTiles.length > 0 && (
        <>
          <h3 className="home-ungrouped-heading">Ungrouped</h3>
          <div className="home-grid">
            {ungroupedTiles.map(renderTile)}
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/test/HomeSection.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Add Home section CSS**

Append to the end of `client/src/index.css` (after the Home tile block added in Task 2):

```css

/* ---------- Home section ---------- */

.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}

.home-banner {
  color: var(--color-foreground-muted);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
}

.home-ungrouped-heading {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--color-foreground-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: var(--space-lg) 0 var(--space-sm);
}
```

- [ ] **Step 6: Run the full client test suite to confirm no regressions**

Run: `cd client && npm test -- --run`
Expected: all test files pass

- [ ] **Step 7: Commit**

```bash
git add client/src/components/HomeSection.tsx client/src/test/HomeSection.test.tsx client/src/index.css
git commit -m "Add HomeSection container: tile grid, live status polling, empty states"
```

---

## Task 4: Wire Home into navigation as the new default section

**Files:**
- Modify: `client/src/components/icons.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/components/AppShell.tsx`
- Modify: `client/src/test/AppShell.test.tsx`

**Interfaces:**
- Consumes: `HomeSection` (Task 3).
- Produces: `SectionKey` now includes `'home'`; `AppShell`'s default section is `'home'`.

- [ ] **Step 1: Update the failing test first**

In `client/src/test/AppShell.test.tsx`, replace the first test:

```tsx
  it('opens on the Home section by default and lists all eight sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<AppShell />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Home/ }).className).toContain('active'));
    for (const name of ['Home', 'Layout', 'Controllers', 'Groups', 'Themes', 'Schedule', 'Firmware', 'Settings']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
  });
```

(This replaces the existing `'opens on the Layout section by default and lists all seven sections'` test — same file, same `describe` block, other tests in the file are unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/test/AppShell.test.tsx`
Expected: FAIL — the Home nav button doesn't exist yet, and Layout is still the active/default section.

- [ ] **Step 3: Add a Home icon**

Append to `client/src/components/icons.tsx`:

```tsx
export function HomeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </svg>
  );
}
```

- [ ] **Step 4: Add 'home' to SectionKey and SECTIONS**

In `client/src/components/Sidebar.tsx`, update the import and the two declarations:

```ts
import { LightbulbIcon, GridIcon, UsersIcon, PaletteIcon, CalendarIcon, ChipIcon, GearIcon, HomeIcon } from './icons';

export type SectionKey = 'home' | 'layout' | 'controllers' | 'groups' | 'themes' | 'schedule' | 'firmware' | 'settings';
```

```ts
export const SECTIONS: { key: SectionKey; label: string; Icon: IconComp }[] = [
  { key: 'home', label: 'Home', Icon: HomeIcon },
  { key: 'layout', label: 'Layout', Icon: GridIcon },
  { key: 'controllers', label: 'Controllers', Icon: LightbulbIcon },
  { key: 'groups', label: 'Groups', Icon: UsersIcon },
  { key: 'themes', label: 'Themes', Icon: PaletteIcon },
  { key: 'schedule', label: 'Schedule', Icon: CalendarIcon },
  { key: 'firmware', label: 'Firmware', Icon: ChipIcon },
  { key: 'settings', label: 'Settings', Icon: GearIcon }
];
```

- [ ] **Step 5: Render HomeSection and change the default route**

In `client/src/components/AppShell.tsx`, add the import and change `DEFAULT_SECTION`:

```ts
import { HomeSection } from './HomeSection';
```

```ts
const DEFAULT_SECTION: SectionKey = 'home';
```

Add the render branch as the first one inside `<main className="app-main">`:

```tsx
        {active === 'home' && <HomeSection />}
        {active === 'layout' && <LayoutSection />}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run src/test/AppShell.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 7: Run the full client test suite to confirm no regressions**

Run: `cd client && npm test -- --run`
Expected: all test files pass

- [ ] **Step 8: Commit**

```bash
git add client/src/components/icons.tsx client/src/components/Sidebar.tsx client/src/components/AppShell.tsx client/src/test/AppShell.test.tsx
git commit -m "Add Home section to navigation as the new default route"
```

---

## Task 5: Build, README update, deploy, and live verification

**Files:**
- Modify: `client/package.json` (version bump)
- Modify: `README.md`

- [ ] **Step 1: Full client build**

Run: `cd client && npm run build`
Expected: `tsc -b && vite build` succeeds with no type errors.

- [ ] **Step 2: Full client test suite**

Run: `cd client && npm test -- --run`
Expected: all test files pass (existing suite + the new tileStatus/HomeTile/HomeSection tests).

- [ ] **Step 3: Bump client version**

In `client/package.json`, change:
```json
  "version": "0.5.0",
```
to
```json
  "version": "0.6.0",
```

- [ ] **Step 4: Update README**

In `README.md`, in the "Using the app" section, add a bullet for Home directly above the existing "Layout" bullet (find the line starting with `- **Layout**: the default screen.` and change it, since Layout is no longer the default screen):

Change:
```markdown
- **Layout**: the default screen. Click "Draw strip" to trace a strip on the
```
to:
```markdown
- **Home**: the default screen. One tile per Group (a Group doubles as a
  room or scene for this purpose) plus one tile per controller not yet in
  any Group. Each tile shows live on/off + brightness (or "Mixed" if its
  members disagree, or an offline badge if a member is unreachable) and lets
  you toggle power, adjust brightness, or apply a saved Theme — all without
  leaving the page.
- **Layout**: the spatial setup screen. Click "Draw strip" to trace a strip on the
```

- [ ] **Step 5: Commit the version bump and README**

```bash
git add client/package.json README.md
git commit -m "Bump client to 0.6.0; document the new Home section in README"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

- [ ] **Step 7: Deploy to media-server**

```bash
ssh media-server "cd ~/docker/uber-wled && git pull origin main && docker compose up -d --build"
```

Expected: build succeeds, container recreated and started, no errors in `docker compose logs --tail 30 uber-wled`.

- [ ] **Step 8: Verify live in the browser**

Using the Playwright MCP tools (already used earlier this session against `http://media-server:8081`):
1. Navigate to `http://media-server:8081/` (no hash) and confirm it opens on Home, not Layout.
2. Confirm one tile renders per existing Group, plus an "Ungrouped" section for any controller not in a group.
3. Click a tile's On/Off button and confirm the corresponding real controller responds (or, at minimum, that no console error appears and the tile's status updates within one poll cycle).
4. Check the sidebar still lists Layout, Controllers, Groups, Themes, Schedule, Firmware, Settings unchanged, and Layout still opens its canvas correctly when clicked.
5. Take a screenshot for the record.
