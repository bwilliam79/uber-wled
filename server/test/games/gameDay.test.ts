import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import SunCalc from 'suncalc';
import { createDb } from '../../src/db/client.js';
import { createApp } from '../../src/app.js';
import { invoke } from '../support/invoke.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { createSettingsRepository } from '../../src/settings/repository.js';
import { createCalendarRepository } from '../../src/calendar/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { createActiveLookRepository } from '../../src/looks/repository.js';
import { calendarLookExpiresAt } from '../../src/looks/expiry.js';
import { SchedulerEngine, resolveResume } from '../../src/schedules/engine.js';
import { createGameTriggerRepository, createGameSyncLogRepository } from '../../src/games/repository.js';
import { pollActiveGameSummaries, syncGames } from '../../src/games/sync.js';
import { ESPN_TEAM_IDS, summaryUrl, type FetchLike } from '../../src/games/espn.js';

const LAT = 41.8781;
const LON = -87.6298;

function okApply(members: { controllerId: string; wledSegId: number | null }[]) {
  return members.map((m) => ({ ...m, ok: true }));
}

function espnEvent(opts: {
  id: string;
  date: string;
  timeValid?: boolean;
  state?: string;
  teams: { id: string; displayName: string }[];
}) {
  return {
    id: opts.id,
    date: opts.date,
    competitions: [
      {
        timeValid: opts.timeValid ?? true,
        competitors: opts.teams.map((team) => ({ team })),
        status: { type: { state: opts.state ?? 'pre' } }
      }
    ]
  };
}

function scheduleFetch(events: {
  football?: { arkansas?: unknown[]; lsu?: unknown[] };
  basketball?: { arkansas?: unknown[]; lsu?: unknown[] };
}): FetchLike {
  return async (url: string) => {
    const sport = url.includes('basketball') ? 'basketball' : 'football';
    const team = url.includes(`/teams/${ESPN_TEAM_IDS.arkansas}/`)
      ? 'arkansas'
      : url.includes(`/teams/${ESPN_TEAM_IDS.lsu}/`)
        ? 'lsu'
        : null;
    const list = team ? (events[sport]?.[team] ?? []) : [];
    return { ok: true, status: 200, json: async () => ({ events: list }) } as Response;
  };
}

const ARK = { id: ESPN_TEAM_IDS.arkansas, displayName: 'Arkansas Razorbacks' };
const LSU = { id: ESPN_TEAM_IDS.lsu, displayName: 'LSU Tigers' };
const BAMA = { id: '333', displayName: 'Alabama Crimson Tide' };
const FLA = { id: '57', displayName: 'Florida Gators' };

function setupFleet() {
  const db = createDb(':memory:');
  const controllers = createControllerRepository(db);
  const left = controllers.add({ name: 'Shelf L', host: '10.0.0.11', source: 'manual' });
  const right = controllers.add({ name: 'Shelf R', host: '10.0.0.12', source: 'manual' });
  const cabinet = controllers.add({ name: 'Cabinet', host: '10.0.0.13', source: 'manual' });
  const group = createGroupRepository(db).add({
    name: 'Shelves',
    members: [
      { controllerId: left.id, wledSegId: 0 },
      { controllerId: right.id, wledSegId: 0 }
    ]
  });
  const themes = createThemeRepository(db);
  const dim = themes.add({ name: 'Dim White', effect: 0, palette: 0, colors: [[255, 255, 240]], brightness: 40 });
  const arkTheme = themes.add({ name: 'Arkansas', effect: 1, palette: 2, colors: [[157, 34, 53]], brightness: 180 });
  const lsuTheme = themes.add({ name: 'LSU Wipe', effect: 55, palette: 6, colors: [[70, 29, 124]], brightness: 180 });
  const holiday = themes.add({ name: 'Halloween', effect: 9, palette: 3, colors: [[255, 80, 0]], brightness: 200 });
  createSettingsRepository(db).update({
    homeLatitude: LAT,
    homeLongitude: LON,
    gameDayEnabled: true,
    gameGroupId: group.id,
    gameLeftControllerId: left.id,
    gameRightControllerId: right.id,
    gameArkansasThemeId: arkTheme.id,
    gameLsuThemeId: lsuTheme.id
  });
  const applyFn = vi.fn(async (members: { controllerId: string; wledSegId: number | null }[]) => okApply(members));
  return { db, left, right, cabinet, dim, arkTheme, lsuTheme, holiday, applyFn, looks: createActiveLookRepository(db) };
}

