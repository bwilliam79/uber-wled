import { describe, it, expect } from 'vitest';
import { themeToPatch } from '../lib/themePatch';

const theme = { id: 't', name: 'LSU Wipe', effect: 55, palette: 0, brightness: 140, speed: 242, intensity: 128,
  colors: [[170, 0, 255, 0], [255, 215, 0, 0], [255, 255, 255, 0]] };

describe('themeToPatch', () => {
  it('builds the theme patch without segRev when no directions are stored', () => {
    expect(themeToPatch(theme, { on: true })).toEqual({
      on: true, bri: 140, seg: { fxId: 55, palId: 0, col: theme.colors, sx: 242, ix: 128 }
    });
    expect(themeToPatch({ ...theme, directions: null })).not.toHaveProperty('segRev');
    expect(themeToPatch({ ...theme, directions: {} })).not.toHaveProperty('segRev');
  });

  it('adds a controllerId → rev map when directions are stored', () => {
    expect(themeToPatch({ ...theme, directions: { a: { rev: false }, b: { rev: true } } }).segRev)
      .toEqual({ a: false, b: true });
  });
});
