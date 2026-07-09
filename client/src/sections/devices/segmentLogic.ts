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

// ---- Split / merge / drag-boundary geometry (pure; the component turns these
// into create/update/delete API calls). All bounds are half-open [start, stop). ----

export interface SegSpan { id: number; start: number; stop: number }

/** A segment can split only if it spans >= 2 LEDs (each half keeps >= 1). */
export function canSplitSegment(seg: { start: number; stop: number }): boolean {
  return seg.stop - seg.start >= 2;
}

/** Default split boundary: the segment's midpoint (floored). */
export function splitMidpoint(seg: { start: number; stop: number }): number {
  return seg.start + Math.floor((seg.stop - seg.start) / 2);
}

/**
 * Split `seg` at `boundary` into a left half [start, boundary) and a right half
 * [boundary, stop). Returns null if the boundary doesn't leave >= 1 LED on both
 * sides. The caller keeps `seg`'s id for the left half and creates the right.
 */
export function splitSegmentAt(
  seg: { start: number; stop: number },
  boundary: number
): { left: { start: number; stop: number }; right: { start: number; stop: number } } | null {
  if (!Number.isInteger(boundary) || boundary <= seg.start || boundary >= seg.stop) return null;
  return {
    left: { start: seg.start, stop: boundary },
    right: { start: boundary, stop: seg.stop }
  };
}

/**
 * Merge two segments into the span covering both. The lower id survives (with
 * the merged bounds); the higher id is deleted. Order-independent.
 */
export function mergeSegments(
  a: SegSpan,
  b: SegSpan
): { keepId: number; deleteId: number; start: number; stop: number } {
  const start = Math.min(a.start, b.start);
  const stop = Math.max(a.stop, b.stop);
  const [keep, del] = a.id <= b.id ? [a, b] : [b, a];
  return { keepId: keep.id, deleteId: del.id, start, stop };
}

/**
 * Clamp a dragged shared boundary between two adjacent segments so each keeps
 * at least 1 LED. `boundary` is rounded to the nearest LED index.
 */
export function clampBoundary(boundary: number, leftStart: number, rightStop: number): number {
  return Math.max(leftStart + 1, Math.min(rightStop - 1, Math.round(boundary)));
}

/** Segments sorted by start, then id — the left-to-right order on the strip. */
export function sortedByStart<T extends { start: number; id: number }>(segments: T[]): T[] {
  return [...segments].sort((a, b) => a.start - b.start || a.id - b.id);
}
