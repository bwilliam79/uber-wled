import { segmentToCssColor } from '../../lib/segmentColor';

/** Stroke for a strip whose controller is missing/unreachable/has no state or segment. */
export const OFFLINE_STROKE = '#475569';

/**
 * Structural subset of the Phase-D useLiveStatus map value — only the fields
 * the Layout canvas reads. Phase D's real map assigns to this without casts.
 */
export interface LiveControllerStatus {
  reachable: boolean;
  state?: { on: boolean; bri: number; seg: { id: number; on: boolean; bri: number; col: number[][] }[] };
}

export function stripStrokeColor(
  strip: { controllerId: string; wledSegId: number },
  live: Map<string, LiveControllerStatus>
): string {
  const status = live.get(strip.controllerId);
  if (!status || !status.reachable || !status.state) return OFFLINE_STROKE;
  if (!status.state.on) return segmentToCssColor({ on: false, bri: 0, col: [] });
  const seg = status.state.seg.find((s) => s.id === strip.wledSegId);
  if (!seg) return OFFLINE_STROKE;
  return segmentToCssColor(seg);
}
