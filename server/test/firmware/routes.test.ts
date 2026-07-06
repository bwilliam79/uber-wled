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

  it('reports an unreachable status (200) instead of hanging when the controller is offline', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
      if (url.endsWith('/json/info')) throw new Error('ECONNREFUSED');
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get(`/api/controllers/${controllerId}/firmware`);
    expect(res.status).toBe(200);
    expect(res.body.unreachable).toBe(true);
    expect(res.body.installedVersion).toBeNull();
    expect(res.body.updateAvailable).toBe(false);
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

  it('still returns candidate assets once pinned and the pin still matches, so the client can offer an override', async () => {
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
    // Candidates are always computed now — the picker button must stay
    // reachable as an "override" affordance after the first pin, not just
    // before it.
    expect(res.body.candidateAssets).toHaveLength(2);
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

  describe('POST /:id/update', () => {
    it('returns 404 for a nonexistent controller id', async () => {
      const res = await request(app).post('/api/controllers/does-not-exist/firmware/update');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'controller not found' });
    });

    it('returns 400 when no asset has been pinned for the controller', async () => {
      const res = await request(app).post(`/api/controllers/${controllerId}/firmware/update`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'no asset pinned for this controller yet' });
    });

    it('returns 409 when the pinned pattern no longer matches any asset in the latest release', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      // Pin a pattern that has no corresponding asset in the current release
      // (e.g. the controller was pinned to a variant that's since been
      // dropped from the release assets).
      await request(app).post(`/api/controllers/${controllerId}/firmware/pin`).send({ assetPattern: 'ESP32-S3' }).expect(204);

      const res = await request(app).post(`/api/controllers/${controllerId}/firmware/update`);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'pinned asset pattern no longer matches any asset in the latest release' });
    });

    it('returns 502 when the pinned asset fails to download', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
        if (url === 'https://example.com/ESP02.bin') return { ok: false, status: 500 } as Response;
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      await request(app).post(`/api/controllers/${controllerId}/firmware/pin`).send({ assetPattern: 'ESP02' }).expect(204);

      const res = await request(app).post(`/api/controllers/${controllerId}/firmware/update`);
      expect(res.status).toBe(502);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/download failed/i);
    });

    it('downloads the pinned asset, pushes the OTA update, and returns 200 with the confirmed version', async () => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('api.github.com')) return { ok: true, json: async () => GITHUB_RESPONSE } as Response;
        if (url === 'https://example.com/ESP02.bin') {
          return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
        }
        if (url.endsWith('/update') && init?.method === 'POST') {
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (url.endsWith('/json/info')) {
          // The route's OTA push uses its default retry delay (no way to
          // override it from the route), so the device must confirm the new
          // version on the very first poll to keep this test fast.
          return { ok: true, json: async () => ({ name: 'Porch', ver: '0.15.0', leds: { count: 60 }, arch: 'esp8266' }) } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      await request(app).post(`/api/controllers/${controllerId}/firmware/pin`).send({ assetPattern: 'ESP02' }).expect(204);

      const res = await request(app).post(`/api/controllers/${controllerId}/firmware/update`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, installedVersion: '0.15.0' });
    }, 10000);
  });
});
