export function segmentToCssColor(seg: { on: boolean; bri: number; col: number[][] }): string {
  if (!seg.on) return '#334155';
  const primary = seg.col[0];
  if (!primary || primary.length < 3) return 'rgb(148, 163, 184)';
  const scale = seg.bri / 255;
  const [r, g, b] = primary;
  return `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;
}
