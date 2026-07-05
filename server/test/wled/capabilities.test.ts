import { describe, it, expect } from 'vitest';
import { parseFxData } from '../../src/wled/capabilities.js';

// Verbatim /json/eff + /json/fxdata entries captured from 192.168.1.86
// (WLED 16.0.0 "Niji", vid 2605030) on 2026-07-04. Test index = effect id
// here; the original device index is noted per entry.
const NAMES = [
  'Solid',        // device idx 0   — empty fxdata entry
  'Blink',        // idx 1          — '!' defaults, flags '01'
  'Wipe',         // idx 3          — no flags/defaults sections at all
  'Dynamic',      // idx 7          — o1 at position 5, empty colors section
  'Scan',         // idx 10         — o2 at position 6, 3 default color slots
  'Aurora',       // idx 38         — custom color labels, EMPTY flags section
  'Tetrix',       // idx 44         — o1 label + 4-key defaults incl. m12
  'Two Dots',     // idx 50         — mixed custom/default color labels
  'Palette',      // idx 65         — c1 slider + all three options + o-defaults
  'Copy Segment', // idx 77         — sx hidden, c1-c3 sliders, NO palette
  'Glitter',      // idx 87         — only color slot 3 labeled
  'Pixels',       // idx 128        — audio flag '1v'
  'Spaceships'    // idx 118        — 2D flag '2'
];
const FXDATA = [
  '',
  '!,Duty cycle;!,!;!;01',
  '!,!;!,!;!',
  '!,!,,,,Smooth;;!',
  '!,# of dots,,,,,Overlay;!,!,!;!',
  '!,!;1,2,3;!;;sx=24,pal=50',
  '!,Width,,,,One color;!,!;!;;sx=0,ix=0,pal=11,m12=1',
  '!,Dot size,,,,,Overlay;1,2,Bg;!',
  'Shift,Size,Rotation,,,Animate Shift,Animate Rotation,Anamorphic;;!;12;ix=112,c1=0,o1=1,o2=0,o3=1',
  ',Color shift,Lighten,Brighten,ID,Axis(2D),FullStack(last frame);;;12;ix=0,c1=0,c2=0,c3=0',
  '!,!,,,,,Overlay;,,Glitter color;!;;pal=11,m12=0',
  'Fade rate,# of pixels;!,!;!;1v;m12=0,si=0',
  '!,Blur,,,,Smear;;!;2'
];

