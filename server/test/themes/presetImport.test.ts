import { describe, it, expect } from 'vitest';
import { presetToTheme, classifyPresetImport, type RawPreset } from '../../src/themes/presetImport.js';
import type { CustomTheme } from '../../src/themes/repository.js';

describe('presetToTheme', () => {
  it('maps a real WLED preset (name, first-segment fx/pal/col, top-level bri)', () => {
    const preset: RawPreset = {
      n: 'Christmas Chase', bri: 255,
      seg: [{ fx: 34, pal: 5, col: [[255, 0, 0, 0], [255, 255, 255, 0], [8, 255, 0, 0]] }]
    };
    expect(presetToTheme(preset)).toEqual({
      name: 'Christmas Chase', effect: 34, palette: 5,
      colors: [[255, 0, 0, 0], [255, 255, 255, 0], [8, 255, 0, 0]], brightness: 255
    });
  });

  it('defaults palette to 0 and brightness to 128 when absent', () => {
    const theme = presetToTheme({ n: 'Twinkle', seg: [{ fx: 17, col: [[255, 147, 41, 200]] }] });
    expect(theme).toMatchObject({ name: 'Twinkle', effect: 17, palette: 0, brightness: 128 });
  });

  it('returns null for non-themes (nameless placeholder, playlist, no seg, effect-less segment)', () => {
    expect(presetToTheme({ bri: 128, seg: [{ fx: 0 }] })).toBeNull(); // no name (id-0 placeholder)
    expect(presetToTheme({ n: 'My Playlist', playlist: { ps: [1, 2] } })).toBeNull();
    expect(presetToTheme({ n: 'Empty' })).toBeNull(); // no seg
    expect(presetToTheme({ n: 'TV Architectural', bri: 96, seg: [{}] })).toBeNull(); // no fx
  });
});

describe('classifyPresetImport', () => {
  const existing: CustomTheme[] = [
    { id: 'x1', name: 'Christmas Chase', effect: 34, palette: 5, colors: [[255, 0, 0, 0]], brightness: 255 },
    { id: 'x2', name: 'Candy Cane', effect: 78, palette: 3, colors: [[255, 0, 0, 0]], brightness: 40 }
  ];

  it('classifies new, already-imported (duplicate), and conflicting presets, and skips non-themes', () => {
    const presets: Record<string, RawPreset> = {
      // Same name + identical config as x1 -> duplicate (already imported).
      '5': { n: 'Christmas Chase', bri: 255, seg: [{ fx: 34, pal: 5, col: [[255, 0, 0, 0]] }] },
      // Same name as x2 but different config -> conflict.
      '6': { n: 'Candy Cane', bri: 128, seg: [{ fx: 34, pal: 0, col: [[255, 0, 0, 0]] }] },
      // Brand new name -> new.
      '7': { n: 'USA', bri: 64, seg: [{ fx: 76, pal: 5, col: [[255, 0, 0], [255, 255, 255], [0, 0, 255]] }] },
      // Non-theme -> skipped.
      '8': { n: 'TV Architectural', bri: 96, seg: [{}] },
      // Nameless placeholder -> silently ignored (not even skipped-reported).
      '0': { seg: [{ fx: 0 }] }
    };

    const { candidates, skipped } = classifyPresetImport(presets, existing);

    const byId = Object.fromEntries(candidates.map((c) => [c.presetId, c]));
    expect(byId[5].status).toBe('duplicate');
    expect(byId[5].existingThemeId).toBe('x1');
    expect(byId[6].status).toBe('conflict');
    expect(byId[6].existingThemeId).toBe('x2');
    expect(byId[7].status).toBe('new');
    expect(byId[7].existingThemeId).toBeUndefined();

    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ presetId: 8, name: 'TV Architectural' });
    // The nameless id-0 placeholder is neither a candidate nor a reported skip.
    expect(candidates.map((c) => c.presetId)).not.toContain(0);
  });

  it('reports playlists as skipped with a playlist reason', () => {
    const { skipped } = classifyPresetImport(
      { '3': { n: 'Holiday Loop', playlist: { ps: [1, 2, 3] } } },
      []
    );
    expect(skipped[0]).toMatchObject({ name: 'Holiday Loop' });
    expect(skipped[0].reason).toMatch(/playlist/i);
  });
});
