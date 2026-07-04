import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createFloorplanRepository } from '../../src/floorplans/repository.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createPlacementsRouter } from '../../src/placements/routes.js';

describe('placements routes', () => {
  let app: express.Express;
  let floorplanId: string;
  let controllerId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    floorplanId = createFloorplanRepository(db).add({ name: 'Main', imagePath: '/tmp/x.png' }).id;
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: '10.0.0.50', source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/floorplans/:floorplanId/placements', createPlacementsRouter(db));
  });

  it('creates a placement and returns split recommendations', async () => {
    const first = await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMeters: 3 });
    expect(first.status).toBe(201);
    expect(first.body.recommendations).toEqual([]);

    const second = await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], lengthMeters: 3 });
    expect(second.body.recommendations).toHaveLength(0); // no device segment data supplied yet -> no recommendation possible
  });

  it('lists placements for a floorplan', async () => {
    await request(app)
      .post(`/api/floorplans/${floorplanId}/placements`)
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], lengthMeters: 3 });
    const get = await request(app).get(`/api/floorplans/${floorplanId}/placements`);
    expect(get.body).toHaveLength(1);
  });

  it('deletes a placement', async () => {
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
