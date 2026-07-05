import { describe, it, expect } from 'vitest';
import { validateSegmentBounds, nextFreeSegmentId } from '../../sections/devices/segmentLogic';

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
