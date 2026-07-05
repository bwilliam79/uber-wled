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

// --- Home v2: live-stream aggregation ------------------------------------

export interface TileTargetMember {
  controllerId: string;
  wledSegId: number | null; // null = whole controller
}

export interface LiveSegState {
  id: number;
  on: boolean;
  bri: number;
}

export interface LiveTileState {
  on: boolean;
  bri: number;
  seg: LiveSegState[];
}

export interface LiveTileSource {
  reachable: boolean;
  state?: LiveTileState;
}

export interface TileStatusV2 {
  power: 'on' | 'off' | 'mixed' | 'unknown';
  brightness: number | null;
  anyOffline: boolean;
  allOffline: boolean;
}

export function aggregateTileStatusLive(
  members: TileTargetMember[],
  live: ReadonlyMap<string, LiveTileSource>
): TileStatusV2 {
  if (members.length === 0) {
    return { power: 'unknown', brightness: null, anyOffline: false, allOffline: false };
  }

  let offline = 0;
  const onStates: boolean[] = [];
  const onBrightnesses: number[] = [];

  for (const member of members) {
    const src = live.get(member.controllerId);
    if (!src || !src.reachable || !src.state) {
      offline++;
      continue;
    }
    if (member.wledSegId === null) {
      onStates.push(src.state.on);
      if (src.state.on) onBrightnesses.push(src.state.bri);
    } else {
      const seg = src.state.seg.find((s) => s.id === member.wledSegId);
      if (!seg) {
        offline++;
        continue;
      }
      const isOn = src.state.on && seg.on;
      onStates.push(isOn);
      if (isOn) onBrightnesses.push(seg.bri);
    }
  }

  const anyOffline = offline > 0;
  const allOffline = offline === members.length;
  if (onStates.length === 0) {
    return { power: 'unknown', brightness: null, anyOffline, allOffline };
  }

  const allOn = onStates.every(Boolean);
  const allOff = onStates.every((s) => !s);
  return {
    power: allOn ? 'on' : allOff ? 'off' : 'mixed',
    brightness:
      onBrightnesses.length > 0
        ? Math.round(onBrightnesses.reduce((a, b) => a + b, 0) / onBrightnesses.length)
        : null,
    anyOffline,
    allOffline
  };
}
