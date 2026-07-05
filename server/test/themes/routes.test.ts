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
  let db: ReturnType<typeof createDb>;
  let controllerId: string;

  beforeEach(() => {
    db = createDb(':memory:');
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

  it('returns effect/palette names from the first reachable controller', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === `http://${HOST}/json/eff`) return { ok: true, json: async () => ['Solid', 'Blink'] } as Response;
      if (url === `http://${HOST}/json/pal`) return { ok: true, json: async () => ['Default', 'Sunset'] } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/themes/effects-palettes');
    expect(res.body).toEqual({
      effects: ['Solid', 'Blink'],
      palettes: ['Default', 'Sunset'],
      sourceControllerId: controllerId,
      sourceControllerName: 'Porch'
    });
  });

  it('skips an unreachable controller and falls through to the next one', async () => {
    const secondHost = '10.0.0.60';
    // "Porch" sorts before "Zeta" (controllers.list() orders by name), so
    // Porch (HOST) is tried first and made to fail here, forcing the fallthrough.
    createControllerRepository(db).add({ name: 'Zeta', host: secondHost, source: 'manual' });

    const fetchMock = vi.fn(async (url: string) => {
      if (url === `http://${HOST}/json/eff` || url === `http://${HOST}/json/pal`) {
        throw new Error('ECONNREFUSED');
      }
      if (url === `http://${secondHost}/json/eff`) return { ok: true, json: async () => ['Solid'] } as Response;
      if (url === `http://${secondHost}/json/pal`) return { ok: true, json: async () => ['Default'] } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/themes/effects-palettes');
    expect(res.body).toEqual({
      effects: ['Solid'],
      palettes: ['Default'],
      sourceControllerId: expect.any(String),
      sourceControllerName: 'Zeta'
    });
  });

  it('returns empty lists and null source when no controller is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const res = await request(app).get('/api/themes/effects-palettes');
    expect(res.body).toEqual({ effects: [], palettes: [], sourceControllerId: null, sourceControllerName: null });
  });
});
