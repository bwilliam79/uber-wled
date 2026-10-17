import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { invoke } from '../support/invoke.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { createActiveLookRepository } from '../../src/looks/repository.js';
import { createControlRouter } from '../../src/control/routes.js';

function stubFetchByHost(
  handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    const handler = handlers[host];
    if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('control apply active-look tracking', () => {
  let app: express.Express;
  let db: ReturnType<typeof createDb>;
  let controllerA: string;
  let controllerB: string;
  let gameId: string;
  let dimId: string;
  const HOST_A = '10.0.0.50';
  const HOST_B = '10.0.0.51';

  beforeEach(() => {
    db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    controllerA = controllers.add({ name: 'Shelf', host: HOST_A, source: 'manual' }).id;
    controllerB = controllers.add({ name: 'Cabinet', host: HOST_B, source: 'manual' }).id;
    const themes = createThemeRepository(db);
    gameId = themes.add({ name: 'LSU Wipe', effect: 55, palette: 6, colors: [[70, 29, 124]], brightness: 180 }).id;
    dimId = themes.add({ name: 'Dim White', effect: 0, palette: 0, colors: [[255, 255, 240]], brightness: 40 }).id;
    createScheduleRepository(db).add({
      name: 'Dim White', triggerType: 'sunset', cronExpr: null, daysOfWeek: null, timeOfDay: null,
      offsetMinutes: 0, latitude: null, longitude: null, groupId: null,
      controllers: [{ controllerId: controllerA, wledSegId: null }],
      actionType: 'theme', actionPayload: { themeId: dimId }, offTrigger: null, enabled: true
    });
    app = express();
    app.use(express.json());
    app.use('/api/control', createControlRouter(db));
  });

  afterEach(() => vi.unstubAllGlobals());

  function state() {
    return { on: true, bri: 128, ps: -1, seg: [{ id: 0 }] };
  }

  it('records a manual theme and never puts themeId on the device body', async () => {
    let posted: Record<string, unknown> | undefined;
    stubFetchByHost({
      [HOST_A]: (_url, init) => {
        if (init?.body) posted = JSON.parse(init.body as string);
        return { status: 200, body: state() };
      }
    });
    const res = await invoke(app, 'POST', '/api/control/apply', {
      targets: [{ kind: 'segment', controllerId: controllerA, wledSegId: 0 }],
      patch: { on: true, bri: 180, themeId: gameId, seg: { fxId: 55, col: [[70, 29, 124]] } }
    });
    expect(res.status).toBe(200);
    expect(res.body.results[0].ok).toBe(true);
    expect(posted).not.toHaveProperty('themeId');
    expect(posted).toEqual(expect.objectContaining({
      udpn: { nn: true }, on: true, bri: 180
    }));
    expect(posted?.seg).toEqual([expect.objectContaining({ id: 0, fx: 55 })]);
    expect(createActiveLookRepository(db).get(controllerA)).toMatchObject({
      themeId: gameId, source: 'manual', sourceId: null, expiresAt: null
    });
  });

  it('does not track a controller whose apply failed', async () => {
    stubFetchByHost({
      [HOST_A]: () => ({ status: 200, body: state() }),
      [HOST_B]: () => ({ status: 500, body: {} })
    });
    const res = await invoke(app, 'POST', '/api/control/apply', {
      targets: [
        { kind: 'segment', controllerId: controllerA, wledSegId: 0 },
        { kind: 'segment', controllerId: controllerB, wledSegId: 0 }
      ],
      patch: { themeId: gameId, seg: { fxId: 55 } }
    });
    expect(res.body.results.find((r: { controllerId: string }) => r.controllerId === controllerA).ok).toBe(true);
    expect(res.body.results.find((r: { controllerId: string }) => r.controllerId === controllerB).ok).toBe(false);
    const looks = createActiveLookRepository(db);
    expect(looks.get(controllerA)?.themeId).toBe(gameId);
    expect(looks.get(controllerB)).toBeUndefined();
  });

  it('clears the look when the patch turns controllers off', async () => {
    const looks = createActiveLookRepository(db);
    const appliedAt = '2026-10-31T18:00:00.000Z';
    looks.set({ controllerId: controllerA, themeId: gameId, source: 'manual', appliedAt, expiresAt: null });
    looks.set({ controllerId: controllerB, themeId: gameId, source: 'manual', appliedAt, expiresAt: null });
    stubFetchByHost({
      [HOST_A]: () => ({ status: 200, body: { ...state(), on: false } }),
      [HOST_B]: () => ({ status: 500, body: {} })
    });
    await invoke(app, 'POST', '/api/control/apply', {
      targets: [
        { kind: 'segment', controllerId: controllerA, wledSegId: 0 },
        { kind: 'segment', controllerId: controllerB, wledSegId: 0 }
      ],
      patch: { on: false, themeId: gameId }
    });
    expect(looks.get(controllerA)).toBeUndefined();
    expect(looks.get(controllerB)?.themeId).toBe(gameId);
  });

  it('clears the look when the applied theme is an ambient schedule theme (Dim White)', async () => {
    const looks = createActiveLookRepository(db);
    looks.set({
      controllerId: controllerA, themeId: gameId, source: 'manual',
      appliedAt: '2026-10-31T18:00:00.000Z', expiresAt: null
    });
    stubFetchByHost({
      [HOST_A]: () => ({ status: 200, body: state() }),
      [HOST_B]: () => ({ status: 200, body: state() })
    });
    await invoke(app, 'POST', '/api/control/apply', {
      targets: [{ kind: 'segment', controllerId: controllerA, wledSegId: 0 }],
      patch: { themeId: dimId, bri: 40, seg: { fxId: 0 } }
    });
    expect(looks.get(controllerA)).toBeUndefined();

    const created = await invoke(app, 'POST', '/api/control/apply', {
      targets: [{ kind: 'segment', controllerId: controllerB, wledSegId: 0 }],
      patch: { themeId: dimId, seg: { fxId: 0 } }
    });
    expect(created.body.results[0].ok).toBe(true);
    expect(looks.list()).toEqual([]);
  });

  it('leaves tracking unchanged for a patch that is neither off nor a theme', async () => {
    const looks = createActiveLookRepository(db);
    const appliedAt = '2026-10-31T18:00:00.000Z';
    looks.set({ controllerId: controllerA, themeId: gameId, source: 'manual', appliedAt, expiresAt: null });
    stubFetchByHost({
      [HOST_A]: () => ({ status: 200, body: state() })
    });
    await invoke(app, 'POST', '/api/control/apply', {
      targets: [{ kind: 'segment', controllerId: controllerA, wledSegId: 0 }],
      patch: { bri: 90 }
    });
    expect(looks.get(controllerA)).toMatchObject({ themeId: gameId, source: 'manual', appliedAt });

    await invoke(app, 'POST', '/api/control/apply', {
      targets: [{ kind: 'segment', controllerId: controllerA, wledSegId: 0 }],
      patch: { on: true }
    });
    expect(looks.get(controllerA)).toMatchObject({ themeId: gameId, appliedAt });
  });
});
