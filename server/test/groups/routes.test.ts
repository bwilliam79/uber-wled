import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupsRouter } from '../../src/groups/routes.js';

describe('groups routes', () => {
  let app: express.Express;
  let controllerId1: string;
  let controllerId2: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    controllerId1 = controllers.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' }).id;
    controllerId2 = controllers.add({ name: 'Eaves', host: '10.0.0.51', source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/groups', createGroupsRouter(db));
  });

  it('creates a group with members and lists it', async () => {
    const post = await request(app)
      .post('/api/groups')
      .send({ name: 'Front of House', members: [{ controllerId: controllerId1, wledSegId: 0 }, { controllerId: controllerId2, wledSegId: 1 }] });
    expect(post.status).toBe(201);
    expect(post.body.members).toHaveLength(2);

    const get = await request(app).get('/api/groups');
    expect(get.body).toHaveLength(1);
  });

  it('updates a group\'s members', async () => {
    const post = await request(app)
      .post('/api/groups')
      .send({ name: 'Front of House', members: [{ controllerId: controllerId1, wledSegId: 0 }] });
    const patch = await request(app)
      .patch(`/api/groups/${post.body.id}`)
      .send({ members: [{ controllerId: controllerId1, wledSegId: 0 }, { controllerId: controllerId2, wledSegId: 0 }] });
    expect(patch.body.members).toHaveLength(2);
  });

  it('deletes a group', async () => {
    const post = await request(app).post('/api/groups').send({ name: 'X', members: [] });
    await request(app).delete(`/api/groups/${post.body.id}`).expect(204);
    expect((await request(app).get('/api/groups')).body).toHaveLength(0);
  });

  it('stores icon and sortOrder on create and returns them', async () => {
    const post = await request(app)
      .post('/api/groups')
      .send({ name: 'Kitchen', members: [], icon: 'lamp', sortOrder: 3 });
    expect(post.status).toBe(201);
    expect(post.body.icon).toBe('lamp');
    expect(post.body.sortOrder).toBe(3);
  });

  it('defaults icon to null and appends new groups at the end of the sort order', async () => {
    const a = await request(app).post('/api/groups').send({ name: 'A', members: [] });
    const b = await request(app).post('/api/groups').send({ name: 'B', members: [] });
    expect(a.body.icon).toBeNull();
    expect(a.body.sortOrder).toBe(0);
    expect(b.body.sortOrder).toBe(1);
  });

  it('updates icon via PATCH without touching other fields', async () => {
    const post = await request(app).post('/api/groups').send({ name: 'A', members: [] });
    const patch = await request(app).patch(`/api/groups/${post.body.id}`).send({ icon: 'sofa' });
    expect(patch.body.icon).toBe('sofa');
    expect(patch.body.name).toBe('A');
  });

  it('reorders groups and persists the new sortOrder', async () => {
    const a = await request(app).post('/api/groups').send({ name: 'A', members: [] });
    const b = await request(app).post('/api/groups').send({ name: 'B', members: [] });
    const res = await request(app).post('/api/groups/reorder').send({ ids: [b.body.id, a.body.id] });
    expect(res.status).toBe(200);
    expect(res.body.map((g: { id: string }) => g.id)).toEqual([b.body.id, a.body.id]);
    expect(res.body.map((g: { sortOrder: number }) => g.sortOrder)).toEqual([0, 1]);
    const list = await request(app).get('/api/groups');
    expect(list.body.map((g: { id: string }) => g.id)).toEqual([b.body.id, a.body.id]);
  });

  it('rejects a reorder body without an ids array of strings', async () => {
    await request(app).post('/api/groups/reorder').send({ ids: 'nope' }).expect(400);
    await request(app).post('/api/groups/reorder').send({}).expect(400);
  });
});
