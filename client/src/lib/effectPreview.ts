import type { LedEffect } from './ledRenderer';
import { rgbToHex } from './color';

// Map a WLED effect *name* (from a controller's capabilities.effects list) to
// the closest preview animation the renderer supports. Keyword-based so it
// degrades gracefully for the ~180 WLED effects we don't model exactly — the
// goal is a live sense of the look, not a bit-exact reproduction.
export function effectToPreview(effectName: string | undefined): LedEffect {
  const n = (effectName ?? '').toLowerCase();
  if (n.includes('rainbow')) return 'rainbow';
  if (n.includes('fire')) return 'fire';
  if (n.includes('twinkle') || n.includes('glitter') || n.includes('sparkle') || n.includes('fairy') || n.includes('saw'))
    return 'sparkle';
  if (n.includes('chase') || n.includes('theater') || n.includes('marquee') || n.includes('lighthouse'))
    return 'chase';
  if (n.includes('comet') || n.includes('meteor') || n.includes('scan') || n.includes('runner') || n.includes('chase flash'))
    return 'comet';
  if (n.includes('wave') || n.includes('sine') || n.includes('ripple') || n.includes('dissolve') || n.includes('noise'))
    return 'wave';
  if (n.includes('breathe') || n.includes('fade') || n.includes('pulse') || n.includes('blink') || n.includes('strobe'))
    return 'breathe';
  if (n.includes('solid') && !n.includes('pattern')) return 'solid';
  if (n.includes('gradient') || n.includes('loop') || n.includes('flow') || n.includes('palette') || n.includes('aurora') || n.includes('pattern'))
    return 'gradient';
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
