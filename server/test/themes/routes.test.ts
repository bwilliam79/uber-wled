import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createThemesRouter } from '../../src/themes/routes.js';

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

describe('themes routes', () => {
  let app: express.Express;
  let controllerId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/themes', createThemesRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates and lists a custom theme', async () => {
    const post = await request(app).post('/api/themes').send({
      name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180
    });
    expect(post.status).toBe(201);
    expect((await request(app).get('/api/themes')).body).toHaveLength(1);
  });

  it('deletes a custom theme', async () => {
    const post = await request(app).post('/api/themes').send({
      name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180
    });
    await request(app).delete(`/api/themes/${post.body.id}`).expect(204);
    expect((await request(app).get('/api/themes')).body).toHaveLength(0);
  });

  it('proxies a controller\'s WLED presets', async () => {
    stubFetchOnce({ url: `http://${HOST}/presets.json` }, { '1': { n: 'Party' } });
    const res = await request(app).get(`/api/themes/presets/${controllerId}`);
    expect(res.body).toEqual([{ id: 1, name: 'Party' }]);
  });
});
