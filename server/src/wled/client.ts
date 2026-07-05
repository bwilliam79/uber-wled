import type {
  WledInfo,
  WledState,
  WledStatePatch,
  WledPreset,
  WledFullState,
  WledNightlight
} from './types.js';
import { parsePalettePreviewPage, type PalettePreview } from './capabilities.js';
import { assertValidHost } from '../controllers/validateHost.js';

async function getJson<T>(host: string, path: string): Promise<T> {
  assertValidHost(host);
  const res = await fetch(`http://${host}${path}`);
  if (!res.ok) throw new Error(`WLED request failed: GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(host: string, path: string, body: unknown): Promise<T> {
  assertValidHost(host);
  const res = await fetch(`http://${host}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`WLED request failed: POST ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export function getInfo(host: string): Promise<WledInfo> {
  return getJson<WledInfo>(host, '/json/info');
}

export function getState(host: string): Promise<WledState> {
  return getJson<WledState>(host, '/json/state');
}

export function setState(host: string, patch: WledStatePatch): Promise<WledState> {
  return postJson<WledState>(host, '/json/state', patch);
}

export function setSegment(
  host: string,
  segment: { id: number; start: number; stop: number }
): Promise<WledState> {
  return postJson<WledState>(host, '/json/state', { seg: [segment] });
}

export async function getPresets(host: string): Promise<WledPreset[]> {
  const raw = await getJson<Record<string, { n: string }>>(host, '/presets.json');
  return Object.entries(raw)
    .map(([id, v]) => ({ id: Number(id), name: v.n }))
    .sort((a, b) => a.id - b.id);
}

export function applyPreset(host: string, presetId: number): Promise<WledState> {
  return postJson<WledState>(host, '/json/state', { ps: presetId });
}

export function getEffects(host: string): Promise<string[]> {
  return getJson<string[]>(host, '/json/eff');
}

export function getPalettes(host: string): Promise<string[]> {
  return getJson<string[]>(host, '/json/pal');
}

export function getFxData(host: string): Promise<string[]> {
  return getJson<string[]>(host, '/json/fxdata');
}

interface PalxPage {
  m: number;
  p: Record<string, unknown>;
}

export async function getPalettePreviews(host: string): Promise<Record<number, PalettePreview>> {
  const first = await getJson<PalxPage>(host, '/json/palx?page=0');
  const previews = parsePalettePreviewPage(first.p);
  for (let page = 1; page <= first.m; page++) {
    const next = await getJson<PalxPage>(host, `/json/palx?page=${page}`);
    Object.assign(previews, parsePalettePreviewPage(next.p));
  }
  return previews;
}

export function getConfig(host: string): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(host, '/json/cfg');
}

export function getFullState(host: string): Promise<WledFullState> {
  return getJson<WledFullState>(host, '/json');
}

export function patchConfig(
  host: string,
  patch: Record<string, unknown>
): Promise<{ success?: boolean }> {
  return postJson<{ success?: boolean }>(host, '/json/cfg', patch);
}

export async function savePreset(
  host: string,
  opts: { id?: number; name: string; includeBrightness: boolean; saveSegmentBounds: boolean }
): Promise<{ id: number }> {
  let id = opts.id;
  if (id === undefined) {
    // Next free slot 1-250 (slot 0 is reserved by the device).
    const taken = new Set((await getPresets(host)).map((p) => p.id));
    id = 1;
    while (id <= 250 && taken.has(id)) id++;
    if (id > 250) throw new Error('no free preset slot (1-250)');
  }
  await postJson(host, '/json/state', {
    psave: id,
    n: opts.name,
    ib: opts.includeBrightness,
    sb: opts.saveSegmentBounds
  });
  return { id };
}

export async function deletePreset(host: string, presetId: number): Promise<void> {
  await postJson(host, '/json/state', { pdel: presetId });
}

export function getPresetsRaw(host: string): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(host, '/presets.json');
}

export async function reboot(host: string): Promise<void> {
  await postJson(host, '/json/state', { rb: true });
}

export function setNightlight(host: string, nl: Partial<WledNightlight>): Promise<WledState> {
  return setState(host, { nl });
}