describe('game trigger engine', () => {
  it('game start skips a live manual hold and records source game on the rest', async () => {
    const { db, left, right, arkTheme, lsuTheme, looks, applyFn } = setupFleet();
    looks.set({
      controllerId: left.id, themeId: lsuTheme.id, source: 'manual', sourceId: null,
      appliedAt: '2026-10-31T12:00:00.000Z', expiresAt: null
    });
    createGameTriggerRepository(db).upsert({
      espnEventId: 'e-ark',
      sport: 'football',
      teams: ['arkansas'],
      opponent: 'Alabama Crimson Tide',
      startAt: '2026-10-31T18:00:00.000Z',
      releaseAt: '2026-10-31T22:00:00.000Z',
      timeValid: true,
      assignments: { [left.id]: arkTheme.id, [right.id]: arkTheme.id },
      status: 'scheduled',
      updatedAt: '2026-10-01T00:00:00.000Z'
    });
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(new Date('2026-10-31T19:00:00.000Z'));
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: right.id, wledSegId: null }],
      { type: 'theme', themeId: arkTheme.id }
    );
    expect(looks.get(left.id)?.source).toBe('manual');
    expect(looks.get(right.id)).toMatchObject({ source: 'game', sourceId: 'e-ark', themeId: arkTheme.id, expiresAt: null });
    expect(createGameTriggerRepository(db).get('e-ark')?.status).toBe('active');
  });

  it('release resumes an in-window holiday theme', async () => {
    const { db, left, arkTheme, holiday, looks, applyFn } = setupFleet();
    const sunset = SunCalc.getTimes(new Date(2026, 9, 31, 12, 0, 0), LAT, LON).sunset;
    const now = new Date(sunset.getTime() + 60 * 60 * 1000);
    const event = createCalendarRepository(db).add({
      name: 'Halloween', category: 'holiday',
      dateRule: { kind: 'fixed', month: now.getMonth() + 1, day: now.getDate() },
      recursYearly: true, enabled: true, groupId: null,
      controllers: [{ controllerId: left.id, wledSegId: null }],
      triggerTime: { type: 'sunset', offsetMinutes: 0 },
      actionType: 'theme', actionPayload: { themeId: holiday.id }
    });
    expect(resolveResume(db, left.id, now)).toEqual({ type: 'calendar', eventId: event.id, themeId: holiday.id });
    looks.set({
      controllerId: left.id, themeId: arkTheme.id, source: 'game', sourceId: 'e-ark',
      appliedAt: now.toISOString(), expiresAt: null
    });
    createGameTriggerRepository(db).upsert({
      espnEventId: 'e-ark',
      sport: 'football',
      teams: ['arkansas'],
      opponent: 'Alabama Crimson Tide',
      startAt: new Date(now.getTime() - 3 * 3600_000).toISOString(),
      releaseAt: new Date(now.getTime() - 60_000).toISOString(),
      timeValid: true,
      assignments: { [left.id]: arkTheme.id },
      status: 'active',
      updatedAt: now.toISOString()
    });
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(now);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: left.id, wledSegId: null }],
      { type: 'theme', themeId: holiday.id }
    );
    expect(looks.get(left.id)).toMatchObject({
      source: 'calendar', sourceId: event.id, themeId: holiday.id, expiresAt: calendarLookExpiresAt(now)
    });
    expect(createGameTriggerRepository(db).get('e-ark')?.status).toBe('released');
  });

  it('release resumes Dim White at night and powers off in daytime', async () => {
    const { db, left, cabinet, dim, arkTheme, looks, applyFn } = setupFleet();
    const noon = new Date(2026, 9, 31, 12, 0, 0);
    const sunset = SunCalc.getTimes(noon, LAT, LON).sunset;
    const night = new Date(sunset.getTime() + 30 * 60 * 1000);
    const day = new Date(2026, 9, 31, 14, 0, 0);
    createScheduleRepository(db).add({
      name: 'Dim White',
      triggerType: 'sunset', cronExpr: null, daysOfWeek: null, timeOfDay: null,
      offsetMinutes: 0, latitude: LAT, longitude: LON, groupId: null,
      controllers: [
        { controllerId: left.id, wledSegId: null },
        { controllerId: cabinet.id, wledSegId: null }
      ],
      actionType: 'theme', actionPayload: { themeId: dim.id }, offTrigger: null, enabled: true
    });
    expect(resolveResume(db, left.id, night)).toEqual(expect.objectContaining({ type: 'schedule', themeId: dim.id }));
    expect(resolveResume(db, left.id, day)).toEqual({ type: 'powerOff' });

    looks.set({
      controllerId: left.id, themeId: arkTheme.id, source: 'game', sourceId: 'e-night',
      appliedAt: night.toISOString(), expiresAt: null
    });
    createGameTriggerRepository(db).upsert({
      espnEventId: 'e-night',
      sport: 'football',
      teams: ['arkansas'],
      opponent: 'Alabama Crimson Tide',
      startAt: new Date(night.getTime() - 4 * 3600_000).toISOString(),
      releaseAt: new Date(night.getTime() - 1000).toISOString(),
      timeValid: true,
      assignments: { [left.id]: arkTheme.id },
      status: 'active',
      updatedAt: night.toISOString()
    });
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(night);
    expect(applyFn).toHaveBeenLastCalledWith(
      [{ controllerId: left.id, wledSegId: null }],
      { type: 'theme', themeId: dim.id }
    );
    expect(looks.get(left.id)?.source).toBe('schedule');

    applyFn.mockClear();
    looks.set({
      controllerId: cabinet.id, themeId: arkTheme.id, source: 'game', sourceId: 'e-day',
      appliedAt: day.toISOString(), expiresAt: null
    });
    createGameTriggerRepository(db).upsert({
      espnEventId: 'e-day',
      sport: 'football',
      teams: ['arkansas'],
      opponent: 'Alabama Crimson Tide',
      startAt: new Date(day.getTime() - 2 * 3600_000).toISOString(),
      releaseAt: new Date(day.getTime() - 1000).toISOString(),
      timeValid: true,
      assignments: { [cabinet.id]: arkTheme.id },
      status: 'active',
      updatedAt: day.toISOString()
    });
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(day);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: cabinet.id, wledSegId: null }],
      { type: 'power', on: false }
    );
    expect(looks.get(cabinet.id)).toBeUndefined();
  });

  it('early-final flag releases an active game before release_at', async () => {
    const { db, left, arkTheme, looks, applyFn } = setupFleet();
    const now = new Date(2026, 9, 31, 14, 0, 0);
    looks.set({
      controllerId: left.id, themeId: arkTheme.id, source: 'game', sourceId: 'e-early',
      appliedAt: now.toISOString(), expiresAt: null
    });
    const repo = createGameTriggerRepository(db);
    repo.upsert({
      espnEventId: 'e-early',
      sport: 'football',
      teams: ['arkansas'],
      opponent: 'Alabama Crimson Tide',
      startAt: new Date(now.getTime() - 3600_000).toISOString(),
      releaseAt: new Date(now.getTime() + 2 * 3600_000).toISOString(),
      timeValid: true,
      assignments: { [left.id]: arkTheme.id },
      status: 'active',
      updatedAt: now.toISOString()
    });
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe(summaryUrl('football', 'e-early'));
      return {
        ok: true,
        json: async () => ({ header: { competitions: [{ status: { type: { state: 'post' } } }] } })
      } as Response;
    });
    const early = await pollActiveGameSummaries(db, now, fetchFn);
    expect(early).toEqual(['e-early']);
    expect(repo.get('e-early')?.earlyFinal).toBe(true);
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(now);
    expect(repo.get('e-early')?.status).toBe('released');
    expect(looks.get(left.id)).toBeUndefined();
  });
});

