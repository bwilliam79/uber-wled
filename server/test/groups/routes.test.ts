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
});
