import type { LedEffect } from './ledRenderer';
import { rgbToHex } from './color';

// Map a WLED effect *name* (from a controller's capabilities.effects list) to
// the closest preview animation the renderer supports. Keyword-based so it
// degrades gracefully for the ~180 WLED effects we don't model exactly — the
// goal is a live sense of the look, not a bit-exact reproduction.
export function effectToPreview(effectName: string | undefined): LedEffect {
  const n = (effectName ?? '').toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => n.includes(k));
  // Static effects first — these must NOT animate.
  if (n.includes('solid') && n.includes('pattern')) return 'bands'; // Solid Pattern (Tri) = static bands
  if (n === 'solid' || n.startsWith('solid ')) return 'solid';
  if (n.includes('rainbow')) return 'rainbow';
  if (has('fire', 'flame', 'lava', 'volcano', 'ember', 'candle', 'torch')) return 'fire';
  if (has('twinkle', 'glitter', 'sparkle', 'fairy', 'firework', 'starburst', 'star', 'popcorn',
    'sputter', 'flicker'))
    return 'sparkle';
  if (has('chase', 'theater', 'marquee', 'lighthouse', 'railway', 'tetrix', 'chaser'))
    return 'chase';
  if (has('comet', 'meteor', 'scan', 'runner', 'larson', 'cylon', 'sweep', 'juggle', 'sinelon',
    'bounce', 'ball', 'drip', 'dot'))
    return 'comet';
  // Multi-color palette-flow effects must come BEFORE the single-color "wave"
  // (Colorwaves contains "wave" but cycles the whole palette, not one color).
  if (has('colorwave', 'colorloop', 'colorflow', 'aurora', 'gradient', 'palette', 'flow', 'loop',
    'colorful', 'pride', 'stream', 'galaxy', 'vortex', 'blend'))
    return 'gradient';
  if (has('wave', 'sine', 'ripple', 'dissolve', 'noise', 'plasma', 'phased', 'oscillate', 'saw',
    'bpm', 'heartbeat', 'wobble', 'tremolo', 'gravity', 'geq', 'sonic'))
    return 'wave';
  if (has('breathe', 'fade', 'pulse', 'blink', 'strobe', 'police', 'lightning', 'glow', 'sunrise'))
    return 'breathe';
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
