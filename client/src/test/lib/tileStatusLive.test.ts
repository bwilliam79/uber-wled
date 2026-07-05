import { describe, it, expect } from 'vitest';
import { aggregateTileStatusLive, type LiveTileSource, type LiveTileState } from '../../lib/tileStatus';

function src(state?: LiveTileState, reachable = true): LiveTileSource {
  return { reachable, state };
}

describe('aggregateTileStatusLive', () => {
  it('reads whole-controller members from the top-level state', () => {
    const live = new Map([['c1', src({ on: true, bri: 200, seg: [] })]]);
    expect(aggregateTileStatusLive([{ controllerId: 'c1', wledSegId: null }], live))
      .toEqual({ power: 'on', brightness: 200, anyOffline: false, allOffline: false });
  });

  it('treats a segment as off when master power is off even if the segment flag is on', () => {
    const live = new Map([['c1', src({ on: false, bri: 128, seg: [{ id: 0, on: true, bri: 255 }] })]]);
    expect(aggregateTileStatusLive([{ controllerId: 'c1', wledSegId: 0 }], live))
      .toEqual({ power: 'off', brightness: null, anyOffline: false, allOffline: false });
  });

  it('reports mixed across members and averages brightness over on members only', () => {
    const live = new Map([
      ['c1', src({ on: true, bri: 9, seg: [{ id: 0, on: true, bri: 255 }, { id: 1, on: false, bri: 255 }] })]
    ]);
    expect(aggregateTileStatusLive(
      [{ controllerId: 'c1', wledSegId: 0 }, { controllerId: 'c1', wledSegId: 1 }], live))
      .toEqual({ power: 'mixed', brightness: 255, anyOffline: false, allOffline: false });
  });

  it('flags anyOffline for an unreachable controller and allOffline when every member is', () => {
    const live = new Map([['c1', src(undefined, false)]]);
    expect(aggregateTileStatusLive([{ controllerId: 'c1', wledSegId: null }], live))
      .toEqual({ power: 'unknown', brightness: null, anyOffline: true, allOffline: true });
  });

  it('counts a missing segment id as offline without failing the tile', () => {
    const live = new Map([['c1', src({ on: true, bri: 100, seg: [{ id: 0, on: true, bri: 100 }] })]]);
    expect(aggregateTileStatusLive(
      [{ controllerId: 'c1', wledSegId: 0 }, { controllerId: 'c1', wledSegId: 5 }], live))
      .toEqual({ power: 'on', brightness: 100, anyOffline: true, allOffline: false });
  });

  it('returns unknown for an empty member list', () => {
    expect(aggregateTileStatusLive([], new Map()))
      .toEqual({ power: 'unknown', brightness: null, anyOffline: false, allOffline: false });
  });

  it('handles the real-device shape captured from 192.168.1.86', () => {
    // captured 2026-07-04 from GET /json/state (WLED 16.0.0 "Niji"): master bri 9, both segs on
    const state: LiveTileState = {
      on: true, bri: 9,
      seg: [{ id: 0, on: true, bri: 255 }, { id: 1, on: true, bri: 255 }]
    };
    const live = new Map([['cabinet', src(state)]]);
    expect(aggregateTileStatusLive(
      [{ controllerId: 'cabinet', wledSegId: 0 }, { controllerId: 'cabinet', wledSegId: 1 }], live))
      .toEqual({ power: 'on', brightness: 255, anyOffline: false, allOffline: false });
  });
});
