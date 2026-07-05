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

  // Subset of the real /json/cfg probed from 192.168.1.86.
  const CFG: Record<string, unknown> = {
    id: { mdns: 'cabinet-lights', name: 'Cabinet Lights', inv: 'Cabinet Lights', sui: false },
    ap: { ssid: 'WLED-AP', pskl: 8, chan: 1, hide: 0 },
    hw: { led: { total: 48, maxpwr: 0, fps: 42, ins: [{ start: 0, len: 39, pin: [16], order: 34, rev: true, skip: 0, type: 30 }] } },
    def: { ps: 1, on: true, bri: 128 }
  };

  describe('config', () => {
    it('GET passes the device cfg.json through', async () => {
      stubFetchByHost({
        [HOST]: (url) => {
          expect(url).toBe(`http://${HOST}/json/cfg`);
          return { status: 200, body: CFG };
        }
      });
      const res = await request(app).get(`/api/controllers/${controllerId}/config`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(CFG);
    });

    it('POST ?dryRun=1 returns the flat diff + rebootRequired and never writes to the device', async () => {
      const fetchMock = stubFetchByHost({
        [HOST]: (url, init) => {
          expect(init?.method).toBeUndefined(); // GETs only
          expect(url).toBe(`http://${HOST}/json/cfg`);
          return { status: 200, body: CFG };
        }
      });
      const res = await request(app)
        .post(`/api/controllers/${controllerId}/config?dryRun=1`)
        .send({ patch: { id: { name: 'Kitchen Cabinets' }, hw: { led: { ins: [{ pin: [17] }] } } } });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        diff: [
          { path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen Cabinets' },
          { path: 'hw.led.ins.0.pin.0', from: 16, to: 17 }
        ],
        rebootRequired: true
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('POST applies the patch and reports rebootRequired', async () => {
      const posts: { url: string; body: unknown }[] = [];
      stubFetchByHost({
        [HOST]: (url, init) => {
          if (!init || init.method === undefined) return { status: 200, body: CFG };
          posts.push({ url, body: JSON.parse(init.body as string) });
          return { status: 200, body: { success: true } };
        }
      });
      const res = await request(app)
        .post(`/api/controllers/${controllerId}/config`)
        .send({ patch: { def: { ps: 3 } } });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, rebootRequired: false });
      expect(posts).toEqual([{ url: `http://${HOST}/json/cfg`, body: { def: { ps: 3 } } }]);
    });

    it('POST without a patch object is a 400', async () => {
      const res = await request(app).post(`/api/controllers/${controllerId}/config`).send({});
      expect(res.status).toBe(400);
    });
  });

  describe('reboot', () => {
    it('POST sends rb:true and returns ok', async () => {
      const posts: unknown[] = [];
      stubFetchByHost({
        [HOST]: (url, init) => {
          expect(url).toBe(`http://${HOST}/json/state`);
          posts.push(JSON.parse(init?.body as string));
          return { status: 200, body: { on: true, bri: 9, ps: -1, seg: [] } };
        }
      });
      const res = await request(app).post(`/api/controllers/${controllerId}/reboot`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(posts).toEqual([{ rb: true }]);
    });

    it('404s for an unknown controller', async () => {
      const res = await request(app).post('/api/controllers/ghost/reboot');
      expect(res.status).toBe(404);
    });
  });
});
