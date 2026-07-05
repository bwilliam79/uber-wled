export function moveId(ids: string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const clamped = Math.max(0, Math.min(ids.length - 1, toIndex));
  if (clamped === from) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(clamped, 0, id);
  return next;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function dropIndexForPoint(rects: Rect[], x: number, y: number): number {
  if (rects.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  rects.forEach((r, i) => {
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
