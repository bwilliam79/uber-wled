import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createFloorplanRepository } from '../../src/floorplans/repository.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createPlacementsRouter } from '../../src/placements/routes.js';

const HOST = '10.0.0.50';

function stubFetchState(responseBody: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => responseBody
  } as Response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchFailure() {
  const fetchMock = vi.fn(async () => {
    throw new Error('device unreachable');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('placements routes', () => {
  let app: express.Express;
  let floorplanId: string;
  let controllerId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    floorplanId = createFloorplanRepository(db).add({ name: 'Main', imagePath: '/tmp/x.png' }).id;
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/floorplans/:floorplanId/placements', createPlacementsRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates a placement and returns a real split recommendation when two placements share a device segment', async () => {
    stubFetchState({
      on: true,
      bri: 128,
      ps: -1,
      seg: [{ id: 0, start: 0, stop: 120, len: 120, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
    });

    const first = await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMeters: 3 });
    expect(first.status).toBe(201);
    expect(first.body.recommendations).toEqual([]);

    const second = await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], lengthMeters: 3 });
    expect(second.status).toBe(201);
    expect(second.body.recommendations).toHaveLength(1);
    expect(second.body.recommendations[0].deviceSegId).toBe(0);
    expect(second.body.recommendations[0].suggestedSplitAt).toBe(60);
    expect(second.body.recommendations[0].reason).toMatch(/two placements/i);
  });

  it('still saves the placement and falls back to empty recommendations when the device is unreachable', async () => {
    stubFetchState({
      on: true,
      bri: 128,
      ps: -1,
      seg: [{ id: 0, start: 0, stop: 120, len: 120, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
    });
    await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMeters: 3 });

    stubFetchFailure();
    const second = await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], lengthMeters: 3 });

    expect(second.status).toBe(201);
    expect(second.body.placement).toBeTruthy();
    expect(second.body.recommendations).toEqual([]);

    const list = await request(app).get(`/api/floorplans/${floorplanId}/placements`);
    expect(list.body).toHaveLength(2);
  });

  it('lists placements for a floorplan', async () => {
    stubFetchFailure();
    await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMeters: 3 });
    const get = await request(app).get(`/api/floorplans/${floorplanId}/placements`);
    expect(get.body).toHaveLength(1);
  });

  it('deletes a placement', async () => {
    stubFetchFailure();
    const post = await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMeters: 3 });
    await request(app)
      .delete(`/api/floorplans/${floorplanId}/placements/${post.body.placement.id}`)
      .expect(204);
    const get = await request(app).get(`/api/floorplans/${floorplanId}/placements`);
    expect(get.body).toHaveLength(0);
  });
});
