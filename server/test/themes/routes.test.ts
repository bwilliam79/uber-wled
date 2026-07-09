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

  it('updates an existing custom theme in place via PUT', async () => {
    const post = await request(app).post('/api/themes').send({
      name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180
    });
    const put = await request(app).put(`/api/themes/${post.body.id}`).send({
      name: 'Sunset (brighter)', effect: 74, palette: 5, colors: [[255, 120, 0], [0, 0, 0]], brightness: 220
    });
    expect(put.status).toBe(200);
    expect(put.body.id).toBe(post.body.id);
    expect(put.body.name).toBe('Sunset (brighter)');
    // No duplicate row — still exactly one theme, now with the new values.
    const list = (await request(app).get('/api/themes')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: post.body.id, name: 'Sunset (brighter)', effect: 74, brightness: 220 });
  });

  it('returns 404 when updating a theme that does not exist', async () => {
    const res = await request(app).put('/api/themes/nope').send({
      name: 'X', effect: 0, palette: 0, colors: [[1, 1, 1]], brightness: 1
    });
    expect(res.status).toBe(404);
  });

  it('previews a preset import: classifies new/duplicate/conflict and skips non-themes', async () => {
    // One existing theme identical to a preset (duplicate), one same-name-different (conflict).
    await request(app).post('/api/themes').send({ name: 'Christmas Chase', effect: 34, palette: 5, colors: [[255, 0, 0]], brightness: 255 });
    await request(app).post('/api/themes').send({ name: 'Candy Cane', effect: 78, palette: 3, colors: [[255, 0, 0]], brightness: 40 });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === `http://${HOST}/presets.json`) {
        return { ok: true, json: async () => ({
          '5': { n: 'Christmas Chase', bri: 255, seg: [{ fx: 34, pal: 5, col: [[255, 0, 0]] }] },
          '6': { n: 'Candy Cane', bri: 128, seg: [{ fx: 34, pal: 0, col: [[255, 0, 0]] }] },
          '7': { n: 'USA', bri: 64, seg: [{ fx: 76, pal: 5, col: [[255, 0, 0], [255, 255, 255], [0, 0, 255]] }] },
          '8': { n: 'TV Architectural', bri: 96, seg: [{}] }
        }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const res = await request(app).get(`/api/themes/preset-import/${controllerId}`);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.candidates.map((c: any) => [c.presetId, c]));
    expect(byId[5].status).toBe('duplicate');
    expect(byId[6].status).toBe('conflict');
    expect(byId[7].status).toBe('new');
    expect(res.body.skipped.map((s: any) => s.name)).toEqual(['TV Architectural']);
  });

  it('applies a resolved preset import: creates new themes and overwrites a conflict in place', async () => {
    const existing = (await request(app).post('/api/themes').send({
      name: 'Candy Cane', effect: 78, palette: 3, colors: [[255, 0, 0]], brightness: 40
    })).body;

    const res = await request(app).post('/api/themes/preset-import').send({
      imports: [
        { name: 'USA', effect: 76, palette: 5, colors: [[255, 0, 0]], brightness: 64 },
        { name: 'Candy Cane', effect: 34, palette: 0, colors: [[255, 0, 0]], brightness: 128, overwriteThemeId: existing.id }
      ]
    });
    expect(res.body).toEqual({ created: 1, overwritten: 1 });

    const themes = (await request(app).get('/api/themes')).body;
    expect(themes).toHaveLength(2); // Candy Cane overwritten in place (not duplicated) + new USA
    const candy = themes.find((t: any) => t.name === 'Candy Cane');
    expect(candy.id).toBe(existing.id);
    expect(candy.effect).toBe(34);
  });

  it('returns 503 when the controller is unreachable during preset-import preview', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const res = await request(app).get(`/api/themes/preset-import/${controllerId}`);
    expect(res.status).toBe(503);
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
