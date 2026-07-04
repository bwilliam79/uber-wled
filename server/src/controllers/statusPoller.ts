import type Database from 'better-sqlite3';
import { createControllerRepository } from './repository.js';
import { createControllerStatusRepository } from './statusRepository.js';
import { getInfo, getState } from '../wled/client.js';

export async function pollAllControllerStatus(
  db: Database.Database,
  wled: { getInfo: typeof getInfo; getState: typeof getState } = { getInfo, getState }
): Promise<void> {
  const controllers = createControllerRepository(db);
  const statuses = createControllerStatusRepository(db);

  await Promise.all(
    controllers.list().map(async (controller) => {
      const polledAt = new Date().toISOString();
      try {
        const [info, state] = await Promise.all([
          wled.getInfo(controller.host),
          wled.getState(controller.host)
        ]);
        statuses.upsert({ controllerId: controller.id, reachable: true, info, state, polledAt });
      } catch {
        // Offline/unreachable controllers are cached as such rather than
        // leaving stale data or throwing — one unreachable controller must
        // never abort the poll cycle for the rest.
        statuses.upsert({ controllerId: controller.id, reachable: false, info: null, state: null, polledAt });
      }
    })
  );
}
