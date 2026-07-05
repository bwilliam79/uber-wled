import { describe, it, expect } from 'vitest';
import { paletteGradientCss, RANDOM_BAR, EMPTY_BAR } from '../../lib/paletteCss';

describe('paletteGradientCss', () => {
  it('renders palx gradient stops as a left-to-right linear-gradient (positions 0-255 → %)', () => {
    // Subset of the real "Default" palette (id 0) stops from /json/palx?page=0
    const css = paletteGradientCss(
      { type: 'stops', stops: [[0, 155, 0, 213], [128, 213, 155, 0], [240, 0, 50, 252]] },
      []
    );
    expect(css).toBe('linear-gradient(90deg, rgb(155,0,213) 0%, rgb(213,155,0) 50%, rgb(0,50,252) 94%)');
  });

  it('renders randomized palettes as the deterministic multi-hue bar', () => {
    expect(paletteGradientCss({ type: 'random' }, [])).toBe(RANDOM_BAR);
  });

  it('renders color-slot palettes from the provided slot colors (real "* Colors 1&2" shape)', () => {
    const css = paletteGradientCss(
      { type: 'slots', slots: ['c1', 'c1', 'c2', 'c2'] },
      ['#ff0000', '#00ff00', '#0000ff']
    );
    expect(css).toBe('linear-gradient(90deg, #ff0000 0%, #ff0000 33%, #00ff00 67%, #00ff00 100%)');
  });

  it('falls back to a flat bar for missing previews and single-slot palettes', () => {
    expect(paletteGradientCss(undefined, [])).toBe(EMPTY_BAR);
    expect(paletteGradientCss({ type: 'slots', slots: ['c1'] }, ['#abcdef'])).toBe(
      'linear-gradient(90deg, #abcdef 0%, #abcdef 100%)'
    );
  });
});
