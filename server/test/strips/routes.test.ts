import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createStripsRouter } from '../../src/strips/routes.js';

const HOST = '10.0.0.50';

function stubFetchState(body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => body } as Response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
function stubFetchFailure() {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('device unreachable'); }));
}

describe('strips routes', () => {
  let app: express.Express;
  let controllerId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/strips', createStripsRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates a strip with an optional label and returns it in the flat list', async () => {
    stubFetchFailure();
    const post = await request(app)
      .post('/api/strips')
      .send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], label: 'Porch rail' });
    expect(post.status).toBe(201);
    expect(post.body.strip.label).toBe('Porch rail');
    expect(post.body.strip.controllerId).toBe(controllerId);

    const list = await request(app).get('/api/strips');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].wledSegId).toBe(0);
  });

  it('recommends a split when two strips share one device segment on the same controller', async () => {
    stubFetchState({ on: true, bri: 128, ps: -1, seg: [{ id: 0, start: 0, stop: 120, len: 120, on: true, bri: 128, fx: 0, pal: 0, col: [] }] });
    await request(app).post('/api/strips').send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
    const second = await request(app).post('/api/strips').send({ controllerId, wledSegId: 0, points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] });
    expect(second.body.recommendations).toHaveLength(1);
    expect(second.body.recommendations[0].suggestedSplitAt).toBe(60);
  });

  it('deletes a strip', async () => {
    stubFetchFailure();
    const post = await request(app).post('/api/strips').send({ controllerId, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    await request(app).delete(`/api/strips/${post.body.strip.id}`).expect(204);
    const list = await request(app).get('/api/strips');
    expect(list.body).toHaveLength(0);
  });
});
