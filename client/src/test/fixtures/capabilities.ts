import type { ControllerCapabilities, FxMeta } from '../../api/client';
import type { LiveInfo, LiveSegment, LiveState, LiveStatusEntry } from '../../api/live';

// ── FxMeta fixtures ─────────────────────────────────────────────────────────
// Captured from WLED 16.0.0 (vid 2605030) at 192.168.1.86 on 2026-07-04.
// Raw /json/fxdata strings quoted per entry; ids remapped to a compact 0..4
// space so the fixture effects[] arrays stay dense (real device ids noted).

// fxdata[0] = '' (Solid)
export const FX_SOLID: FxMeta = {
  id: 0, name: 'Solid',
  sliders: { sx: null, ix: null, c1: null, c2: null, c3: null },
  options: { o1: null, o2: null, o3: null },
  colorLabels: ['Fx', null, null],
  usesPalette: false, flags: [], defaults: {}
};

// fxdata[1] = '!,Duty cycle;!,!;!;01' (Blink)
export const FX_BLINK: FxMeta = {
  id: 1, name: 'Blink',
  sliders: { sx: 'Effect speed', ix: 'Duty cycle', c1: null, c2: null, c3: null },
  options: { o1: null, o2: null, o3: null },
  colorLabels: ['Fx', 'Bg', null],
  usesPalette: true, flags: ['0', '1'], defaults: {}
};

// fxdata[74] = 'Fade speed,Spawn speed;;!;;m12=0' (Colortwinkles, device id 74)
export const FX_COLORTWINKLES: FxMeta = {
  id: 2, name: 'Colortwinkles',
  sliders: { sx: 'Fade speed', ix: 'Spawn speed', c1: null, c2: null, c3: null },
  options: { o1: null, o2: null, o3: null },
  colorLabels: [null, null, null],
  usesPalette: true, flags: [], defaults: { m12: 0 }
};

// fxdata[118] = '!,Blur,,,,Smear;;!;2' (Spaceships, device id 118 — 2D, has o1)
export const FX_SPACESHIPS: FxMeta = {
  id: 3, name: 'Spaceships',
  sliders: { sx: 'Effect speed', ix: 'Blur', c1: null, c2: null, c3: null },
  options: { o1: 'Smear', o2: null, o3: null },
  colorLabels: [null, null, null],
  usesPalette: true, flags: ['2'], defaults: {}
};

// fxdata[128] = 'Fade rate,# of pixels;!,!;!;1v;m12=0,si=0' (Pixels, device id 128 — audio 'v')
export const FX_PIXELS: FxMeta = {
  id: 4, name: 'Pixels',
  sliders: { sx: 'Fade rate', ix: '# of pixels', c1: null, c2: null, c3: null },
  options: { o1: null, o2: null, o3: null },
  colorLabels: ['Fx', 'Bg', null],
  usesPalette: true, flags: ['1', 'v'], defaults: { m12: 0, si: 0 }
};

// ── Palette previews (real /json/palx data) ────────────────────────────────
// First five gradient stops of palette 0 'Default'.
export const PAL_DEFAULT_STOPS: [number, number, number, number][] = [
  [0, 155, 0, 213], [16, 189, 0, 184], [32, 218, 0, 146], [48, 243, 0, 92], [64, 244, 85, 0]
];
// Full 13 stops of palette 35 'Fire'.
export const PAL_FIRE_STOPS: [number, number, number, number][] = [
  [0, 0, 0, 0], [46, 77, 0, 0], [96, 177, 0, 0], [108, 196, 38, 9], [119, 215, 76, 19],
  [146, 235, 115, 29], [174, 255, 153, 41], [188, 255, 178, 41], [202, 255, 204, 41],
  [218, 255, 230, 41], [234, 255, 255, 41], [244, 255, 255, 143], [255, 255, 255, 255]
];

// ── Capability fixtures for two controllers with different id layouts ─────
export const CAPS_A: ControllerCapabilities = {
  vid: 2605030,
  effects: ['Solid', 'Blink', 'Colortwinkles', 'Spaceships', 'Pixels'],
  palettes: ['Default', '* Random Cycle', '* Colors 1&2', '* Color Gradient', 'Fire'],
  fxMeta: [FX_SOLID, FX_BLINK, FX_COLORTWINKLES, FX_SPACESHIPS, FX_PIXELS],
  palettePreviews: {
    0: { type: 'stops', stops: PAL_DEFAULT_STOPS },
    1: { type: 'random' },
    2: { type: 'slots', slots: ['c1', 'c1', 'c2', 'c2'] },
    3: { type: 'slots', slots: ['c3', 'c2', 'c1'] },
    4: { type: 'stops', stops: PAL_FIRE_STOPS }
  },
  fetchedAt: '2026-07-04T00:00:00.000Z'
};

// Older firmware: same names at DIFFERENT ids, one reserved slot, fewer palettes.
export const CAPS_B: ControllerCapabilities = {
  vid: 2405180,
  effects: ['Solid', 'Pixels', 'Blink', 'RSVD'],
  palettes: ['Default', '* Random Cycle', 'Fire'],
  fxMeta: [
    { ...FX_SOLID, id: 0 },
    { ...FX_PIXELS, id: 1 },
    { ...FX_BLINK, id: 2 }
  ],
  palettePreviews: {
    0: { type: 'stops', stops: PAL_DEFAULT_STOPS },
    1: { type: 'random' },
    2: { type: 'stops', stops: PAL_FIRE_STOPS }
  },
  fetchedAt: '2026-07-04T00:00:00.000Z'
};

// ── Live-state builders (defaults from the real /json/state probe) ────────
export function makeSeg(id: number, overrides: Partial<LiveSegment> = {}): LiveSegment {
  return {
    id, start: 0, stop: 39, len: 39, on: true, bri: 255,
    col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    fx: 0, sx: 128, ix: 128, pal: 0, c1: 220, c2: 30, c3: 21,
    o1: true, o2: false, o3: false, cct: 127, rev: false, mi: false,
    ...overrides
  };
}

export function makeState(seg: LiveSegment[], overrides: Partial<LiveState> = {}): LiveState {
  return {
    on: true, bri: 9, transition: 7, ps: -1, pl: -1,
    nl: { on: false, dur: 60, mode: 1, tbri: 0, rem: -1 },
    mainseg: 0, seg,
    ...overrides
  };
}

export function makeInfo(overrides: Partial<LiveInfo> = {}): LiveInfo {
  return {
    name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
    leds: { count: 48, rgbw: true, cct: 0, seglc: [1, 1] },
    ...overrides
  };
}

export function liveEntry(state: LiveState, info?: LiveInfo): LiveStatusEntry {
  return { reachable: true, state, info: info ?? makeInfo() };
}
