/** Returns an error message, or null when 0 <= start < stop <= ledCount. */
export function validateSegmentBounds(start: number, stop: number, ledCount: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(stop)) return 'Start and stop must be whole numbers';
  if (start < 0) return 'Start must be 0 or greater';
  if (stop <= start) return 'Stop must be greater than start';
  if (stop > ledCount) return `Stop cannot exceed the LED count (${ledCount})`;
  return null;
}

/** Smallest unused WLED segment id, or null when maxSeg slots are all taken. */
export function nextFreeSegmentId(segments: { id: number }[], maxSeg: number): number | null {
  const used = new Set(segments.map((s) => s.id));
  for (let i = 0; i < maxSeg; i++) if (!used.has(i)) return i;
  return null;
}
