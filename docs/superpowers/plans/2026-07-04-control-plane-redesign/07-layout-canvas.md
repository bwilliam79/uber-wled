# Phase G — Layout Canvas Rebuild

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Replace the old Layout screen (fixed 0–100 viewBox, private 5s poller, docked ControlPanel) with a zoomable/pannable SVG canvas featuring click-to-place drawing, vertex editing, marquee selection into the shared Control surface, SSE live colors, and draggable/renamable room-label chips — with the strips/room-labels APIs and stored data shapes untouched.

**Architecture:** All new code lives in `client/src/sections/layout/`. Pure math (screen↔world transforms, snapping, hit tests, fit-all) lives in `geometry.ts`; the interaction state machine (idle/draw/confirmStrip/pan/marquee/dragStrip/dragVertex) is a typed reducer in `canvasMode.ts`; `LayoutCanvas.tsx` is a dumb SVG renderer; `LayoutSection.tsx` owns queries, mutations, viewport, keyboard/wheel/pinch wiring, and mounts the Phase-D `ControlSurface`. **No server changes:** `server/src/strips/routes.ts` and `server/src/room_labels/routes.ts` are consumed as-is; `strips.points` stays a `{x,y}[]` JSON array in the legacy 0–100 world coordinate space.

**Tech Stack:** React 19 + TypeScript + Vite; `@tanstack/react-query` (installed in Phase C); Vitest + Testing Library (jsdom); plain CSS on the Phase-C design tokens (`var(--accent)` etc.). No new dependencies.

## Global Constraints

(Copied verbatim from `00-master.md` — binding.)

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

## Binding contracts consumed from earlier phases

From `00-master.md` (copy exact — never reshape):

```ts
// Client Target type mirrors the server contract exactly.
// Phase D (04 plan, Task 1) exports it from client/src/api/client.ts:
export type Target =
  | { kind: 'controller'; controllerId: string }
  | { kind: 'segment'; controllerId: string; wledSegId: number }
  | { kind: 'group'; groupId: string };

// Phase D — client/src/control/ControlSurface.tsx
//   props: { targets: Target[]; open: boolean; onClose(): void }
//   (imports Target from ../api/client; does NOT re-export it)

// Phase D — client/src/api/live.ts
//   useLiveStatus(controllerIds: string[])
//     → Map<string, { reachable: boolean; state?: WledState; info?: WledInfo }>
```

This plan imports `Target` from `client/src/api/client` (where Phase D's Task 1 places it; `ControlSurface.tsx` does not re-export it). Per superpowers:executing-plans-verification, if Phase D drifted and exported `Target` from a different module, adjust only the import specifier — the shape above is binding and must not change. `useLiveStatus`'s map value is consumed **structurally** (only `reachable` and `state.on` / `state.seg[].{id,on,bri,col}` are read), so Phase D's exact type name is irrelevant.

Preset application is Phase D's concern, not this phase's: the ControlSurface's Presets tab sends `POST /api/control/apply` with `patch: { ps }` (the master's `ControlPatch.ps?: number` — device-local preset ids, restricted to single-controller selections). Phase G only hands `targets: Target[]` to the surface and never constructs a `ControlPatch` itself — do not add any preset or apply logic under `sections/layout/`.

Existing APIs consumed unchanged (from `client/src/api/client.ts`):

```ts
interface Strip { id: string; controllerId: string; wledSegId: number; points: { x: number; y: number }[]; label: string | null }
interface RoomLabel { id: string; name: string; x: number; y: number }
listStrips(): Promise<Strip[]>                                   // GET  /api/strips
addStrip(input): Promise<{ strip: Strip; recommendations: unknown[] }>  // POST /api/strips
updateStrip(id, patch): Promise<Strip>                           // PATCH /api/strips/:id
deleteStrip(id): Promise<Response>                               // DELETE /api/strips/:id
listRoomLabels / addRoomLabel / updateRoomLabel                  // /api/room-labels
listControllers(): Promise<Controller[]>                         // GET /api/controllers (consumed via useControllers() from api/queries)
segmentToCssColor(seg: { on: boolean; bri: number; col: number[][] }): string  // client/src/lib/segmentColor.ts — KEPT, not deleted
```

## Interaction model (decisions binding within this phase)

| Gesture | Result |
|---|---|
| Wheel over canvas | Zoom about cursor (`zoomAt`); native listener with `{ passive: false }` because React's root-delegated wheel is passive |
| Drag on empty canvas | Pan |
| Plain click on empty canvas (press+release, no move) | Clear selection |
| **Shift**+drag on empty canvas | Marquee box-select (additive union — matches "shift adds") |
| Click a strip | Select just it (pointer-up without move) |
| Shift+click a strip | Toggle it in/out of selection |
| Drag a selected strip | Move **all selected** strips by the delta; persists via `PATCH /api/strips/:id { points }` on release |
| Drag a vertex handle | Move that vertex (grid-snapped when snap is on); persists on release |
| Two-finger pinch (touch) | Zoom about midpoint; single-finger drag on empty pans |
| Draw mode: click | Place vertex (Shift = 45° constraint from last vertex; grid snap when toggled on) |
| Draw mode: Enter / double-click | Finish (double-click dispatches `UNDO_VERTEX` then `FINISH_DRAW` to drop the duplicate vertex the second click placed) |
| Draw mode: Esc / Backspace | Cancel / undo last vertex |
| Idle + selection: Delete or Backspace | `window.confirm` then delete selected strips |

Initial viewport is **identity** (`scale 1, tx 0, ty 0` — legacy world units render 1:1 as px); the **Fit all** button computes a fitted viewport over the union of the legacy 0–100 world box, all strip points, and all label positions. (No auto-fit on mount: keeps integration tests deterministic with a mocked 100×100 rect where screen == world.)

Test commands: all client — `cd /Users/bwwilliams/github/uber-wled/client && npm test -- <file>`. There are no server tasks in this phase.

---

## Task 1: Pure geometry helpers

**Files:**
- Create: `client/src/sections/layout/geometry.ts`
- Test: `client/src/test/sections/layout/geometry.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (exact, relied on by Tasks 2, 5, 6):
  ```ts
  export interface Point { x: number; y: number }
  export interface Viewport { scale: number; tx: number; ty: number }   // screen = world * scale + t
  export interface Rect { x: number; y: number; w: number; h: number }  // world coords
  export const IDENTITY_VIEWPORT: Viewport;
  export const MIN_SCALE: number;        // 0.25
  export const MAX_SCALE: number;        // 40
  export const GRID_SIZE: number;        // 2 world units
  export const HIT_TOLERANCE_PX: number; // 6 screen px
  export function worldToScreen(vp: Viewport, p: Point): Point;
  export function screenToWorld(vp: Viewport, p: Point): Point;
  export function zoomAt(vp: Viewport, screenPt: Point, factor: number): Viewport;
  export function panBy(vp: Viewport, dxScreen: number, dyScreen: number): Viewport;
  export function snapAngle(anchor: Point, p: Point): Point;
  export function snapToGrid(p: Point, grid?: number): Point;
  export function distToSegment(p: Point, a: Point, b: Point): number;
  export function hitTestPolyline(points: Point[], p: Point, tolerance: number): boolean;
  export function normalizeRect(a: Point, b: Point): Rect;
  export function polylineIntersectsRect(points: Point[], rect: Rect): boolean;
  export function fitAllViewport(points: Point[], viewW: number, viewH: number, paddingPx?: number): Viewport;
  ```

**Steps:**

- [ ] Write the failing test file `client/src/test/sections/layout/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  IDENTITY_VIEWPORT, MIN_SCALE, MAX_SCALE, GRID_SIZE,
  worldToScreen, screenToWorld, zoomAt, panBy,
  snapAngle, snapToGrid, distToSegment, hitTestPolyline,
  normalizeRect, polylineIntersectsRect, fitAllViewport,
  type Viewport
} from '../../../sections/layout/geometry';

