// Capability types (BINDING contract from
// docs/superpowers/plans/2026-07-04-control-plane-redesign/00-master.md)
// plus the pure parsers for WLED's /json/fxdata and /json/palx formats.

// fxdata parser output — one entry per effect id
export interface FxMeta {
  id: number;
  name: string;                    // from /json/eff at same index
  sliders: {                       // null = control hidden for this effect
    sx: string | null;             // '!' in fxdata → 'Effect speed'
    ix: string | null;             // '!' → 'Effect intensity'
    c1: string | null;
    c2: string | null;
    c3: string | null;
  };
  options: {                       // checkbox labels, null = hidden
    o1: string | null;
    o2: string | null;
    o3: string | null;
  };
  colorLabels: (string | null)[];  // length 3; '!' → default names Fx/Bg/Cs; null = slot unused
  usesPalette: boolean;
  flags: string[];                 // e.g. ['1'] dimensionality chars, 'v', 'f'
  defaults: Record<string, number>; // e.g. { sx: 24, m12: 0 }
}

export type PalettePreview =
  | { type: 'stops'; stops: [number, number, number, number][] } // [pos0-255, r, g, b]
  | { type: 'random' }
  | { type: 'slots'; slots: ('c1' | 'c2' | 'c3')[] };

export interface ControllerCapabilities {
  vid: number;
  effects: string[];
  palettes: string[];
  fxMeta: FxMeta[];
  palettePreviews: Record<number, PalettePreview>;
  fetchedAt: string; // ISO
}

const DEFAULT_COLOR_LABELS = ['Fx', 'Bg', 'Cs'];

/**
 * fxdata entry format: `<sliders>;<colors>;<palette>;<flags>;<defaults>`
 * - sliders: comma list at positions 0-4 = sx,ix,c1,c2,c3 and 5-7 = o1,o2,o3
 *   checkboxes. '' = hidden, '!' = default label.
 * - colors: up to 3 slot labels ('' = slot unused, '!' = Fx/Bg/Cs).
 * - palette: non-empty = effect uses a palette.
 * - flags: char list, e.g. '01' 0D+1D, '12' 1D+2D, 'v'/'f' audio; missing or
 *   empty = 1D (WLED default).
 * - defaults: 'sx=24,m12=0' → numeric map.
 * An entirely empty entry means "no controls defined": the native WLED UI
 * shows default speed/intensity sliders and all three color slots (this is
 * what it does for Solid, id 0).
 */
export function parseFxData(fxdata: string[], effectNames: string[]): FxMeta[] {
  return effectNames.map((name, id) => parseFxEntry(fxdata[id] ?? '', id, name));
}

function parseFxEntry(raw: string, id: number, name: string): FxMeta {
  if (raw === '') {
    return {
      id,
      name,
      sliders: { sx: 'Effect speed', ix: 'Effect intensity', c1: null, c2: null, c3: null },
      options: { o1: null, o2: null, o3: null },
      colorLabels: ['Fx', 'Bg', 'Cs'],
      usesPalette: false,
      flags: ['1'],
      defaults: {}
    };
  }

  const [slidersSec = '', colorsSec = '', palSec = '', flagsSec = '', defaultsSec = ''] =
    raw.split(';');
  const sl = slidersSec.split(',');
  const co = colorsSec === '' ? [] : colorsSec.split(',');

  return {
    id,
    name,
    sliders: {
      sx: labelAt(sl, 0, 'Effect speed'),
      ix: labelAt(sl, 1, 'Effect intensity'),
      c1: labelAt(sl, 2, 'Custom 1'),
      c2: labelAt(sl, 3, 'Custom 2'),
      c3: labelAt(sl, 4, 'Custom 3')
    },
    options: {
      o1: labelAt(sl, 5, 'Option 1'),
      o2: labelAt(sl, 6, 'Option 2'),
      o3: labelAt(sl, 7, 'Option 3')
    },
    colorLabels: [0, 1, 2].map((i) => labelAt(co, i, DEFAULT_COLOR_LABELS[i])),
    usesPalette: palSec !== '',
    flags: flagsSec === '' ? ['1'] : flagsSec.split(''),
    defaults: parseDefaults(defaultsSec)
  };
}

function labelAt(parts: string[], index: number, defaultLabel: string): string | null {
  const raw = parts[index];
  if (raw === undefined || raw === '') return null;
  return raw === '!' ? defaultLabel : raw;
}

function parseDefaults(sec: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (sec === '') return out;
  for (const pair of sec.split(',')) {
    const [key, value] = pair.split('=');
    if (!key || value === undefined) continue;
    const num = Number(value);
    if (!Number.isNaN(num)) out[key] = num;
  }
  return out;
}
