import { describe, it, expect } from 'vitest';
import { moveId, dropIndexForPoint } from '../../../sections/home/reorder';

describe('moveId', () => {
  it('moves an id to a later index', () => {
    expect(moveId(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
  });
  it('moves an id earlier and clamps out-of-range targets', () => {
    expect(moveId(['a', 'b', 'c'], 'c', -5)).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a']);
  });
  it('returns the array unchanged for an unknown id or a no-op move', () => {
    expect(moveId(['a', 'b'], 'x', 1)).toEqual(['a', 'b']);
    expect(moveId(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
  });
});

describe('dropIndexForPoint', () => {
  const rects = [
    { left: 0, top: 0, right: 100, bottom: 100 },
    { left: 110, top: 0, right: 210, bottom: 100 },
    { left: 0, top: 110, right: 100, bottom: 210 }
  ];
  it('returns the index of the tile whose center is nearest the pointer', () => {
    expect(dropIndexForPoint(rects, 160, 50)).toBe(1);
    expect(dropIndexForPoint(rects, 10, 200)).toBe(2);
  });
  it('returns 0 for an empty rect list', () => {
    expect(dropIndexForPoint([], 50, 50)).toBe(0);
  });
});