describe('screen<->world transforms', () => {
  const vp: Viewport = { scale: 2, tx: 10, ty: -5 };

  it('worldToScreen applies scale then translation', () => {
    expect(worldToScreen(vp, { x: 3, y: 4 })).toEqual({ x: 16, y: 3 });
  });

  it('screenToWorld inverts worldToScreen exactly', () => {
    const w = { x: 12.5, y: -7.25 };
    const back = screenToWorld(vp, worldToScreen(vp, w));
    expect(back.x).toBeCloseTo(w.x, 10);
    expect(back.y).toBeCloseTo(w.y, 10);
  });

  it('identity viewport is a no-op', () => {
    expect(worldToScreen(IDENTITY_VIEWPORT, { x: 42, y: 7 })).toEqual({ x: 42, y: 7 });
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const vp: Viewport = { scale: 1, tx: 0, ty: 0 };
    const cursor = { x: 50, y: 80 };
    const before = screenToWorld(vp, cursor);
    const after = screenToWorld(zoomAt(vp, cursor, 2), cursor);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it('clamps to MAX_SCALE and MIN_SCALE', () => {
    const vp: Viewport = { scale: 1, tx: 0, ty: 0 };
    expect(zoomAt(vp, { x: 0, y: 0 }, 1e6).scale).toBe(MAX_SCALE);
    expect(zoomAt(vp, { x: 0, y: 0 }, 1e-6).scale).toBe(MIN_SCALE);
  });

  it('compounds from the current scale', () => {
    const vp: Viewport = { scale: 2, tx: 5, ty: 5 };
    expect(zoomAt(vp, { x: 0, y: 0 }, 1.5).scale).toBeCloseTo(3, 10);
  });
});

describe('panBy', () => {
  it('shifts translation by screen deltas without touching scale', () => {
    expect(panBy({ scale: 3, tx: 1, ty: 2 }, 10, -4)).toEqual({ scale: 3, tx: 11, ty: -2 });
  });
});

describe('snapAngle (45-degree constraint)', () => {
  const anchor = { x: 0, y: 0 };

  it('snaps a near-horizontal point onto the horizontal axis, preserving length', () => {
    const p = snapAngle(anchor, { x: 10, y: 0.5 });
    expect(p.y).toBeCloseTo(0, 10);
    expect(p.x).toBeCloseTo(Math.hypot(10, 0.5), 10);
  });

  it('snaps a near-diagonal point onto the 45-degree diagonal', () => {
    const p = snapAngle(anchor, { x: 10, y: 9 });
    const len = Math.hypot(10, 9);
    expect(p.x).toBeCloseTo(len / Math.SQRT2, 10);
    expect(p.y).toBeCloseTo(len / Math.SQRT2, 10);
  });

  it('snaps a near-vertical point onto the vertical axis', () => {
    const p = snapAngle(anchor, { x: -0.4, y: 10 });
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.y).toBeCloseTo(Math.hypot(0.4, 10), 10);
  });

  it('returns the anchor for a zero-length vector', () => {
    expect(snapAngle({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
  });
});

describe('snapToGrid', () => {
  it('rounds each coordinate to the nearest grid multiple (default GRID_SIZE)', () => {
    expect(snapToGrid({ x: 3.4, y: 5.1 })).toEqual({ x: 4, y: 6 });
    expect(GRID_SIZE).toBe(2);
  });

  it('leaves exact multiples untouched and honors a custom grid', () => {
    expect(snapToGrid({ x: 8, y: 10 })).toEqual({ x: 8, y: 10 });
    expect(snapToGrid({ x: 7, y: 2 }, 5)).toEqual({ x: 5, y: 0 });
  });
});

describe('distToSegment / hitTestPolyline', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it('measures perpendicular distance inside the segment span', () => {
    expect(distToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 10);
  });

  it('measures distance to the nearest endpoint beyond the span', () => {
    expect(distToSegment({ x: 14, y: 3 }, a, b)).toBeCloseTo(5, 10);
  });

  it('handles a degenerate zero-length segment', () => {
    expect(distToSegment({ x: 3, y: 4 }, a, a)).toBeCloseTo(5, 10);
  });

  it('hitTestPolyline: hit within tolerance on any segment, miss outside', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(hitTestPolyline(line, { x: 10.5, y: 5 }, 1)).toBe(true);
    expect(hitTestPolyline(line, { x: 5, y: 2 }, 1)).toBe(false);
  });

  it('hitTestPolyline: single-point polyline uses point distance', () => {
    expect(hitTestPolyline([{ x: 5, y: 5 }], { x: 5.5, y: 5 }, 1)).toBe(true);
    expect(hitTestPolyline([{ x: 5, y: 5 }], { x: 8, y: 5 }, 1)).toBe(false);
  });
});

describe('normalizeRect', () => {
  it('produces a positive-size rect from any two corners', () => {
    expect(normalizeRect({ x: 9, y: 2 }, { x: 3, y: 8 })).toEqual({ x: 3, y: 2, w: 6, h: 6 });
  });
});

describe('polylineIntersectsRect (marquee test)', () => {
  const rect = { x: 10, y: 10, w: 20, h: 20 };

  it('true when a vertex lies inside the rect', () => {
    expect(polylineIntersectsRect([{ x: 15, y: 15 }, { x: 100, y: 100 }], rect)).toBe(true);
  });

  it('true when a segment passes straight through with both endpoints outside', () => {
    expect(polylineIntersectsRect([{ x: 0, y: 20 }, { x: 50, y: 20 }], rect)).toBe(true);
  });

  it('false when the polyline is entirely outside', () => {
    expect(polylineIntersectsRect([{ x: 40, y: 40 }, { x: 60, y: 40 }], rect)).toBe(false);
  });

  it('true when a segment is collinear with a rect edge and overlaps it', () => {
    expect(polylineIntersectsRect([{ x: 0, y: 10 }, { x: 50, y: 10 }], rect)).toBe(true);
  });

  it('handles a single-point polyline', () => {
    expect(polylineIntersectsRect([{ x: 20, y: 20 }], rect)).toBe(true);
    expect(polylineIntersectsRect([{ x: 5, y: 5 }], rect)).toBe(false);
  });
});

describe('fitAllViewport', () => {
  it('fits the 0..100 box into a 148x148 view with 24px padding at scale 1, centered', () => {
    const vp = fitAllViewport([{ x: 0, y: 0 }, { x: 100, y: 100 }], 148, 148);
    expect(vp.scale).toBeCloseTo(1, 10);
    expect(vp.tx).toBeCloseTo(24, 10);
    expect(vp.ty).toBeCloseTo(24, 10);
  });

  it('uses the tighter axis and centers the other', () => {
    const vp = fitAllViewport([{ x: 0, y: 0 }, { x: 200, y: 50 }], 224, 148);
    expect(vp.scale).toBeCloseTo(0.88, 10);           // (224-48)/200
    expect(vp.tx).toBeCloseTo((224 - 200 * 0.88) / 2, 10);
    expect(vp.ty).toBeCloseTo((148 - 50 * 0.88) / 2, 10);
  });

  it('clamps the fitted scale into [MIN_SCALE, MAX_SCALE]', () => {
    expect(fitAllViewport([{ x: 0, y: 0 }, { x: 1, y: 1 }], 148, 148).scale).toBe(MAX_SCALE);
  });

  it('falls back to the 0..100 box when given no points', () => {
    const vp = fitAllViewport([], 148, 148);
    expect(vp.scale).toBeCloseTo(1, 10);
  });

  it('offsets translation for content not anchored at the origin', () => {
    const vp = fitAllViewport([{ x: 50, y: 50 }, { x: 150, y: 150 }], 148, 148);
    expect(vp.scale).toBeCloseTo(1, 10);
    expect(vp.tx).toBeCloseTo(24 - 50, 10);
    expect(vp.ty).toBeCloseTo(24 - 50, 10);
  });
});
```

- [ ] Run it and confirm it fails with "Cannot find module '../../../sections/layout/geometry'":
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/geometry.test.ts`
- [ ] Create `client/src/sections/layout/geometry.ts`:

```ts
export interface Point { x: number; y: number }

/** screen = world * scale + (tx, ty) */
export interface Viewport { scale: number; tx: number; ty: number }

/** Axis-aligned rect in world coordinates. */
export interface Rect { x: number; y: number; w: number; h: number }

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, tx: 0, ty: 0 };
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 40;
/** World units between grid lines (legacy world box is 0..100). */
export const GRID_SIZE = 2;
/** Screen-pixel hit slop; divide by viewport.scale to get world tolerance. */
export const HIT_TOLERANCE_PX = 6;

export function worldToScreen(vp: Viewport, p: Point): Point {
  return { x: p.x * vp.scale + vp.tx, y: p.y * vp.scale + vp.ty };
}

export function screenToWorld(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.tx) / vp.scale, y: (p.y - vp.ty) / vp.scale };
}

/** Zoom by `factor` keeping the world point under `screenPt` stationary. */
export function zoomAt(vp: Viewport, screenPt: Point, factor: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vp.scale * factor));
  const k = scale / vp.scale;
  return {
    scale,
    tx: screenPt.x - (screenPt.x - vp.tx) * k,
    ty: screenPt.y - (screenPt.y - vp.ty) * k
  };
}

export function panBy(vp: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { scale: vp.scale, tx: vp.tx + dxScreen, ty: vp.ty + dyScreen };
}

/** Constrain `p` to the nearest 45-degree ray from `anchor`, preserving distance. */
export function snapAngle(anchor: Point, p: Point): Point {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: anchor.x, y: anchor.y };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + len * Math.cos(angle), y: anchor.y + len * Math.sin(angle) };
}

export function snapToGrid(p: Point, grid: number = GRID_SIZE): Point {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

export function hitTestPolyline(points: Point[], p: Point, tolerance: number): boolean {
  if (points.length === 0) return false;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y) <= tolerance;
  for (let i = 0; i < points.length - 1; i++) {
    if (distToSegment(p, points[i], points[i + 1]) <= tolerance) return true;
  }
  return false;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  };
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function orient(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    orient(p, q, r) === 0 &&
    r.x >= Math.min(p.x, q.x) && r.x <= Math.max(p.x, q.x) &&
    r.y >= Math.min(p.y, q.y) && r.y <= Math.max(p.y, q.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** Marquee test: any vertex inside the rect, or any polyline segment crossing a rect edge. */
export function polylineIntersectsRect(points: Point[], rect: Rect): boolean {
  if (points.some((p) => pointInRect(p, rect))) return true;
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h }
  ];
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < 4; j++) {
      if (segmentsIntersect(points[i], points[i + 1], corners[j], corners[(j + 1) % 4])) return true;
    }
  }
  return false;
}

/** Viewport that fits the bounds of `points` (min 1x1) into viewW x viewH, centered, clamped to scale limits. */
export function fitAllViewport(points: Point[], viewW: number, viewH: number, paddingPx = 24): Viewport {
  const pts = points.length > 0 ? points : [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const raw = Math.min((viewW - 2 * paddingPx) / w, (viewH - 2 * paddingPx) / h);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
  return {
    scale,
    tx: (viewW - w * scale) / 2 - minX * scale,
    ty: (viewH - h * scale) / 2 - minY * scale
  };
}
```

- [ ] Run again, expect all green:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/geometry.test.ts`
- [ ] Commit:
  `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/layout/geometry.ts client/src/test/sections/layout/geometry.test.ts && git commit -m "layout: pure geometry helpers (transforms, snapping, hit tests, fit-all)"`

---

## Task 2: Canvas mode state machine (typed reducer)

**Files:**
- Create: `client/src/sections/layout/canvasMode.ts`
- Test: `client/src/test/sections/layout/canvasMode.test.ts`

**Interfaces:**
- Consumes: `snapAngle`, `snapToGrid`, `Point` from Task 1.
- Produces (exact, relied on by Task 6):
  ```ts
  export type LayoutMode =
    | { name: 'idle' }
    | { name: 'draw'; vertices: Point[] }
    | { name: 'confirmStrip'; vertices: Point[] }
    | { name: 'pan'; lastScreen: Point; moved: boolean }
    | { name: 'marquee'; origin: Point; current: Point }
    | { name: 'dragStrip'; stripId: string; last: Point; moved: boolean }
    | { name: 'dragVertex'; stripId: string; vertexIndex: number; moved: boolean };
  export interface LayoutState { mode: LayoutMode; selection: string[]; gridSnap: boolean }
  export const initialLayoutState: LayoutState;
  export type LayoutEvent = /* see implementation below */;
  export function layoutReducer(state: LayoutState, event: LayoutEvent): LayoutState;
  ```

**Steps:**

- [ ] Write the failing test `client/src/test/sections/layout/canvasMode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  layoutReducer, initialLayoutState, type LayoutState, type LayoutEvent
} from '../../../sections/layout/canvasMode';

function run(events: LayoutEvent[], from: LayoutState = initialLayoutState): LayoutState {
  return events.reduce(layoutReducer, from);
}

describe('draw flow', () => {
  it('START_DRAW enters draw mode with no vertices (only from idle)', () => {
    const s = run([{ type: 'START_DRAW' }]);
    expect(s.mode).toEqual({ name: 'draw', vertices: [] });
    expect(run([{ type: 'START_DRAW' }], s).mode).toEqual({ name: 'draw', vertices: [] });
  });

  it('PLACE_VERTEX appends world points', () => {
    const s = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 10, y: 10 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 50, y: 12 }, shift: false }
    ]);
    expect(s.mode).toEqual({ name: 'draw', vertices: [{ x: 10, y: 10 }, { x: 50, y: 12 }] });
  });

  it('PLACE_VERTEX with shift constrains to 45 degrees from the previous vertex', () => {
    const s = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 10, y: 10 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 50, y: 11 }, shift: true }
    ]);
    const [, v] = (s.mode as { name: 'draw'; vertices: { x: number; y: number }[] }).vertices;
    expect(v.y).toBeCloseTo(10, 10);                       // snapped horizontal
    expect(v.x).toBeCloseTo(10 + Math.hypot(40, 1), 10);   // length preserved
  });

  it('PLACE_VERTEX snaps to the grid when gridSnap is on (after angle snap)', () => {
    const s = run([
      { type: 'TOGGLE_GRID_SNAP' },
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 10.9, y: 5.2 }, shift: false }
    ]);
    expect(s.mode).toEqual({ name: 'draw', vertices: [{ x: 10, y: 6 }] });
  });

  it('UNDO_VERTEX drops the last vertex and is a no-op on empty', () => {
    const base = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 1, y: 1 }, shift: false }
    ]);
    const s1 = layoutReducer(base, { type: 'UNDO_VERTEX' });
    expect(s1.mode).toEqual({ name: 'draw', vertices: [] });
    expect(layoutReducer(s1, { type: 'UNDO_VERTEX' }).mode).toEqual({ name: 'draw', vertices: [] });
  });

  it('FINISH_DRAW with fewer than 2 distinct vertices stays in draw mode', () => {
    const s = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 5, y: 5 }, shift: false },
      { type: 'FINISH_DRAW' }
    ]);
    expect(s.mode.name).toBe('draw');
  });

  it('FINISH_DRAW dedupes consecutive duplicate vertices and enters confirmStrip', () => {
    const s = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 5, y: 5 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 20, y: 5 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 20, y: 5 }, shift: false },
      { type: 'FINISH_DRAW' }
    ]);
    expect(s.mode).toEqual({ name: 'confirmStrip', vertices: [{ x: 5, y: 5 }, { x: 20, y: 5 }] });
  });

  it('STRIP_SAVED and CANCEL both return to idle', () => {
    const confirm = run([
      { type: 'START_DRAW' },
      { type: 'PLACE_VERTEX', point: { x: 0, y: 0 }, shift: false },
      { type: 'PLACE_VERTEX', point: { x: 9, y: 0 }, shift: false },
      { type: 'FINISH_DRAW' }
    ]);
    expect(layoutReducer(confirm, { type: 'STRIP_SAVED' }).mode).toEqual({ name: 'idle' });
    expect(layoutReducer(confirm, { type: 'CANCEL' }).mode).toEqual({ name: 'idle' });
  });

  it('CANCEL from draw preserves the existing selection', () => {
    const withSel: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([{ type: 'START_DRAW' }, { type: 'CANCEL' }], withSel);
    expect(s.selection).toEqual(['s1']);
    expect(s.mode).toEqual({ name: 'idle' });
  });
});