describe('parseFxData', () => {
  const fx = parseFxData(FXDATA, NAMES);

  it('produces one FxMeta per effect id with matching id and name', () => {
    expect(fx).toHaveLength(NAMES.length);
    fx.forEach((meta, i) => {
      expect(meta.id).toBe(i);
      expect(meta.name).toBe(NAMES[i]);
    });
  });

  it('empty entry (Solid): default sx/ix labels, all color slots, no palette, 1D', () => {
    expect(fx[0]).toEqual({
      id: 0,
      name: 'Solid',
      sliders: { sx: 'Effect speed', ix: 'Effect intensity', c1: null, c2: null, c3: null },
      options: { o1: null, o2: null, o3: null },
      colorLabels: ['Fx', 'Bg', 'Cs'],
      usesPalette: false,
      flags: ['1'],
      defaults: {}
    });
  });

  it("maps '!' slider labels to defaults and keeps custom ones (Blink)", () => {
    expect(fx[1].sliders).toEqual({
      sx: 'Effect speed', ix: 'Duty cycle', c1: null, c2: null, c3: null
    });
    expect(fx[1].colorLabels).toEqual(['Fx', 'Bg', null]);
    expect(fx[1].usesPalette).toBe(true);
    expect(fx[1].flags).toEqual(['0', '1']);
    expect(fx[1].defaults).toEqual({});
  });

  it("defaults flags to ['1'] when the flags section is missing entirely (Wipe)", () => {
    expect(fx[2].flags).toEqual(['1']);
  });

  it('reads checkbox option at position 5 as o1 and empty colors as unused slots (Dynamic)', () => {
    expect(fx[3].options).toEqual({ o1: 'Smooth', o2: null, o3: null });
    expect(fx[3].colorLabels).toEqual([null, null, null]);
  });

  it('reads checkbox option at position 6 as o2 (Scan) with all-default color labels', () => {
    expect(fx[4].options).toEqual({ o1: null, o2: 'Overlay', o3: null });
    expect(fx[4].colorLabels).toEqual(['Fx', 'Bg', 'Cs']);
  });

  it("defaults flags to ['1'] when the flags section is present but empty, keeps custom color labels and parses defaults (Aurora)", () => {
    expect(fx[5].colorLabels).toEqual(['1', '2', '3']);
    expect(fx[5].flags).toEqual(['1']);
    expect(fx[5].defaults).toEqual({ sx: 24, pal: 50 });
  });

  it('parses multi-key defaults including m12 (Tetrix)', () => {
    expect(fx[6].options.o1).toBe('One color');
    expect(fx[6].defaults).toEqual({ sx: 0, ix: 0, pal: 11, m12: 1 });
  });

  it('keeps mixed custom/default color labels in slot order (Two Dots)', () => {
    expect(fx[7].colorLabels).toEqual(['1', '2', 'Bg']);
  });

  it('parses c1 slider, all three options, 1D+2D flags and o-defaults (Palette)', () => {
    expect(fx[8].sliders).toEqual({
      sx: 'Shift', ix: 'Size', c1: 'Rotation', c2: null, c3: null
    });
    expect(fx[8].options).toEqual({
      o1: 'Animate Shift', o2: 'Animate Rotation', o3: 'Anamorphic'
    });
    expect(fx[8].usesPalette).toBe(true);
    expect(fx[8].flags).toEqual(['1', '2']);
    expect(fx[8].defaults).toEqual({ ix: 112, c1: 0, o1: 1, o2: 0, o3: 1 });
  });

  it('hides sx when position 0 is empty and reports usesPalette false for an empty palette section (Copy Segment)', () => {
    expect(fx[9].sliders).toEqual({
      sx: null, ix: 'Color shift', c1: 'Lighten', c2: 'Brighten', c3: 'ID'
    });
    expect(fx[9].options).toEqual({
      o1: 'Axis(2D)', o2: 'FullStack(last frame)', o3: null
    });
    expect(fx[9].usesPalette).toBe(false);
    expect(fx[9].flags).toEqual(['1', '2']);
    expect(fx[9].defaults).toEqual({ ix: 0, c1: 0, c2: 0, c3: 0 });
  });

  it('labels only color slot 3 when slots 1-2 are empty (Glitter)', () => {
    expect(fx[10].colorLabels).toEqual([null, null, 'Glitter color']);
    expect(fx[10].defaults).toEqual({ pal: 11, m12: 0 });
  });

  it("splits audio flags into chars (Pixels '1v')", () => {
    expect(fx[11].flags).toEqual(['1', 'v']);
    expect(fx[11].sliders.sx).toBe('Fade rate');
  });

  it("parses pure 2D flag (Spaceships '2') with o1 'Smear'", () => {
    expect(fx[12].flags).toEqual(['2']);
    expect(fx[12].options.o1).toBe('Smear');
  });

  it('treats fxdata entries missing for a given effect id as empty (real RSVD placeholders)', () => {
    // On the real device, ids 142/169/170/171 are named 'RSVD' with '' fxdata;
    // fxdata may also simply be shorter than the effect list.
    const meta = parseFxData([''], ['Solid', 'RSVD']);
    expect(meta[1].name).toBe('RSVD');
    expect(meta[1].sliders.sx).toBe('Effect speed');
    expect(meta[1].usesPalette).toBe(false);
  });
});
