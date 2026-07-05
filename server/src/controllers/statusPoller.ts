import type Database from 'better-sqlite3';
import { createControllerRepository } from './repository.js';
import { createControllerStatusRepository } from './statusRepository.js';
import {
  getInfo,
  getState,
  getEffects,
  getPalettes,
  getFxData,
  getPalettePreviews
} from '../wled/client.js';
import { maybeRefreshCapabilities, type CapabilityFetchers } from './capabilityService.js';

export interface StatusPollerWled {
  getInfo: typeof getInfo;
  getState: typeof getState;
  getEffects?: typeof getEffects;
  getPalettes?: typeof getPalettes;
  getFxData?: typeof getFxData;
  getPalettePreviews?: typeof getPalettePreviews;
}

export async function pollAllControllerStatus(
  db: Database.Database,
  wled: StatusPollerWled = { getInfo, getState, getEffects, getPalettes, getFxData, getPalettePreviews }
): Promise<void> {
  const controllers = createControllerRepository(db);
  const statuses = createControllerStatusRepository(db);
  const fetchers: CapabilityFetchers = {
    getInfo: wled.getInfo,
    getEffects: wled.getEffects ?? getEffects,
    getPalettes: wled.getPalettes ?? getPalettes,
    getFxData: wled.getFxData ?? getFxData,
    getPalettePreviews: wled.getPalettePreviews ?? getPalettePreviews
  };

  await Promise.all(
    controllers.list().map(async (controller) => {
      const polledAt = new Date().toISOString();
      try {
        const [info, state] = await Promise.all([
          wled.getInfo(controller.host),
          wled.getState(controller.host)
        ]);
        statuses.upsert({ controllerId: controller.id, reachable: true, info, state, polledAt });
        if (typeof info.vid === 'number') {
          // First sighting or firmware change triggers a capability refresh;
          // maybeRefreshCapabilities swallows its own errors.
          await maybeRefreshCapabilities(db, controller, info.vid, fetchers);
        }
      } catch {
        // Offline/unreachable controllers are cached as such rather than
        // leaving stale data or throwing — one unreachable controller must
        // never abort the poll cycle for the rest.
        statuses.upsert({ controllerId: controller.id, reachable: false, info: null, state: null, polledAt });
      }
    })
  );
}