describe('selection and drags', () => {
  it('pointer-down on an unselected strip selects only it and starts dragStrip', () => {
    const s = run([{ type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 1, y: 1 }, shift: false }]);
    expect(s.selection).toEqual(['s1']);
    expect(s.mode).toEqual({ name: 'dragStrip', stripId: 's1', last: { x: 1, y: 1 }, moved: false });
  });

  it('pointer-down on an already-selected strip keeps the multi-selection', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1', 's2'] };
    const s = run([{ type: 'STRIP_POINTER_DOWN', stripId: 's2', point: { x: 1, y: 1 }, shift: false }], from);
    expect(s.selection).toEqual(['s1', 's2']);
    expect(s.mode.name).toBe('dragStrip');
  });

  it('shift+pointer-down toggles membership and does not start a drag', () => {
    const s1 = run([{ type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 0, y: 0 }, shift: true }]);
    expect(s1.selection).toEqual(['s1']);
    expect(s1.mode).toEqual({ name: 'idle' });
    const s2 = layoutReducer(s1, { type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 0, y: 0 }, shift: true });
    expect(s2.selection).toEqual([]);
  });

  it('VERTEX_POINTER_DOWN enters dragVertex', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([{ type: 'VERTEX_POINTER_DOWN', stripId: 's1', vertexIndex: 1 }], from);
    expect(s.mode).toEqual({ name: 'dragVertex', stripId: 's1', vertexIndex: 1, moved: false });
  });

  it('POINTER_MOVE marks drags as moved and tracks the last point', () => {
    const from = run([{ type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 1, y: 1 }, shift: false }]);
    const s = layoutReducer(from, { type: 'POINTER_MOVE', world: { x: 4, y: 6 }, screen: { x: 4, y: 6 } });
    expect(s.mode).toEqual({ name: 'dragStrip', stripId: 's1', last: { x: 4, y: 6 }, moved: true });
  });

  it('POINTER_UP ends dragStrip/dragVertex back to idle keeping selection', () => {
    const from = run([
      { type: 'STRIP_POINTER_DOWN', stripId: 's1', point: { x: 1, y: 1 }, shift: false },
      { type: 'POINTER_UP' }
    ]);
    expect(from.mode).toEqual({ name: 'idle' });
    expect(from.selection).toEqual(['s1']);
  });

  it('CLEAR_SELECTION empties the selection', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1', 's2'] };
    expect(layoutReducer(from, { type: 'CLEAR_SELECTION' }).selection).toEqual([]);
  });

  it('SELECTION_DELETED empties selection and returns to idle', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = layoutReducer(from, { type: 'SELECTION_DELETED' });
    expect(s).toEqual({ ...initialLayoutState, selection: [] });
  });
});

describe('pan and marquee on empty canvas', () => {
  it('BG_POINTER_DOWN without shift starts a pan', () => {
    const s = run([{ type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 50, y: 50 }, shift: false }]);
    expect(s.mode).toEqual({ name: 'pan', lastScreen: { x: 50, y: 50 }, moved: false });
  });

  it('a pan that never moved clears the selection on POINTER_UP (plain click on empty)', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([
      { type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 50, y: 50 }, shift: false },
      { type: 'POINTER_UP' }
    ], from);
    expect(s.selection).toEqual([]);
    expect(s.mode).toEqual({ name: 'idle' });
  });

  it('a pan that moved preserves the selection', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([
      { type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 50, y: 50 }, shift: false },
      { type: 'POINTER_MOVE', world: { x: 6, y: 6 }, screen: { x: 60, y: 60 } },
      { type: 'POINTER_UP' }
    ], from);
    expect(s.selection).toEqual(['s1']);
  });

  it('BG_POINTER_DOWN with shift starts a marquee at the world point', () => {
    const s = run([{ type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 5, y: 5 }, shift: true }]);
    expect(s.mode).toEqual({ name: 'marquee', origin: { x: 5, y: 5 }, current: { x: 5, y: 5 } });
  });

  it('POINTER_MOVE updates the marquee corner; POINTER_UP unions hits into selection', () => {
    const from: LayoutState = { ...initialLayoutState, selection: ['s1'] };
    const s = run([
      { type: 'BG_POINTER_DOWN', world: { x: 5, y: 5 }, screen: { x: 5, y: 5 }, shift: true },
      { type: 'POINTER_MOVE', world: { x: 95, y: 95 }, screen: { x: 95, y: 95 } },
      { type: 'POINTER_UP', marqueeHits: ['s1', 's2'] }
    ], from);
    expect(s.selection).toEqual(['s1', 's2']);   // no duplicate s1
    expect(s.mode).toEqual({ name: 'idle' });
  });

  it('TOGGLE_GRID_SNAP flips the flag', () => {
    expect(run([{ type: 'TOGGLE_GRID_SNAP' }]).gridSnap).toBe(true);
    expect(run([{ type: 'TOGGLE_GRID_SNAP' }, { type: 'TOGGLE_GRID_SNAP' }]).gridSnap).toBe(false);
  });
});
```

- [ ] Run and confirm module-not-found failure:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/canvasMode.test.ts`
- [ ] Create `client/src/sections/layout/canvasMode.ts`:

```ts
import { snapAngle, snapToGrid, type Point } from './geometry';

export type LayoutMode =
  | { name: 'idle' }
  | { name: 'draw'; vertices: Point[] }
  | { name: 'confirmStrip'; vertices: Point[] }
  | { name: 'pan'; lastScreen: Point; moved: boolean }
  | { name: 'marquee'; origin: Point; current: Point }
  | { name: 'dragStrip'; stripId: string; last: Point; moved: boolean }
  | { name: 'dragVertex'; stripId: string; vertexIndex: number; moved: boolean };

export interface LayoutState {
  mode: LayoutMode;
  selection: string[];
  gridSnap: boolean;
}

export const initialLayoutState: LayoutState = {
  mode: { name: 'idle' },
  selection: [],
  gridSnap: false
};

export type LayoutEvent =
  | { type: 'START_DRAW' }
  | { type: 'PLACE_VERTEX'; point: Point; shift: boolean }
  | { type: 'UNDO_VERTEX' }
  | { type: 'FINISH_DRAW' }
  | { type: 'STRIP_SAVED' }
  | { type: 'CANCEL' }
  | { type: 'TOGGLE_GRID_SNAP' }
  | { type: 'STRIP_POINTER_DOWN'; stripId: string; point: Point; shift: boolean }
  | { type: 'VERTEX_POINTER_DOWN'; stripId: string; vertexIndex: number }
  | { type: 'BG_POINTER_DOWN'; world: Point; screen: Point; shift: boolean }
  | { type: 'POINTER_MOVE'; world: Point; screen: Point }
  | { type: 'POINTER_UP'; marqueeHits?: string[] }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SELECTION_DELETED' };

const DUPLICATE_EPS = 0.001;

export function layoutReducer(state: LayoutState, event: LayoutEvent): LayoutState {
  switch (event.type) {
    case 'START_DRAW':
      return state.mode.name === 'idle' ? { ...state, mode: { name: 'draw', vertices: [] } } : state;

    case 'PLACE_VERTEX': {
      if (state.mode.name !== 'draw') return state;
      const vertices = state.mode.vertices;
      let p = event.point;
      if (event.shift && vertices.length > 0) p = snapAngle(vertices[vertices.length - 1], p);
      if (state.gridSnap) p = snapToGrid(p);
      return { ...state, mode: { name: 'draw', vertices: [...vertices, p] } };
    }

    case 'UNDO_VERTEX':
      if (state.mode.name !== 'draw') return state;
      return { ...state, mode: { name: 'draw', vertices: state.mode.vertices.slice(0, -1) } };

    case 'FINISH_DRAW': {
      if (state.mode.name !== 'draw') return state;
      const deduped = state.mode.vertices.filter(
        (p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > DUPLICATE_EPS
      );
      if (deduped.length < 2) return { ...state, mode: { name: 'draw', vertices: deduped } };
      return { ...state, mode: { name: 'confirmStrip', vertices: deduped } };
    }

    case 'STRIP_SAVED':
      return state.mode.name === 'confirmStrip' ? { ...state, mode: { name: 'idle' } } : state;

    case 'CANCEL':
      return { ...state, mode: { name: 'idle' } };

    case 'TOGGLE_GRID_SNAP':
      return { ...state, gridSnap: !state.gridSnap };

    case 'STRIP_POINTER_DOWN': {
      if (state.mode.name !== 'idle') return state;
      if (event.shift) {
        const selection = state.selection.includes(event.stripId)
          ? state.selection.filter((id) => id !== event.stripId)
          : [...state.selection, event.stripId];
        return { ...state, selection };
      }
      const selection = state.selection.includes(event.stripId) ? state.selection : [event.stripId];
      return {
        ...state,
        selection,
        mode: { name: 'dragStrip', stripId: event.stripId, last: event.point, moved: false }
      };
    }

    case 'VERTEX_POINTER_DOWN':
      if (state.mode.name !== 'idle') return state;
      return {
        ...state,
        mode: { name: 'dragVertex', stripId: event.stripId, vertexIndex: event.vertexIndex, moved: false }
      };

    case 'BG_POINTER_DOWN':
      if (state.mode.name !== 'idle') return state;
      return event.shift
        ? { ...state, mode: { name: 'marquee', origin: event.world, current: event.world } }
        : { ...state, mode: { name: 'pan', lastScreen: event.screen, moved: false } };

    case 'POINTER_MOVE':
      switch (state.mode.name) {
        case 'pan':
          return { ...state, mode: { name: 'pan', lastScreen: event.screen, moved: true } };
        case 'marquee':
          return { ...state, mode: { ...state.mode, current: event.world } };
        case 'dragStrip':
          return { ...state, mode: { ...state.mode, last: event.world, moved: true } };
        case 'dragVertex':
          return { ...state, mode: { ...state.mode, moved: true } };
        default:
          return state;
      }

    case 'POINTER_UP':
      switch (state.mode.name) {
        case 'pan':
          return { ...state, mode: { name: 'idle' }, selection: state.mode.moved ? state.selection : [] };
        case 'marquee': {
          const hits = event.marqueeHits ?? [];
          const selection = [...state.selection, ...hits.filter((id) => !state.selection.includes(id))];
          return { ...state, mode: { name: 'idle' }, selection };
        }
        case 'dragStrip':
        case 'dragVertex':
          return { ...state, mode: { name: 'idle' } };
        default:
          return state;
      }

    case 'CLEAR_SELECTION':
      return { ...state, selection: [] };

    case 'SELECTION_DELETED':
      return { ...state, mode: { name: 'idle' }, selection: [] };

    default:
      return state;
  }
}
```

- [ ] Run again, expect green:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/canvasMode.test.ts`
- [ ] Commit:
  `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/layout/canvasMode.ts client/src/test/sections/layout/canvasMode.test.ts && git commit -m "layout: typed mode reducer for draw/edit/pan/marquee state machine"`

---

## Task 3: Live stroke color helper + react-query hooks for strips and room labels

**Files:**
- Create: `client/src/sections/layout/stripColors.ts`
- Modify: `client/src/api/queries.ts` (created by Phase C — **append** the two hooks at the end of the file; if Phase C drifted and the file does not exist, create it containing exactly the imports + hooks below)
- Test: `client/src/test/sections/layout/stripColors.test.ts`, `client/src/test/api/queries.layout.test.tsx`

**Interfaces:**
- Consumes: `segmentToCssColor` from `client/src/lib/segmentColor.ts` (existing, kept); `listStrips`/`listRoomLabels` + `Strip`/`RoomLabel` from `client/src/api/client.ts`; `useQuery` from `@tanstack/react-query` (Phase C dep).
- Produces:
  ```ts
  // stripColors.ts
  export const OFFLINE_STROKE = '#475569';
  export interface LiveControllerStatus {
    reachable: boolean;
    state?: { on: boolean; bri: number; seg: { id: number; on: boolean; bri: number; col: number[][] }[] };
  }
  export function stripStrokeColor(
    strip: { controllerId: string; wledSegId: number },
    live: Map<string, LiveControllerStatus>
  ): string;
  // queries.ts additions
  export function useStrips(): UseQueryResult<Strip[]>;        // key ['strips']
  export function useRoomLabels(): UseQueryResult<RoomLabel[]>; // key ['room-labels']
  ```
  `LiveControllerStatus` is a **structural subset** of Phase D's `useLiveStatus` map value — the Phase-D map assigns to it without casts.

**Steps:**

- [ ] Write the failing test `client/src/test/sections/layout/stripColors.test.ts`. The segment fixtures are real data captured 2026-07-04 from the controller at 192.168.1.86 (WLED 16.0.0 "Niji", `GET /json/state`):

```ts
import { describe, it, expect } from 'vitest';
import { stripStrokeColor, OFFLINE_STROKE, type LiveControllerStatus } from '../../../sections/layout/stripColors';

