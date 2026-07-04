export interface WledSegmentSnapshot {
  id: number;
  start: number;
  stop: number;
  len: number;
  on: boolean;
  bri: number;
  fx: number;
  pal: number;
  col: number[][];
}

export interface TileMember {
  controllerId: string;
  wledSegId: number;
}

export interface TileStatus {
  power: 'on' | 'off' | 'mixed' | 'unknown';
  brightness: number | null;
  anyOffline: boolean;
}

export function aggregateTileStatus(
  members: TileMember[],
  snapshots: Map<string, WledSegmentSnapshot[]>
): TileStatus {
  if (members.length === 0) {
    return { power: 'unknown', brightness: null, anyOffline: false };
  }

  let anyOffline = false;
  const reachableOnStates: boolean[] = [];
  const onBrightnesses: number[] = [];

  for (const member of members) {
    const segs = snapshots.get(member.controllerId);
    const seg = segs?.find((s) => s.id === member.wledSegId);
    if (!seg) {
      anyOffline = true;
      continue;
    }
    reachableOnStates.push(seg.on);
    if (seg.on) onBrightnesses.push(seg.bri);
  }

  if (reachableOnStates.length === 0) {
    return { power: 'unknown', brightness: null, anyOffline };
  }

  const allOn = reachableOnStates.every((on) => on);
  const allOff = reachableOnStates.every((on) => !on);
  const power = allOn ? 'on' : allOff ? 'off' : 'mixed';
  const brightness = onBrightnesses.length > 0
    ? Math.round(onBrightnesses.reduce((sum, b) => sum + b, 0) / onBrightnesses.length)
    : null;

  return { power, brightness, anyOffline };
}
