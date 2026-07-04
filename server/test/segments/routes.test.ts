import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createSegmentsRouter } from '../../src/segments/routes.js';

const HOST = '10.0.0.50';

function stubFetchOnce(expected: { url: string; method?: string; body?: unknown }, responseBody: unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe(expected.url);
    if (expected.method) expect(init?.method).toBe(expected.method);
    if (expected.body) expect(JSON.parse(init?.body as string)).toEqual(expected.body);
    return {
      ok: true,
      json: async () => responseBody
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('segments routes', () => {
  let app: express.Express;
  let controllerId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    const repo = createControllerRepository(db);
    controllerId = repo.add({ name: 'Porch', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/controllers/:controllerId/segments', createSegmentsRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('GET returns the live segments from the device', async () => {
    stubFetchOnce(
      { url: `http://${HOST}/json/state` },
      {
        on: true, bri: 128, ps: -1,
        seg: [{ id: 0, start: 0, stop: 60, len: 60, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
      }
    );
    const res = await request(app).get(`/api/controllers/${controllerId}/segments`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].stop).toBe(60);
  });

  it('PUT pushes a new boundary to the device and returns updated segments', async () => {
    stubFetchOnce(
      { url: `http://${HOST}/json/state`, method: 'POST', body: { seg: [{ id: 0, start: 0, stop: 90 }] } },
      {
        on: true, bri: 128, ps: -1,
        seg: [{ id: 0, start: 0, stop: 90, len: 90, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
      }
    );
    const res = await request(app)
      .put(`/api/controllers/${controllerId}/segments/0`)
      .send({ start: 0, stop: 90 });
    expect(res.status).toBe(200);
    expect(res.body[0].stop).toBe(90);
  });

  it('returns 404 for an unknown controller', async () => {
    const res = await request(app).get('/api/controllers/does-not-exist/segments');
    expect(res.status).toBe(404);
  });
});