// Real segments from 192.168.1.86 /json/state (2026-07-04): a white RGBW segment
// at full segment brightness, and a second segment currently set to black.
const realSeg0 = { id: 0, on: true, bri: 255, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] };
const realSeg1 = { id: 1, on: true, bri: 255, col: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] };

const onlineState: LiveControllerStatus = {
  reachable: true,
  state: { on: true, bri: 9, seg: [realSeg0, realSeg1] }
};

describe('stripStrokeColor', () => {
  const stripSeg0 = { controllerId: 'c1', wledSegId: 0 };

  it('renders the live segment color when the controller is reachable and on', () => {
    const live = new Map([['c1', onlineState]]);
    expect(stripStrokeColor(stripSeg0, live)).toBe('rgb(255, 255, 255)');
    expect(stripStrokeColor({ controllerId: 'c1', wledSegId: 1 }, live)).toBe('rgb(0, 0, 0)');
  });

  it('renders the muted off color when the whole controller is off', () => {
    const live = new Map([['c1', { ...onlineState, state: { ...onlineState.state!, on: false } }]]);
    expect(stripStrokeColor(stripSeg0, live)).toBe('#334155');
  });

  it('renders the muted off color when just the segment is off', () => {
    const live = new Map([['c1', {
      reachable: true,
      state: { on: true, bri: 9, seg: [{ ...realSeg0, on: false }] }
    }]]);
    expect(stripStrokeColor(stripSeg0, live)).toBe('#334155');
  });

  it('renders grey when the controller is missing, unreachable, or has no state yet', () => {
    expect(stripStrokeColor(stripSeg0, new Map())).toBe(OFFLINE_STROKE);
    expect(stripStrokeColor(stripSeg0, new Map([['c1', { reachable: false }]]))).toBe(OFFLINE_STROKE);
    expect(stripStrokeColor(stripSeg0, new Map([['c1', { reachable: true }]]))).toBe(OFFLINE_STROKE);
  });

  it('renders grey when the mapped segment id does not exist on the device', () => {
    const live = new Map([['c1', onlineState]]);
    expect(stripStrokeColor({ controllerId: 'c1', wledSegId: 9 }, live)).toBe(OFFLINE_STROKE);
  });
});
```

- [ ] Run and confirm module-not-found failure:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/stripColors.test.ts`
- [ ] Create `client/src/sections/layout/stripColors.ts`:

```ts
import { segmentToCssColor } from '../../lib/segmentColor';

/** Stroke for a strip whose controller is missing/unreachable/has no state or segment. */
export const OFFLINE_STROKE = '#475569';

/**
 * Structural subset of the Phase-D useLiveStatus map value — only the fields
 * the Layout canvas reads. Phase D's real map assigns to this without casts.
 */
export interface LiveControllerStatus {
  reachable: boolean;
  state?: { on: boolean; bri: number; seg: { id: number; on: boolean; bri: number; col: number[][] }[] };
}

export function stripStrokeColor(
  strip: { controllerId: string; wledSegId: number },
  live: Map<string, LiveControllerStatus>
): string {
  const status = live.get(strip.controllerId);
  if (!status || !status.reachable || !status.state) return OFFLINE_STROKE;
  if (!status.state.on) return segmentToCssColor({ on: false, bri: 0, col: [] });
  const seg = status.state.seg.find((s) => s.id === strip.wledSegId);
  if (!seg) return OFFLINE_STROKE;
  return segmentToCssColor(seg);
}
```

- [ ] Run again, expect green:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/stripColors.test.ts`
- [ ] Write the failing hooks test `client/src/test/api/queries.layout.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useStrips, useRoomLabels } from '../../api/queries';

