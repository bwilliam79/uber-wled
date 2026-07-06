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
 * always black in practice). A single blended dot (see dominantColor.ts) is
 * already used for the Home tile's ambient glow; this strip is meant to be
 * the more detailed, explicit readout, so per-segment is the right grain.
 */

export type LiveSwatchState = 'on' | 'off' | 'unreachable' | 'pending';

export interface LiveOutputSwatch {
  key: string;
  state: LiveSwatchState;
  color: string;
}

/** Muted grey for a target that isn't reachable at all. */
export const SWATCH_UNREACHABLE_COLOR = '#3A3F4B'; // matches dominantColor's OFFLINE_GLOW
/** Placeholder tone before the first SSE event has arrived for a target. */
export const SWATCH_PENDING_COLOR = '#232B3F';

/** Structural subset of LiveState — only what swatch derivation reads. */
export interface LiveSwatchSegment {
  id: number;
  on: boolean;
  bri: number;
  col: number[][];
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
  keyPrefix: string
): LiveOutputSwatch[] {
  if (!source) {
    return [{ key: `${keyPrefix}:pending`, state: 'pending', color: SWATCH_PENDING_COLOR }];
  }
  if (!source.reachable) {
    return [{ key: `${keyPrefix}:unreachable`, state: 'unreachable', color: SWATCH_UNREACHABLE_COLOR }];
  }
  if (!source.state) {
    return [{ key: `${keyPrefix}:pending`, state: 'pending', color: SWATCH_PENDING_COLOR }];
  }

  const segs = wledSegId === null
    ? source.state.seg
    : source.state.seg.filter((s) => s.id === wledSegId);

  if (segs.length === 0) {
    // Reachable and reporting state, but the segment we care about doesn't
    // exist (e.g. stale group membership after a re-segmentation) — treat
    // like unreachable rather than silently rendering nothing.
    return [{ key: `${keyPrefix}:unreachable`, state: 'unreachable', color: SWATCH_UNREACHABLE_COLOR }];
  }

  const masterOn = source.state.on;
  return segs.map((seg) => {
    const on = masterOn && seg.on;
    return {
      key: `${keyPrefix}:${seg.id}`,
      state: on ? 'on' : 'off',
      color: segmentToCssColor({ on, bri: seg.bri, col: seg.col })
    };
  });
}

/** Swatches for a single controller's whole live entry (e.g. a device card). */
export function swatchesForEntry(live: LiveSwatchSource | undefined): LiveOutputSwatch[] {
  return swatchesForSource(live, null, 'c');
}

/**
 * Swatches for a Home tile's member list (one controller for a plain tile,
 * one-or-more for a room/group tile) — mirrors aggregateTileStatusLive's
 * per-member, per-segment-or-whole-controller model from lib/tileStatus.ts.
 */
export function swatchesForMembers(
  members: LiveSwatchMember[],
  live: ReadonlyMap<string, LiveSwatchSource>
): LiveOutputSwatch[] {
  return members.flatMap((m) => swatchesForSource(live.get(m.controllerId), m.wledSegId, m.controllerId));
}
