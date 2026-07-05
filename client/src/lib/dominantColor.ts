export const OFF_GLOW = '#334155'; // muted slate — matches segmentToCssColor's off color
export const OFFLINE_GLOW = '#3A3F4B'; // desaturated grey for unreachable targets

const MIN_GLOW_SCALE = 0.35; // keep the glow visible even at very low master brightness

export interface DominantColorSegment {
  on: boolean;
  len?: number; // optional to match Phase D's LiveSegment; weight 1 when absent
  col: number[][];
}

export interface DominantColorState {
  on: boolean;
  bri: number;
  seg: DominantColorSegment[];
}

function effectiveRgb(col: number[] | undefined): [number, number, number] | null {
  if (!col || col.length < 3) return null;
  const [r, g, b] = col;
  const w = col[3] ?? 0;
  if (r === 0 && g === 0 && b === 0) {
    if (w > 0) return [255, 214, 170]; // warm-white approximation of the W channel
    return null; // black contributes no glow
  }
  return [r, g, b];
}

export function dominantColor(state: DominantColorState | undefined): string {
  if (!state) return OFFLINE_GLOW;
  if (!state.on) return OFF_GLOW;

  const weights = new Map<string, { rgb: [number, number, number]; weight: number }>();
  for (const seg of state.seg) {
    if (!seg.on) continue;
    const rgb = effectiveRgb(seg.col[0]);
    if (!rgb) continue;
    const key = rgb.join(',');
    const entry = weights.get(key) ?? { rgb, weight: 0 };
    entry.weight += Math.max(1, seg.len ?? 1);
    weights.set(key, entry);
  }

  let best: { rgb: [number, number, number]; weight: number } | null = null;
  for (const entry of weights.values()) {
    if (!best || entry.weight > best.weight) best = entry;
  }
  if (!best) return OFF_GLOW;

  const scale = Math.max(MIN_GLOW_SCALE, state.bri / 255);
  const [r, g, b] = best.rgb;
  return `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;
}
