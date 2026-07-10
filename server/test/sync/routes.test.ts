import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createSyncGroupsRouter } from '../../src/sync/routes.js';

function stubFetchByHost(
  handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    const handler = handlers[host];
    if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body ?? { success: true } } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('sync groups routes', () => {
  let app: express.Express;
  let c1: string, c2: string, c3: string;
  const HOST1 = '10.0.0.50', HOST2 = '10.0.0.51', HOST3 = '10.0.0.52';

  beforeEach(() => {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    c1 = controllers.add({ name: 'Cabinet', host: HOST1, source: 'manual' }).id;
    c2 = controllers.add({ name: 'Porch', host: HOST2, source: 'manual' }).id;
    c3 = controllers.add({ name: 'Bar', host: HOST3, source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/sync-groups', createSyncGroupsRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates a sync group with members, inactive, no bitmask', async () => {
    const res = await request(app)
      .post('/api/sync-groups')
      .send({ name: 'Front porch show', memberControllerIds: [c1, c2] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Front porch show', active: false, bitmask: null });
    expect(res.body.memberControllerIds).toEqual([c1, c2]);

    const list = await request(app).get('/api/sync-groups');
    expect(list.body).toHaveLength(1);
  });

  it('rejects creation with a non-array memberControllerIds', async () => {
    const res = await request(app).post('/api/sync-groups').send({ name: 'X', memberControllerIds: 'nope' });
    expect(res.status).toBe(400);
  });

  it('renames a group', async () => {
    const created = await request(app).post('/api/sync-groups').send({ name: 'A', memberControllerIds: [] });
    const patched = await request(app).patch(`/api/sync-groups/${created.body.id}`).send({ name: 'B' });
    expect(patched.body.name).toBe('B');
  });

  it('404s renaming/removing/activating a nonexistent group', async () => {
    expect((await request(app).patch('/api/sync-groups/nope').send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/sync-groups/nope')).status).toBe(404);
    expect((await request(app).post('/api/sync-groups/nope/activate')).status).toBe(404);
    expect((await request(app).post('/api/sync-groups/nope/deactivate')).status).toBe(404);
  });

  it('activate patches every member with the same allocated bit and marks the group active', async () => {
    const created = await request(app)
      .post('/api/sync-groups')
      .send({ name: 'Show', memberControllerIds: [c1, c2] });
    const posts: { host: string; body: any }[] = [];
    stubFetchByHost({
      [HOST1]: (_url, init) => { posts.push({ host: HOST1, body: JSON.parse(init!.body as string) }); return { status: 200 }; },
      [HOST2]: (_url, init) => { posts.push({ host: HOST2, body: JSON.parse(init!.body as string) }); return { status: 200 }; }
    });

    const res = await request(app).post(`/api/sync-groups/${created.body.id}/activate`);
    expect(res.status).toBe(200);
    expect(res.body.group.active).toBe(true);
    expect(res.body.group.bitmask).toBe(1);
    expect(res.body.results).toEqual([{ controllerId: c1, ok: true }, { controllerId: c2, ok: true }]);

    for (const p of posts) {
      expect(p.body).toEqual({
        if: { sync: { send: { en: true, grp: 1 }, recv: { grp: 1, bri: true, col: true, fx: true, pal: true } } }
      });
    }
  });

  it('two concurrently active groups get different bits', async () => {
    stubFetchByHost({
      [HOST1]: () => ({ status: 200 }),
      [HOST2]: () => ({ status: 200 }),
      [HOST3]: () => ({ status: 200 })
    });
    const g1 = await request(app).post('/api/sync-groups').send({ name: 'G1', memberControllerIds: [c1] });
    const g2 = await request(app).post('/api/sync-groups').send({ name: 'G2', memberControllerIds: [c2] });

    const a1 = await request(app).post(`/api/sync-groups/${g1.body.id}/activate`);
    const a2 = await request(app).post(`/api/sync-groups/${g2.body.id}/activate`);
    expect(a1.body.group.bitmask).toBe(1);
    expect(a2.body.group.bitmask).toBe(2);
  });

  it('rejects activating a group that shares a member with another already-active group', async () => {
    stubFetchByHost({ [HOST1]: () => ({ status: 200 }), [HOST2]: () => ({ status: 200 }) });
    const g1 = await request(app).post('/api/sync-groups').send({ name: 'G1', memberControllerIds: [c1] });
    await request(app).post(`/api/sync-groups/${g1.body.id}/activate`);

    const g2 = await request(app).post('/api/sync-groups').send({ name: 'G2', memberControllerIds: [c1, c2] });
    const res = await request(app).post(`/api/sync-groups/${g2.body.id}/activate`);
    expect(res.status).toBe(409);
    // Named controller + named group, with a clear next step — not a bare UUID.
    expect(res.body.error).toMatch(/"Cabinet".*already active.*"G1"/);
    expect(res.body.error).toMatch(/Deactivate that group first/);
  });

  it('returns 409 when all 8 sync bits are already in use', async () => {
    stubFetchByHost({ [HOST1]: () => ({ status: 200 }) });
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const g = await request(app).post('/api/sync-groups').send({ name: `G${i}`, memberControllerIds: [] });
      ids.push(g.body.id);
      await request(app).post(`/api/sync-groups/${g.body.id}/activate`);
    }
    const overflow = await request(app).post('/api/sync-groups').send({ name: 'Overflow', memberControllerIds: [] });
    const res = await request(app).post(`/api/sync-groups/${overflow.body.id}/activate`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('no free sync group slot');
  });

  it('deactivate reverts send.en to false and frees the bit for reuse', async () => {
    const posts: any[] = [];
    stubFetchByHost({
      [HOST1]: (_url, init) => { posts.push(JSON.parse(init!.body as string)); return { status: 200 }; }
    });
    const created = await request(app).post('/api/sync-groups').send({ name: 'Show', memberControllerIds: [c1] });
    await request(app).post(`/api/sync-groups/${created.body.id}/activate`);
    posts.length = 0; // clear the activate POST, only care about deactivate's

    const res = await request(app).post(`/api/sync-groups/${created.body.id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.group.active).toBe(false);
    expect(res.body.group.bitmask).toBeNull();
    expect(posts).toEqual([{ if: { sync: { send: { en: false } } } }]);

    // bit 1 should be free again for a new group
    const g2 = await request(app).post('/api/sync-groups').send({ name: 'Next', memberControllerIds: [] });
    const activated = await request(app).post(`/api/sync-groups/${g2.body.id}/activate`);
    expect(activated.body.group.bitmask).toBe(1);
  });

  it('one member failing does not block the others or the group\'s own active state', async () => {
    stubFetchByHost({
      [HOST1]: () => ({ status: 200 }),
      [HOST2]: () => { throw new Error('connect ECONNREFUSED'); }
    });
    const created = await request(app).post('/api/sync-groups').send({ name: 'Show', memberControllerIds: [c1, c2] });
    const res = await request(app).post(`/api/sync-groups/${created.body.id}/activate`);
    expect(res.body.group.active).toBe(true);
    expect(res.body.results).toEqual([
      { controllerId: c1, ok: true },
      { controllerId: c2, ok: false, error: 'connect ECONNREFUSED' }
    ]);
  });

  it('rejects changing membership while active, allows it once deactivated', async () => {
    stubFetchByHost({ [HOST1]: () => ({ status: 200 }), [HOST2]: () => ({ status: 200 }) });
    const created = await request(app).post('/api/sync-groups').send({ name: 'Show', memberControllerIds: [c1] });
    await request(app).post(`/api/sync-groups/${created.body.id}/activate`);

    const whileActive = await request(app)
      .patch(`/api/sync-groups/${created.body.id}`)
      .send({ memberControllerIds: [c1, c2] });
    expect(whileActive.status).toBe(400);

    await request(app).post(`/api/sync-groups/${created.body.id}/deactivate`);
    const whileInactive = await request(app)
      .patch(`/api/sync-groups/${created.body.id}`)
      .send({ memberControllerIds: [c1, c2] });
    expect(whileInactive.status).toBe(200);
    expect(whileInactive.body.memberControllerIds).toEqual([c1, c2]);
  });

  it('removing an active group deactivates its members first, then deletes it', async () => {
    const posts: any[] = [];
    stubFetchByHost({
      [HOST1]: (_url, init) => { posts.push(JSON.parse(init!.body as string)); return { status: 200 }; }
    });
    const created = await request(app).post('/api/sync-groups').send({ name: 'Show', memberControllerIds: [c1] });
    await request(app).post(`/api/sync-groups/${created.body.id}/activate`);
    posts.length = 0;

    const res = await request(app).delete(`/api/sync-groups/${created.body.id}`);
    expect(res.status).toBe(204);
    expect(posts).toEqual([{ if: { sync: { send: { en: false } } } }]);
    expect((await request(app).get('/api/sync-groups')).body).toHaveLength(0);
  });

  it('removing an inactive group makes no device requests', async () => {
    const fetchMock = stubFetchByHost({});
    const created = await request(app).post('/api/sync-groups').send({ name: 'Show', memberControllerIds: [] });
    await request(app).delete(`/api/sync-groups/${created.body.id}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reactivating an already-active group is a no-op that keeps its bit', async () => {
    stubFetchByHost({ [HOST1]: () => ({ status: 200 }) });
    const created = await request(app).post('/api/sync-groups').send({ name: 'Show', memberControllerIds: [c1] });
    const first = await request(app).post(`/api/sync-groups/${created.body.id}/activate`);
    const second = await request(app).post(`/api/sync-groups/${created.body.id}/activate`);
    expect(second.body.group.bitmask).toBe(first.body.group.bitmask);
    expect(second.body.results).toEqual([]);
  });
});
