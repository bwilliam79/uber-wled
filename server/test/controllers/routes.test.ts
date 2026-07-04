import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllersRouter } from '../../src/controllers/routes.js';

describe('controllers routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/controllers', createControllersRouter(db));
  });

  it('POST adds a controller, GET lists it', async () => {
    const post = await request(app)
      .post('/api/controllers')
      .send({ name: 'Porch', host: '10.0.0.50' });
    expect(post.status).toBe(201);
    expect(post.body.source).toBe('manual');

    const get = await request(app).get('/api/controllers');
    expect(get.body).toHaveLength(1);
    expect(get.body[0].name).toBe('Porch');
  });

  it('DELETE removes a controller', async () => {
    const post = await request(app)
      .post('/api/controllers')
      .send({ name: 'Porch', host: '10.0.0.50' });
    await request(app).delete(`/api/controllers/${post.body.id}`).expect(204);
    const get = await request(app).get('/api/controllers');
    expect(get.body).toHaveLength(0);
  });
});
