import { describe, it, expect } from 'vitest';
import { hexToRgb, led, LED_EFFECTS } from '../../lib/ledRenderer';
import {
  effectToPreview,
  themeColorsString,
  resolvePreviewColors,
  samplePaletteStops
} from '../../lib/effectPreview';
import type { PalettePreview } from '../../api/client';

describe('ledRenderer', () => {
  it('parses hex (incl. shorthand) and clamps invalid input to white', () => {
    expect(hexToRgb('#ff8800')).toEqual([255, 136, 0]);
    expect(hexToRgb('#f80')).toEqual([255, 136, 0]);
    expect(hexToRgb('nonsense')).toEqual([255, 255, 255]);
  });

  it('solid holds the first color at full brightness', () => {
    const o = led('solid', 5, 40, 1.2, [[10, 20, 30]], 1);
    expect(o.c).toEqual([10, 20, 30]);
    expect(o.b).toBe(1);
  });

  it('breathe modulates brightness over time but keeps the color', () => {
    const rgbs: [number, number, number][] = [[0, 255, 0]];
    const a = led('breathe', 0, 40, 0, rgbs, 1).b;
    const b = led('breathe', 0, 40, 1, rgbs, 1).b;
    expect(a).not.toBe(b);
    expect(led('breathe', 0, 40, 0, rgbs, 1).c).toEqual([0, 255, 0]);
  });

  it('fire with a multi-color palette samples palette colors by heat', () => {
    const firePal: [number, number, number][] = [
      [80, 0, 0],
      [255, 80, 0],
      [255, 220, 40]
    ];
    const o = led('fire', 3, 40, 0.5, firePal, 1);
    expect(o.c.every((n) => Number.isFinite(n))).toBe(true);
    // Should not be pure teal / white — stay in the warm range of the palette.
    expect(o.c[0]).toBeGreaterThan(o.c[2]);
  });

  it('every known effect returns a finite color + brightness', () => {
    for (const fx of LED_EFFECTS) {
      const o = led(fx, 3, 40, 0.7, [[255, 0, 0], [0, 0, 255]], 1);
      expect(o.c.every((n) => Number.isFinite(n))).toBe(true);
      expect(Number.isFinite(o.b)).toBe(true);
    }
  });
});

describe('effectToPreview', () => {
  it.each([
    ['Fire 2012', 'fire'],
    ['Colortwinkles', 'sparkle'],
    ['Rainbow Runner', 'rainbow'],
    ['Theater Chase', 'chase'],
    ['Meteor', 'comet'],
    ['Breathe', 'breathe'],
    ['Solid', 'solid'],
    ['Solid Pattern Tri', 'bands'],
    ['Colorwaves', 'gradient'],
    ['Colorful', 'gradient'],
    ['Railway', 'chase'],
    ['Washing Machine', 'gradient'],
    ['Twinklefox', 'sparkle'],
    ['Twinkle', 'sparkle'],
    ['Glitter', 'sparkle'],
    ['Fireworks', 'sparkle'],
    ['Chase', 'chase'],
    ['Something Unknown', 'gradient']
  ])('maps %s → %s', (name, expected) => {
    expect(effectToPreview(name)).toBe(expected);
  });
});

describe('themeColorsString', () => {
  it('joins non-black slots as hex; defaults to teal when all are black', () => {
    expect(themeColorsString([[255, 0, 0], [0, 0, 0], [0, 0, 255]])).toBe('#ff0000,#0000ff');
    expect(themeColorsString([[0, 0, 0]])).toBe('#2ee6c0');
  });
});

describe('resolvePreviewColors', () => {
  const rwb = [
    [255, 0, 0],
    [255, 255, 255],
    [0, 40, 255]
  ];
  const c9: PalettePreview = {
    type: 'stops',
    stops: [
      [0, 255, 5, 0],
      [60, 255, 5, 0],
      [61, 196, 57, 2],
      [120, 196, 57, 2],
      [121, 6, 126, 2],
      [180, 6, 126, 2],
      [181, 4, 30, 114],
      [255, 4, 30, 114]
    ]
  };
  const colorsOnly: PalettePreview = {
    type: 'slots',
    slots: ['c1', 'c1', 'c1', 'c2', 'c2', 'c2', 'c3', 'c3', 'c3']
  };
  const colors12: PalettePreview = {
    type: 'slots',
    slots: ['c1', 'c1', 'c2', 'c2']
  };
  const defaultPal: PalettePreview = {
    type: 'stops',
    stops: [
      [0, 155, 0, 213],
      [128, 213, 155, 0],
      [255, 0, 50, 252]
    ]
  };

  it('uses color slots when the effect does not use a palette (Solid Pattern Tri)', () => {
    expect(
      resolvePreviewColors(rwb, defaultPal, { usesPalette: false, paletteId: 0 })
    ).toBe('#ff0000,#ffffff,#0028ff');
  });

  it('uses color slots for palette 0 Default even when palx has rainbow stops', () => {
    expect(
      resolvePreviewColors(rwb, defaultPal, { usesPalette: true, paletteId: 0 })
    ).toBe('#ff0000,#ffffff,#0028ff');
  });

  it('samples C9 New stops so Christmas C9 Chase is not just slot colors', () => {
    const resolved = resolvePreviewColors(rwb, c9, { usesPalette: true, paletteId: 53 });
    expect(resolved).toContain('#');
    // Must include green/blue from C9, not only the red/white/blue slots.
    expect(resolved).not.toBe('#ff0000,#ffffff,#0028ff');
    const parts = resolved.split(',');
    expect(parts.length).toBeGreaterThanOrEqual(4);
  });

  it('expands * Colors Only into the theme slot colors', () => {
    expect(
      resolvePreviewColors(rwb, colorsOnly, { usesPalette: true, paletteId: 5 })
    ).toBe('#ff0000,#ffffff,#0028ff');
  });

  it('expands * Colors 1&2 for Candy Cane / Snow', () => {
    const candy = [
      [255, 0, 0],
      [255, 255, 255],
      [8, 255, 0]
    ];
    expect(
      resolvePreviewColors(candy, colors12, { usesPalette: true, paletteId: 3 })
    ).toBe('#ff0000,#ffffff');
  });

  it('falls back to slots when no palette preview is available', () => {
    expect(resolvePreviewColors(rwb, undefined, { usesPalette: true, paletteId: 12 })).toBe(
      '#ff0000,#ffffff,#0028ff'
    );
  });
});

describe('samplePaletteStops', () => {
  it('interpolates between stops and drops pure-black leading samples', () => {
    const fire: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [128, 255, 80, 0],
      [255, 255, 255, 200]
    ];
    const samples = samplePaletteStops(fire, 5);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((c) => c[0] || c[1] || c[2])).toBe(true);
  });
});
