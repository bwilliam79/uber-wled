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
