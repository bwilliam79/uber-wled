import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { createSettingsRepository, type Settings } from '../../src/settings/repository.js';
import { createActiveLookRepository } from '../../src/looks/repository.js';
import { createGameTriggerRepository } from '../../src/games/repository.js';
import { computeAssignments, syncGames } from '../../src/games/sync.js';
import { processGameTriggers } from '../../src/games/tick.js';
import { ESPN_TEAM_IDS, type FetchLike } from '../../src/games/espn.js';

const ARK_THEME = 'ark-theme';
const LSU_THEME = 'lsu-theme';

function settings(over: Partial<Settings> = {}): Settings {
  return {
    includePrereleaseFirmware: false,
    homeLatitude: null,
    homeLongitude: null,
    discoveryRescanIntervalMinutes: 5,
    scheduleImportDisableOnDeviceDefault: false,
    controllerStatusPollIntervalMinutes: 5,
    livePollIntervalSeconds: 2,
    gameDayEnabled: true,
    gameGroupId: 'group',
    gameLeftControllerId: 'left',
    gameRightControllerId: 'right',
    gameArkansasThemeId: ARK_THEME,
    gameLsuThemeId: LSU_THEME,
    ...over
  };
}

const SPLIT = { lsu: LSU_THEME, ark: ARK_THEME };

describe('computeAssignments', () => {
  it('split night assigns LSU to the left, Arkansas to the right, and both halves to every other group controller', () => {
    const out = computeAssignments(
      settings(),
      ['left', 'right', 'cabinet'],
      ['arkansas', 'lsu'],
      false
    );
    expect(out).toEqual({
      left: LSU_THEME,
      right: ARK_THEME,
      cabinet: SPLIT
    });
  });

  it('a single team assigns that theme to every group controller', () => {
    expect(computeAssignments(settings(), ['left', 'right', 'cabinet'], ['arkansas'], false)).toEqual({
      left: ARK_THEME,
      right: ARK_THEME,
      cabinet: ARK_THEME
    });
    expect(computeAssignments(settings(), ['left', 'right', 'cabinet'], ['lsu'], false)).toEqual({
      left: LSU_THEME,
      right: LSU_THEME,
      cabinet: LSU_THEME
    });
  });

  it('split night with no left or right controller assigns both halves to every group controller', () => {
    const out = computeAssignments(
      settings({ gameLeftControllerId: null, gameRightControllerId: null }),
      ['left', 'right', 'cabinet'],
      ['arkansas', 'lsu'],
      true
    );
    expect(out).toEqual({
      left: SPLIT,
      right: SPLIT,
      cabinet: SPLIT
    });
  });
});

function insertTrigger(db: ReturnType<typeof createDb>, id: string, assignments: string): void {
  db.prepare(
    `INSERT INTO game_triggers (
       espn_event_id, sport, teams, opponent, start_at, release_at, time_valid,
       assignments, status, early_final, updated_at
     ) VALUES (?, 'football', '["arkansas"]', 'Alabama', ?, ?, 1, ?, 'scheduled', 0, ?)`
  ).run(id, '2026-10-31T18:00:00.000Z', '2026-10-31T22:00:00.000Z', assignments, '2026-10-01T00:00:00.000Z');
}

describe('stored game assignments', () => {
  it('a stored string-only assignment map still loads', () => {
    const db = createDb(':memory:');
    insertTrigger(db, 'old-string', JSON.stringify({ 'controller-old': 'theme-old' }));
    expect(createGameTriggerRepository(db).get('old-string')?.assignments).toEqual({
      'controller-old': 'theme-old'
    });
  });

  it('a stored split assignment loads beside a string theme id', () => {
    const db = createDb(':memory:');
    insertTrigger(
      db,
      'mixed',
      JSON.stringify({
        shelf: 'theme-ark',
        cabinet: { lsu: 'theme-lsu', ark: 'theme-ark' },
        empty: '',
        incomplete: { lsu: 'only-lsu' },
        numeric: 4
      })
    );
    expect(createGameTriggerRepository(db).get('mixed')?.assignments).toEqual({
      shelf: 'theme-ark',
      cabinet: { lsu: 'theme-lsu', ark: 'theme-ark' }
    });
  });
});

