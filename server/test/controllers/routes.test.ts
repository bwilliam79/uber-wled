import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllersRouter } from '../../src/controllers/routes.js';
import { createControllerStatusRepository } from '../../src/controllers/statusRepository.js';

describe('controllers routes', () => {
  let app: express.Express;
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
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

  it('POST rejects a malformed/URL-like host with 400 and does not persist it', async () => {
    const post = await request(app)
      .post('/api/controllers')
      .send({ name: 'Evil', host: 'http://evil.example.com/path' });
    expect(post.status).toBe(400);
    expect(post.body.error).toBeTruthy();

    const get = await request(app).get('/api/controllers');
    expect(get.body).toHaveLength(0);
  });

  it('POST /:id/import-schedules returns 404 for a nonexistent controller id', async () => {
    const res = await request(app).post('/api/controllers/does-not-exist/import-schedules').send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('GET /:id/status returns 404 for a nonexistent controller id', async () => {
    const res = await request(app).get('/api/controllers/does-not-exist/status');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('GET /:id/status returns an unpolled placeholder before the background poller has run', async () => {
    const post = await request(app).post('/api/controllers').send({ name: 'Porch', host: '10.0.0.50' });

    const res = await request(app).get(`/api/controllers/${post.body.id}/status`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ controllerId: post.body.id, reachable: false, info: null, state: null, polledAt: null });
  });

  it('GET /:id/status returns the cached snapshot once one exists', async () => {
    const post = await request(app).post('/api/controllers').send({ name: 'Porch', host: '10.0.0.50' });
    const info = { name: 'Porch', ver: '0.14.0', leds: { count: 60 }, arch: 'esp32' };
    const state = { on: true, bri: 128, ps: -1, seg: [] };
    createControllerStatusRepository(db).upsert({
      controllerId: post.body.id, reachable: true, info, state, polledAt: '2026-07-04T12:00:00.000Z'
    });

    const res = await request(app).get(`/api/controllers/${post.body.id}/status`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      controllerId: post.body.id, reachable: true, info, state, polledAt: '2026-07-04T12:00:00.000Z'
    });
  });
});
