import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createSettingsRouter } from '../../src/settings/routes.js';

const NOMINATIM_RESPONSE = [
  { display_name: '1600 Pennsylvania Ave NW, Washington, DC 20500, USA', lat: '38.8976763', lon: '-77.0365298' },
  { display_name: 'Pennsylvania Avenue, Washington, DC, USA', lat: '38.8951', lon: '-77.0369' }
];

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/settings/geocode', () => {
  function makeApp() {
    const db = createDb(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api/settings', createSettingsRouter(db));
    return app;
  }

  it('returns 400 when the q query param is missing', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/settings/geocode');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when q is blank', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/settings/geocode?q=%20%20');
    expect(res.status).toBe(400);
  });

  it('proxies Nominatim and returns matches with an identifying User-Agent header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => NOMINATIM_RESPONSE });
    vi.stubGlobal('fetch', fetchMock);

    const app = makeApp();
    const res = await request(app).get('/api/settings/geocode').query({ q: '1600 Pennsylvania Ave' });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { displayName: '1600 Pennsylvania Ave NW, Washington, DC 20500, USA', latitude: 38.8976763, longitude: -77.0365298 },
      { displayName: 'Pennsylvania Avenue, Washington, DC, USA', latitude: 38.8951, longitude: -77.0369 }
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('nominatim.openstreetmap.org/search');
    expect(String(url)).toContain('q=1600%20Pennsylvania%20Ave');
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/^uber-wled\//);
  });

  it('returns an empty results array when Nominatim has no matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    const app = makeApp();
    const res = await request(app).get('/api/settings/geocode').query({ q: 'asdkfjaslkdfjlaksdjf' });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('returns 502 when the upstream request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const app = makeApp();
    const res = await request(app).get('/api/settings/geocode').query({ q: 'somewhere' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 502 when Nominatim responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    const app = makeApp();
    const res = await request(app).get('/api/settings/geocode').query({ q: 'somewhere' });
    expect(res.status).toBe(502);
  });
});