const ARK = { id: ESPN_TEAM_IDS.arkansas, displayName: 'Arkansas Razorbacks' };
const LSU = { id: ESPN_TEAM_IDS.lsu, displayName: 'LSU Tigers' };

function espnEvent(id: string, date: string, teams: { id: string; displayName: string }[]) {
  return {
    id,
    date,
    competitions: [
      {
        timeValid: true,
        competitors: teams.map((team) => ({ team })),
        status: { type: { state: 'pre' } }
      }
    ]
  };
}

function scheduleFetch(events: unknown[]): FetchLike {
  return async (url: string) => {
    const team = url.includes(`/teams/${ESPN_TEAM_IDS.arkansas}/`)
      ? 'arkansas'
      : url.includes(`/teams/${ESPN_TEAM_IDS.lsu}/`)
        ? 'lsu'
        : null;
    const sport = url.includes('basketball') ? 'basketball' : 'football';
    const list = sport === 'football' && team ? events : [];
    return { ok: true, status: 200, json: async () => ({ events: list }) } as Response;
  };
}

describe('split night re-sync', () => {
  it('re-sync adds a split assignment when another controller joins the game group', async () => {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    const left = controllers.add({ name: 'Shelf L', host: '192.0.2.11', source: 'manual' });
    const right = controllers.add({ name: 'Shelf R', host: '198.51.100.12', source: 'manual' });
    const cabinet = controllers.add({ name: 'Cabinet', host: '203.0.113.13', source: 'manual' });
    const groups = createGroupRepository(db);
    const group = groups.add({
      name: 'Shelves',
      members: [
        { controllerId: left.id, wledSegId: 0 },
        { controllerId: right.id, wledSegId: 0 }
      ]
    });
    const themes = createThemeRepository(db);
    const ark = themes.add({ name: 'Arkansas', effect: 1, palette: 2, colors: [[157, 34, 53]], brightness: 180 });
    const lsu = themes.add({ name: 'LSU', effect: 55, palette: 6, colors: [[70, 29, 124]], brightness: 180 });
    createSettingsRepository(db).update({
      gameDayEnabled: true,
      gameGroupId: group.id,
      gameLeftControllerId: left.id,
      gameRightControllerId: right.id,
      gameArkansasThemeId: ark.id,
      gameLsuThemeId: lsu.id
    });
    const fetchFn = scheduleFetch([
      espnEvent('rivalry', '2026-11-28T17:00:00.000Z', [ARK, LSU])
    ]);
    const now = new Date('2026-09-01T12:00:00.000Z');
    await syncGames(db, now, fetchFn);
    const repo = createGameTriggerRepository(db);
    expect(repo.get('rivalry')?.assignments).toEqual({
      [left.id]: lsu.id,
      [right.id]: ark.id
    });

    groups.update(group.id, {
      members: [
        { controllerId: left.id, wledSegId: 0 },
        { controllerId: right.id, wledSegId: 0 },
        { controllerId: cabinet.id, wledSegId: 0 }
      ]
    });
    await syncGames(db, now, fetchFn);
    expect(repo.get('rivalry')?.assignments).toEqual({
      [left.id]: lsu.id,
      [right.id]: ark.id,
      [cabinet.id]: { lsu: lsu.id, ark: ark.id }
    });

    await syncGames(db, now, fetchFn);
    expect(repo.get('rivalry')?.assignments).toEqual({
      [left.id]: lsu.id,
      [right.id]: ark.id,
      [cabinet.id]: { lsu: lsu.id, ark: ark.id }
    });
  });
});

function state48() {
  return {
    on: true,
    bri: 128,
    ps: -1,
    seg: [
      {
        id: 0,
        start: 0,
        stop: 48,
        len: 48,
        on: true,
        bri: 255,
        fx: 0,
        pal: 0,
        col: [[255, 255, 255]],
        sx: 128,
        ix: 128
      }
    ]
  };
}

