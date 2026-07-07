import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createSchedulesRouter } from '../../src/schedules/routes.js';

describe('schedules routes', () => {
  let app: express.Express;
  let groupId: string;
  let controllerId: string;
  let controllerId2: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    groupId = createGroupRepository(db).add({ name: 'Front', members: [] }).id;
    controllerId = createControllerRepository(db).add({ name: 'Cabinet', host: '10.0.0.50', source: 'manual' }).id;
    controllerId2 = createControllerRepository(db).add({ name: 'Porch', host: '10.0.0.51', source: 'manual' }).id;
    app = express();
    app.use(express.json());
    app.use('/api/schedules', createSchedulesRouter(db));
  });

  it('creates a cron schedule and lists it', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'Bedtime off', triggerType: 'cron', cronExpr: '0 22 * * *',
      offsetMinutes: 0, groupId, actionType: 'power', actionPayload: { on: false }
    });
    expect(post.status).toBe(201);
    expect((await request(app).get('/api/schedules')).body).toHaveLength(1);
  });

  it('creates a sunset-relative schedule', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'Sunset on', triggerType: 'sunset', offsetMinutes: -15,
      latitude: 39.1, longitude: -94.6, groupId, actionType: 'power', actionPayload: { on: true }
    });
    expect(post.status).toBe(201);
    expect(post.body.triggerType).toBe('sunset');
  });

  it('creates a weekly schedule with daysOfWeek and timeOfDay', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'Weekday porch light', triggerType: 'weekly',
      daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '18:30',
      offsetMinutes: 0, groupId, actionType: 'power', actionPayload: { on: true }
    });
    expect(post.status).toBe(201);
    expect(post.body.triggerType).toBe('weekly');
    expect(post.body.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(post.body.timeOfDay).toBe('18:30');
  });

  it('creates a schedule targeting a controller directly (no group)', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'Direct', triggerType: 'cron', cronExpr: '0 22 * * *', offsetMinutes: 0,
      controllers: [{ controllerId, wledSegId: null }], actionType: 'power', actionPayload: { on: false }
    });
    expect(post.status).toBe(201);
    expect(post.body.groupId).toBeNull();
    expect(post.body.controllers).toEqual([{ controllerId, wledSegId: null }]);
  });

  it('creates a schedule targeting several individual controllers at once', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'Multi-direct', triggerType: 'cron', cronExpr: '0 22 * * *', offsetMinutes: 0,
      controllers: [{ controllerId, wledSegId: null }, { controllerId: controllerId2, wledSegId: null }],
      actionType: 'power', actionPayload: { on: false }
    });
    expect(post.status).toBe(201);
    expect(post.body.groupId).toBeNull();
    expect(post.body.controllers).toEqual([
      { controllerId, wledSegId: null },
      { controllerId: controllerId2, wledSegId: null }
    ]);
  });

  it('PATCHes a schedule from a group target to a direct multi-controller target', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'Bedtime off', triggerType: 'cron', cronExpr: '0 22 * * *',
      offsetMinutes: 0, groupId, actionType: 'power', actionPayload: { on: false }
    });
    const patch = await request(app).patch(`/api/schedules/${post.body.id}`).send({
      groupId: null, controllers: [{ controllerId, wledSegId: 0 }, { controllerId: controllerId2, wledSegId: null }]
    });
    expect(patch.status).toBe(200);
    expect(patch.body.groupId).toBeNull();
    expect(patch.body.controllers).toEqual([
      { controllerId, wledSegId: 0 },
      { controllerId: controllerId2, wledSegId: null }
    ]);
  });

  it('deletes a schedule', async () => {
    const post = await request(app).post('/api/schedules').send({
      name: 'X', triggerType: 'cron', cronExpr: '0 * * * *', offsetMinutes: 0,
      groupId, actionType: 'power', actionPayload: { on: false }
    });
    await request(app).delete(`/api/schedules/${post.body.id}`).expect(204);
    expect((await request(app).get('/api/schedules')).body).toHaveLength(0);
  });
});
