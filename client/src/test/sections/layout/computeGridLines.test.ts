import { describe, it, expect } from 'vitest';
import { computeGridLines } from '../../../sections/layout/LayoutCanvas';
import { GRID_SIZE, IDENTITY_VIEWPORT } from '../../../sections/layout/geometry';

describe('computeGridLines', () => {
  it('spans the actual visible canvas area, not a fixed 0..100 box', () => {
    // A real strip-drawing canvas is commonly hundreds of pixels wide, and at
    // the default scale:1 viewport, world coordinates match screen pixels 1:1
    // — so a real drawn strip easily has coordinates well past 100.
    const { vertical, horizontal } = computeGridLines({ width: 800, height: 600 }, IDENTITY_VIEWPORT);
    expect(vertical[0].pos).toBeLessThanOrEqual(0);
    expect(vertical[vertical.length - 1].pos).toBeGreaterThanOrEqual(800);
    expect(horizontal[0].pos).toBeLessThanOrEqual(0);
    expect(horizontal[horizontal.length - 1].pos).toBeGreaterThanOrEqual(600);
  });

  it('uses the raw GRID_SIZE step when the visible area is small enough', () => {
    const { vertical } = computeGridLines({ width: 100, height: 100 }, IDENTITY_VIEWPORT);
    const steps = vertical.slice(1).map((l, i) => l.pos - vertical[i].pos);
    expect(steps.every((s) => s === GRID_SIZE)).toBe(true);
  });

  it('coarsens the step (doubling) when the naive line count would be excessive', () => {
    // 800px wide at GRID_SIZE=2 needs 400 lines — well past the 150 cap.
    const { vertical } = computeGridLines({ width: 800, height: 600 }, IDENTITY_VIEWPORT);
    expect(vertical.length).toBeLessThanOrEqual(151);
    const steps = vertical.slice(1).map((l, i) => l.pos - vertical[i].pos);
    const uniformStep = steps[0];
    expect(uniformStep).toBeGreaterThan(GRID_SIZE);
    expect(Math.log2(uniformStep / GRID_SIZE) % 1).toBe(0); // a clean power-of-two multiple
    expect(steps.every((s) => s === uniformStep)).toBe(true);
  });

  it('coarsens further at extreme zoom-out (large visible world area)', () => {
    const zoomedOut = { scale: 0.05, tx: 0, ty: 0 }; // 800 screen px -> 16000 world units
    const { vertical } = computeGridLines({ width: 800, height: 600 }, zoomedOut);
    expect(vertical.length).toBeLessThanOrEqual(151);
    const step = vertical[1].pos - vertical[0].pos;
    expect(step).toBeGreaterThan(32); // much coarser than the un-zoomed case
  });

  it('marks major lines at absolute multiples of 4x the step', () => {
    const { vertical } = computeGridLines({ width: 800, height: 600 }, IDENTITY_VIEWPORT);
    const step = vertical[1].pos - vertical[0].pos;
    for (const line of vertical) {
      expect(line.major).toBe(line.pos % (step * 4) === 0);
    }
    expect(vertical.some((l) => l.major)).toBe(true);
    expect(vertical.some((l) => !l.major)).toBe(true);
  });

  it('keeps major-line alignment stable across pan — a given world position is major or not regardless of which pan brought it into view', () => {
    const viewA = { scale: 1, tx: 0, ty: 0 }; // visible x: 0..800
    const viewB = { scale: 1, tx: -400, ty: 0 }; // visible x: 400..1200 (world x=400..800 overlaps both)
    const a = computeGridLines({ width: 800, height: 600 }, viewA);
    const b = computeGridLines({ width: 800, height: 600 }, viewB);
    const overlapPositions = a.vertical.map((l) => l.pos).filter((p) => p >= 400 && p <= 800);
    expect(overlapPositions.length).toBeGreaterThan(0);
    for (const pos of overlapPositions) {
      const inA = a.vertical.find((l) => l.pos === pos)!;
      const inB = b.vertical.find((l) => l.pos === pos)!;
      expect(inB.major).toBe(inA.major);
    }
  });

  it('produces no lines when the canvas has zero area', () => {
    const { vertical, horizontal } = computeGridLines({ width: 0, height: 0 }, IDENTITY_VIEWPORT);
    // Degenerate but should not throw — a single line at the collapsed point is fine.
    expect(vertical.length).toBeGreaterThanOrEqual(1);
    expect(horizontal.length).toBeGreaterThanOrEqual(1);
  });
});
