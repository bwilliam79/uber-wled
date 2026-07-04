import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createRoomLabelsRouter } from '../../src/room_labels/routes.js';

describe('room-labels routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/room-labels', createRoomLabelsRouter(db));
  });

  it('creates, lists, moves, and deletes a room label', async () => {
    const post = await request(app).post('/api/room-labels').send({ name: 'Kitchen', x: 12, y: 34 });
    expect(post.status).toBe(201);
    expect(post.body.name).toBe('Kitchen');

    const list = await request(app).get('/api/room-labels');
    expect(list.body).toHaveLength(1);

    const patch = await request(app).patch(`/api/room-labels/${post.body.id}`).send({ x: 50, y: 60 });
    expect(patch.status).toBe(200);
    expect(patch.body.x).toBe(50);
    expect(patch.body.y).toBe(60);
    expect(patch.body.name).toBe('Kitchen');

    await request(app).delete(`/api/room-labels/${post.body.id}`).expect(204);
    const after = await request(app).get('/api/room-labels');
    expect(after.body).toHaveLength(0);
  });

  it('returns 404 when patching a missing label', async () => {
    const res = await request(app).patch('/api/room-labels/nope').send({ x: 1 });
    expect(res.status).toBe(404);
  });
});