const strips = [{ id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 1, y: 2 }], label: null }];
const labels = [{ id: 'l1', name: 'Kitchen', x: 50, y: 20 }];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/strips') return { ok: true, status: 200, json: async () => strips };
    if (url === '/api/room-labels') return { ok: true, status: 200, json: async () => labels };
    throw new Error(`unmocked fetch: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('layout data hooks', () => {
  it('useStrips fetches /api/strips under the ["strips"] key', async () => {
    const { result } = renderHook(() => useStrips(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(strips));
  });

  it('useRoomLabels fetches /api/room-labels', async () => {
    const { result } = renderHook(() => useRoomLabels(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(labels));
  });
});
```

- [ ] Run and confirm it fails (missing exports):
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/queries.layout.test.tsx`
- [ ] Append to `client/src/api/queries.ts` (add `useQuery`, `listStrips`, `listRoomLabels` to its existing imports if not already imported):

```ts
export function useStrips() {
  return useQuery({ queryKey: ['strips'], queryFn: listStrips });
}

export function useRoomLabels() {
  return useQuery({ queryKey: ['room-labels'], queryFn: listRoomLabels });
}
```

- [ ] Run again, expect green:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/api/queries.layout.test.tsx`
- [ ] Commit:
  `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/layout/stripColors.ts client/src/api/queries.ts client/src/test/sections/layout/stripColors.test.ts client/src/test/api/queries.layout.test.tsx && git commit -m "layout: live stroke color helper and strips/room-labels query hooks"`

---

## Task 4: Room label chips (drag + inline rename)

**Files:**
- Create: `client/src/sections/layout/RoomLabels.tsx`
- Test: `client/src/test/sections/layout/RoomLabels.test.tsx`

**Interfaces:**
- Consumes: `RoomLabel` type from `client/src/api/client.ts`.
- Produces (relied on by Task 5):
  ```ts
  export interface RoomLabelsProps {
    labels: RoomLabel[];
    toWorld(clientX: number, clientY: number): { x: number; y: number };
    onMove(id: string, x: number, y: number): void;
    onRename(id: string, name: string): void;
  }
  export function RoomLabels(props: RoomLabelsProps): JSX element;
  ```
  Rendered **inside** the canvas's world-transform `<g>`, so all coordinates are world-space; the parent supplies `toWorld` for pointer math. CSS class contract: `.room-label-layer`, `.room-chip`, `.room-chip-bg`, `.room-chip-text`, `.room-chip-input` (styles land in `layout.css` in Task 6; classes are fixed here).

**Steps:**

- [ ] Write the failing test `client/src/test/sections/layout/RoomLabels.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomLabels } from '../../../sections/layout/RoomLabels';
import type { RoomLabel } from '../../../api/client';

const labels: RoomLabel[] = [{ id: 'l1', name: 'Kitchen', x: 50, y: 20 }];
const toWorld = (clientX: number, clientY: number) => ({ x: clientX, y: clientY });

function renderLayer(overrides: { onMove?: ReturnType<typeof vi.fn>; onRename?: ReturnType<typeof vi.fn> } = {}) {
  const onMove = overrides.onMove ?? vi.fn();
  const onRename = overrides.onRename ?? vi.fn();
  render(
    <svg>
      <RoomLabels labels={labels} toWorld={toWorld} onMove={onMove} onRename={onRename} />
    </svg>
  );
  return { onMove, onRename };
}

describe('RoomLabels', () => {
  it('renders a chip with the label text', () => {
    renderLayer();
    expect(screen.getByTestId('room-label-l1').textContent).toBe('Kitchen');
  });

  it('drag: pointerdown then move then up commits the new world position once', () => {
    const { onMove } = renderLayer();
    const chip = screen.getByTestId('room-label-l1');
    fireEvent.pointerDown(chip, { clientX: 50, clientY: 20 });
    fireEvent.pointerMove(chip, { clientX: 30, clientY: 40 });
    fireEvent.pointerUp(chip);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('l1', 30, 40);
  });

  it('a pointerup without movement does not call onMove', () => {
    const { onMove } = renderLayer();
    const chip = screen.getByTestId('room-label-l1');
    fireEvent.pointerDown(chip, { clientX: 50, clientY: 20 });
    fireEvent.pointerUp(chip);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('double-click opens an inline input prefilled with the name; Enter commits the rename', () => {
    const { onRename } = renderLayer();
    fireEvent.doubleClick(screen.getByTestId('room-label-l1'));
    const input = screen.getByTestId('room-label-input-l1') as HTMLInputElement;
    expect(input.value).toBe('Kitchen');
    fireEvent.change(input, { target: { value: 'Pantry' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('l1', 'Pantry');
    expect(screen.queryByTestId('room-label-input-l1')).toBeNull();
  });

  it('Escape cancels the rename without calling onRename', () => {
    const { onRename } = renderLayer();
    fireEvent.doubleClick(screen.getByTestId('room-label-l1'));
    const input = screen.getByTestId('room-label-input-l1');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByTestId('room-label-l1').textContent).toBe('Kitchen');
  });

  it('an empty rename is discarded on Enter', () => {
    const { onRename } = renderLayer();
    fireEvent.doubleClick(screen.getByTestId('room-label-l1'));
    const input = screen.getByTestId('room-label-input-l1');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
  });
});
```

- [ ] Run and confirm module-not-found failure:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/RoomLabels.test.tsx`
- [ ] Create `client/src/sections/layout/RoomLabels.tsx`:

```tsx
import { useState } from 'react';
import type { RoomLabel } from '../../api/client';

export interface RoomLabelsProps {
  labels: RoomLabel[];
  /** Convert client (viewport) coordinates to world coordinates. */
  toWorld(clientX: number, clientY: number): { x: number; y: number };
  onMove(id: string, x: number, y: number): void;
  onRename(id: string, name: string): void;
}

export function RoomLabels({ labels, toWorld, onMove, onRename }: RoomLabelsProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function handlePointerDown(e: React.PointerEvent, id: string) {
    if (editingId) return;
    e.stopPropagation();
    setDragId(id);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragId) return;
    setDragPos(toWorld(e.clientX, e.clientY));
  }

  function handlePointerUp() {
    if (dragId && dragPos) onMove(dragId, dragPos.x, dragPos.y);
    setDragId(null);
    setDragPos(null);
  }

  function startEdit(label: RoomLabel) {
    setEditingId(label.id);
    setDraft(label.name);
  }

  function commitEdit() {
    const name = draft.trim();
    if (editingId && name) onRename(editingId, name);
    setEditingId(null);
  }

  return (
    <g className="room-label-layer" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
      {labels.map((label) => {
        const x = dragId === label.id && dragPos ? dragPos.x : label.x;
        const y = dragId === label.id && dragPos ? dragPos.y : label.y;
        if (editingId === label.id) {
          return (
            <foreignObject key={label.id} x={x - 4} y={y - 16} width={140} height={30}>
              <input
                data-testid={`room-label-input-${label.id}`}
                className="room-chip-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            </foreignObject>
          );
        }
        const chipWidth = label.name.length * 7.5 + 20;
        return (
          <g
            key={label.id}
            data-testid={`room-label-${label.id}`}
            className="room-chip"
            transform={`translate(${x} ${y})`}
            onPointerDown={(e) => handlePointerDown(e, label.id)}
            onDoubleClick={() => startEdit(label)}
          >
            <rect className="room-chip-bg" x={-chipWidth / 2} y={-11} width={chipWidth} height={22} rx={11} />
            <text className="room-chip-text" textAnchor="middle" dominantBaseline="central">
              {label.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}
```

- [ ] Run again, expect green:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/RoomLabels.test.tsx`
- [ ] Commit:
  `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/layout/RoomLabels.tsx client/src/test/sections/layout/RoomLabels.test.tsx && git commit -m "layout: room label chips with drag and inline rename"`

---

## Task 5: LayoutCanvas SVG renderer

**Files:**
- Create: `client/src/sections/layout/LayoutCanvas.tsx`
- Test: `client/src/test/sections/layout/LayoutCanvas.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`Viewport`, `Rect`, `Point`, `GRID_SIZE`, `HIT_TOLERANCE_PX`), Task 3 (`stripStrokeColor`, `LiveControllerStatus`), Task 4 (`RoomLabels`), `Strip`/`RoomLabel` from `api/client`.
- Produces (relied on by Task 6): `LayoutCanvasProps` and `LayoutCanvas` exactly as in the implementation below. Test ids (binding for Task 6's integration tests): `layout-canvas`, `canvas-bg`, `world-group`, `strip-<id>`, `strip-hit-<id>`, `vertex-<stripId>-<index>`, `draw-preview`, `draw-line`, `draw-rubber`, `marquee`, `layout-grid`.

**Steps:**

- [ ] Write the failing test `client/src/test/sections/layout/LayoutCanvas.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { LayoutCanvas, type LayoutCanvasProps } from '../../../sections/layout/LayoutCanvas';
import { OFFLINE_STROKE, type LiveControllerStatus } from '../../../sections/layout/stripColors';
import type { Strip } from '../../../api/client';

const strips: Strip[] = [
  { id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], label: 'Porch' },
  { id: 's2', controllerId: 'c2', wledSegId: 3, points: [{ x: 60, y: 60 }, { x: 90, y: 60 }], label: null }
];

// Real segment data captured 2026-07-04 from 192.168.1.86 /json/state.
const live = new Map<string, LiveControllerStatus>([
  ['c1', {
    reachable: true,
    state: { on: true, bri: 9, seg: [{ id: 0, on: true, bri: 255, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }] }
  }]
]);

function makeProps(overrides: Partial<LayoutCanvasProps> = {}): LayoutCanvasProps {
  return {
    strips,
    labels: [],
    live,
    selection: [],
    viewport: { scale: 1, tx: 0, ty: 0 },
    gridSnap: false,
    drawVertices: null,
    drawCursor: null,
    marqueeRect: null,
    svgRef: createRef<SVGSVGElement>(),
    toWorld: (x, y) => ({ x, y }),
    onStripPointerDown: vi.fn(),
    onVertexPointerDown: vi.fn(),
    onBackgroundPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onCanvasClick: vi.fn(),
    onCanvasDoubleClick: vi.fn(),
    onMoveLabel: vi.fn(),
    onRenameLabel: vi.fn(),
    ...overrides
  };
}

describe('LayoutCanvas', () => {
  it('applies the viewport as the world-group transform', () => {
    render(<LayoutCanvas {...makeProps({ viewport: { scale: 2, tx: 15, ty: -3 } })} />);
    expect(screen.getByTestId('world-group').getAttribute('transform')).toBe('translate(15 -3) scale(2)');
  });

  it('strokes strips with the live color via INLINE style (cascade winner), grey when offline', () => {
    render(<LayoutCanvas {...makeProps()} />);
    const s1 = screen.getByTestId('strip-s1') as unknown as SVGElement;
    const s2 = screen.getByTestId('strip-s2') as unknown as SVGElement;
    expect(s1.style.stroke).toBe('rgb(255, 255, 255)');   // live white from real fixture
    expect(s2.style.stroke).toBe(OFFLINE_STROKE);          // c2 absent from live map
    expect(s1.getAttribute('stroke')).toBeNull();          // never the presentation attribute
  });

  it('marks a selected strip with the glow filter and renders its vertex handles', () => {
    render(<LayoutCanvas {...makeProps({ selection: ['s1'] })} />);
    const s1 = screen.getByTestId('strip-s1');
    expect(s1.getAttribute('data-selected')).toBe('true');
    expect(s1.getAttribute('filter')).toBe('url(#strip-glow)');
    expect(screen.getByTestId('vertex-s1-0')).toBeDefined();
    expect(screen.getByTestId('vertex-s1-1')).toBeDefined();
    expect(screen.queryByTestId('vertex-s2-0')).toBeNull();
  });

  it('forwards pointerdown on a strip hit-line with the strip id', () => {
    const onStripPointerDown = vi.fn();
    render(<LayoutCanvas {...makeProps({ onStripPointerDown })} />);
    fireEvent.pointerDown(screen.getByTestId('strip-hit-s1'), { clientX: 20, clientY: 10 });
    expect(onStripPointerDown).toHaveBeenCalledTimes(1);
    expect(onStripPointerDown.mock.calls[0][0]).toBe('s1');
  });

  it('disables strip hit-lines while drawing so clicks fall through to the canvas', () => {
    render(<LayoutCanvas {...makeProps({ drawVertices: [] })} />);
    expect(screen.getByTestId('strip-hit-s1').getAttribute('pointer-events')).toBe('none');
  });

  it('renders the draw preview polyline and the rubber-band line to the cursor', () => {
    render(<LayoutCanvas {...makeProps({
      drawVertices: [{ x: 10, y: 10 }, { x: 50, y: 10 }],
      drawCursor: { x: 50, y: 50 }
    })} />);
    expect(screen.getByTestId('draw-line').getAttribute('points')).toBe('10,10 50,10');
    const rubber = screen.getByTestId('draw-rubber');
    expect(rubber.getAttribute('x1')).toBe('50');
    expect(rubber.getAttribute('y1')).toBe('10');
    expect(rubber.getAttribute('x2')).toBe('50');
    expect(rubber.getAttribute('y2')).toBe('50');
  });

  it('renders the marquee rect in world coordinates', () => {
    render(<LayoutCanvas {...makeProps({ marqueeRect: { x: 5, y: 6, w: 30, h: 20 } })} />);
    const m = screen.getByTestId('marquee');
    expect(m.getAttribute('x')).toBe('5');
    expect(m.getAttribute('width')).toBe('30');
  });

  it('renders the grid only when gridSnap is on', () => {
    const { rerender } = render(<LayoutCanvas {...makeProps()} />);
    expect(screen.queryByTestId('layout-grid')).toBeNull();
    rerender(<LayoutCanvas {...makeProps({ gridSnap: true })} />);
    expect(screen.getByTestId('layout-grid')).toBeDefined();
  });
});
```

- [ ] Run and confirm module-not-found failure:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/LayoutCanvas.test.tsx`
- [ ] Create `client/src/sections/layout/LayoutCanvas.tsx`:

```tsx
import type { RefObject } from 'react';
import type { RoomLabel, Strip } from '../../api/client';
import { GRID_SIZE, HIT_TOLERANCE_PX, type Point, type Rect, type Viewport } from './geometry';
import { stripStrokeColor, type LiveControllerStatus } from './stripColors';
import { RoomLabels } from './RoomLabels';

/** Legacy world box: existing strip data lives in 0..100. */
const WORLD_BOX = 100;

export interface LayoutCanvasProps {
  strips: Strip[];
  labels: RoomLabel[];
  live: Map<string, LiveControllerStatus>;
  selection: string[];
  viewport: Viewport;
  gridSnap: boolean;
  /** Non-null while in draw mode (may be empty before the first click). */
  drawVertices: Point[] | null;
  /** Rubber-band endpoint, already snapped by the container. */
  drawCursor: Point | null;
  /** Marquee rect in world coordinates, or null. */
  marqueeRect: Rect | null;
  svgRef: RefObject<SVGSVGElement | null>;
  toWorld(clientX: number, clientY: number): Point;
  onStripPointerDown(stripId: string, e: React.PointerEvent): void;
  onVertexPointerDown(stripId: string, vertexIndex: number, e: React.PointerEvent): void;
  onBackgroundPointerDown(e: React.PointerEvent): void;
  onPointerMove(e: React.PointerEvent): void;
  onPointerUp(e: React.PointerEvent): void;
  onCanvasClick(e: React.MouseEvent): void;
  onCanvasDoubleClick(e: React.MouseEvent): void;
  onMoveLabel(id: string, x: number, y: number): void;
  onRenameLabel(id: string, name: string): void;
}

export function LayoutCanvas(props: LayoutCanvasProps) {
  const vp = props.viewport;
  const drawing = props.drawVertices !== null;
  const lastDrawVertex =
    props.drawVertices && props.drawVertices.length > 0
      ? props.drawVertices[props.drawVertices.length - 1]
      : null;

  return (
    <svg
      ref={props.svgRef}
      data-testid="layout-canvas"
      className="layout-canvas"
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerLeave={props.onPointerUp}
      onClick={props.onCanvasClick}
      onDoubleClick={props.onCanvasDoubleClick}
    >
      <defs>
        <filter id="strip-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect
        data-testid="canvas-bg"
        x={0}
        y={0}
        width="100%"
        height="100%"
        fill="transparent"
        onPointerDown={props.onBackgroundPointerDown}
      />
      <g data-testid="world-group" transform={`translate(${vp.tx} ${vp.ty}) scale(${vp.scale})`}>
        {props.gridSnap && (
          <g data-testid="layout-grid" className="layout-grid">
            {Array.from({ length: WORLD_BOX / GRID_SIZE + 1 }, (_, idx) => {
              const c = idx * GRID_SIZE;
              return (
                <g key={c}>
                  <line className="layout-grid-line" x1={c} y1={0} x2={c} y2={WORLD_BOX} vectorEffect="non-scaling-stroke" />
                  <line className="layout-grid-line" x1={0} y1={c} x2={WORLD_BOX} y2={c} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </g>
        )}
        {props.strips.map((s) => {
          const isSelected = props.selection.includes(s.id);
          const stroke = stripStrokeColor(s, props.live);
          const pointsAttr = s.points.map((p) => `${p.x},${p.y}`).join(' ');
          return (
            <g key={s.id}>
              <polyline
                data-testid={`strip-${s.id}`}
                data-selected={isSelected ? 'true' : 'false'}
                className={`strip-line${isSelected ? ' selected' : ''}`}
                points={pointsAttr}
                fill="none"
                vectorEffect="non-scaling-stroke"
                style={{ stroke }}
                filter={isSelected ? 'url(#strip-glow)' : undefined}
                pointerEvents="none"
              />
              <polyline
                data-testid={`strip-hit-${s.id}`}
                className="strip-hit"
                points={pointsAttr}
                fill="none"
                stroke="transparent"
                strokeWidth={(HIT_TOLERANCE_PX * 2) / vp.scale}
                pointerEvents={drawing ? 'none' : 'stroke'}
                onPointerDown={(e) => props.onStripPointerDown(s.id, e)}
              />
              {isSelected &&
                s.points.map((p, i) => (
                  <circle
                    key={i}
                    data-testid={`vertex-${s.id}-${i}`}
                    className="vertex-handle"
                    cx={p.x}
                    cy={p.y}
                    r={5 / vp.scale}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      props.onVertexPointerDown(s.id, i, e);
                    }}
                  />
                ))}
            </g>
          );
        })}
        {props.drawVertices && (
          <g data-testid="draw-preview" className="draw-preview">
            <polyline
              data-testid="draw-line"
              className="draw-line"
              points={props.drawVertices.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
            {lastDrawVertex && props.drawCursor && (
              <line
                data-testid="draw-rubber"
                className="draw-rubber"
                x1={lastDrawVertex.x}
                y1={lastDrawVertex.y}
                x2={props.drawCursor.x}
                y2={props.drawCursor.y}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {props.drawVertices.map((p, i) => (
              <circle key={i} className="draw-vertex" cx={p.x} cy={p.y} r={4 / vp.scale} />
            ))}
          </g>
        )}
        {props.marqueeRect && (
          <rect
            data-testid="marquee"
            className="marquee-rect"
            x={props.marqueeRect.x}
            y={props.marqueeRect.y}
            width={props.marqueeRect.w}
            height={props.marqueeRect.h}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <RoomLabels labels={props.labels} toWorld={props.toWorld} onMove={props.onMoveLabel} onRename={props.onRenameLabel} />
      </g>
    </svg>
  );
}
```

- [ ] Run again, expect green:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/LayoutCanvas.test.tsx`
- [ ] Commit:
  `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/layout/LayoutCanvas.tsx client/src/test/sections/layout/LayoutCanvas.test.tsx && git commit -m "layout: SVG canvas renderer with viewport transform, live strokes, glow, handles"`

---

## Task 6: LayoutSection container + styles + integration tests

**Files:**
- Create: `client/src/sections/layout/LayoutSection.tsx`, `client/src/sections/layout/layout.css`
- Test: `client/src/test/sections/layout/LayoutSection.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1–5 exports (as specified above).
  - Phase D: `ControlSurface` from `client/src/control/ControlSurface` (props `{ targets: Target[]; open: boolean; onClose(): void }` — binding); `Target` from `client/src/api/client` (added by Phase D Task 1 — `ControlSurface.tsx` does not re-export it); `useLiveStatus(controllerIds: string[])` from `client/src/api/live`; `useControllers()` from `client/src/api/queries` (key `['controllers']`, ships in Phase C and is re-listed in Phase D).
  - Phase C: `useMutation`/`useQueryClient` from `@tanstack/react-query`; design token CSS variables.
  - Existing `api/client` fns: `addStrip`, `updateStrip`, `deleteStrip`, `addRoomLabel`, `updateRoomLabel`.
- Produces: `export function LayoutSection(): JSX element` — the Layout route component (consumed by the app shell in Task 7). Query keys written to: `['strips']`, `['room-labels']`.

**Steps:**

- [ ] Write the failing integration test `client/src/test/sections/layout/LayoutSection.test.tsx` (fails at import until the component exists). Note the two Phase-D module mocks and the `vi.hoisted` guard against mock-factory hoisting:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Controller, RoomLabel, Strip } from '../../../api/client';

const { liveMap } = vi.hoisted(() => ({ liveMap: new Map() }));

vi.mock('../../../api/live', () => ({
  useLiveStatus: () => liveMap
}));

vi.mock('../../../control/ControlSurface', () => ({
  ControlSurface: ({ targets, open }: { targets: unknown[]; open: boolean; onClose(): void }) =>
    open ? <div data-testid="control-surface">{JSON.stringify(targets)}</div> : null
}));

import { LayoutSection } from '../../../sections/layout/LayoutSection';

const strips: Strip[] = [
  { id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], label: 'Porch' },
  { id: 's2', controllerId: 'c2', wledSegId: 3, points: [{ x: 60, y: 60 }, { x: 90, y: 60 }], label: null }
];
const labels: RoomLabel[] = [{ id: 'l1', name: 'Kitchen', x: 50, y: 20 }];
const controllers: Controller[] = [
  { id: 'c1', name: 'Porch Ctrl', host: '192.168.1.86', source: 'manual', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'Deck Ctrl', host: '192.168.1.87', source: 'manual', stale: false, pinnedAssetPattern: null }
];

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

const fetchMock = vi.fn();
let rectSpy: Mock;

function mockCanvasRect(size: number) {
  (Element.prototype.getBoundingClientRect as unknown as Mock).mockReturnValue({
    left: 0, top: 0, width: size, height: size, right: size, bottom: size, x: 0, y: 0, toJSON: () => ({})
  } as DOMRect);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/strips' && method === 'GET') return jsonResponse(strips);
    if (url === '/api/strips' && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      return jsonResponse({ strip: { id: 's-new', label: null, ...body }, recommendations: [] }, 201);
    }
    if (url.startsWith('/api/strips/') && method === 'PATCH') {
      const id = url.split('/').pop() as string;
      const body = JSON.parse(String(init?.body));
      return jsonResponse({ ...(strips.find((s) => s.id === id) as Strip), ...body });
    }
    if (url.startsWith('/api/strips/') && method === 'DELETE') return jsonResponse(null, 204);
    if (url === '/api/room-labels' && method === 'GET') return jsonResponse(labels);
    if (url.startsWith('/api/room-labels/') && method === 'PATCH') {
      const id = url.split('/').pop() as string;
      const body = JSON.parse(String(init?.body));
      return jsonResponse({ ...(labels.find((l) => l.id === id) as RoomLabel), ...body });
    }
    if (url === '/api/controllers' && method === 'GET') return jsonResponse(controllers);
    throw new Error(`unmocked fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  // jsdom returns an all-zero rect; 100x100 makes screen coords == world coords
  // under the identity viewport.
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect') as unknown as Mock;
  mockCanvasRect(100);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LayoutSection />
    </QueryClientProvider>
  );
}

async function selectStripByPointer(id: string, clientX: number, clientY: number) {
  fireEvent.pointerDown(screen.getByTestId(`strip-hit-${id}`), { clientX, clientY });
  fireEvent.pointerUp(screen.getByTestId('layout-canvas'), { clientX, clientY });
  await screen.findByTestId('selection-bar');
}

describe('draw flow', () => {
  it('places vertices with clicks, finishes with Enter, and POSTs the strip', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 50 });
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByTestId('strip-save-panel');
    fireEvent.change(screen.getByLabelText('Controller'), { target: { value: 'c2' } });
    fireEvent.change(screen.getByLabelText('Segment ID'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Label (optional)'), { target: { value: 'Desk run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save strip' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips' && (i as RequestInit)?.method === 'POST');
      expect(post).toBeDefined();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({
        controllerId: 'c2',
        wledSegId: 3,
        points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }],
        label: 'Desk run'
      });
    });
    expect(screen.queryByTestId('strip-save-panel')).toBeNull();
  });

  it('Backspace undoes the last vertex; Escape cancels drawing', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    fireEvent.click(canvas, { clientX: 90, clientY: 10 });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(screen.getByTestId('draw-line').getAttribute('points')).toBe('10,10 50,10');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('draw-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Draw strip' })).toBeDefined();
    expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/strips' && (i as RequestInit)?.method === 'POST')).toBe(false);
  });

  it('double-click finishes the path without keeping the duplicate vertex', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.click(screen.getByRole('button', { name: 'Draw strip' }));
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    // the second click of a dblclick lands as an extra PLACE_VERTEX first
    fireEvent.click(canvas, { clientX: 50, clientY: 10 });
    fireEvent.doubleClick(canvas, { clientX: 50, clientY: 10 });
    await screen.findByTestId('strip-save-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Save strip' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips' && (i as RequestInit)?.method === 'POST');
      expect(JSON.parse(String((post![1] as RequestInit).body)).points).toEqual([{ x: 10, y: 10 }, { x: 50, y: 10 }]);
    });
  });
});

describe('selection', () => {
  it('shift+drag marquee selects intersecting strips and Control opens the surface with segment targets', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.pointerDown(screen.getByTestId('canvas-bg'), { clientX: 5, clientY: 5, shiftKey: true });
    fireEvent.pointerMove(canvas, { clientX: 95, clientY: 95 });
    fireEvent.pointerUp(canvas, { clientX: 95, clientY: 95 });
    const bar = await screen.findByTestId('selection-bar');
    expect(bar.textContent).toContain('2 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    const surface = screen.getByTestId('control-surface');
    expect(JSON.parse(surface.textContent as string)).toEqual([
      { kind: 'segment', controllerId: 'c1', wledSegId: 0 },
      { kind: 'segment', controllerId: 'c2', wledSegId: 3 }
    ]);
  });

  it('shift-click adds a second strip to the selection', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    fireEvent.pointerDown(screen.getByTestId('strip-hit-s2'), { clientX: 70, clientY: 60, shiftKey: true });
    fireEvent.pointerUp(screen.getByTestId('layout-canvas'));
    expect((await screen.findByTestId('selection-bar')).textContent).toContain('2 selected');
  });

  it('a plain click on empty canvas clears the selection', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    fireEvent.pointerDown(screen.getByTestId('canvas-bg'), { clientX: 80, clientY: 30 });
    fireEvent.pointerUp(screen.getByTestId('layout-canvas'), { clientX: 80, clientY: 30 });
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull());
  });
});

describe('editing', () => {
  it('dragging a selected strip persists translated points via PATCH', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.pointerDown(screen.getByTestId('strip-hit-s1'), { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 25, clientY: 30 });
    fireEvent.pointerUp(canvas, { clientX: 25, clientY: 30 });
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips/s1' && (i as RequestInit)?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        points: [{ x: 15, y: 30 }, { x: 45, y: 30 }]
      });
    });
  });

  it('dragging a vertex handle moves only that vertex', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    const canvas = screen.getByTestId('layout-canvas');
    fireEvent.pointerDown(screen.getByTestId('vertex-s1-0'), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 12, clientY: 44 });
    fireEvent.pointerUp(canvas, { clientX: 12, clientY: 44 });
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/strips/s1' && (i as RequestInit)?.method === 'PATCH');
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        points: [{ x: 12, y: 44 }, { x: 40, y: 10 }]
      });
    });
  });

  it('Delete removes the selected strip after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/strips/s1' && (i as RequestInit)?.method === 'DELETE')).toBe(true);
    });
    await waitFor(() => expect(screen.queryByTestId('strip-s1')).toBeNull());
  });

  it('declining the confirm leaves the strip alone', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSection();
    await screen.findByTestId('strip-s1');
    await selectStripByPointer('s1', 20, 10);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'DELETE')).toBe(false);
  });

  it('renaming a room label inline PATCHes the name', async () => {
    renderSection();
    await screen.findByTestId('room-label-l1');
    fireEvent.doubleClick(screen.getByTestId('room-label-l1'));
    const input = screen.getByTestId('room-label-input-l1');
    fireEvent.change(input, { target: { value: 'Pantry' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([u, i]) => u === '/api/room-labels/l1' && (i as RequestInit)?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ name: 'Pantry' });
    });
  });
});

describe('navigation', () => {
  it('wheel zooms the world group about the cursor', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    fireEvent.wheel(screen.getByTestId('layout-canvas'), { clientX: 50, clientY: 50, deltaY: -400 });
    const transform = screen.getByTestId('world-group').getAttribute('transform') as string;
    const scale = Number((/scale\(([\d.]+)\)/.exec(transform) as RegExpExecArray)[1]);
    expect(scale).toBeGreaterThan(1);
  });

  it('Fit all fits the 0..100 world box into the container', async () => {
    renderSection();
    await screen.findByTestId('strip-s1');
    mockCanvasRect(148);
    fireEvent.click(screen.getByRole('button', { name: 'Fit all' }));
    expect(screen.getByTestId('world-group').getAttribute('transform')).toBe('translate(24 24) scale(1)');
  });
});
```

- [ ] Run and confirm it fails with "Cannot find module '../../../sections/layout/LayoutSection'":
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/LayoutSection.test.tsx`
- [ ] Create `client/src/sections/layout/layout.css`:

```css
.layout-section { display: flex; flex-direction: column; gap: 12px; height: 100%; }

.layout-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.layout-toolbar h2 { margin: 0; }
.layout-toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.layout-btn {
  min-height: 40px; padding: 0 14px; cursor: pointer;
  border-radius: var(--radius-control, 10px);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.1));
  background: var(--surface-2, #1a2338); color: var(--text, #e6eaf2);
}
.layout-btn.primary { background: var(--accent, #7c6cff); border-color: transparent; color: #fff; }
.layout-btn.danger { background: var(--danger, #ef4444); border-color: transparent; color: #fff; }
.layout-btn:disabled { opacity: 0.5; cursor: default; }

.layout-input {
  min-height: 40px; padding: 0 10px;
  border-radius: var(--radius-control, 10px);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.1));
  background: var(--surface, #131a2a); color: var(--text, #e6eaf2);
}

.layout-snap-toggle { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; color: var(--text-muted, #8a94a8); }
.layout-draw-hint { color: var(--text-muted, #8a94a8); font-size: 13px; }

.layout-canvas-wrap {
  position: relative; flex: 1; min-height: 420px; overflow: hidden;
  border-radius: var(--radius-card, 16px);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.1));
  background: var(--surface, #131a2a);
}
.layout-canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.layout-hint { position: absolute; inset: auto 16px 16px; text-align: center; color: var(--text-muted, #8a94a8); pointer-events: none; }

.layout-grid-line { stroke: rgba(148, 163, 184, 0.08); stroke-width: 1px; }

/* Stroke COLOR is always set inline per strip (live / off / offline) so it wins
   the cascade — never add a stroke color rule for .strip-line here. */
.strip-line { stroke-width: 4px; stroke-linecap: round; stroke-linejoin: round; }
.strip-line.selected { stroke-width: 6px; }
.strip-hit { cursor: pointer; }

.vertex-handle { fill: var(--bg, #0b0f1a); stroke: var(--accent, #7c6cff); stroke-width: 2px; cursor: grab; }
.draw-line { stroke: var(--accent, #7c6cff); stroke-width: 2px; }
.draw-rubber { stroke: var(--accent, #7c6cff); stroke-width: 1.5px; stroke-dasharray: 4 4; }
.draw-vertex { fill: var(--accent, #7c6cff); }
.marquee-rect { fill: rgba(124, 108, 255, 0.12); stroke: var(--accent, #7c6cff); stroke-width: 1px; stroke-dasharray: 4 3; }

.room-chip { cursor: grab; }
.room-chip-bg { fill: var(--surface-2, #1a2338); stroke: var(--border, rgba(148, 163, 184, 0.25)); }
.room-chip-text { fill: var(--text, #e6eaf2); font-size: 12px; user-select: none; }
.room-chip-input {
  width: 100%; min-height: 26px; padding: 0 6px;
  border-radius: 8px; border: 1px solid var(--accent, #7c6cff);
  background: var(--surface, #131a2a); color: var(--text, #e6eaf2);
}

.layout-confirm-panel {
  display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; padding: 16px;
  border-radius: var(--radius-card, 16px);
  border: 1px solid var(--border, rgba(148, 163, 184, 0.1));
  background: var(--surface, #131a2a);
}
.layout-confirm-panel h3 { margin: 0; flex-basis: 100%; }
.layout-field { display: flex; flex-direction: column; gap: 4px; min-width: 160px; }
.layout-field label { font-size: 12px; color: var(--text-muted, #8a94a8); }
.layout-confirm-actions { display: flex; gap: 8px; }

.layout-selection-bar {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 40;
  display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid var(--border, rgba(148, 163, 184, 0.1));
  background: var(--surface-2, #1a2338);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
}

@media (max-width: 899px) {
  /* clear the phone bottom nav from Phase C */
  .layout-selection-bar { bottom: 88px; max-width: calc(100vw - 24px); }
  .layout-canvas-wrap { min-height: 320px; }
}
```

- [ ] Create `client/src/sections/layout/LayoutSection.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addRoomLabel, addStrip, deleteStrip, updateRoomLabel, updateStrip,
  type RoomLabel, type Strip, type Target
} from '../../api/client';
import { useControllers, useRoomLabels, useStrips } from '../../api/queries';
import { useLiveStatus } from '../../api/live';
import { ControlSurface } from '../../control/ControlSurface';
import {
  IDENTITY_VIEWPORT, fitAllViewport, normalizeRect, panBy, polylineIntersectsRect,
  screenToWorld, snapAngle, snapToGrid, zoomAt, type Point, type Viewport
} from './geometry';
import { initialLayoutState, layoutReducer } from './canvasMode';
import { LayoutCanvas } from './LayoutCanvas';
import './layout.css';

/** Fit-all always includes the legacy 0..100 world box so the "floor" stays framed. */
const WORLD_BOX_CORNERS: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }];

export function LayoutSection() {
  const queryClient = useQueryClient();
  const stripsQuery = useStrips();
  const labelsQuery = useRoomLabels();
  const controllersQuery = useControllers();

  const strips = useMemo(() => stripsQuery.data ?? [], [stripsQuery.data]);
  const labels = labelsQuery.data ?? [];
  const controllers = controllersQuery.data ?? [];

  const [state, dispatch] = useReducer(layoutReducer, initialLayoutState);
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT);
  const [drawCursor, setDrawCursor] = useState<Point | null>(null);
  const [dragOverride, setDragOverride] = useState<Map<string, Point[]>>(new Map());
  const [surfaceOpen, setSurfaceOpen] = useState(false);
  const [formControllerId, setFormControllerId] = useState('');
  const [formSegId, setFormSegId] = useState(0);
  const [formLabel, setFormLabel] = useState('');
  const [newLabelName, setNewLabelName] = useState('');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const touchPointsRef = useRef<Map<number, Point>>(new Map());

  const controllerIds = useMemo(
    () => Array.from(new Set(strips.map((s) => s.controllerId))).sort(),
    [strips]
  );
  const live = useLiveStatus(controllerIds);

  const renderStrips = useMemo(
    () => strips.map((s) => {
      const override = dragOverride.get(s.id);
      return override ? { ...s, points: override } : s;
    }),
    [strips, dragOverride]
  );

  const addStripMut = useMutation({
    mutationFn: (input: { controllerId: string; wledSegId: number; points: Point[]; label: string | null }) =>
      addStrip(input),
    onSuccess: ({ strip }) => {
      queryClient.setQueryData<Strip[]>(['strips'], (prev) => [...(prev ?? []), strip]);
      dispatch({ type: 'STRIP_SAVED' });
    }
  });

  const updateStripMut = useMutation({
    mutationFn: ({ id, points }: { id: string; points: Point[] }) => updateStrip(id, { points }),
    onSuccess: (saved) => {
      queryClient.setQueryData<Strip[]>(['strips'], (prev) =>
        (prev ?? []).map((s) => (s.id === saved.id ? saved : s))
      );
      setDragOverride((prev) => {
        const next = new Map(prev);
        next.delete(saved.id);
        return next;
      });
    }
  });

  const upsertLabel = (saved: RoomLabel) =>
    queryClient.setQueryData<RoomLabel[]>(['room-labels'], (prev) =>
      (prev ?? []).map((l) => (l.id === saved.id ? saved : l))
    );
  const moveLabelMut = useMutation({
    mutationFn: ({ id, x, y }: { id: string; x: number; y: number }) => updateRoomLabel(id, { x, y }),
    onSuccess: upsertLabel
  });
  const renameLabelMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateRoomLabel(id, { name }),
    onSuccess: upsertLabel
  });
  const addLabelMut = useMutation({
    mutationFn: (input: { name: string; x: number; y: number }) => addRoomLabel(input),
    onSuccess: (created) => {
      queryClient.setQueryData<RoomLabel[]>(['room-labels'], (prev) => [...(prev ?? []), created]);
      setNewLabelName('');
    }
  });

  const toScreen = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => screenToWorld(viewport, toScreen(clientX, clientY)),
    [viewport, toScreen]
  );

  // Native wheel listener: React's root-delegated onWheel is passive, so
  // preventDefault (needed to stop page scroll) requires a manual listener.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setViewport((vp) => zoomAt(vp, pt, Math.exp(-e.deltaY * 0.0015)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  async function handleDeleteSelected() {
    const ids = state.selection;
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} strip${ids.length === 1 ? '' : 's'} from the layout?`)) return;
    await Promise.all(ids.map((id) => deleteStrip(id)));
    queryClient.setQueryData<Strip[]>(['strips'], (prev) => (prev ?? []).filter((s) => !ids.includes(s.id)));
    dispatch({ type: 'SELECTION_DELETED' });
  }

  // Keyboard shortcuts. No dependency array on purpose: re-registering each
  // render keeps the handler's captured state fresh without a ref dance.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (state.mode.name === 'draw') {
        if (e.key === 'Enter') dispatch({ type: 'FINISH_DRAW' });
        if (e.key === 'Escape') { dispatch({ type: 'CANCEL' }); setDrawCursor(null); }
        if (e.key === 'Backspace') { e.preventDefault(); dispatch({ type: 'UNDO_VERTEX' }); }
        return;
      }
      if (state.mode.name === 'confirmStrip' && e.key === 'Escape') { dispatch({ type: 'CANCEL' }); return; }
      if (state.mode.name === 'idle' && state.selection.length > 0 && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        void handleDeleteSelected();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function applyDrawSnap(p: Point, shift: boolean): Point {
    let out = p;
    if (state.mode.name === 'draw' && shift && state.mode.vertices.length > 0) {
      out = snapAngle(state.mode.vertices[state.mode.vertices.length - 1], out);
    }
    if (state.gridSnap) out = snapToGrid(out);
    return out;
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (state.mode.name !== 'draw') return;
    dispatch({ type: 'PLACE_VERTEX', point: toWorld(e.clientX, e.clientY), shift: e.shiftKey });
  }

  function handleCanvasDoubleClick() {
    if (state.mode.name !== 'draw') return;
    // dblclick already fired two click events; drop the duplicate vertex.
    dispatch({ type: 'UNDO_VERTEX' });
    dispatch({ type: 'FINISH_DRAW' });
  }

  function handleBackgroundPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'touch') {
      touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointsRef.current.size > 1) return; // second finger = pinch, not a gesture start
    }
    if (state.mode.name !== 'idle') return;
    dispatch({
      type: 'BG_POINTER_DOWN',
      world: toWorld(e.clientX, e.clientY),
      screen: toScreen(e.clientX, e.clientY),
      shift: e.shiftKey
    });
  }

  function handleStripPointerDown(stripId: string, e: React.PointerEvent) {
    e.stopPropagation();
    if (state.mode.name !== 'idle') return;
    dispatch({ type: 'STRIP_POINTER_DOWN', stripId, point: toWorld(e.clientX, e.clientY), shift: e.shiftKey });
  }

  function handleVertexPointerDown(stripId: string, vertexIndex: number) {
    if (state.mode.name !== 'idle') return;
    dispatch({ type: 'VERTEX_POINTER_DOWN', stripId, vertexIndex });
  }

  function handlePointerMove(e: React.PointerEvent) {
    // Two-finger pinch zoom (touch only).
    if (e.pointerType === 'touch' && touchPointsRef.current.has(e.pointerId)) {
      if (touchPointsRef.current.size === 2) {
        const prev = new Map(touchPointsRef.current);
        touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a1, b1] = Array.from(prev.values());
        const [a2, b2] = Array.from(touchPointsRef.current.values());
        const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
        const d2 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (d1 > 0 && d2 > 0) {
          const mid = toScreen((a2.x + b2.x) / 2, (a2.y + b2.y) / 2);
          setViewport((vp) => zoomAt(vp, mid, d2 / d1));
        }
        return;
      }
      touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    const world = toWorld(e.clientX, e.clientY);
    const screen = toScreen(e.clientX, e.clientY);

    if (state.mode.name === 'draw') {
      setDrawCursor(applyDrawSnap(world, e.shiftKey));
      return;
    }
    if (state.mode.name === 'pan') {
      const dx = screen.x - state.mode.lastScreen.x;
      const dy = screen.y - state.mode.lastScreen.y;
      setViewport((vp) => panBy(vp, dx, dy));
    }
    if (state.mode.name === 'dragStrip') {
      const dx = world.x - state.mode.last.x;
      const dy = world.y - state.mode.last.y;
      setDragOverride((prev) => {
        const next = new Map(prev);
        for (const id of state.selection) {
          const base = next.get(id) ?? strips.find((s) => s.id === id)?.points;
          if (base) next.set(id, base.map((p) => ({ x: p.x + dx, y: p.y + dy })));
        }
        return next;
      });
    }
    if (state.mode.name === 'dragVertex') {
      const { stripId, vertexIndex } = state.mode;
      const target = state.gridSnap ? snapToGrid(world) : world;
      setDragOverride((prev) => {
        const next = new Map(prev);
        const base = next.get(stripId) ?? strips.find((s) => s.id === stripId)?.points;
        if (base) next.set(stripId, base.map((p, i) => (i === vertexIndex ? target : p)));
        return next;
      });
    }
    dispatch({ type: 'POINTER_MOVE', world, screen });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (e.pointerType === 'touch') touchPointsRef.current.delete(e.pointerId);
    if (state.mode.name === 'marquee') {
      const rect = normalizeRect(state.mode.origin, state.mode.current);
      const hits = renderStrips.filter((s) => polylineIntersectsRect(s.points, rect)).map((s) => s.id);
      dispatch({ type: 'POINTER_UP', marqueeHits: hits });
      return;
    }
    if ((state.mode.name === 'dragStrip' || state.mode.name === 'dragVertex') && state.mode.moved) {
      for (const [id, points] of dragOverride) updateStripMut.mutate({ id, points });
    }
    dispatch({ type: 'POINTER_UP' });
  }

  function handleStartDraw() {
    setFormControllerId(controllers[0]?.id ?? '');
    setFormSegId(0);
    setFormLabel('');
    setDrawCursor(null);
    dispatch({ type: 'START_DRAW' });
  }

  function handleSaveStrip() {
    if (state.mode.name !== 'confirmStrip' || !formControllerId) return;
    addStripMut.mutate({
      controllerId: formControllerId,
      wledSegId: formSegId,
      points: state.mode.vertices,
      label: formLabel.trim() || null
    });
  }

  function handleFitAll() {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const pts: Point[] = [
      ...WORLD_BOX_CORNERS,
      ...strips.flatMap((s) => s.points),
      ...labels.map((l) => ({ x: l.x, y: l.y }))
    ];
    setViewport(fitAllViewport(pts, rect.width, rect.height));
  }

  function handleAddLabel() {
    const name = newLabelName.trim();
    if (!name) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const center = rect && rect.width > 0
      ? screenToWorld(viewport, { x: rect.width / 2, y: rect.height / 2 })
      : { x: 50, y: 50 };
    addLabelMut.mutate({ name, x: center.x, y: center.y });
  }

  const targets: Target[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Target[] = [];
    for (const s of strips) {
      if (!state.selection.includes(s.id)) continue;
      const key = `${s.controllerId}:${s.wledSegId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'segment', controllerId: s.controllerId, wledSegId: s.wledSegId });
    }
    return out;
  }, [strips, state.selection]);

  const isDrawing = state.mode.name === 'draw';
  const marqueeRect = state.mode.name === 'marquee' ? normalizeRect(state.mode.origin, state.mode.current) : null;

  return (
    <section className="layout-section">
      <div className="layout-toolbar">
        <h2>Layout</h2>
        <div className="layout-toolbar-actions">
          <label className="layout-snap-toggle">
            <input type="checkbox" checked={state.gridSnap} onChange={() => dispatch({ type: 'TOGGLE_GRID_SNAP' })} />
            Snap to grid
          </label>
          <button type="button" className="layout-btn" onClick={handleFitAll}>Fit all</button>
          <input
            aria-label="new room label"
            className="layout-input"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            placeholder="Room label"
          />
          <button type="button" className="layout-btn" onClick={handleAddLabel} disabled={!newLabelName.trim()}>
            Add label
          </button>
          {!isDrawing && state.mode.name !== 'confirmStrip' && (
            <button type="button" className="layout-btn primary" onClick={handleStartDraw} disabled={controllers.length === 0}>
              Draw strip
            </button>
          )}
          {isDrawing && (
            <span className="layout-draw-hint">
              Click to place · Enter or double-click to finish · Esc cancels · Backspace undoes · Shift = 45°
            </span>
          )}
        </div>
      </div>

      <div className="layout-canvas-wrap">
        <LayoutCanvas
          strips={renderStrips}
          labels={labels}
          live={live}
          selection={state.selection}
          viewport={viewport}
          gridSnap={state.gridSnap}
          drawVertices={state.mode.name === 'draw' ? state.mode.vertices : null}
          drawCursor={state.mode.name === 'draw' ? drawCursor : null}
          marqueeRect={marqueeRect}
          svgRef={svgRef}
          toWorld={toWorld}
          onStripPointerDown={handleStripPointerDown}
          onVertexPointerDown={handleVertexPointerDown}
          onBackgroundPointerDown={handleBackgroundPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onCanvasClick={handleCanvasClick}
          onCanvasDoubleClick={handleCanvasDoubleClick}
          onMoveLabel={(id, x, y) => moveLabelMut.mutate({ id, x, y })}
          onRenameLabel={(id, name) => renameLabelMut.mutate({ id, name })}
        />
        {strips.length === 0 && !isDrawing && (
          <p className="layout-hint">
            {controllers.length === 0
              ? 'Add a controller in Devices, then come back here to draw your first strip.'
              : 'Click "Draw strip" to trace your first LED strip onto the canvas.'}
          </p>
        )}
      </div>

      {state.mode.name === 'confirmStrip' && (
        <div className="layout-confirm-panel" data-testid="strip-save-panel">
          <h3>Save strip</h3>
          <div className="layout-field">
            <label htmlFor="strip-controller">Controller</label>
            <select
              id="strip-controller"
              className="layout-input"
              value={formControllerId}
              onChange={(e) => setFormControllerId(e.target.value)}
            >
              {controllers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="layout-field">
            <label htmlFor="strip-seg">Segment ID</label>
            <input
              id="strip-seg"
              className="layout-input"
              type="number"
              min={0}
              value={formSegId}
              onChange={(e) => setFormSegId(Number(e.target.value))}
            />
          </div>
          <div className="layout-field">
            <label htmlFor="strip-label">Label (optional)</label>
            <input
              id="strip-label"
              className="layout-input"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="Porch rail"
            />
          </div>
          <div className="layout-confirm-actions">
            <button
              type="button"
              className="layout-btn primary"
              onClick={handleSaveStrip}
              disabled={!formControllerId || addStripMut.isPending}
            >
              Save strip
            </button>
            <button type="button" className="layout-btn" onClick={() => dispatch({ type: 'CANCEL' })}>Cancel</button>
          </div>
        </div>
      )}

      {state.selection.length > 0 && state.mode.name === 'idle' && (
        <div className="layout-selection-bar" data-testid="selection-bar">
          <span>{state.selection.length} selected</span>
          <button type="button" className="layout-btn primary" onClick={() => setSurfaceOpen(true)}>Control</button>
          <button type="button" className="layout-btn danger" onClick={() => void handleDeleteSelected()}>Delete</button>
          <button type="button" className="layout-btn" onClick={() => dispatch({ type: 'CLEAR_SELECTION' })}>Clear</button>
        </div>
      )}

      <ControlSurface targets={targets} open={surfaceOpen} onClose={() => setSurfaceOpen(false)} />
    </section>
  );
}
```

- [ ] Run the integration tests, expect all green:
  `cd /Users/bwwilliams/github/uber-wled/client && npm test -- src/test/sections/layout/LayoutSection.test.tsx`
- [ ] Commit:
  `cd /Users/bwwilliams/github/uber-wled && git add client/src/sections/layout/LayoutSection.tsx client/src/sections/layout/layout.css client/src/test/sections/layout/LayoutSection.test.tsx && git commit -m "layout: rebuilt LayoutSection with draw/edit/pan/marquee and ControlSurface handoff"`

---

## Task 7: Wire the route, delete the old canvas files, clean stale CSS

**Files:**
- Modify: the app-shell file that renders the Layout route. Locate it with `grep -rn "LayoutSection" /Users/bwwilliams/github/uber-wled/client/src --include='*.tsx' -l | grep -v test | grep -v sections/layout`. As of this writing that is `client/src/components/AppShell.tsx` (Phase C may have rewritten it — same edit applies wherever the import lives).
- Modify: `client/src/index.css` — only if it still exists and still contains the old layout rules.
- Delete: `client/src/components/LayoutSection.tsx`, `client/src/components/StripCanvas.tsx`, `client/src/components/StripPathEditor.tsx`, `client/src/components/RoomLabelLayer.tsx`, `client/src/test/LayoutSection.test.tsx`, `client/src/test/components/StripCanvas.test.tsx`, `client/src/test/components/StripPathEditor.test.tsx`, `client/src/test/components/RoomLabelLayer.test.tsx`
- Kept deliberately: `client/src/lib/segmentColor.ts` + `client/src/test/lib/segmentColor.test.ts` (consumed by `stripColors.ts` and by Home), `client/src/components/ControlPanel.tsx` (NOT kept for a HomeSection dependency — HomeSection never imports it; the real reason is that it still POSTs the v1 `{members, action}` control body, via this task's own `LayoutSection.tsx` calling `applyControlV1`, and the master plan keeps the v1 apply route alive until Phase I retires it. This task deletes `LayoutSection.tsx`, which will leave `ControlPanel.tsx` with zero importers — it is left in place anyway because per-phase orphan cleanup is Phase I's job (`09-migration-release.md` Task 4's sweep), not this task's; verify importer count with grep before touching, but do not delete it here regardless of what the grep shows).

**Interfaces:**
- Consumes: `LayoutSection` from Task 6.
- Produces: the app renders `sections/layout/LayoutSection` on the Layout route; the four legacy files are gone.

**Steps:**

- [ ] In the shell file found by the grep above, replace the old import
      `import { LayoutSection } from './LayoutSection';`
      with
      `import { LayoutSection } from '../sections/layout/LayoutSection';`
      (keep the same relative depth if the shell lives elsewhere — from `client/src/components/` the prefix is `../`). The JSX usage `<LayoutSection />` is unchanged.
- [ ] Verify nothing else imports the legacy modules (expect only the four files being deleted and their tests):
  `grep -rn "StripCanvas\|StripPathEditor\|RoomLabelLayer\|components/LayoutSection" /Users/bwwilliams/github/uber-wled/client/src`
- [ ] Delete the legacy implementation and test files:
  `cd /Users/bwwilliams/github/uber-wled && git rm client/src/components/LayoutSection.tsx client/src/components/StripCanvas.tsx client/src/components/StripPathEditor.tsx client/src/components/RoomLabelLayer.tsx client/src/test/LayoutSection.test.tsx client/src/test/components/StripCanvas.test.tsx client/src/test/components/StripPathEditor.test.tsx client/src/test/components/RoomLabelLayer.test.tsx`
- [ ] If `client/src/index.css` still exists, delete the now-dead rule blocks for these exact selectors (currently lines 635–769, starting at the `/* ---------- Strip canvas (Layout) ---------- */` banner): `.strip-canvas`, `.strip-canvas.draw`, `.strip`, `.strip.selected`, `.strip.stale`, `.strip-marquee`, `.layout-toolbar`, `.layout-toolbar-actions`, `.layout-body`, `.layout-canvas-wrap`, `.layout-canvas-hint`, `.room-label`, `.room-label:active` — the new equivalents live in `sections/layout/layout.css`. (If Phase C already replaced `index.css` with `design/global.css` and these selectors are gone, skip this step.)
- [ ] Run the full client suite and the production build — both must be green (the suite proves no test still references the deleted files; the build proves no dangling imports):
  `cd /Users/bwwilliams/github/uber-wled/client && npm test && npm run build`
- [ ] Commit:
  `cd /Users/bwwilliams/github/uber-wled && git add -A client/src && git commit -m "layout: route to rebuilt canvas, delete legacy StripCanvas/StripPathEditor/RoomLabelLayer"`

---

## Phase completion checklist

- [ ] `cd /Users/bwwilliams/github/uber-wled/client && npm test` — full suite green.
- [ ] `cd /Users/bwwilliams/github/uber-wled/client && npm run build` — green.
- [ ] `cd /Users/bwwilliams/github/uber-wled/server && npm test` — still green (this phase must not have touched the server).
- [ ] Manual spot-check against the dev server at 1440px and 390px: draw a strip (Shift for 45°, grid snap on/off), wheel-zoom + drag-pan + Fit all, marquee two strips → Control opens the shared surface, drag a label and rename it inline, strips show live colors while the SSE stream is connected (no more 5s poller anywhere in `sections/layout/`).
- [ ] Per the real-hardware policy: canvas verification is read-only (live colors via SSE); any color/effect writes exercised through the Control surface during manual checks must capture-then-restore device state.
