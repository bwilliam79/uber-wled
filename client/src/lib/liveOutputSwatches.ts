import { segmentToCssColor } from './segmentColor';

/**
 * "Live output" swatch derivation — the pure logic behind LiveOutputStrip.
 *
 * Design choice: one swatch PER SEGMENT (not per color slot). WLED segments
 * are the physical unit a user actually configures (e.g. a controller with a
 * cabinet run + a trim run as two segments, see fixtures.SEGMENTS), and each
 * can run a different effect/color independently. Collapsing to color slots
 * (up to 3 per segment) would either lose that per-zone distinction or bloat
 * the strip with slots that are usually unused (col[1]/col[2] are almost
 * always black in practice).
 */

export type LiveSwatchState = 'on' | 'off' | 'unreachable' | 'pending';

export interface LiveOutputSwatch {
  key: string;
  state: LiveSwatchState;
  color: string;
  /** Segment's real LED count — renders as relative width so e.g. a 39-LED
   *  run and a 9-LED trim run don't draw as identically-sized dots. Placeholder
   *  (pending/unreachable) swatches use 1 since there's no real size to show yet. */
  len: number;
  /** CSS gradient sampling the segment's actual current per-pixel colors (via
   *  the live-view WebSocket, see api/liveWsPixels.ts), when available. Falls
   *  back to the flat `color` — derived only from the configured color slot —
   *  when no live pixel frame has arrived yet, e.g. for effects (Rainbow,
   *  Colorloop, chases...) whose real output doesn't match col[0] at all. */
  gradient?: string;
}

/** Muted grey for a target that isn't reachable at all. */
export const SWATCH_UNREACHABLE_COLOR = '#3A3F4B';
/** Placeholder tone before the first SSE event has arrived for a target. */
export const SWATCH_PENDING_COLOR = '#232B3F';
/** Placeholder for an 'on' segment before its first live-pixel frame arrives.
 *  Every real caller of swatchesForEntry/swatchesForMembers wires up live
 *  pixels (see api/liveWsPixels.ts), so the old fallback here — the segment's
 *  *configured* color slot — only ever showed briefly during the WS connect
 *  window, and for anything but a plain solid color it was frequently wrong
 *  anyway (that mismatch is the whole reason live pixels exist). Showing that
 *  momentarily-wrong color (e.g. flashing red because col[0] happens to be
 *  red) reads as a glitch; black-until-real-data doesn't. */
export const SWATCH_LIVE_LOADING_COLOR = '#000000';

/** Structural subset of LiveState — only what swatch derivation reads. */
export interface LiveSwatchSegment {
  id: number;
  on: boolean;
  bri: number;
  col: number[][];
  // Optional because it mirrors LiveSegment.len, which WLED always sends in
  // practice but the type hedges as optional — swatchesForSource falls back
  // to equal weighting (1) when absent.
  len?: number;
  /** LED index this segment starts at within the device's whole pixel
   *  buffer — needed to slice the right sub-range out of a live-pixel frame. */
  start: number;
}

const GRADIENT_STOPS = 10;

/** Samples a segment's real LEDs out of the device-wide live-pixel buffer
 *  (RGB triplets in physical LED order) into a CSS linear-gradient. Returns
 *  undefined if the buffer doesn't actually cover this segment's range (e.g.
 *  a stale frame from before a re-segmentation). */
function pixelsToGradient(pixels: Uint8Array, start: number, len: number): string | undefined {
  if (len <= 0 || (start + len) * 3 > pixels.length) return undefined;
  const n = Math.min(GRADIENT_STOPS, len);
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    const ledIndex = start + Math.floor((i / Math.max(1, n - 1)) * (len - 1));
    const o = ledIndex * 3;
    stops.push(`rgb(${pixels[o]}, ${pixels[o + 1]}, ${pixels[o + 2]})`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export interface LiveSwatchSource {
  reachable: boolean;
  state?: { on: boolean; seg: LiveSwatchSegment[] };
}

export interface LiveSwatchMember {
  controllerId: string;
  wledSegId: number | null; // null = every segment on the controller
}

function swatchesForSource(
  source: LiveSwatchSource | undefined,
  wledSegId: number | null,
  keyPrefix: string,
  livePixels?: Uint8Array
): LiveOutputSwatch[] {
  if (!source) {
    return [{ key: `${keyPrefix}:pending`, state: 'pending', color: SWATCH_PENDING_COLOR, len: 1 }];
  }
  if (!source.reachable) {
    return [{ key: `${keyPrefix}:unreachable`, state: 'unreachable', color: SWATCH_UNREACHABLE_COLOR, len: 1 }];
  }
  if (!source.state) {
    return [{ key: `${keyPrefix}:pending`, state: 'pending', color: SWATCH_PENDING_COLOR, len: 1 }];
  }

  const segs = wledSegId === null
    ? source.state.seg
    : source.state.seg.filter((s) => s.id === wledSegId);

  if (segs.length === 0) {
    // Reachable and reporting state, but the segment we care about doesn't
    // exist (e.g. stale group membership after a re-segmentation) — treat
    // like unreachable rather than silently rendering nothing.
    return [{ key: `${keyPrefix}:unreachable`, state: 'unreachable', color: SWATCH_UNREACHABLE_COLOR, len: 1 }];
  }

  const masterOn = source.state.on;
  return segs.map((seg) => {
    const on = masterOn && seg.on;
    const len = Math.max(1, seg.len ?? 1);
    const gradient = on && livePixels ? pixelsToGradient(livePixels, seg.start, len) : undefined;
    return {
      key: `${keyPrefix}:${seg.id}`,
      state: on ? 'on' : 'off',
      color: on && !gradient ? SWATCH_LIVE_LOADING_COLOR : segmentToCssColor({ on, bri: seg.bri, col: seg.col }),
      len,
      gradient
    };
  });
}

/** Swatches for a single controller's whole live entry (e.g. a device card).
 *  `livePixels`, if given, is that controller's device-wide live-pixel frame
 *  (see api/liveWsPixels.ts) — enables real per-pixel gradients instead of
 *  each segment's flat configured color. */
export function swatchesForEntry(
  live: LiveSwatchSource | undefined,
  livePixels?: Uint8Array
): LiveOutputSwatch[] {
  return swatchesForSource(live, null, 'c', livePixels);
}

/**
 * Swatches for a Home tile's member list (one controller for a plain tile,
 * one-or-more for a room/group tile) — mirrors aggregateTileStatusLive's
 * per-member, per-segment-or-whole-controller model from lib/tileStatus.ts.
 * `livePixelsByController`, if given, maps controllerId -> that device's
 * live-pixel frame.
 */
export function swatchesForMembers(
  members: LiveSwatchMember[],
  live: ReadonlyMap<string, LiveSwatchSource>,
  livePixelsByController?: ReadonlyMap<string, Uint8Array>
): LiveOutputSwatch[] {
  return members.flatMap((m) =>
    swatchesForSource(live.get(m.controllerId), m.wledSegId, m.controllerId, livePixelsByController?.get(m.controllerId))
  );
}
