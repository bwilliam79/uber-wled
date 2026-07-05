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
      { url: `http://${HOST}/json/state`, method: 'POST', body: { udpn: { nn: true }, seg: [{ id: 0, start: 0, stop: 90 }] } },
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

  it('PUT accepts the full widened field set and maps name → n', async () => {
    stubFetchOnce(
      {
        url: `http://${HOST}/json/state`,
        method: 'POST',
        body: {
          udpn: { nn: true },
          seg: [{ id: 1, grp: 2, spc: 1, of: 3, rev: true, mi: false, n: 'Under-cabinet', on: false, bri: 96 }]
        }
      },
      {
        on: true, bri: 128, ps: -1,
        seg: [
          { id: 0, start: 0, stop: 39, len: 39, on: true, bri: 128, fx: 0, pal: 0, col: [] },
          { id: 1, start: 39, stop: 48, len: 9, on: false, bri: 96, fx: 0, pal: 0, col: [] }
        ]
      }
    );
    const res = await request(app)
      .put(`/api/controllers/${controllerId}/segments/1`)
      .send({ grp: 2, spc: 1, of: 3, rev: true, mi: false, name: 'Under-cabinet', on: false, bri: 96 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('POST creates a segment at the next free id', async () => {
    // Two-segment layout probed from the real controller (ids 0 and 1).
    const existing = {
      on: true, bri: 128, ps: -1,
      seg: [
        { id: 0, start: 0, stop: 39, len: 39, on: true, bri: 128, fx: 0, pal: 0, col: [] },
        { id: 1, start: 39, stop: 48, len: 9, on: true, bri: 128, fx: 0, pal: 0, col: [] }
      ]
    };
    const posts: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return { ok: true, json: async () => existing } as Response;
      }
      posts.push(JSON.parse(init.body as string));
      return {
        ok: true,
        json: async () => ({
          ...existing,
          seg: [...existing.seg, { id: 2, start: 48, stop: 60, len: 12, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
        })
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .post(`/api/controllers/${controllerId}/segments`)
      .send({ start: 48, stop: 60 });
    expect(res.status).toBe(201);
    expect(posts).toEqual([{ udpn: { nn: true }, seg: [{ id: 2, start: 48, stop: 60 }] }]);
    expect(res.body).toHaveLength(3);
  });

  it('POST without numeric start/stop is a 400', async () => {
    const res = await request(app).post(`/api/controllers/${controllerId}/segments`).send({ start: 'a' });
    expect(res.status).toBe(400);
  });

  it('DELETE removes a segment via stop:0 and returns the remaining segments', async () => {
    stubFetchOnce(
      { url: `http://${HOST}/json/state`, method: 'POST', body: { udpn: { nn: true }, seg: [{ id: 1, stop: 0 }] } },
      {
        on: true, bri: 128, ps: -1,
        seg: [{ id: 0, start: 0, stop: 39, len: 39, on: true, bri: 128, fx: 0, pal: 0, col: [] }]
      }
    );
    const res = await request(app).delete(`/api/controllers/${controllerId}/segments/1`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('returns 404 for an unknown controller', async () => {
    const res = await request(app).get('/api/controllers/does-not-exist/segments');
    expect(res.status).toBe(404);
  });
});
