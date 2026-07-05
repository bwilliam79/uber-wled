import type Database from 'better-sqlite3';
import {
  getInfo,
  getEffects,
  getPalettes,
  getFxData,
  getPalettePreviews
} from '../wled/client.js';
import { parseFxData, type ControllerCapabilities } from '../wled/capabilities.js';
import { createCapabilitiesRepository } from './capabilitiesRepository.js';

export interface CapabilityFetchers {
  getInfo: typeof getInfo;
  getEffects: typeof getEffects;
  getPalettes: typeof getPalettes;
  getFxData: typeof getFxData;
  getPalettePreviews: typeof getPalettePreviews;
}

const defaultFetchers: CapabilityFetchers = {
  getInfo,
  getEffects,
  getPalettes,
  getFxData,
  getPalettePreviews
};

/** Fetch all five capability datasets from the device and upsert the cache. */
export async function refreshCapabilities(
  db: Database.Database,
  controller: { id: string; host: string },
  wled: CapabilityFetchers = defaultFetchers
): Promise<ControllerCapabilities> {
  const [info, effects, palettes, fxdata, palettePreviews] = await Promise.all([
    wled.getInfo(controller.host),
    wled.getEffects(controller.host),
    wled.getPalettes(controller.host),
    wled.getFxData(controller.host),
    wled.getPalettePreviews(controller.host)
  ]);
  if (typeof info.vid !== 'number') {
    throw new Error('device info reports no vid (firmware too old?)');
  }
  const caps: ControllerCapabilities = {
    vid: info.vid,
    effects,
    palettes,
    fxMeta: parseFxData(fxdata, effects),
    palettePreviews,
    fetchedAt: new Date().toISOString()
  };
  createCapabilitiesRepository(db).upsert(controller.id, caps);
  return caps;
}

/**
 * Refresh only when the cache is missing or its vid differs from the one
 * just observed. Errors are swallowed: a failed refresh must never break
 * the caller (the status poller); the next poll retries naturally.
 */
export async function maybeRefreshCapabilities(
  db: Database.Database,
  controller: { id: string; host: string },
  seenVid: number,
  wled: CapabilityFetchers = defaultFetchers
): Promise<void> {
  const cached = createCapabilitiesRepository(db).get(controller.id);
  if (cached && cached.vid === seenVid) return;
  try {
    await refreshCapabilities(db, controller, wled);
  } catch {
    // Swallowed by design — see doc comment.
  }
}
