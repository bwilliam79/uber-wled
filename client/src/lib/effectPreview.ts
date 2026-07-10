import type { PalettePreview } from '../api/client';
import type { LedEffect } from './ledRenderer';
import { rgbToHex } from './color';

/**
 * Exact effect-name → preview map for the effects that show up in real
 * themes (media-server catalog + common WLED names). Checked first so
 * keyword collisions (e.g. "Solid Pattern Tri" containing "solid") can't
 * mis-route a known effect.
 */
const EXACT_EFFECT_PREVIEW: Record<string, LedEffect> = {
  solid: 'solid',
  'solid pattern': 'bands',
  'solid pattern tri': 'bands',
  twinkle: 'sparkle',
  twinklefox: 'sparkle',
  colortwinkles: 'sparkle',
  glitter: 'sparkle',
  fireworks: 'sparkle',
  'fire 2012': 'fire',
  fire2012: 'fire',
  colorful: 'gradient',
  colorwaves: 'gradient',
  'washing machine': 'gradient',
  railway: 'chase',
  chase: 'chase',
  'theater chase': 'chase',
  breathe: 'breathe',
  blink: 'breathe',
  rainbow: 'rainbow',
  'rainbow runner': 'rainbow'
};

// Map a WLED effect *name* (from a controller's capabilities.effects list) to
// the closest preview animation the renderer supports. Exact-name hits first,
// then keyword fallback so the ~180 uncatalogued effects still get a live
// sense of the look (not a bit-exact reproduction).
export function effectToPreview(effectName: string | undefined): LedEffect {
  const n = (effectName ?? '').toLowerCase().trim();
  if (!n) return 'gradient';

  const exact = EXACT_EFFECT_PREVIEW[n];
  if (exact) return exact;

  const has = (...kw: string[]) => kw.some((k) => n.includes(k));
  // Static effects first — these must NOT animate.
  if (n.includes('solid') && n.includes('pattern')) return 'bands';
  if (n === 'solid' || n.startsWith('solid ')) return 'solid';
  if (n.includes('rainbow')) return 'rainbow';
  if (has('fire', 'flame', 'lava', 'volcano', 'ember', 'candle', 'torch')) return 'fire';
  if (
    has(
      'twinkle',
      'glitter',
      'sparkle',
      'fairy',
      'firework',
      'starburst',
      'star',
      'popcorn',
      'sputter',
      'flicker'
    )
  ) {
    return 'sparkle';
  }
  if (has('chase', 'theater', 'marquee', 'lighthouse', 'railway', 'tetrix', 'chaser')) {
    return 'chase';
  }
  if (
    has(
      'comet',
      'meteor',
      'scan',
      'runner',
      'larson',
      'cylon',
      'sweep',
      'juggle',
      'sinelon',
      'bounce',
      'ball',
      'drip',
      'dot'
    )
  ) {
    return 'comet';
  }
  // Multi-color palette-flow effects must come BEFORE the single-color "wave"
  // (Colorwaves contains "wave" but cycles the whole palette, not one color).
  if (
    has(
      'colorwave',
      'colorloop',
      'colorflow',
      'aurora',
      'gradient',
      'palette',
      'flow',
      'loop',
      'colorful',
      'pride',
      'stream',
      'galaxy',
      'vortex',
      'blend',
      'washing'
    )
  ) {
    return 'gradient';
  }
  if (
    has(
      'wave',
      'sine',
      'ripple',
      'dissolve',
      'noise',
      'plasma',
      'phased',
      'oscillate',
      'saw',
      'bpm',
      'heartbeat',
      'wobble',
      'tremolo',
      'gravity',
      'geq',
      'sonic'
    )
  ) {
    return 'wave';
  }
  if (has('breathe', 'fade', 'pulse', 'blink', 'strobe', 'police', 'lightning', 'glow', 'sunrise')) {
    return 'breathe';
  }
  // WLED's "PS ..." (particle system) family is a whole set the keyword map
  // doesn't model. The ones already caught above win first (PS Fire→fire,
  // PS Sparkler→sparkle, PS Chase→chase, PS Fuzzy Noise→wave); the rest get a
  // generic sparkle so they read as clearly animated instead of collapsing to
  // the near-solid single-color 'gradient' fallback.
  if (n.startsWith('ps ') || n.includes('particle')) return 'sparkle';
  return 'gradient';
}

/** A theme's non-black color slots as a comma-joined hex string for the
 *  renderer, defaulting to the brand teal when every slot is black/unused. */
