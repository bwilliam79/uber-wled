import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createCalendarRouter } from '../../src/calendar/routes.js';

describe('calendar routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/calendar-events', createCalendarRouter(db));
  });

  it('creates and lists a custom event', async () => {
    const post = await request(app).post('/api/calendar-events').send({
      name: 'Anniversary', category: 'custom',
      dateRule: { kind: 'fixed', month: 9, day: 12 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });
    expect(post.status).toBe(201);
    expect((await request(app).get('/api/calendar-events')).body).toHaveLength(1);
  });

  it('rejects with 409 when an enabled event collides on date with an enabled event of the other category', async () => {
    await request(app).post('/api/calendar-events').send({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    const conflict = await request(app).post('/api/calendar-events').send({
      name: "Dad's Birthday", category: 'custom',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body.conflict.name).toBe('July 4th');
  });

  it('allows two enabled events of the same category to share a date', async () => {
    await request(app).post('/api/calendar-events').send({
      name: 'Party lights on', category: 'custom',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '17:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    const second = await request(app).post('/api/calendar-events').send({
      name: 'Party lights off', category: 'custom',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '23:00' },
      actionType: 'power', actionPayload: { on: false }
    });

    expect(second.status).toBe(201);
  });

  it('does not conflict against a disabled event of the other category', async () => {
    await request(app).post('/api/calendar-events').send({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: false, groupId: null,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: null, actionPayload: null
    });

    const custom = await request(app).post('/api/calendar-events').send({
      name: "Dad's Birthday", category: 'custom',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    expect(custom.status).toBe(201);
  });

  it('deletes a calendar event', async () => {
    const post = await request(app).post('/api/calendar-events').send({
      name: 'X', category: 'custom',
      dateRule: { kind: 'fixed', month: 1, day: 1 },
      recursYearly: true, enabled: true, groupId: null,
      triggerTime: { type: 'fixed', time: '09:00' },
      actionType: null, actionPayload: null
    });
    await request(app).delete(`/api/calendar-events/${post.body.id}`).expect(204);
    expect((await request(app).get('/api/calendar-events')).body).toHaveLength(0);
  });
});
