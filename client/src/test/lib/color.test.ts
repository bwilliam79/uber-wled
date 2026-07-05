import { describe, it, expect } from 'vitest';
import { kelvinToRgb, rgbToHex, hexToRgb, paletteGradientCss } from '../../lib/color';

describe('kelvinToRgb', () => {
  // Expected values computed from the Tanner Helland approximation used in the implementation.
  it('maps the four quick-preset temperatures', () => {
    expect(kelvinToRgb(2700)).toEqual([255, 167, 87]);
    expect(kelvinToRgb(3500)).toEqual([255, 193, 141]);
    expect(kelvinToRgb(5000)).toEqual([255, 228, 206]);
    expect(kelvinToRgb(6500)).toEqual([255, 254, 250]);
  });
  it('clamps out-of-range inputs', () => {
    expect(kelvinToRgb(200)).toEqual(kelvinToRgb(1000));   // [255, 68, 0]
    expect(kelvinToRgb(99000)).toEqual(kelvinToRgb(40000));
  });
  it('is warm below and cool above the 6600K pivot', () => {
    expect(kelvinToRgb(2700)[2]).toBeLessThan(120);
    expect(kelvinToRgb(10000)).toEqual([202, 218, 255]);
  });
});

describe('hex <-> rgb', () => {
  it('round-trips', () => {
    expect(rgbToHex([255, 167, 87])).toBe('#ffa757');
    expect(hexToRgb('#ffa757')).toEqual([255, 167, 87]);
    expect(hexToRgb('FFA757')).toEqual([255, 167, 87]); // no #, uppercase
  });
  it('rgbToHex ignores a white channel and clamps', () => {
    expect(rgbToHex([255, 0, 0, 128])).toBe('#ff0000');
    expect(rgbToHex([300, -5, 12.4])).toBe('#ff000c');
  });
  it('rgbToHex clamps and tolerates short arrays (Phase H lib/color contract)', () => {
    // Phase H's paletteCss/ThemeForm consume rgbToHex with a possibly-short array.
    expect(rgbToHex([300, -5])).toBe('#ff0000');
    expect(rgbToHex([155, 0, 213])).toBe('#9b00d5');
    expect(rgbToHex([0, 0, 0])).toBe('#000000');
  });
  it('hexToRgb rejects malformed input', () => {
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('red')).toBeNull();
  });
});

describe('paletteGradientCss', () => {
  it('renders gradient stops positioned 0-255 → 0-100%', () => {
    const css = paletteGradientCss(
      { type: 'stops', stops: [[0, 255, 0, 0], [128, 0, 255, 0], [255, 0, 0, 255]] },
      [null, null, null]
    );
    expect(css).toBe('linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 255, 0) 50%, rgb(0, 0, 255) 100%)');
  });
  it('renders a fixed multi-hue gradient for random palettes', () => {
    const css = paletteGradientCss({ type: 'random' }, [null, null, null]);
    expect(css).toContain('linear-gradient(90deg');
  });
  it('renders hard bands from current slot colors for slot palettes', () => {
    const css = paletteGradientCss(
      { type: 'slots', slots: ['c3', 'c2', 'c1'] }, // real device preview for '* Color Gradient' (pal 4)
      [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0]]
    );
    expect(css).toBe(
      'linear-gradient(90deg, rgb(0, 0, 255) 0% 33%, rgb(0, 255, 0) 33% 67%, rgb(255, 0, 0) 67% 100%)'
    );
  });
  it('falls back to slate for missing slot colors', () => {
    const css = paletteGradientCss({ type: 'slots', slots: ['c1'] }, [null, null, null]);
    expect(css).toBe('linear-gradient(90deg, rgb(100, 116, 139) 0% 100%)');
  });
});
