import { describe, it, expect } from 'vitest';
import { segmentToCssColor } from '../../lib/segmentColor';

describe('segmentToCssColor', () => {
  it('returns a muted color when the segment is off', () => {
    expect(segmentToCssColor({ on: false, bri: 255, col: [[255, 0, 0]] })).toBe('#334155');
  });
  it('scales the primary color by brightness when on', () => {
    expect(segmentToCssColor({ on: true, bri: 128, col: [[200, 100, 50]] })).toBe('rgb(100, 50, 25)');
  });
  it('falls back to a neutral color when col is empty', () => {
    expect(segmentToCssColor({ on: true, bri: 255, col: [] })).toBe('rgb(148, 163, 184)');
  });
});
