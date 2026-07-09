import { describe, it, expect } from 'vitest';
import {
  validateSegmentBounds, nextFreeSegmentId,
  canSplitSegment, splitMidpoint, splitSegmentAt, mergeSegments, clampBoundary, sortedByStart
} from '../../sections/devices/segmentLogic';

describe('validateSegmentBounds', () => {
  it('accepts the real probed segment 0..39 on a 48-LED device', () =>
    expect(validateSegmentBounds(0, 39, 48)).toBeNull());
  it('accepts a segment ending exactly at the LED count', () =>
    expect(validateSegmentBounds(39, 48, 48)).toBeNull());
  it('rejects negative start', () =>
    expect(validateSegmentBounds(-1, 10, 48)).toMatch(/0 or greater/i));
  it('rejects stop <= start', () =>
    expect(validateSegmentBounds(10, 10, 48)).toMatch(/greater than start/i));
  it('rejects stop beyond the LED count', () =>
    expect(validateSegmentBounds(0, 49, 48)).toMatch(/48/));
  it('rejects non-integers', () =>
    expect(validateSegmentBounds(0.5, 10, 48)).toMatch(/whole numbers/i));
});

describe('nextFreeSegmentId', () => {
  it('returns the next id after the real probed segments 0 and 1', () =>
    expect(nextFreeSegmentId([{ id: 0 }, { id: 1 }], 32)).toBe(2));
  it('fills gaps first', () =>
    expect(nextFreeSegmentId([{ id: 0 }, { id: 2 }], 32)).toBe(1));
  it('returns null when all slots are used', () => {
    const all = Array.from({ length: 32 }, (_, i) => ({ id: i }));
    expect(nextFreeSegmentId(all, 32)).toBeNull();
  });
});

describe('canSplitSegment / splitMidpoint', () => {
  it('a 1-LED segment cannot split', () => expect(canSplitSegment({ start: 5, stop: 6 })).toBe(false));
  it('a 2-LED segment can split', () => expect(canSplitSegment({ start: 0, stop: 2 })).toBe(true));
  it('midpoint of 0..39 is 19', () => expect(splitMidpoint({ start: 0, stop: 39 })).toBe(19));
  it('midpoint floors an odd span', () => expect(splitMidpoint({ start: 0, stop: 3 })).toBe(1));
});

describe('splitSegmentAt', () => {
  it('splits 0..48 at 20 into [0,20) and [20,48)', () => {
    expect(splitSegmentAt({ start: 0, stop: 48 }, 20)).toEqual({
      left: { start: 0, stop: 20 },
      right: { start: 20, stop: 48 }
    });
  });
  it('rejects a boundary at or outside the segment edges', () => {
    expect(splitSegmentAt({ start: 0, stop: 48 }, 0)).toBeNull();
    expect(splitSegmentAt({ start: 0, stop: 48 }, 48)).toBeNull();
    expect(splitSegmentAt({ start: 10, stop: 20 }, 25)).toBeNull();
  });
});

describe('mergeSegments', () => {
  it('spans both segments and keeps the lower id', () => {
    expect(mergeSegments({ id: 1, start: 20, stop: 48 }, { id: 3, start: 0, stop: 20 })).toEqual({
      keepId: 1, deleteId: 3, start: 0, stop: 48
    });
  });
  it('is order-independent', () => {
    const a = { id: 2, start: 0, stop: 10 };
    const b = { id: 0, start: 10, stop: 24 };
    expect(mergeSegments(a, b)).toEqual({ keepId: 0, deleteId: 2, start: 0, stop: 24 });
  });
});

describe('clampBoundary', () => {
  it('keeps >= 1 LED on each side', () => {
    expect(clampBoundary(0, 0, 48)).toBe(1);
    expect(clampBoundary(48, 0, 48)).toBe(47);
    expect(clampBoundary(20.4, 0, 48)).toBe(20);
  });
});

describe('sortedByStart', () => {
  it('orders left-to-right by start then id', () => {
    const out = sortedByStart([
      { id: 2, start: 20 }, { id: 0, start: 0 }, { id: 1, start: 20 }
    ]);
    expect(out.map((s) => s.id)).toEqual([0, 1, 2]);
  });
});
