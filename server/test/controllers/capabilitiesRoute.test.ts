import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllersRouter } from '../../src/controllers/routes.js';
import { createCapabilitiesRepository } from '../../src/controllers/capabilitiesRepository.js';
import { parseFxData, type ControllerCapabilities } from '../../src/wled/capabilities.js';

// Verbatim-shaped device responses (values captured from 192.168.1.86,
// WLED 16.0.0, vid 2605030; lists trimmed to two entries).
const DEVICE_ROUTES: Record<string, unknown> = {
  '/json/info': {
    name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
    leds: { count: 48, rgbw: true }, arch: 'esp32'
  },
  '/json/eff': ['Solid', 'Blink'],
  '/json/pal': ['Default', '* Random Cycle'],
  '/json/fxdata': ['', '!,Duty cycle;!,!;!;01'],
  '/json/palx?page=0': {
    m: 0,
    p: { '0': [[0, 155, 0, 213], [240, 0, 50, 252]], '1': ['r', 'r', 'r', 'r'] }
  }
};

function stubDeviceFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    const { pathname, search } = new URL(url);
    const key = pathname + search;
    if (!(key in DEVICE_ROUTES)) throw new Error(`unexpected fetch: ${key}`);
    return { ok: true, json: async () => DEVICE_ROUTES[key] } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('GET /api/controllers/:id/capabilities', () => {
  let app: express.Express;
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/controllers', createControllersRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  async function addController(): Promise<string> {
    const post = await request(app)
      .post('/api/controllers')
      .send({ name: 'Cabinet Lights', host: '10.0.0.50' });
    return post.body.id as string;
  }

  it('returns 404 for an unknown controller id', async () => {
    const res = await request(app).get('/api/controllers/does-not-exist/capabilities');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('serves the cached row without contacting the device', async () => {
    const id = await addController();
    const caps: ControllerCapabilities = {
      vid: 2605030,
      effects: ['Solid', 'Blink'],
      palettes: ['Default', '* Random Cycle'],
      fxMeta: parseFxData(['', '!,Duty cycle;!,!;!;01'], ['Solid', 'Blink']),
      palettePreviews: { 1: { type: 'random' } },
      fetchedAt: '2026-07-04T22:00:00.000Z'
    };
    createCapabilitiesRepository(db).upsert(id, caps);
    const fetchMock = vi.fn(async () => { throw new Error('must not be called'); });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get(`/api/controllers/${id}/capabilities`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(JSON.stringify(caps)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes on demand when no row exists and the device is reachable, then persists', async () => {
    const id = await addController();
    stubDeviceFetch();

    const res = await request(app).get(`/api/controllers/${id}/capabilities`);

    expect(res.status).toBe(200);
    expect(res.body.vid).toBe(2605030);
    expect(res.body.effects).toEqual(['Solid', 'Blink']);
    expect(res.body.fxMeta[1].sliders.ix).toBe('Duty cycle');
    expect(res.body.palettePreviews['1']).toEqual({ type: 'random' });
    expect(createCapabilitiesRepository(db).get(id)?.vid).toBe(2605030);

    // Second request is served from the cache: no further device traffic.
    const silent = vi.fn(async () => { throw new Error('must not be called'); });
    vi.stubGlobal('fetch', silent);
    const again = await request(app).get(`/api/controllers/${id}/capabilities`);
    expect(again.status).toBe(200);
    expect(silent).not.toHaveBeenCalled();
  });

  it('returns 503 {error} when never fetched and the device is unreachable', async () => {
    const id = await addController();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const res = await request(app).get(`/api/controllers/${id}/capabilities`);

    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
    expect(createCapabilitiesRepository(db).get(id)).toBeUndefined();
  });
});
