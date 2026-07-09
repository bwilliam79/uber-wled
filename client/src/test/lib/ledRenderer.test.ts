import { describe, it, expect } from 'vitest';
import { hexToRgb, led, LED_EFFECTS } from '../../lib/ledRenderer';
import { effectToPreview, themeColorsString } from '../../lib/effectPreview';

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
