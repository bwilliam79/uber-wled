export interface DevicePreset {
  id: number;
  name: string;
  isPlaylist: boolean;
  quicklook?: { fx?: number; pal?: number; on?: boolean; bri?: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePresetsJson(raw: Record<string, unknown>): DevicePreset[] {
  const presets: DevicePreset[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 1) continue; // slot 0 is WLED's empty placeholder
    if (!isRecord(value)) continue;
    if (typeof value.n !== 'string' || value.n.length === 0) continue;

    const preset: DevicePreset = { id, name: value.n, isPlaylist: 'playlist' in value };

    const quicklook: NonNullable<DevicePreset['quicklook']> = {};
    if (typeof value.on === 'boolean') quicklook.on = value.on;
    if (typeof value.bri === 'number') quicklook.bri = value.bri;
    const firstSeg = Array.isArray(value.seg)
      ? value.seg.find((s): s is Record<string, unknown> => isRecord(s) && typeof s.fx === 'number')
      : undefined;
    if (firstSeg) {
      quicklook.fx = firstSeg.fx as number;
      if (typeof firstSeg.pal === 'number') quicklook.pal = firstSeg.pal;
    }
    if (Object.keys(quicklook).length > 0) preset.quicklook = quicklook;

    presets.push(preset);
  }
  return presets.sort((a, b) => a.id - b.id);
}
