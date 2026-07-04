import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createControllerStatusRepository } from '../../src/controllers/statusRepository.js';
import { pollAllControllerStatus } from '../../src/controllers/statusPoller.js';

describe('pollAllControllerStatus', () => {
  let db: ReturnType<typeof createDb>;
  let controllers: ReturnType<typeof createControllerRepository>;
  let statuses: ReturnType<typeof createControllerStatusRepository>;

  beforeEach(() => {
    db = createDb(':memory:');
    controllers = createControllerRepository(db);
    statuses = createControllerStatusRepository(db);
  });

  it('caches info and state for a reachable controller', async () => {
    const id = controllers.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' }).id;
    const info = { name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp32' };
    const state = { on: true, bri: 128, ps: -1, seg: [] };

    await pollAllControllerStatus(db, {
      getInfo: async () => info,
      getState: async () => state
    });

    expect(statuses.get(id)).toMatchObject({ reachable: true, info, state });
  });

  it('caches reachable: false with null data when a controller throws (offline)', async () => {
    const id = controllers.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' }).id;

    await pollAllControllerStatus(db, {
      getInfo: async () => { throw new Error('ECONNREFUSED'); },
      getState: async () => { throw new Error('ECONNREFUSED'); }
    });

    expect(statuses.get(id)).toMatchObject({ reachable: false, info: null, state: null });
  });

  it('polls every controller independently — one offline controller does not block the rest', async () => {
    const okId = controllers.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' }).id;
    const offlineId = controllers.add({ name: 'Deck', host: '10.0.0.51', source: 'manual' }).id;
    const info = { name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp32' };
    const state = { on: true, bri: 128, ps: -1, seg: [] };

    await pollAllControllerStatus(db, {
      getInfo: async (host: string) => {
        if (host === '10.0.0.51') throw new Error('ECONNREFUSED');
        return info;
      },
      getState: async (host: string) => {
        if (host === '10.0.0.51') throw new Error('ECONNREFUSED');
        return state;
      }
    });

    expect(statuses.get(okId)).toMatchObject({ reachable: true, info, state });
    expect(statuses.get(offlineId)).toMatchObject({ reachable: false, info: null, state: null });
  });

  it('does nothing when there are no controllers', async () => {
    await pollAllControllerStatus(db, {
      getInfo: async () => { throw new Error('should not be called'); },
      getState: async () => { throw new Error('should not be called'); }
    });
    expect(statuses.getAll()).toEqual([]);
  });
});
