import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface GeocodeMatch {
  displayName: string;
  latitude: number;
  longitude: number;
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const MAX_RESULTS = 5;

// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// requires requests to identify the calling application via a descriptive
// User-Agent (or Referer). This is only reachable from server-side code
// (not the browser fetch in the client) precisely because browsers control
// and normalize their own User-Agent header and won't let a page override
// it — so this proxy exists to make that identifying request correctly,
// mirroring the same server-proxies-external-API shape already used for
// GitHub release checks (see ../firmware/githubClient.ts).
function readServerVersion(): string {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const USER_AGENT = `uber-wled/${readServerVersion()} (self-hosted WLED controller; https://github.com/bwilliam79/uber-wled)`;

export async function geocodeAddress(query: string): Promise<GeocodeMatch[]> {
  const url = `${NOMINATIM_SEARCH_URL}?format=json&limit=${MAX_RESULTS}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);

  const results = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return results.map((r) => ({
    displayName: r.display_name,
    latitude: Number(r.lat),
    longitude: Number(r.lon)
  }));
}