describe('game assignment split', () => {
  it('Arkansas vs LSU is a split; overlapping windows split; a lone team paints the group', async () => {
    const { db, left, right, arkTheme, lsuTheme } = setupFleet();
    const now = new Date('2026-09-01T12:00:00.000Z');
    const vs = espnEvent({
      id: 'rivalry',
      date: '2026-11-28T17:00:00.000Z',
      teams: [ARK, LSU]
    });
    const arkOnly = espnEvent({
      id: 'ark-bama',
      date: '2026-10-10T17:00:00.000Z',
      teams: [ARK, BAMA]
    });
    const lsuOverlap = espnEvent({
      id: 'lsu-fla',
      date: '2026-10-10T19:00:00.000Z',
      teams: [LSU, FLA]
    });
    const arkSolo = espnEvent({
      id: 'ark-solo',
      date: '2026-12-05T18:00:00.000Z',
      teams: [ARK, BAMA]
    });

    const result = await syncGames(
      db,
      now,
      scheduleFetch({
        football: { arkansas: [vs, arkOnly, arkSolo], lsu: [vs, lsuOverlap] },
        basketball: {}
      })
    );
    expect(result.created).toBe(4);
    const byId = Object.fromEntries(result.triggers.map((t) => [t.espnEventId, t]));
    expect(byId.rivalry.assignments).toEqual({ [left.id]: lsuTheme.id, [right.id]: arkTheme.id });
    expect(byId.rivalry.teams.sort()).toEqual(['arkansas', 'lsu']);
    expect(byId['ark-bama'].assignments).toEqual({ [left.id]: lsuTheme.id, [right.id]: arkTheme.id });
    expect(byId['lsu-fla'].assignments).toEqual({ [left.id]: lsuTheme.id, [right.id]: arkTheme.id });
    expect(byId['ark-solo'].assignments).toEqual({ [left.id]: arkTheme.id, [right.id]: arkTheme.id });
  });
});

