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
