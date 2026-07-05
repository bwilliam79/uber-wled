import { describe, it, expect } from 'vitest';
import { parsePresetsJson } from '../../src/devices/presets.js';

// A fresh WLED 16.0.0 device serves {"0":{}} (probed live at 192.168.1.86).
// Saved presets store a full state snapshot with `n`; playlists store a
// `playlist` object; WLED pads deleted slots as {} or omits them.
const RAW: Record<string, unknown> = {
  '0': {},
  '1': {
    n: 'Warm White', on: true, bri: 128, transition: 7, mainseg: 0,
    seg: [
      {
        id: 0, start: 0, stop: 39, grp: 1, spc: 0, of: 0, on: true, frz: false, bri: 255, cct: 127,
        col: [[255, 197, 143, 0], [0, 0, 0, 0], [0, 0, 0, 0]], fx: 0, sx: 128, ix: 128, pal: 0,
        c1: 128, c2: 128, c3: 16, sel: true, rev: false, mi: false, o1: false, o2: false, o3: false
      },
      { stop: 0 }
    ]
  },
  '3': {
    n: 'Party Mix', on: true, bri: 200,
    seg: [{ id: 0, start: 0, stop: 48, fx: 9, pal: 6, col: [[255, 0, 0], [0, 255, 0], [0, 0, 255]] }]
  },
  '7': {
    n: 'Evening Playlist', on: true,
    playlist: { ps: [1, 3], dur: [300, 300], transition: [7, 7], repeat: 0, end: 0 }
  }
};

describe('parsePresetsJson', () => {
  it('skips slot 0 and unnamed slots, sorts by id, and extracts quicklook fields', () => {
    expect(parsePresetsJson(RAW)).toEqual([
      { id: 1, name: 'Warm White', isPlaylist: false, quicklook: { on: true, bri: 128, fx: 0, pal: 0 } },
      { id: 3, name: 'Party Mix', isPlaylist: false, quicklook: { on: true, bri: 200, fx: 9, pal: 6 } },
      { id: 7, name: 'Evening Playlist', isPlaylist: true, quicklook: { on: true } }
    ]);
  });

  it('returns [] for a fresh device ({"0":{}})', () => {
    expect(parsePresetsJson({ '0': {} })).toEqual([]);
  });

  it('omits quicklook entirely when a preset has no recognizable fields', () => {
    expect(parsePresetsJson({ '2': { n: 'Opaque' } })).toEqual([
      { id: 2, name: 'Opaque', isPlaylist: false }
    ]);
  });
});
