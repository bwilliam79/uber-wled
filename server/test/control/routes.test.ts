import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createControlRouter } from '../../src/control/routes.js';

// Mirrors the project-wide pattern (see test/wled/client.test.ts, test/segments/routes.test.ts,
// test/themes/routes.test.ts) of stubbing the global `fetch` used by src/wled/client.ts, rather than
// nock (which is not a project dependency and does not intercept Node's native fetch/undici dispatcher).
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

describe('control routes', () => {
  let app: express.Express;
  let db: ReturnType<typeof createDb>;
  let controllerA: string;
  let controllerB: string;
  const HOST_A = '10.0.0.50';
  const HOST_B = '10.0.0.51';

  beforeEach(() => {
    db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    controllerA = controllers.add({ name: 'A', host: HOST_A, source: 'manual' }).id;
    controllerB = controllers.add({ name: 'B', host: HOST_B, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/control', createControlRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('discriminates a v2 {targets,patch} body and writes with udpn nn:true', async () => {
    stubFetchByHost({
      [HOST_A]: (_url, init) => {
        expect(JSON.parse(init?.body as string)).toEqual({ udpn: { nn: true }, on: true, bri: 120 });
        return { status: 200, body: { on: true, bri: 120, ps: -1, seg: [] } };
      }
    });
    const res = await request(app).post('/api/control/apply').send({
      targets: [{ kind: 'segment', controllerId: controllerA, wledSegId: 0 }],
      patch: { on: true, bri: 120 }
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ controllerId: controllerA, wledSegId: 0, ok: true }]);
  });

  it('expands a v2 group target to its segment members', async () => {
    const group = createGroupRepository(db).add({
      name: 'Front',
      members: [
        { controllerId: controllerA, wledSegId: 0 },
        { controllerId: controllerB, wledSegId: 1 }
      ]
    });
    stubFetchByHost({
      [HOST_A]: (_url, init) => {
        expect(JSON.parse(init?.body as string)).toEqual({ udpn: { nn: true }, on: false });
        return { status: 200, body: { on: false, bri: 0, ps: -1, seg: [] } };
      },
      [HOST_B]: () => ({ status: 200, body: { on: false, bri: 0, ps: -1, seg: [] } })
    });
    const res = await request(app).post('/api/control/apply').send({
      targets: [{ kind: 'group', groupId: group.id }],
      patch: { on: false }
    });
    expect(res.body.results).toEqual([
      { controllerId: controllerA, wledSegId: 0, ok: true },
      { controllerId: controllerB, wledSegId: 1, ok: true }
    ]);
  });

  it('returns 400 for a v2 body naming an unknown group', async () => {
    const res = await request(app).post('/api/control/apply').send({
      targets: [{ kind: 'group', groupId: 'nope' }],
      patch: { on: true }
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('group not found: nope');
  });

  it('returns 400 when the body is neither v1 nor v2', async () => {
    const res = await request(app).post('/api/control/apply').send({ hello: 'world' });
    expect(res.status).toBe(400);
  });

  it('rejects the removed v1 {members, action} body shape with 400', async () => {
    const res = await request(app).post('/api/control/apply').send({
      members: [{ controllerId: controllerA, wledSegId: 0 }],
      action: { type: 'power', on: true }
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targets/);
  });
});