function info48() {
  return { name: 'Cabinet', ver: '16.0.1', leds: { count: 48 }, arch: 'esp32' };
}

describe('split night apply and release', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fleet() {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    const left = controllers.add({ name: 'Shelf L', host: '192.0.2.21', source: 'manual' });
    const right = controllers.add({ name: 'Shelf R', host: '198.51.100.22', source: 'manual' });
    const cabinet = controllers.add({ name: 'Cabinet', host: '203.0.113.23', source: 'manual' });
    const themes = createThemeRepository(db);
    const ark = themes.add({
      name: 'Arkansas',
      effect: 1,
      palette: 2,
      colors: [[157, 34, 53]],
      brightness: 90,
      speed: 40,
      intensity: 50
    });
    const lsu = themes.add({
      name: 'LSU Wipe',
      effect: 55,
      palette: 6,
      colors: [[70, 29, 124], [253, 208, 35]],
      brightness: 200,
      speed: 180,
      intensity: 70,
      directions: { [cabinet.id]: { rev: true } }
    });
    createSettingsRepository(db).update({ gameDayEnabled: true });
    const posts: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const host = new URL(url).host;
      if (host !== '203.0.113.23') throw new Error(`unexpected host ${host}`);
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return { ok: true, status: 200, json: async () => state48() } as Response;
      }
      if (url.endsWith('/json/info')) {
        return { ok: true, status: 200, json: async () => info48() } as Response;
      }
      if (url.endsWith('/json/state')) {
        return { ok: true, status: 200, json: async () => state48() } as Response;
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const applyFn = vi.fn(async (members: { controllerId: string; wledSegId: number | null }[]) =>
      members.map((m) => ({ ...m, ok: true }))
    );
    return { db, left, right, cabinet, ark, lsu, posts, applyFn, looks: createActiveLookRepository(db) };
  }

  it('writes two segments on a 48-LED strip and restores the original layout on early-final release', async () => {
    const { db, left, right, cabinet, ark, lsu, posts, applyFn, looks } = fleet();
    const start = new Date(2026, 9, 31, 12, 0, 0);
    const activateAt = new Date(2026, 9, 31, 13, 0, 0);
    const earlyAt = new Date(2026, 9, 31, 14, 0, 0);
    createGameTriggerRepository(db).upsert({
      espnEventId: 'rivalry',
      sport: 'football',
      teams: ['arkansas', 'lsu'],
      opponent: 'LSU Tigers',
      startAt: start.toISOString(),
      releaseAt: new Date(2026, 9, 31, 18, 0, 0).toISOString(),
      timeValid: true,
      assignments: {
        [left.id]: lsu.id,
        [right.id]: ark.id,
        [cabinet.id]: { lsu: lsu.id, ark: ark.id }
      },
      status: 'scheduled',
      updatedAt: start.toISOString()
    });

    await processGameTriggers(db, activateAt, applyFn);

    expect(posts).toEqual([
      {
        on: true,
        bri: 255,
        udpn: { nn: true },
        seg: [
          {
            id: 0,
            start: 0,
            stop: 24,
            on: true,
            bri: lsu.brightness,
            fx: lsu.effect,
            pal: lsu.palette,
            col: lsu.colors,
            sx: lsu.speed,
            ix: lsu.intensity,
            rev: true
          },
          {
            id: 1,
            start: 24,
            stop: 48,
            on: true,
            bri: ark.brightness,
            fx: ark.effect,
            pal: ark.palette,
            col: ark.colors,
            sx: ark.speed,
            ix: ark.intensity
          }
        ]
      }
    ]);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: left.id, wledSegId: null }],
      { type: 'theme', themeId: lsu.id }
    );
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: right.id, wledSegId: null }],
      { type: 'theme', themeId: ark.id }
    );
    const themeTargets = applyFn.mock.calls
      .filter(([, action]) => (action as { type: string }).type === 'theme')
      .map(([members]) => members.map((m) => m.controllerId));
    expect(themeTargets).toEqual([[left.id], [right.id]]);
    expect(looks.get(cabinet.id)).toMatchObject({
      source: 'game',
      sourceId: 'rivalry',
      themeId: lsu.id,
      expiresAt: null
    });
    expect(createGameTriggerRepository(db).get('rivalry')?.status).toBe('active');

    createGameTriggerRepository(db).setEarlyFinal('rivalry', earlyAt.toISOString());
    await processGameTriggers(db, earlyAt, applyFn);

    expect(posts[1]).toEqual({
      udpn: { nn: true },
      seg: [
        { id: 1, stop: 0 },
        { id: 0, start: 0, stop: 48 }
      ]
    });
    expect(posts).toHaveLength(2);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: cabinet.id, wledSegId: null }],
      { type: 'power', on: false }
    );
    expect(looks.get(cabinet.id)).toBeUndefined();
    expect(looks.get(left.id)).toBeUndefined();
    expect(createGameTriggerRepository(db).get('rivalry')?.status).toBe('released');
  });

  it('a live manual hold skips the split apply', async () => {
    const { db, left, right, cabinet, ark, lsu, posts, applyFn, looks } = fleet();
    const now = new Date(2026, 9, 31, 13, 0, 0);
    looks.set({
      controllerId: cabinet.id,
      themeId: lsu.id,
      source: 'manual',
      sourceId: null,
      appliedAt: now.toISOString(),
      expiresAt: null
    });
    createGameTriggerRepository(db).upsert({
      espnEventId: 'rivalry',
      sport: 'football',
      teams: ['arkansas', 'lsu'],
      opponent: 'LSU Tigers',
      startAt: new Date(2026, 9, 31, 12, 0, 0).toISOString(),
      releaseAt: new Date(2026, 9, 31, 18, 0, 0).toISOString(),
      timeValid: true,
      assignments: {
        [left.id]: lsu.id,
        [right.id]: ark.id,
        [cabinet.id]: { lsu: lsu.id, ark: ark.id }
      },
      status: 'scheduled',
      updatedAt: now.toISOString()
    });

    await processGameTriggers(db, now, applyFn);

    expect(posts).toEqual([]);
    expect(looks.get(cabinet.id)?.source).toBe('manual');
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: left.id, wledSegId: null }],
      { type: 'theme', themeId: lsu.id }
    );
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: right.id, wledSegId: null }],
      { type: 'theme', themeId: ark.id }
    );
  });

  function snapshotRows(db: ReturnType<typeof createDb>): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM game_segment_restore').get() as { n: number }).n;
  }

  const originalRestore = {
    udpn: { nn: true },
    seg: [
      { id: 1, stop: 0 },
      { id: 0, start: 0, stop: 48 }
    ]
  };

  function liveFleet() {
    const base = fleet();
    let seg = state48().seg.map((segment) => ({ ...segment }));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const host = new URL(url).host;
      if (host !== '203.0.113.23') throw new Error(`unexpected host ${host}`);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        base.posts.push(body);
        if (Array.isArray(body.seg)) {
          const kept = body.seg.filter(
            (segment: { start?: number; stop?: number }) =>
              typeof segment.start === 'number' && typeof segment.stop === 'number' && segment.stop > segment.start
          );
          if (kept.length > 0) {
            seg = kept.map((segment: { id: number; start: number; stop: number }) => ({
              id: segment.id,
              start: segment.start,
              stop: segment.stop,
              len: segment.stop - segment.start,
              on: true,
              bri: 255,
              fx: 0,
              pal: 0,
              col: [[0, 0, 0]],
              sx: 128,
              ix: 128
            }));
          }
        }
        return { ok: true, status: 200, json: async () => ({ ...state48(), seg }) } as Response;
      }
      if (url.endsWith('/json/info')) {
        return { ok: true, status: 200, json: async () => info48() } as Response;
      }
      if (url.endsWith('/json/state')) {
        return { ok: true, status: 200, json: async () => ({ ...state48(), seg }) } as Response;
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return base;
  }

  async function overlappingSplit(order: 'a-then-b' | 'b-then-a'): Promise<void> {
    const { db, cabinet, ark, lsu, posts, applyFn } = liveFleet();
    const split = { lsu: lsu.id, ark: ark.id };
    const repo = createGameTriggerRepository(db);
    repo.upsert({
      espnEventId: 'lsu-night',
      sport: 'football',
      teams: ['lsu'],
      opponent: 'Florida Gators',
      startAt: '2026-11-15T00:30:00.000Z',
      releaseAt: '2026-11-15T04:30:00.000Z',
      timeValid: true,
      assignments: { [cabinet.id]: split },
      status: 'scheduled',
      updatedAt: '2026-11-14T00:00:00.000Z'
    });
    repo.upsert({
      espnEventId: 'ark-night',
      sport: 'football',
      teams: ['arkansas'],
      opponent: 'Alabama Crimson Tide',
      startAt: '2026-11-15T00:45:00.000Z',
      releaseAt: '2026-11-15T04:45:00.000Z',
      timeValid: true,
      assignments: { [cabinet.id]: split },
      status: 'scheduled',
      updatedAt: '2026-11-14T00:00:00.000Z'
    });

    await processGameTriggers(db, new Date('2026-11-15T00:31:00.000Z'), applyFn);
    await processGameTriggers(db, new Date('2026-11-15T00:46:00.000Z'), applyFn);
    expect(repo.get('lsu-night')?.status).toBe('active');
    expect(repo.get('ark-night')?.status).toBe('active');

    const first = order === 'a-then-b' ? 'lsu-night' : 'ark-night';
    const second = order === 'a-then-b' ? 'ark-night' : 'lsu-night';
    repo.setEarlyFinal(first, '2026-11-15T01:00:00.000Z');
    await processGameTriggers(db, new Date('2026-11-15T01:00:00.000Z'), applyFn);
    repo.setEarlyFinal(second, '2026-11-15T01:05:00.000Z');
    await processGameTriggers(db, new Date('2026-11-15T01:05:00.000Z'), applyFn);

    const restores = posts.filter((body) => {
      const posted = body as { on?: boolean; seg?: unknown };
      return posted.on === undefined && Array.isArray(posted.seg);
    });
    expect(restores).toEqual([originalRestore]);
    expect(snapshotRows(db)).toBe(0);
    expect(repo.get('lsu-night')?.status).toBe('released');
    expect(repo.get('ark-night')?.status).toBe('released');
  }

  it('overlapping split games restore the original 48-LED bounds after either release order', async () => {
    await overlappingSplit('a-then-b');
    vi.unstubAllGlobals();
    await overlappingSplit('b-then-a');
  });

  it('restores saved bounds when the game look was replaced before release', async () => {
    const { db, cabinet, ark, lsu, posts, applyFn, looks } = fleet();
    const start = new Date(2026, 9, 31, 12, 0, 0);
    const activateAt = new Date(2026, 9, 31, 13, 0, 0);
    const earlyAt = new Date(2026, 9, 31, 14, 0, 0);
    createGameTriggerRepository(db).upsert({
      espnEventId: 'rivalry',
      sport: 'football',
      teams: ['arkansas', 'lsu'],
      opponent: 'LSU Tigers',
      startAt: start.toISOString(),
      releaseAt: new Date(2026, 9, 31, 18, 0, 0).toISOString(),
      timeValid: true,
      assignments: { [cabinet.id]: { lsu: lsu.id, ark: ark.id } },
      status: 'scheduled',
      updatedAt: start.toISOString()
    });
    await processGameTriggers(db, activateAt, applyFn);
    looks.set({
      controllerId: cabinet.id,
      themeId: ark.id,
      source: 'manual',
      sourceId: null,
      appliedAt: earlyAt.toISOString(),
      expiresAt: null
    });
    createGameTriggerRepository(db).setEarlyFinal('rivalry', earlyAt.toISOString());
    await processGameTriggers(db, earlyAt, applyFn);

    expect(posts[1]).toEqual(originalRestore);
    expect(posts).toHaveLength(2);
    expect(looks.get(cabinet.id)).toMatchObject({ source: 'manual', themeId: ark.id });
    expect(applyFn).not.toHaveBeenCalled();
    expect(snapshotRows(db)).toBe(0);
  });
});
