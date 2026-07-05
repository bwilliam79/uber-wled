import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createControllerStatusRepository } from '../../src/controllers/statusRepository.js';
import { pollAllControllerStatus } from '../../src/controllers/statusPoller.js';
import { createCapabilitiesRepository } from '../../src/controllers/capabilitiesRepository.js';

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

describe('pollAllControllerStatus capability refresh wiring', () => {
  let db: ReturnType<typeof createDb>;
  let controllers: ReturnType<typeof createControllerRepository>;
  let statuses: ReturnType<typeof createControllerStatusRepository>;

  const info = {
    name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
    leds: { count: 48, rgbw: true }, arch: 'esp32'
  };
  const state = { on: true, bri: 128, ps: -1, seg: [] };

  function capFetchers() {
    return {
      getEffects: vi.fn(async () => ['Solid', 'Blink']),
      getPalettes: vi.fn(async () => ['Default', '* Random Cycle']),
      getFxData: vi.fn(async () => ['', '!,Duty cycle;!,!;!;01']),
      getPalettePreviews: vi.fn(async () => ({ 1: { type: 'random' as const } }))
    };
  }

  beforeEach(() => {
    db = createDb(':memory:');
    controllers = createControllerRepository(db);
    statuses = createControllerStatusRepository(db);
  });

  it('populates the capability cache on first sight of a controller with a vid', async () => {
    const id = controllers.add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' }).id;
    await pollAllControllerStatus(db, {
      getInfo: async () => info,
      getState: async () => state,
      ...capFetchers()
    });

    const caps = createCapabilitiesRepository(db).get(id);
    expect(caps?.vid).toBe(2605030);
    expect(caps?.fxMeta[1].sliders.ix).toBe('Duty cycle');
    expect(statuses.get(id)).toMatchObject({ reachable: true });
  });

  it('does not re-fetch capabilities when the cached vid matches', async () => {
    controllers.add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' });
    const first = capFetchers();
    await pollAllControllerStatus(db, { getInfo: async () => info, getState: async () => state, ...first });

    const second = capFetchers();
    await pollAllControllerStatus(db, { getInfo: async () => info, getState: async () => state, ...second });

    expect(second.getEffects).not.toHaveBeenCalled();
    expect(second.getFxData).not.toHaveBeenCalled();
  });

  it('re-fetches capabilities when the device vid changes (firmware update)', async () => {
    const id = controllers.add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' }).id;
    await pollAllControllerStatus(db, { getInfo: async () => info, getState: async () => state, ...capFetchers() });

    const upgraded = { ...info, vid: 2605031 };
    await pollAllControllerStatus(db, { getInfo: async () => upgraded, getState: async () => state, ...capFetchers() });

    expect(createCapabilitiesRepository(db).get(id)?.vid).toBe(2605031);
  });

  it('still records reachable status when the capability refresh itself fails', async () => {
    const id = controllers.add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' }).id;
    await pollAllControllerStatus(db, {
      getInfo: async () => info,
      getState: async () => state,
      ...capFetchers(),
      getFxData: vi.fn(async () => { throw new Error('ECONNREFUSED'); })
    });

    expect(statuses.get(id)).toMatchObject({ reachable: true, info, state });
    expect(createCapabilitiesRepository(db).get(id)).toBeUndefined();
  });

  it('does not attempt a refresh when info has no vid (old firmware / legacy mocks)', async () => {
    const id = controllers.add({ name: 'Old', host: '10.0.0.51', source: 'manual' }).id;
    const fetchers = capFetchers();
    await pollAllControllerStatus(db, {
      getInfo: async () => ({ name: 'Old', ver: '0.9.0', leds: { count: 30 }, arch: 'esp8266' }),
      getState: async () => state,
      ...fetchers
    });

    expect(fetchers.getEffects).not.toHaveBeenCalled();
    expect(createCapabilitiesRepository(db).get(id)).toBeUndefined();
  });
});
