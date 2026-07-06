import { describe, it, expect } from 'vitest';
import {
  swatchesForEntry, swatchesForMembers,
  SWATCH_PENDING_COLOR, SWATCH_UNREACHABLE_COLOR,
  type LiveSwatchSource
} from '../../lib/liveOutputSwatches';

describe('swatchesForEntry', () => {
  it('renders a single pending swatch when there is no entry yet', () => {
    expect(swatchesForEntry(undefined)).toEqual([
      { key: 'c:pending', state: 'pending', color: SWATCH_PENDING_COLOR, len: 1 }
    ]);
  });

  it('renders a single unreachable swatch when the target is unreachable', () => {
    expect(swatchesForEntry({ reachable: false })).toEqual([
      { key: 'c:unreachable', state: 'unreachable', color: SWATCH_UNREACHABLE_COLOR, len: 1 }
    ]);
  });

  it('renders a single pending swatch when reachable but state has not arrived yet', () => {
    expect(swatchesForEntry({ reachable: true })).toEqual([
      { key: 'c:pending', state: 'pending', color: SWATCH_PENDING_COLOR, len: 1 }
    ]);
  });

  it('renders one swatch per segment, colored when on, sized by the segment\'s real LED count', () => {
    const source: LiveSwatchSource = {
      reachable: true,
      state: {
        on: true,
        seg: [
          { id: 0, on: true, bri: 255, col: [[255, 0, 0]], len: 39, start: 0 },
          { id: 1, on: true, bri: 128, col: [[0, 0, 255]], len: 9, start: 39 }
        ]
      }
    };
    expect(swatchesForEntry(source)).toEqual([
      { key: 'c:0', state: 'on', color: 'rgb(255, 0, 0)', len: 39 },
      { key: 'c:1', state: 'on', color: 'rgb(0, 0, 128)', len: 9 }
    ]);
  });

  it('marks a segment off when the segment itself is off even if master power is on', () => {
    const source: LiveSwatchSource = {
      reachable: true,
      state: { on: true, seg: [{ id: 0, on: false, bri: 255, col: [[255, 0, 0]], len: 39, start: 0 }] }
    };
    expect(swatchesForEntry(source)).toEqual([
      { key: 'c:0', state: 'off', color: '#334155', len: 39 }
    ]);
  });

  it('marks every segment off when master power is off, even if the segment reports on', () => {
    const source: LiveSwatchSource = {
      reachable: true,
      state: { on: false, seg: [{ id: 0, on: true, bri: 255, col: [[255, 0, 0]], len: 39, start: 0 }] }
    };
    expect(swatchesForEntry(source)).toEqual([
      { key: 'c:0', state: 'off', color: '#334155', len: 39 }
    ]);
  });

  it('floors a zero/negative reported length to 1 so a swatch never disappears entirely', () => {
    const source: LiveSwatchSource = {
      reachable: true,
      state: { on: true, seg: [{ id: 0, on: true, bri: 255, col: [[255, 0, 0]], len: 0, start: 0 }] }
    };
    expect(swatchesForEntry(source)[0].len).toBe(1);
  });
});

describe('swatchesForEntry — live-pixel gradients', () => {
  const source: LiveSwatchSource = {
    reachable: true,
    state: {
      on: true,
      seg: [
        { id: 0, on: true, bri: 255, col: [[255, 0, 0]], len: 2, start: 0 },
        { id: 1, on: false, bri: 255, col: [[0, 255, 0]], len: 2, start: 2 }
      ]
    }
  };
  const pixels = new Uint8Array([
    10, 20, 30, 40, 50, 60, // segment 0's two LEDs
    70, 80, 90, 100, 110, 120 // segment 1's two LEDs
  ]);

  it('computes a gradient sliced from the segment\'s own start/len range', () => {
    const swatches = swatchesForEntry(source, pixels);
    expect(swatches[0].gradient).toBe('linear-gradient(to right, rgb(10, 20, 30), rgb(40, 50, 60))');
  });

  it('does not compute a gradient for a segment that is off', () => {
    const swatches = swatchesForEntry(source, pixels);
    expect(swatches[1].gradient).toBeUndefined();
  });

  it('omits the gradient when no live-pixel frame is available', () => {
    const swatches = swatchesForEntry(source);
    expect(swatches[0].gradient).toBeUndefined();
  });

  it('omits the gradient when the pixel buffer is too short to cover the segment', () => {
    const shortPixels = new Uint8Array([10, 20, 30]); // only one LED's worth
    const swatches = swatchesForEntry(source, shortPixels);
    expect(swatches[0].gradient).toBeUndefined();
  });
});

