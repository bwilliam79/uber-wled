import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createDevicesRouter } from '../../src/devices/routes.js';

const HOST = '10.0.0.50';

function stubFetchByHost(
  handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    const handler = handlers[host];
    if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Same fixture family as test/devices/presets.test.ts — WLED presets.json
// with a normal preset (1), a gap (2), a second preset (3), and a playlist (7).
const RAW_PRESETS: Record<string, unknown> = {
  '0': {},
  '1': { n: 'Warm White', on: true, bri: 128, seg: [{ id: 0, start: 0, stop: 39, fx: 0, pal: 0, col: [[255, 197, 143, 0]] }] },
  '3': { n: 'Party Mix', on: true, bri: 200, seg: [{ id: 0, start: 0, stop: 48, fx: 9, pal: 6, col: [[255, 0, 0]] }] },
  '7': { n: 'Evening Playlist', on: true, playlist: { ps: [1, 3], dur: [300, 300], transition: [7, 7], repeat: 0, end: 0 } }
};

describe('device management routes', () => {
  let app: express.Express;
  let controllerId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Cabinet', host: HOST, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/controllers/:controllerId', createDevicesRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('presets', () => {
    it('GET lists parsed device presets', async () => {
      stubFetchByHost({
        [HOST]: (url) => {
          expect(url).toBe(`http://${HOST}/presets.json`);
          return { status: 200, body: RAW_PRESETS };
        }
      });
      const res = await request(app).get(`/api/controllers/${controllerId}/presets`);
      expect(res.status).toBe(200);
      expect(res.body.presets.map((p: any) => p.id)).toEqual([1, 3, 7]);
      expect(res.body.presets[2]).toEqual({
        id: 7, name: 'Evening Playlist', isPlaylist: true, quicklook: { on: true }
      });
    });

    it('POST saves into the next free slot when id is omitted', async () => {
      const posts: unknown[] = [];
      stubFetchByHost({
        [HOST]: (url, init) => {
          if (url.endsWith('/presets.json')) return { status: 200, body: RAW_PRESETS };
          posts.push(JSON.parse(init?.body as string));
          return { status: 200, body: { success: true } };
        }
      });
      const res = await request(app)
        .post(`/api/controllers/${controllerId}/presets`)
        .send({ name: 'Movie Night', includeBrightness: true, saveSegmentBounds: false });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 2, name: 'Movie Night' });
      expect(posts).toEqual([{ psave: 2, n: 'Movie Night', ib: true, sb: false }]);
    });

    it('POST with an explicit id skips slot discovery', async () => {
      const posts: unknown[] = [];
      const fetchMock = stubFetchByHost({
        [HOST]: (_url, init) => {
          posts.push(JSON.parse(init?.body as string));
          return { status: 200, body: { success: true } };
        }
      });
      const res = await request(app)
        .post(`/api/controllers/${controllerId}/presets`)
        .send({ id: 42, name: 'Pinned', includeBrightness: false, saveSegmentBounds: true });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 42, name: 'Pinned' });
      expect(fetchMock).toHaveBeenCalledTimes(1); // no presets.json fetch
      expect(posts).toEqual([{ psave: 42, n: 'Pinned', ib: false, sb: true }]);
    });

    it('POST without a name is a 400', async () => {
      const res = await request(app)
        .post(`/api/controllers/${controllerId}/presets`)
        .send({ includeBrightness: true, saveSegmentBounds: true });
      expect(res.status).toBe(400);
    });

    it('DELETE sends pdel and returns 204', async () => {
      const posts: unknown[] = [];
      stubFetchByHost({
        [HOST]: (_url, init) => {
          posts.push(JSON.parse(init?.body as string));
          return { status: 200, body: { success: true } };
        }
      });
      const res = await request(app).delete(`/api/controllers/${controllerId}/presets/3`);
      expect(res.status).toBe(204);
      expect(posts).toEqual([{ pdel: 3 }]);
    });

    it('404s for an unknown controller', async () => {
      const res = await request(app).get('/api/controllers/ghost/presets');
      expect(res.status).toBe(404);
    });

    it('502s when the device is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }));
      const res = await request(app).get(`/api/controllers/${controllerId}/presets`);
      expect(res.status).toBe(502);
      expect(res.body.error).toContain('ECONNREFUSED');
    });
  });
});