describe('syncGames diff', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates, dedupes both-team events, skips post, and does not insert TBA', async () => {
    const { db } = setupFleet();
    const now = new Date('2026-09-01T12:00:00.000Z');
    const live = espnEvent({ id: 'live', date: '2026-11-01T17:00:00.000Z', teams: [ARK, BAMA] });
    const tba = espnEvent({ id: 'tba', date: '2026-11-08T17:00:00.000Z', timeValid: false, teams: [ARK, BAMA] });
    const post = espnEvent({ id: 'post', date: '2026-11-15T17:00:00.000Z', state: 'post', teams: [ARK, BAMA] });
    const rivalry = espnEvent({ id: 'dup', date: '2026-11-28T17:00:00.000Z', teams: [ARK, LSU] });
    const result = await syncGames(
      db,
      now,
      scheduleFetch({
        football: { arkansas: [live, tba, post, rivalry], lsu: [rivalry] },
        basketball: {}
      })
    );
    expect(result.created).toBe(2);
    expect(result.tba).toBe(1);
    expect(result.triggers.map((t) => t.espnEventId).sort()).toEqual(['dup', 'live']);
    expect(createGameTriggerRepository(db).get('tba')).toBeUndefined();
    expect(createGameTriggerRepository(db).get('post')).toBeUndefined();
    expect(createGameTriggerRepository(db).get('dup')?.teams.sort()).toEqual(['arkansas', 'lsu']);
    const logs = createGameSyncLogRepository(db).listRecent();
    expect(logs.some((l) => l.change === 'tba' && l.espnEventId === 'tba')).toBe(true);
    expect(logs.filter((l) => l.change === 'created')).toHaveLength(2);

    const again = await syncGames(
      db,
      now,
      scheduleFetch({
        football: { arkansas: [live, tba, post, rivalry], lsu: [rivalry] },
        basketball: {}
      })
    );
    expect(again.created).toBe(0);
    expect(again.tba).toBe(0);
    expect(again.unchanged).toBeGreaterThan(0);
  });

  it('moves a changed start, cancels scheduled TBA, honors skipEventIds, and dryRun writes nothing', async () => {
    const { db } = setupFleet();
    const now = new Date('2026-09-01T12:00:00.000Z');
    const original = espnEvent({ id: 'move-me', date: '2026-11-01T17:00:00.000Z', teams: [ARK, BAMA] });
    await syncGames(db, now, scheduleFetch({ football: { arkansas: [original] }, basketball: {} }));
    expect(createGameTriggerRepository(db).get('move-me')?.startAt).toBe('2026-11-01T17:00:00.000Z');

    const moved = espnEvent({ id: 'move-me', date: '2026-11-01T20:00:00.000Z', teams: [ARK, BAMA] });
    const moving = await syncGames(db, now, scheduleFetch({ football: { arkansas: [moved] }, basketball: {} }));
    expect(moving.moved).toBe(1);
    expect(createGameTriggerRepository(db).get('move-me')?.startAt).toBe('2026-11-01T20:00:00.000Z');
    expect(createGameTriggerRepository(db).get('move-me')?.releaseAt).toBe('2026-11-02T00:00:00.000Z');

    const asTba = espnEvent({
      id: 'move-me', date: '2026-11-01T20:00:00.000Z', timeValid: false, teams: [ARK, BAMA]
    });
    const cancelled = await syncGames(db, now, scheduleFetch({ football: { arkansas: [asTba] }, basketball: {} }));
    expect(cancelled.cancelled).toBe(1);
    expect(createGameTriggerRepository(db).get('move-me')?.status).toBe('cancelled');

    const skipMe = espnEvent({ id: 'skip-me', date: '2026-12-01T18:00:00.000Z', teams: [LSU, FLA] });
    const skipped = await syncGames(
      db,
      now,
      scheduleFetch({ football: { lsu: [skipMe] }, basketball: {} }),
      { skipEventIds: ['skip-me'] }
    );
    expect(skipped.triggers.find((t) => t.espnEventId === 'skip-me')?.status).toBe('skipped');
    expect(createGameTriggerRepository(db).get('skip-me')?.status).toBe('skipped');

    const fresh = espnEvent({ id: 'dry', date: '2026-12-12T18:00:00.000Z', teams: [ARK, BAMA] });
    const dry = await syncGames(
      db,
      now,
      scheduleFetch({ football: { arkansas: [fresh] }, basketball: {} }),
      { dryRun: true }
    );
    expect(dry.created).toBe(1);
    expect(dry.triggers.some((t) => t.espnEventId === 'dry')).toBe(true);
    expect(createGameTriggerRepository(db).get('dry')).toBeUndefined();
  });

  it('GET /api/games, /log, /preview and POST /sync use invoke and honor dryRun', async () => {
    const { db } = setupFleet();
    const app = createApp(db);
    const live = espnEvent({ id: 'route-1', date: '2026-11-01T17:00:00.000Z', teams: [ARK, BAMA] });
    const fetchFn = scheduleFetch({ football: { arkansas: [live] }, basketball: {} });
    vi.stubGlobal('fetch', fetchFn);

    const preview = await invoke(app, 'GET', '/api/games/preview');
    expect(preview.status).toBe(200);
    expect(preview.body.created).toBe(1);
    expect(createGameTriggerRepository(db).list()).toEqual([]);

    const synced = await invoke(app, 'POST', '/api/games/sync', { dryRun: false });
    expect(synced.status).toBe(200);
    expect(synced.body.created).toBe(1);
    const listed = await invoke(app, 'GET', '/api/games');
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].espnEventId).toBe('route-1');
    const log = await invoke(app, 'GET', '/api/games/log');
    expect(log.body.some((row: { change: string }) => row.change === 'created')).toBe(true);

    const settings = await invoke(app, 'GET', '/api/settings');
    expect(settings.body.gameDayEnabled).toBe(true);
    const patched = await invoke(app, 'PATCH', '/api/settings', { gameDayEnabled: false });
    expect(patched.body.gameDayEnabled).toBe(false);
  });
});