describe('swatchesForMembers', () => {
  const SEG_STATE = {
    on: true,
    seg: [
      { id: 0, on: true, bri: 255, col: [[255, 0, 0]], len: 39, start: 0 },
      { id: 1, on: false, bri: 200, col: [[0, 255, 0]], len: 9, start: 39 }
    ]
  };

  it('returns no swatches for an empty member list', () => {
    expect(swatchesForMembers([], new Map())).toEqual([]);
  });

  it('expands a whole-controller member (wledSegId null) into every segment', () => {
    const live = new Map<string, LiveSwatchSource>([['c1', { reachable: true, state: SEG_STATE }]]);
    const swatches = swatchesForMembers([{ controllerId: 'c1', wledSegId: null }], live);
    expect(swatches.map((s) => s.key)).toEqual(['c1:0', 'c1:1']);
    expect(swatches[0].state).toBe('on');
    expect(swatches[1].state).toBe('off');
    expect(swatches[0].len).toBe(39);
    expect(swatches[1].len).toBe(9);
  });

  it('narrows a member with a specific wledSegId to just that segment', () => {
    const live = new Map<string, LiveSwatchSource>([['c1', { reachable: true, state: SEG_STATE }]]);
    const swatches = swatchesForMembers([{ controllerId: 'c1', wledSegId: 1 }], live);
    expect(swatches).toEqual([{ key: 'c1:1', state: 'off', color: '#334155', len: 9 }]);
  });

  it('treats a missing segment id as unreachable rather than dropping it silently', () => {
    const live = new Map<string, LiveSwatchSource>([['c1', { reachable: true, state: SEG_STATE }]]);
    const swatches = swatchesForMembers([{ controllerId: 'c1', wledSegId: 9 }], live);
    expect(swatches).toEqual([
      { key: 'c1:unreachable', state: 'unreachable', color: SWATCH_UNREACHABLE_COLOR, len: 1 }
    ]);
  });

  it('combines multiple room members, each contributing its own swatches', () => {
    const live = new Map<string, LiveSwatchSource>([
      ['c1', { reachable: true, state: SEG_STATE }],
      ['c2', { reachable: false }]
    ]);
    const swatches = swatchesForMembers(
      [{ controllerId: 'c1', wledSegId: 0 }, { controllerId: 'c2', wledSegId: null }],
      live
    );
    expect(swatches).toEqual([
      { key: 'c1:0', state: 'on', color: 'rgb(255, 0, 0)', len: 39 },
      { key: 'c2:unreachable', state: 'unreachable', color: SWATCH_UNREACHABLE_COLOR, len: 1 }
    ]);
  });

  it('renders a pending swatch per member absent from the live map', () => {
    const swatches = swatchesForMembers([{ controllerId: 'c1', wledSegId: null }], new Map());
    expect(swatches).toEqual([{ key: 'c1:pending', state: 'pending', color: SWATCH_PENDING_COLOR, len: 1 }]);
  });

  it('looks up each member\'s live pixels by controllerId', () => {
    const live = new Map<string, LiveSwatchSource>([['c1', { reachable: true, state: SEG_STATE }]]);
    const livePixelsByController = new Map<string, Uint8Array>([
      ['c1', new Uint8Array([1, 2, 3, ...Array(38 * 3).fill(0)])]
    ]);
    const swatches = swatchesForMembers(
      [{ controllerId: 'c1', wledSegId: 0 }], live, livePixelsByController
    );
    expect(swatches[0].gradient).toContain('rgb(1, 2, 3)');
  });
});