export function themeColorsString(colors: number[][]): string {
  const hexes = colors
    .filter((c) => c && (c[0] || c[1] || c[2]))
    .map((c) => rgbToHex([c[0], c[1], c[2]]));
  return hexes.length > 0 ? hexes.join(',') : '#2ee6c0';
}

function slotRgb(colors: number[][], index: number): number[] | null {
  const c = colors[index];
  if (!c || !(c[0] || c[1] || c[2])) return null;
  return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
}

const SLOT_INDEX = { c1: 0, c2: 1, c3: 2 } as const;

/** Sample gradient stops into N evenly-spaced RGB colors for the LED renderer. */
export function samplePaletteStops(
  stops: [number, number, number, number][],
  count = 8
): number[][] {
  if (stops.length === 0) return [];
  if (stops.length === 1) {
    const [, r, g, b] = stops[0];
    return [[r, g, b]];
  }
  // Sort by position so interpolation is well-defined.
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const pos = count === 1 ? sorted[0][0] : (i / (count - 1)) * 255;
    // Find surrounding stops.
    let lo = sorted[0];
    let hi = sorted[sorted.length - 1];
    for (let s = 0; s < sorted.length - 1; s++) {
      if (pos >= sorted[s][0] && pos <= sorted[s + 1][0]) {
        lo = sorted[s];
        hi = sorted[s + 1];
        break;
      }
    }
    const span = Math.max(1, hi[0] - lo[0]);
    const t = Math.max(0, Math.min(1, (pos - lo[0]) / span));
    out.push([
      Math.round(lo[1] + (hi[1] - lo[1]) * t),
      Math.round(lo[2] + (hi[2] - lo[2]) * t),
      Math.round(lo[3] + (hi[3] - lo[3]) * t)
    ]);
  }
  // Drop pure-black samples at the ends of heat-style palettes (Fire starts
  // black) so the strip still reads as lit color, not dead LEDs.
  const lit = out.filter((c) => c[0] || c[1] || c[2]);
  return lit.length > 0 ? lit : out;
}

const RANDOM_PREVIEW_COLORS =
  '#e5484d,#f5a524,#2ec27e,#3584e4,#9141ac,#e5484d';

export interface ResolvePreviewColorsOpts {
  /** From FxMeta.usesPalette — when false, colors always come from slots. */
  usesPalette?: boolean;
  /** Palette id; 0 = WLED "Default", whose palx stops are a misleading rainbow. */
  paletteId?: number;
}

/**
 * Resolve the comma-separated hex colors the LED preview should animate with.
 *
 * Priority (matches how WLED actually paints themes in this app's catalog):
 *  1. Effects that don't use a palette → color slots only
 *     (Solid, Solid Pattern Tri, …)
 *  2. Palette 0 "Default" → color slots (palx returns a generic FastLED
 *     rainbow that is NOT what slot-driven themes look like)
 *  3. Slot-derived palettes (* Colors Only, * Colors 1&2) → expand the
 *     c1/c2/c3 pattern with the theme's slots
 *  4. Gradient palettes (C9 New, Fire, Autumn, …) → sample palx stops
 *  5. Random cycle → multi-hue placeholder
 *  6. Fallback → color slots / teal
 */
export function resolvePreviewColors(
  colors: number[][],
  palettePreview: PalettePreview | undefined,
  opts: ResolvePreviewColorsOpts = {}
): string {
  const slotsOnly = themeColorsString(colors);

  if (opts.usesPalette === false) return slotsOnly;
  // Default palette: prefer the theme's own colors over the palx rainbow.
  if (opts.paletteId === 0 || palettePreview == null) return slotsOnly;

  if (palettePreview.type === 'random') return RANDOM_PREVIEW_COLORS;

  if (palettePreview.type === 'slots') {
    const expanded: string[] = [];
    for (const slot of palettePreview.slots) {
      const rgb = slotRgb(colors, SLOT_INDEX[slot]);
      if (rgb) expanded.push(rgbToHex(rgb));
    }
    // De-dupe consecutive identical hexes so chase/sparkle cycle distinct
    // colors, while keeping order (c1,c1,c2,c2 → c1,c2).
    const deduped: string[] = [];
    for (const h of expanded) {
      if (deduped[deduped.length - 1] !== h) deduped.push(h);
    }
    return deduped.length > 0 ? deduped.join(',') : slotsOnly;
  }

  // Gradient stops (C9 New, Fire, Autumn, …)
  const sampled = samplePaletteStops(palettePreview.stops, 10);
  if (sampled.length === 0) return slotsOnly;
  return sampled.map((c) => rgbToHex(c)).join(',');
}