describe('calendar events preview', () => {
  it('lists enabled events between from and to using resolveDate', async () => {
    const { db, left, holiday } = setupFleet();
    const event = createCalendarRepository(db).add({
      name: 'Halloween', category: 'holiday',
      dateRule: { kind: 'fixed', month: 10, day: 31 },
      recursYearly: true, enabled: true, groupId: null,
      controllers: [{ controllerId: left.id, wledSegId: null }],
      triggerTime: { type: 'sunset', offsetMinutes: 0 },
      actionType: 'theme', actionPayload: { themeId: holiday.id }
    });
    createCalendarRepository(db).add({
      name: 'Disabled', category: 'custom',
      dateRule: { kind: 'fixed', month: 10, day: 31 },
      recursYearly: true, enabled: false, groupId: null,
      controllers: [{ controllerId: left.id, wledSegId: null }],
      triggerTime: { type: 'fixed', time: '12:00' },
      actionType: 'theme', actionPayload: { themeId: holiday.id }
    });
    const app = createApp(db);
    const preview = await invoke(app, 'GET', '/api/calendar-events/preview?from=2026-10-30&to=2026-11-01');
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual([
      { date: '2026-10-31', events: [{ id: event.id, name: 'Halloween', themeId: holiday.id }] }
    ]);
    const bad = await invoke(app, 'GET', '/api/calendar-events/preview?from=2020-01-01&to=2023-01-01');
    expect(bad.status).toBe(400);
  });
});
