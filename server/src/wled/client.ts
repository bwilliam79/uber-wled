import type { WledInfo, WledState, WledStatePatch, WledPreset } from './types.js';
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
