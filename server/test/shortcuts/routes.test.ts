import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { invoke } from '../support/invoke.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { createActiveLookRepository } from '../../src/looks/repository.js';
import { actionToPatch } from '../../src/control/actionMap.js';
import { createShortcutsRouter } from '../../src/shortcuts/routes.js';
import { createApp } from '../../src/app.js';

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

function state() {
  return { on: true, bri: 128, ps: -1, seg: [{ id: 0 }] };
}

describe('POST /api/shortcuts/apply', () => {
  let app: express.Express;
  let db: ReturnType<typeof createDb>;
  let shelfId: string;
  let cabinetId: string;
  let gameId: string;
  let dimId: string;
  let shelvesId: string;
  const HOST_SHELF = '10.0.0.50';
  const HOST_CABINET = '10.0.0.51';

  beforeEach(() => {
    db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    shelfId = controllers.add({ name: 'Shelf', host: HOST_SHELF, source: 'manual' }).id;
    cabinetId = controllers.add({ name: 'Cabinet', host: HOST_CABINET, source: 'manual' }).id;
    const themes = createThemeRepository(db);
    gameId = themes.add({
      name: 'LSU Wipe', effect: 55, palette: 6, colors: [[70, 29, 124]], brightness: 180
    }).id;
    dimId = themes.add({
      name: 'Dim White', effect: 0, palette: 0, colors: [[255, 255, 240]], brightness: 40
    }).id;
    createScheduleRepository(db).add({
      name: 'Dim White', triggerType: 'sunset', cronExpr: null, daysOfWeek: null, timeOfDay: null,
      offsetMinutes: 0, latitude: null, longitude: null, groupId: null,
      controllers: [{ controllerId: shelfId, wledSegId: null }],
      actionType: 'theme', actionPayload: { themeId: dimId }, offTrigger: null, enabled: true
    });
    shelvesId = createGroupRepository(db).add({
      name: 'Shelves',
      members: [
        { controllerId: shelfId, wledSegId: 0 },
        { controllerId: cabinetId, wledSegId: 1 }
      ]
    }).id;
    app = express();
    app.use(express.json());
    app.use('/api/shortcuts', createShortcutsRouter(db));
    stubFetchByHost({
      [HOST_SHELF]: () => ({ status: 200, body: state() }),
      [HOST_CABINET]: () => ({ status: 200, body: state() })
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function capturePosts() {
    const posts: Record<string, any[]> = { [HOST_SHELF]: [], [HOST_CABINET]: [] };
    const fetchMock = stubFetchByHost({
      [HOST_SHELF]: (_url, init) => {
        if (init?.body) posts[HOST_SHELF].push(JSON.parse(String(init.body)));
        return { status: 200, body: state() };
      },
      [HOST_CABINET]: (_url, init) => {
        if (init?.body) posts[HOST_CABINET].push(JSON.parse(String(init.body)));
        return { status: 200, body: state() };
      }
    });
    return { posts, fetchMock };
  }

  it('is mounted on the app and does not apply on GET', async () => {
    const mounted = createApp(db);
    const post = await invoke(mounted, 'POST', '/api/shortcuts/apply', {});
    expect(post.status).toBe(400);
    expect(post.body.error).toBe('exactly one of group or controllers is required');
    const get = await invoke(mounted, 'GET', '/api/shortcuts/apply');
    expect(get.status).toBe(404);
  });

  it('matches theme, group, and controller by trimmed case-insensitive name and by exact id', async () => {
    const byName = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: '  lsu wipe  ',
      group: '  SHELVES  '
    });
    expect(byName.status).toBe(200);
    expect(byName.body.ok).toBe(true);
    expect(byName.body.message).toBe('LSU Wipe on 2 controllers');
    expect(Object.keys(byName.body).sort()).toEqual(['message', 'ok', 'results']);
    expect(byName.body.results).toEqual([
      { controllerId: shelfId, wledSegId: 0, ok: true },
      { controllerId: cabinetId, wledSegId: 1, ok: true }
    ]);

    const byControllerName = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: 'LSU Wipe',
      controllers: ['  cabinet  ']
    });
    expect(byControllerName.status).toBe(200);
    expect(byControllerName.body.message).toBe('LSU Wipe on 1 controller');
    expect(byControllerName.body.results).toEqual([
      { controllerId: cabinetId, wledSegId: null, ok: true }
    ]);

    const byId = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: gameId,
      group: shelvesId,
      action: 'theme'
    });
    expect(byId.status).toBe(200);
    expect(byId.body.ok).toBe(true);
    expect(byId.body.results.map((r: { controllerId: string }) => r.controllerId)).toEqual([shelfId, cabinetId]);
  });

  it('returns 404 for an unknown theme, group, or controller and does not call devices', async () => {
    const fetchMock = stubFetchByHost({
      [HOST_SHELF]: () => ({ status: 200, body: state() }),
      [HOST_CABINET]: () => ({ status: 200, body: state() })
    });

    const theme = await invoke(app, 'POST', '/api/shortcuts/apply', { theme: 'Nope', group: 'Shelves' });
    expect(theme.status).toBe(404);
    expect(theme.body.error).toBe('Unknown theme "Nope"');

    const group = await invoke(app, 'POST', '/api/shortcuts/apply', { theme: 'LSU Wipe', group: 'Nope' });
    expect(group.status).toBe(404);
    expect(group.body.error).toBe('Unknown group "Nope"');

    const controller = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: gameId,
      controllers: ['Nope', 'Shelf']
    });
    expect(controller.status).toBe(404);
    expect(controller.body.error).toBe('Unknown controller "Nope"');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when a name matches more than one record, but an exact id still wins', async () => {
    createControllerRepository(db).add({ name: 'Shelf', host: '10.0.0.52', source: 'manual' });
    createThemeRepository(db).add({
      name: 'LSU Wipe', effect: 1, palette: 1, colors: [[0, 0, 0]], brightness: 10
    });
    createGroupRepository(db).add({ name: 'shelves', members: [] });
    const fetchMock = stubFetchByHost({
      [HOST_SHELF]: () => ({ status: 200, body: state() }),
      [HOST_CABINET]: () => ({ status: 200, body: state() })
    });

    const controller = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: 'Dim White',
      controllers: ['shelf']
    });
    expect(controller.status).toBe(400);
    expect(controller.body.error).toBe('Ambiguous controller name "shelf" (2 matches)');

    const theme = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: 'lsu wipe',
      group: 'Shelves'
    });
    expect(theme.status).toBe(400);
    expect(theme.body.error).toBe('Ambiguous theme name "lsu wipe" (2 matches)');

    const group = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: 'Dim White',
      group: 'SHELVES'
    });
    expect(group.status).toBe(400);
    expect(group.body.error).toBe('Ambiguous group name "SHELVES" (2 matches)');
    expect(fetchMock).not.toHaveBeenCalled();

    const byId = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: gameId,
      controllers: [shelfId]
    });
    expect(byId.status).toBe(200);
    expect(byId.body.results).toEqual([{ controllerId: shelfId, wledSegId: null, ok: true }]);
  });

  it('returns 400 when the target is missing or both are set, and when a theme action has no theme', async () => {
    const targetError = 'exactly one of group or controllers is required';
    for (const body of [
      {},
      { theme: 'LSU Wipe' },
      { theme: 'LSU Wipe', controllers: [] },
      { theme: 'LSU Wipe', group: '   ' },
      { action: 'off' },
      { theme: 'LSU Wipe', group: 'Shelves', controllers: ['Shelf'] }
    ]) {
      const res = await invoke(app, 'POST', '/api/shortcuts/apply', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(targetError);
    }

    const missingTheme = await invoke(app, 'POST', '/api/shortcuts/apply', { group: 'Shelves' });
    expect(missingTheme.status).toBe(400);
    expect(missingTheme.body.error).toBe('theme is required when action is "theme"');

    const badAction = await invoke(app, 'POST', '/api/shortcuts/apply', {
      action: 'party', theme: 'LSU Wipe', group: 'Shelves'
    });
    expect(badAction.status).toBe(400);
    expect(badAction.body.error).toBe('action must be "theme" or "off"');
  });

  it('sends segment rev only to the controller listed on the theme', async () => {
    createThemeRepository(db).update(gameId, {
      directions: { [shelfId]: { rev: true } }
    });
    const { posts } = capturePosts();

    const res = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: 'LSU Wipe',
      controllers: ['Shelf', 'Cabinet']
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(posts[HOST_SHELF]).toHaveLength(1);
    expect(posts[HOST_CABINET]).toHaveLength(1);
    expect(posts[HOST_SHELF][0]).toMatchObject({
      on: true,
      bri: 180,
      udpn: { nn: true },
      seg: [{ id: 0, fx: 55, pal: 6, col: [[70, 29, 124]], sx: 128, ix: 128, rev: true }]
    });
    expect(posts[HOST_SHELF][0]).not.toHaveProperty('themeId');
    expect(posts[HOST_SHELF][0]).not.toHaveProperty('segRev');
    expect(posts[HOST_CABINET][0]).toMatchObject({
      on: true,
      bri: 180,
      seg: [{ id: 0, fx: 55, pal: 6, col: [[70, 29, 124]], sx: 128, ix: 128 }]
    });
    expect(posts[HOST_CABINET][0].seg[0]).not.toHaveProperty('rev');
  });

  it('records a manual look for a game theme', async () => {
    const res = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: 'LSU Wipe',
      controllers: ['Shelf']
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('LSU Wipe on 1 controller');
    expect(createActiveLookRepository(db).get(shelfId)).toMatchObject({
      themeId: gameId,
      source: 'manual',
      sourceId: null,
      expiresAt: null
    });
    expect(createActiveLookRepository(db).get(cabinetId)).toBeUndefined();
  });

  it('clears an existing hold when applying the schedule theme (Dim White)', async () => {
    const looks = createActiveLookRepository(db);
    const appliedAt = '2026-10-31T18:00:00.000Z';
    looks.set({ controllerId: shelfId, themeId: gameId, source: 'manual', appliedAt, expiresAt: null });
    looks.set({ controllerId: cabinetId, themeId: gameId, source: 'manual', appliedAt, expiresAt: null });

    const res = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: 'dim white',
      controllers: [shelfId]
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBe('Dim White on 1 controller');
    expect(looks.get(shelfId)).toBeUndefined();
    expect(looks.get(cabinetId)?.themeId).toBe(gameId);
  });

  it('clears holds when the action is off and ignores theme', async () => {
    const looks = createActiveLookRepository(db);
    const appliedAt = '2026-10-31T18:00:00.000Z';
    looks.set({ controllerId: shelfId, themeId: gameId, source: 'manual', appliedAt, expiresAt: null });
    looks.set({ controllerId: cabinetId, themeId: gameId, source: 'manual', appliedAt, expiresAt: null });
    const { posts } = capturePosts();

    const res = await invoke(app, 'POST', '/api/shortcuts/apply', {
      action: 'off',
      theme: 'not a real theme',
      group: 'Shelves'
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBe('Lights off on 2 controllers');
    expect(posts[HOST_SHELF][0]).toEqual({ udpn: { nn: true }, on: false });
    expect(posts[HOST_CABINET][0]).toEqual({ udpn: { nn: true }, on: false });
    expect(looks.get(shelfId)).toBeUndefined();
    expect(looks.get(cabinetId)).toBeUndefined();
  });

  it('dryRun does not call devices or record a look', async () => {
    const looks = createActiveLookRepository(db);
    looks.set({
      controllerId: shelfId, themeId: gameId, source: 'manual',
      appliedAt: '2026-10-31T18:00:00.000Z', expiresAt: null
    });
    const fetchMock = stubFetchByHost({
      [HOST_SHELF]: () => ({ status: 200, body: state() }),
      [HOST_CABINET]: () => ({ status: 200, body: state() })
    });

    const res = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: 'Dim White',
      group: 'Shelves',
      dryRun: true
    });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(looks.get(shelfId)?.themeId).toBe(gameId);
    expect(looks.list()).toHaveLength(1);
    expect(Object.keys(res.body).sort()).toEqual(['action', 'dryRun', 'message', 'patch', 'targets', 'theme']);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.action).toBe('theme');
    expect(res.body.theme).toEqual({ id: dimId, name: 'Dim White' });
    expect(res.body.targets).toEqual([{ kind: 'group', groupId: shelvesId }]);
    expect(res.body.message).toBe('Dim White on 2 controllers');
    expect(res.body.patch).toEqual({
      on: true,
      ...actionToPatch({ type: 'theme', themeId: dimId }, (id) => createThemeRepository(db).get(id)),
      themeId: dimId
    });
  });

  it('returns the spoken message as text when format=text or Accept is text/plain', async () => {
    const res = await invoke(app, 'POST', '/api/shortcuts/apply?format=text', {
      theme: 'LSU Wipe',
      group: 'Shelves'
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('LSU Wipe on 2 controllers');
    expect(res.body).toBe('LSU Wipe on 2 controllers');
    expect(res.headers['content-type']).toMatch(/^text\/plain/);

    const accepted = await invoke(app, 'POST', '/api/shortcuts/apply', {
      action: 'off',
      controllers: ['Shelf']
    }, { accept: 'text/plain' });
    expect(accepted.status).toBe(200);
    expect(accepted.text).toBe('Lights off on 1 controller');
    expect(accepted.headers['content-type']).toMatch(/^text\/plain/);
  });

  it('speaks a partial count when some controllers fail', async () => {
    stubFetchByHost({
      [HOST_SHELF]: () => ({ status: 200, body: state() }),
      [HOST_CABINET]: () => ({ status: 500, body: {} })
    });
    const res = await invoke(app, 'POST', '/api/shortcuts/apply', {
      theme: 'LSU Wipe',
      controllers: ['Shelf', 'Cabinet']
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toBe('LSU Wipe on 1 of 2 controllers');
    expect(res.body.results).toHaveLength(2);
    const looks = createActiveLookRepository(db);
    expect(looks.get(shelfId)?.themeId).toBe(gameId);
    expect(looks.get(cabinetId)).toBeUndefined();
  });
});
