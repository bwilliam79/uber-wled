import { describe, it, expect } from 'vitest';
import { recommendSplits } from '../../src/segments/recommend.js';

describe('recommendSplits', () => {
  it('recommends no split when each placement maps to its own device segment', () => {
    const placements = [
      { wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { wledSegId: 1, points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] }
    ];
    const deviceSegments = [
      { id: 0, start: 0, stop: 60 },
      { id: 1, start: 60, stop: 120 }
    ];
    expect(recommendSplits(placements, deviceSegments)).toEqual([]);
  });

  it('recommends a split when two placements share one device segment', () => {
    const placements = [
      { wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { wledSegId: 0, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] }
    ];
    const deviceSegments = [{ id: 0, start: 0, stop: 120 }];
    const result = recommendSplits(placements, deviceSegments);
    expect(result).toHaveLength(1);
    expect(result[0].deviceSegId).toBe(0);
    expect(result[0].suggestedSplitAt).toBe(60);
    expect(result[0].reason).toMatch(/two placements/i);
  });
});
