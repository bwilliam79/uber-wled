import type { PalettePreview } from '../api/client';

/** Deterministic multi-hue bar shown (with a badge) for randomized palettes. */
export const RANDOM_BAR =
  'linear-gradient(90deg, #e5484d 0%, #f5a524 20%, #2ec27e 40%, #3584e4 60%, #9141ac 80%, #e5484d 100%)';
/** Flat placeholder when no preview data is available. */
export const EMPTY_BAR = 'linear-gradient(90deg, #3a4358 0%, #232b3d 100%)';

const SLOT_INDEX = { c1: 0, c2: 1, c3: 2 } as const;

export function paletteGradientCss(
  preview: PalettePreview | undefined,
  slotColorsHex: string[]
): string {
  if (!preview) return EMPTY_BAR;
  if (preview.type === 'random') return RANDOM_BAR;
  if (preview.type === 'slots') {
    const colors = preview.slots.map((s) => slotColorsHex[SLOT_INDEX[s]] ?? '#000000');
    if (colors.length === 1) {
      return `linear-gradient(90deg, ${colors[0]} 0%, ${colors[0]} 100%)`;
    }
    const stops = colors.map(
      (c, i) => `${c} ${Math.round((i / (colors.length - 1)) * 100)}%`
    );
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }
  const stops = preview.stops.map(
    ([pos, r, g, b]) => `rgb(${r},${g},${b}) ${Math.round((pos / 255) * 100)}%`
  );
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
