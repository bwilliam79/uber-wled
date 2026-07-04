import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createControllerStatusRepository } from '../../src/controllers/statusRepository.js';

describe('controller status repository', () => {
  let db: ReturnType<typeof createDb>;
  let controllers: ReturnType<typeof createControllerRepository>;
  let statuses: ReturnType<typeof createControllerStatusRepository>;
  let controllerId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    controllers = createControllerRepository(db);
    statuses = createControllerStatusRepository(db);
    controllerId = controllers.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' }).id;
  });

  it('returns undefined for a controller that has never been polled', () => {
    expect(statuses.get(controllerId)).toBeUndefined();
  });

  it('stores and retrieves a reachable snapshot with parsed info/state', () => {
    const info = { name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp32' };
    const state = { on: true, bri: 128, ps: -1, seg: [] };
    statuses.upsert({ controllerId, reachable: true, info, state, polledAt: '2026-07-04T12:00:00.000Z' });

    expect(statuses.get(controllerId)).toEqual({
      controllerId, reachable: true, info, state, polledAt: '2026-07-04T12:00:00.000Z'
    });
  });

  it('stores an unreachable snapshot with null info/state', () => {
    statuses.upsert({ controllerId, reachable: false, info: null, state: null, polledAt: '2026-07-04T12:00:00.000Z' });
    expect(statuses.get(controllerId)).toEqual({
      controllerId, reachable: false, info: null, state: null, polledAt: '2026-07-04T12:00:00.000Z'
    });
  });

  it('overwrites the previous snapshot on repeated upserts for the same controller', () => {
    statuses.upsert({ controllerId, reachable: true, info: { name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp32' }, state: null, polledAt: '2026-07-04T12:00:00.000Z' });
    statuses.upsert({ controllerId, reachable: true, info: { name: 'Porch', ver: '0.15.0', leds: { count: 60 }, arch: 'esp32' }, state: null, polledAt: '2026-07-04T12:05:00.000Z' });

    const all = statuses.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].info?.ver).toBe('0.15.0');
    expect(all[0].polledAt).toBe('2026-07-04T12:05:00.000Z');
  });

  it('lists snapshots for all controllers via getAll', () => {
    const secondId = controllers.add({ name: 'Deck', host: '10.0.0.51', source: 'manual' }).id;
    statuses.upsert({ controllerId, reachable: true, info: null, state: null, polledAt: '2026-07-04T12:00:00.000Z' });
    statuses.upsert({ controllerId: secondId, reachable: false, info: null, state: null, polledAt: '2026-07-04T12:00:00.000Z' });

    expect(statuses.getAll().map((s) => s.controllerId).sort()).toEqual([controllerId, secondId].sort());
  });
});
