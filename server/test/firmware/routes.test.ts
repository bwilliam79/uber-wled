import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createFirmwareRouter } from '../../src/firmware/routes.js';

const HOST = '10.0.0.50';

const GITHUB_RESPONSE = [
  {
    tag_name: 'v0.15.0',
    published_at: '2026-06-01T00:00:00Z',
    assets: [
      { name: 'WLED_0.15.0_ESP8266.bin', browser_download_url: 'https://example.com/ESP8266.bin' },
      { name: 'WLED_0.15.0_ESP02.bin', browser_download_url: 'https://example.com/ESP02.bin' }
    ]
  }
];

afterEach(() => vi.unstubAllGlobals());

describe('firmware routes', () => {
  let app: express.Express;
  let controllerId: string;
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/controllers/:id/firmware', createFirmwareRouter(db));
  });

  it('reports update availability and candidate assets when unpinned', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
      if (url.endsWith('/json/info')) {
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get(`/api/controllers/${controllerId}/firmware`);
    expect(res.status).toBe(200);
    expect(res.body.installedVersion).toBe('0.14.0');
    expect(res.body.latestTag).toBe('v0.15.0');
    expect(res.body.updateAvailable).toBe(true);
    expect(res.body.pinnedAssetPattern).toBeNull();
    expect(res.body.candidateAssets).toHaveLength(2);
  });

  it('returns no candidate assets once pinned and the pin still matches', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
      if (url.endsWith('/json/info')) {
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await request(app).post(`/api/controllers/${controllerId}/firmware/pin`).send({ assetPattern: 'ESP02' }).expect(204);

    const res = await request(app).get(`/api/controllers/${controllerId}/firmware`);
    expect(res.body.pinnedAssetPattern).toBe('ESP02');
    expect(res.body.candidateAssets).toEqual([]);
  });

  it('surfaces candidate assets again when the pin no longer matches any asset', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
      if (url.endsWith('/json/info')) {
        return { ok: true, json: async () => ({ name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await request(app).post(`/api/controllers/${controllerId}/firmware/pin`).send({ assetPattern: 'ESP01' }).expect(204);

    const res = await request(app).get(`/api/controllers/${controllerId}/firmware`);
    expect(res.body.pinnedAssetPattern).toBe('ESP01');
    expect(res.body.candidateAssets.length).toBeGreaterThan(0);
  });
});
