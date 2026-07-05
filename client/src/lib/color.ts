import type { PalettePreview } from '../api/client';

export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = Math.min(40_000, Math.max(1000, kelvin)) / 100;
  let r: number; let g: number; let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return [clamp(r), clamp(g), clamp(b)];
}

export function rgbToHex(rgb: number[]): string {
  const channel = (v: number | undefined) =>
    Math.max(0, Math.min(255, Math.round(v ?? 0))).toString(16).padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const RANDOM_PREVIEW =
  'linear-gradient(90deg, #e6437d 0%, #f5a623 25%, #3ddc84 50%, #38b6ff 75%, #9b5de5 100%)';
const FALLBACK_SLOT = 'rgb(100, 116, 139)';

export function paletteGradientCss(
  preview: PalettePreview,
  slotColors: (number[] | null)[]
): string {
  if (preview.type === 'random') return RANDOM_PREVIEW;
  if (preview.type === 'slots') {
    const n = preview.slots.length;
    const bands = preview.slots.map((slot, i) => {
      const idx = slot === 'c1' ? 0 : slot === 'c2' ? 1 : 2;
      const col = slotColors[idx];
      const css = col && col.length >= 3 ? `rgb(${col[0]}, ${col[1]}, ${col[2]})` : FALLBACK_SLOT;
      const from = Math.round((i / n) * 100);
      const to = Math.round(((i + 1) / n) * 100);
      return `${css} ${from}% ${to}%`;
    });
    return `linear-gradient(90deg, ${bands.join(', ')})`;
  }
  const stops = preview.stops.map(
    ([pos, r, g, b]) => `rgb(${r}, ${g}, ${b}) ${Math.round((pos / 255) * 100)}%`
  );
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
