import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createSettingsRouter } from '../../src/settings/routes.js';

describe('settings routes', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/settings', createSettingsRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns default settings before anything is written', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      includePrereleaseFirmware: false,
      homeLatitude: null,
      homeLongitude: null,
      discoveryRescanIntervalMinutes: 5,
      scheduleImportDisableOnDeviceDefault: false,
      controllerStatusPollIntervalMinutes: 5,
      livePollIntervalSeconds: 2
    });
  });

  it('patches a subset and persists it, leaving other fields at their defaults', async () => {
    const patch = await request(app).patch('/api/settings').send({ includePrereleaseFirmware: true, homeLatitude: 47.6, homeLongitude: -122.3 });
    expect(patch.status).toBe(200);
    expect(patch.body.includePrereleaseFirmware).toBe(true);
    expect(patch.body.homeLatitude).toBe(47.6);
    expect(patch.body.discoveryRescanIntervalMinutes).toBe(5);

    const get = await request(app).get('/api/settings');
    expect(get.body.homeLongitude).toBe(-122.3);
  });

  it('persists livePollIntervalSeconds', async () => {
    const patch = await request(app).patch('/api/settings').send({ livePollIntervalSeconds: 5 });
    expect(patch.status).toBe(200);
    expect(patch.body.livePollIntervalSeconds).toBe(5);

    const get = await request(app).get('/api/settings');
    expect(get.body.livePollIntervalSeconds).toBe(5);
  });

  it('runs a discovery cycle on POST /rescan and returns the controller list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) } as Response)));
    const res = await request(app).post('/api/settings/rescan');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.controllers)).toBe(true);
  });
});
