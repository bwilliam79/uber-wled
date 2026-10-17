import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { invoke } from '../support/invoke.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createControllerStatusRepository } from '../../src/controllers/statusRepository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { createActiveLookRepository } from '../../src/looks/repository.js';
import { calendarLookExpiresAt } from '../../src/looks/expiry.js';
import { createLooksRouter } from '../../src/looks/routes.js';

describe('looks routes', () => {
  let app: express.Express;
  let db: ReturnType<typeof createDb>;
  let cabinetId: string;
  let shelfId: string;
  let gameId: string;
  let dimId: string;
  let scheduleId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    cabinetId = controllers.add({ name: 'Cabinet', host: '10.0.0.13', source: 'manual' }).id;
    shelfId = controllers.add({ name: 'Shelf', host: '10.0.0.11', source: 'manual' }).id;
    const themes = createThemeRepository(db);
    gameId = themes.add({ name: 'LSU Wipe', effect: 55, palette: 6, colors: [[70, 29, 124]], brightness: 180 }).id;
    dimId = themes.add({ name: 'Dim White', effect: 0, palette: 0, colors: [[255, 255, 240]], brightness: 40 }).id;
    scheduleId = createScheduleRepository(db).add({
      name: 'Dim White', triggerType: 'cron', cronExpr: '0 10 * * *', daysOfWeek: null, timeOfDay: null,
      offsetMinutes: 0, latitude: null, longitude: null, groupId: null,
      controllers: [
        { controllerId: cabinetId, wledSegId: null },
        { controllerId: shelfId, wledSegId: null }
      ],
      actionType: 'theme', actionPayload: { themeId: dimId }, offTrigger: null, enabled: true
    }).id;
    app = express();
    app.use(express.json());
    app.use('/api/looks', createLooksRouter(db));
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('device contacted'))));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('PUT records state without contacting a device, GET lists it, DELETE clears it', async () => {
    const before = Date.now();
    const put = await invoke(app, 'PUT', `/api/looks/${cabinetId}`, { themeId: gameId });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      controllerId: cabinetId, themeId: gameId, source: 'manual', sourceId: null, expiresAt: null
    });
    expect(Date.parse(put.body.appliedAt)).toBeGreaterThanOrEqual(before - 1000);

    const listed = await invoke(app, 'GET', '/api/looks');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([put.body]);

    const removed = await invoke(app, 'DELETE', `/api/looks/${cabinetId}`);
    expect(removed.status).toBe(204);
    expect((await invoke(app, 'GET', '/api/looks')).body).toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('gives a calendar bootstrap the noon-next-day expiry and rejects bad input', async () => {
    const put = await invoke(app, 'PUT', `/api/looks/${shelfId}`, { themeId: gameId, source: 'calendar' });
    expect(put.status).toBe(200);
    expect(put.body.source).toBe('calendar');
    expect(put.body.expiresAt).toBe(calendarLookExpiresAt(new Date(put.body.appliedAt)));

    const scheduleSource = await invoke(app, 'PUT', `/api/looks/${shelfId}`, { themeId: dimId, source: 'schedule' });
    expect(scheduleSource.status).toBe(200);
    expect(scheduleSource.body).toMatchObject({ source: 'schedule', themeId: dimId, expiresAt: null });

    expect((await invoke(app, 'PUT', '/api/looks/missing', { themeId: gameId })).status).toBe(404);
    expect((await invoke(app, 'PUT', `/api/looks/${cabinetId}`, { themeId: 'nope' })).status).toBe(400);
    expect((await invoke(app, 'PUT', `/api/looks/${cabinetId}`, { themeId: gameId, source: 'nope' })).status).toBe(400);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('previews the idle decision per controller without writing or calling a device', async () => {
    const looks = createActiveLookRepository(db);
    const appliedAt = '2026-10-31T13:00:00.000Z';
    looks.set({
      controllerId: shelfId, themeId: gameId, source: 'manual', sourceId: null, appliedAt, expiresAt: null
    });
    createControllerStatusRepository(db).upsert({
      controllerId: cabinetId, reachable: true, info: null,
      state: { on: false, bri: 0, ps: -1, seg: [] },
      polledAt: '2026-10-31T14:00:00.000Z'
    });
    // Cabinet has no look, so polled-off does not apply; shelf is held.
    const before = looks.list();

    const res = await invoke(app, 'GET', `/api/looks/preview/${scheduleId}`);
    expect(res.status).toBe(200);
    expect(res.body.scheduleId).toBe(scheduleId);
    expect(res.body.scheduleName).toBe('Dim White');
    expect(res.body.scheduleThemeId).toBe(dimId);
    expect(res.body.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const byId = Object.fromEntries(
      res.body.entries.map((e: { controllerId: string }) => [e.controllerId, e])
    );
    expect(byId[cabinetId]).toMatchObject({
      controllerName: 'Cabinet', wledSegId: null, wouldAct: true, look: null, polledOff: false
    });
    expect(byId[shelfId]).toMatchObject({
      controllerName: 'Shelf', wledSegId: null, wouldAct: false, polledOff: false,
      look: { controllerId: shelfId, themeId: gameId, source: 'manual' }
    });
    expect(looks.list()).toEqual(before);

    looks.set({
      controllerId: cabinetId, themeId: gameId, source: 'manual', sourceId: null,
      appliedAt: '2026-10-31T13:00:00.000Z', expiresAt: null
    });
    const released = await invoke(app, 'GET', `/api/looks/preview/${scheduleId}`);
    const cabinet = released.body.entries.find((e: { controllerId: string }) => e.controllerId === cabinetId);
    expect(cabinet.wouldAct).toBe(true);
    expect(cabinet.polledOff).toBe(true);

    expect((await invoke(app, 'GET', '/api/looks/preview/missing')).status).toBe(404);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
