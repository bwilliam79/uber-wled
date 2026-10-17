import { describe, it, expect, afterEach, vi } from 'vitest';
import SunCalc from 'suncalc';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createControllerStatusRepository } from '../../src/controllers/statusRepository.js';
import { createScheduleRepository, type Schedule } from '../../src/schedules/repository.js';
import { createCalendarRepository } from '../../src/calendar/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { createSettingsRepository } from '../../src/settings/repository.js';
import { createActiveLookRepository } from '../../src/looks/repository.js';
import { calendarLookExpiresAt } from '../../src/looks/expiry.js';
import { SchedulerEngine, nextTriggerDate } from '../../src/schedules/engine.js';
import { applyActionV2, type ControlAction } from '../../src/control/actionMap.js';

const LAT = 41.8781;
const LON = -87.6298;

function scheduleInput(overrides: Partial<Omit<Schedule, 'id'>>): Omit<Schedule, 'id'> {
  return {
    name: 'Ambient',
    triggerType: 'cron',
    cronExpr: '0 10 * * *',
    daysOfWeek: null,
    timeOfDay: null,
    offsetMinutes: 0,
    latitude: null,
    longitude: null,
    groupId: null,
    controllers: null,
    actionType: 'theme',
    actionPayload: { themeId: 'dim' },
    offTrigger: null,
    enabled: true,
    ...overrides
  };
}

function sameMinute(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate() && a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}

function okApply(members: { controllerId: string; wledSegId: number | null }[]) {
  return members.map((m) => ({ ...m, ok: true }));
}

/** Sunset of a local calendar day, then sunrise and sunset of the next local day. */
function sunBoundary(anchor: Date) {
  const sunset = SunCalc.getTimes(anchor, LAT, LON).sunset;
  const holidayNoon = new Date(sunset.getFullYear(), sunset.getMonth(), sunset.getDate(), 12, 0, 0);
  const holidaySunset = SunCalc.getTimes(holidayNoon, LAT, LON).sunset;
  const nextNoon = new Date(holidaySunset.getFullYear(), holidaySunset.getMonth(), holidaySunset.getDate() + 1, 12, 0, 0);
  return {
    holidaySunset,
    nextSunrise: SunCalc.getTimes(nextNoon, LAT, LON).sunrise,
    nextSunset: SunCalc.getTimes(nextNoon, LAT, LON).sunset
  };
}

describe('SchedulerEngine active looks', () => {
  function setup() {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    const shelf = controllers.add({ name: 'Shelf L', host: '10.0.0.11', source: 'manual' });
    const shelfR = controllers.add({ name: 'Shelf R', host: '10.0.0.12', source: 'manual' });
    const cabinet = controllers.add({ name: 'Cabinet', host: '10.0.0.13', source: 'manual' });
    const themes = createThemeRepository(db);
    const dim = themes.add({ name: 'Dim White', effect: 0, palette: 0, colors: [[255, 255, 240]], brightness: 40 });
    const lsu = themes.add({ name: 'LSU Wipe', effect: 55, palette: 6, colors: [[70, 29, 124]], brightness: 180 });
    const holiday = themes.add({ name: 'Halloween', effect: 9, palette: 3, colors: [[255, 80, 0]], brightness: 200 });
    const looks = createActiveLookRepository(db);
    const applyFn = vi.fn(async (members: { controllerId: string; wledSegId: number | null }[]) => okApply(members));
    return { db, shelf, shelfR, cabinet, dim, lsu, holiday, looks, applyFn };
  }

  it('acts on an idle controller with no tracked look', async () => {
    const { db, cabinet, dim, applyFn } = setup();
    createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [{ controllerId: cabinet.id, wledSegId: null }]
    }));
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date(2026, 9, 31, 10, 0, 0));
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: cabinet.id, wledSegId: null }],
      { type: 'theme', themeId: dim.id }
    );
  });

  it('skips a controller holding a manual game theme', async () => {
    const { db, cabinet, dim, lsu, looks, applyFn } = setup();
    looks.set({
      controllerId: cabinet.id, themeId: lsu.id, source: 'manual', sourceId: null,
      appliedAt: new Date(2026, 9, 31, 8, 0, 0).toISOString(), expiresAt: null
    });
    createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [{ controllerId: cabinet.id, wledSegId: null }]
    }));
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date(2026, 9, 31, 10, 0, 0));
    expect(applyFn).not.toHaveBeenCalled();
    expect(looks.get(cabinet.id)?.themeId).toBe(lsu.id);
  });

  it('skips a controller holding an unexpired calendar holiday look', async () => {
    const { db, cabinet, dim, holiday, looks, applyFn } = setup();
    const now = new Date(2026, 9, 31, 10, 0, 0);
    looks.set({
      controllerId: cabinet.id, themeId: holiday.id, source: 'calendar', sourceId: 'evt',
      appliedAt: new Date(2026, 9, 30, 18, 0, 0).toISOString(),
      expiresAt: new Date(2026, 9, 31, 12, 0, 0).toISOString()
    });
    createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [{ controllerId: cabinet.id, wledSegId: null }]
    }));
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(now);
    expect(applyFn).not.toHaveBeenCalled();
  });

  it('acts again once a calendar look expires, and when the tracked theme is the schedule theme or source is schedule', async () => {
    const { db, cabinet, shelf, dim, lsu, looks, applyFn } = setup();
    const now = new Date(2026, 9, 31, 10, 0, 0);
    looks.set({
      controllerId: cabinet.id, themeId: lsu.id, source: 'calendar', sourceId: 'evt',
      appliedAt: new Date(2026, 9, 30, 18, 0, 0).toISOString(),
      expiresAt: new Date(2026, 9, 31, 9, 0, 0).toISOString()
    });
    looks.set({
      controllerId: shelf.id, themeId: dim.id, source: 'manual', sourceId: null,
      appliedAt: new Date(2026, 9, 31, 8, 0, 0).toISOString(), expiresAt: null
    });
    createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [
        { controllerId: cabinet.id, wledSegId: null },
        { controllerId: shelf.id, wledSegId: null }
      ]
    }));
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(now);
    expect(applyFn).toHaveBeenCalledWith(
      [
        { controllerId: cabinet.id, wledSegId: null },
        { controllerId: shelf.id, wledSegId: null }
      ],
      { type: 'theme', themeId: dim.id }
    );
  });

  it('treats a schedule-sourced look as idle even when the theme differs', async () => {
    const { db, cabinet, dim, lsu, looks, applyFn } = setup();
    looks.set({
      controllerId: cabinet.id, themeId: lsu.id, source: 'schedule', sourceId: 'other',
      appliedAt: new Date(2026, 9, 31, 8, 0, 0).toISOString(), expiresAt: null
    });
    createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [{ controllerId: cabinet.id, wledSegId: null }]
    }));
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(new Date(2026, 9, 31, 10, 0, 0));
    expect(applyFn).toHaveBeenCalledTimes(1);
  });

  it('acts when the poller has seen the controller off since the look was applied, and not when that reading is older', async () => {
    const { db, cabinet, shelf, dim, lsu, looks, applyFn } = setup();
    const appliedAt = new Date(2026, 9, 31, 8, 0, 0).toISOString();
    looks.set({
      controllerId: cabinet.id, themeId: lsu.id, source: 'manual', sourceId: null,
      appliedAt, expiresAt: null
    });
    looks.set({
      controllerId: shelf.id, themeId: lsu.id, source: 'manual', sourceId: null,
      appliedAt, expiresAt: null
    });
    const statuses = createControllerStatusRepository(db);
    const off = { on: false, bri: 0, ps: -1, seg: [] };
    statuses.upsert({
      controllerId: cabinet.id, reachable: true, info: null, state: off,
      polledAt: new Date(2026, 9, 31, 9, 0, 0).toISOString()
    });
    // Older than appliedAt: the lights were off before the game theme went on.
    statuses.upsert({
      controllerId: shelf.id, reachable: true, info: null, state: off,
      polledAt: new Date(2026, 9, 31, 7, 0, 0).toISOString()
    });
    createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [
        { controllerId: cabinet.id, wledSegId: null },
        { controllerId: shelf.id, wledSegId: null }
      ]
    }));
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(new Date(2026, 9, 31, 10, 0, 0));
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: cabinet.id, wledSegId: null }],
      { type: 'theme', themeId: dim.id }
    );
  });

  it('splits a schedule per controller: date hold skips one member and the other still runs', async () => {
    const { db, shelf, cabinet, dim, applyFn } = setup();
    createCalendarRepository(db).add({
      name: 'July 4 hold', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      controllers: [{ controllerId: shelf.id, wledSegId: null }],
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: null, actionPayload: null
    });
    createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [
        { controllerId: shelf.id, wledSegId: null },
        { controllerId: cabinet.id, wledSegId: null }
      ]
    }));
    // 2026-07-04 is a Saturday; cron 10:00 is not the calendar's 18:00, so only the schedule is due.
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(new Date(2026, 6, 4, 10, 0, 0));
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: cabinet.id, wledSegId: null }],
      { type: 'theme', themeId: dim.id }
    );
  });

  it('records a schedule theme only for controllers whose apply succeeded', async () => {
    const { db, shelf, cabinet, dim, looks } = setup();
    const schedule = createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [
        { controllerId: shelf.id, wledSegId: null },
        { controllerId: cabinet.id, wledSegId: null }
      ]
    }));
    const applyFn = vi.fn(async () => [
      { controllerId: shelf.id, wledSegId: null, ok: false, error: 'timeout' },
      { controllerId: cabinet.id, wledSegId: null, ok: true }
    ]);
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(new Date(2026, 9, 31, 10, 0, 0));
    expect(looks.get(shelf.id)).toBeUndefined();
    expect(looks.get(cabinet.id)).toMatchObject({
      themeId: dim.id, source: 'schedule', sourceId: schedule.id, expiresAt: null
    });
  });

  it('treats a non-array apply result as every member succeeding', async () => {
    const { db, cabinet, dim, looks } = setup();
    createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [{ controllerId: cabinet.id, wledSegId: null }]
    }));
    const applyFn = vi.fn(async () => undefined);
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(new Date(2026, 9, 31, 10, 0, 0));
    expect(looks.get(cabinet.id)?.source).toBe('schedule');
  });

  it('clears a schedule look only on the controllers the OFF actually ran', async () => {
    const { db, shelf, cabinet, dim, lsu, looks, applyFn } = setup();
    const appliedAt = new Date(2026, 9, 30, 20, 0, 0).toISOString();
    looks.set({
      controllerId: cabinet.id, themeId: dim.id, source: 'schedule', sourceId: 's',
      appliedAt, expiresAt: null
    });
    looks.set({
      controllerId: shelf.id, themeId: lsu.id, source: 'manual', sourceId: null,
      appliedAt, expiresAt: null
    });
    // ON at 20:00, OFF at 22:00 — not overnight, so today's day filter applies.
    createScheduleRepository(db).add(scheduleInput({
      triggerType: 'cron', cronExpr: '0 20 * * *',
      actionPayload: { themeId: dim.id },
      offTrigger: { type: 'fixed', time: '22:00' },
      controllers: [
        { controllerId: shelf.id, wledSegId: null },
        { controllerId: cabinet.id, wledSegId: null }
      ]
    }));
    await new SchedulerEngine(db, applyFn).checkAndFireDueSchedules(new Date(2026, 9, 31, 22, 0, 0));
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: cabinet.id, wledSegId: null }],
      { type: 'power', on: false }
    );
    expect(looks.get(cabinet.id)).toBeUndefined();
    expect(looks.get(shelf.id)?.themeId).toBe(lsu.id);
  });

  it('uses yesterday for an overnight schedule OFF day-of-week filter', async () => {
    const { db, cabinet, applyFn } = setup();
    // 2026-07-04 is Saturday. ON Saturday 18:00, OFF 06:00 belongs to the previous local day.
    createScheduleRepository(db).add(scheduleInput({
      name: 'Saturday night',
      triggerType: 'weekly', cronExpr: null, daysOfWeek: [6], timeOfDay: '18:00',
      actionType: 'power', actionPayload: { on: true },
      offTrigger: { type: 'fixed', time: '06:00' },
      controllers: [{ controllerId: cabinet.id, wledSegId: null }]
    }));
    const engine = new SchedulerEngine(db, applyFn);

    await engine.checkAndFireDueSchedules(new Date(2026, 6, 4, 6, 0, 0));
    expect(applyFn).not.toHaveBeenCalled();

    await engine.checkAndFireDueSchedules(new Date(2026, 6, 4, 18, 0, 0));
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: cabinet.id, wledSegId: null }],
      { type: 'power', on: true }
    );

    applyFn.mockClear();
    await engine.checkAndFireDueSchedules(new Date(2026, 6, 5, 6, 0, 0));
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: cabinet.id, wledSegId: null }],
      { type: 'power', on: false }
    );

    applyFn.mockClear();
    await engine.checkAndFireDueSchedules(new Date(2026, 6, 5, 18, 0, 0));
    expect(applyFn).not.toHaveBeenCalled();
  });

  it('fires a calendar overnight OFF the next morning, not the morning of the event', async () => {
    const { db, cabinet, holiday, looks, applyFn } = setup();
    const event = createCalendarRepository(db).add({
      name: 'July 4', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null,
      controllers: [{ controllerId: cabinet.id, wledSegId: null }],
      triggerTime: { type: 'fixed', time: '18:00' },
      offTrigger: { type: 'fixed', time: '06:00' },
      actionType: 'theme', actionPayload: { themeId: holiday.id }
    });
    const engine = new SchedulerEngine(db, applyFn);
    const members = [{ controllerId: cabinet.id, wledSegId: null }];

    await engine.checkAndFireDueSchedules(new Date(2026, 6, 4, 6, 0, 0));
    expect(applyFn).not.toHaveBeenCalled();

    const onAt = new Date(2026, 6, 4, 18, 0, 0);
    await engine.checkAndFireDueSchedules(onAt);
    expect(applyFn).toHaveBeenCalledWith(members, { type: 'theme', themeId: holiday.id });
    expect(looks.get(cabinet.id)).toMatchObject({
      themeId: holiday.id, source: 'calendar', sourceId: event.id,
      expiresAt: calendarLookExpiresAt(onAt)
    });

    applyFn.mockClear();
    await engine.checkAndFireDueSchedules(new Date(2026, 6, 5, 6, 0, 0));
    expect(applyFn).toHaveBeenCalledWith(members, { type: 'power', on: false });
    expect(looks.get(cabinet.id)).toBeUndefined();
  });

  it('fires a sunset→sunrise calendar OFF the next morning', async () => {
    const { db, cabinet, holiday, applyFn } = setup();
    createSettingsRepository(db).update({ homeLatitude: LAT, homeLongitude: LON });
    const { holidaySunset, nextSunrise } = sunBoundary(new Date(2026, 6, 4, 12, 0, 0));
    expect(nextSunrise.getTime()).toBeGreaterThan(holidaySunset.getTime());

    createCalendarRepository(db).add({
      name: 'July 4', category: 'holiday',
      dateRule: { kind: 'fixed', month: holidaySunset.getMonth() + 1, day: holidaySunset.getDate() },
      recursYearly: true, enabled: true, groupId: null,
      controllers: [{ controllerId: cabinet.id, wledSegId: null }],
      triggerTime: { type: 'sunset', offsetMinutes: 0 },
      offTrigger: { type: 'sunrise', offsetMinutes: 0 },
      actionType: 'theme', actionPayload: { themeId: holiday.id }
    });
    const engine = new SchedulerEngine(db, applyFn);
    const members = [{ controllerId: cabinet.id, wledSegId: null }];

    const morningOf = new Date(holidaySunset.getFullYear(), holidaySunset.getMonth(), holidaySunset.getDate(), 8, 0, 0);
    const sunriseOfEvent = SunCalc.getTimes(morningOf, LAT, LON).sunrise;
    await engine.checkAndFireDueSchedules(sunriseOfEvent);
    expect(applyFn).not.toHaveBeenCalled();

    await engine.checkAndFireDueSchedules(holidaySunset);
    expect(applyFn).toHaveBeenCalledWith(members, { type: 'theme', themeId: holiday.id });

    applyFn.mockClear();
    await engine.checkAndFireDueSchedules(nextSunrise);
    expect(applyFn).toHaveBeenCalledWith(members, { type: 'power', on: false });
  });

  it('keeps an Oct 31 sunset holiday through the next sunrise and lets the ambient schedule resume at the next sunset', async () => {
    const { db, cabinet, dim, holiday, looks, applyFn } = setup();
    createSettingsRepository(db).update({ homeLatitude: LAT, homeLongitude: LON });
    const { holidaySunset, nextSunrise, nextSunset } = sunBoundary(new Date(2026, 9, 31, 12, 0, 0));
    const expiry = calendarLookExpiresAt(holidaySunset);
    expect(nextSunrise.getTime()).toBeGreaterThan(holidaySunset.getTime());
    expect(nextSunset.getTime()).toBeGreaterThan(Date.parse(expiry));

    const members = [{ controllerId: cabinet.id, wledSegId: null }];
    createCalendarRepository(db).add({
      name: 'Halloween', category: 'holiday',
      dateRule: { kind: 'fixed', month: holidaySunset.getMonth() + 1, day: holidaySunset.getDate() },
      recursYearly: true, enabled: true, groupId: null,
      controllers: members,
      triggerTime: { type: 'sunset', offsetMinutes: 0 },
      actionType: 'theme', actionPayload: { themeId: holiday.id }
    });
    const schedule = createScheduleRepository(db).add(scheduleInput({
      name: 'Dim White',
      triggerType: 'sunset', cronExpr: null, offsetMinutes: 0,
      latitude: LAT, longitude: LON,
      actionPayload: { themeId: dim.id },
      offTrigger: { type: 'sunrise', offsetMinutes: 0 },
      controllers: members
    }));
    // The schedule really is due at these sun minutes; a miss here means the
    // hold wasn't what suppressed it.
    expect(sameMinute(nextTriggerDate(schedule, holidaySunset), holidaySunset)).toBe(true);
    expect(sameMinute(nextTriggerDate(schedule, nextSunset), nextSunset)).toBe(true);
    const dueOff = SunCalc.getTimes(nextSunrise, LAT, LON).sunrise;
    expect(sameMinute(dueOff, nextSunrise)).toBe(true);
    const engine = new SchedulerEngine(db, applyFn);

    await engine.checkAndFireDueSchedules(holidaySunset);
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(applyFn).toHaveBeenCalledWith(members, { type: 'theme', themeId: holiday.id });
    expect(looks.get(cabinet.id)).toMatchObject({
      source: 'calendar', themeId: holiday.id, expiresAt: expiry
    });

    await engine.checkAndFireDueSchedules(nextSunrise);
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(looks.get(cabinet.id)?.source).toBe('calendar');

    await engine.checkAndFireDueSchedules(nextSunset);
    expect(applyFn).toHaveBeenCalledTimes(2);
    expect(applyFn).toHaveBeenLastCalledWith(members, { type: 'theme', themeId: dim.id });
    expect(looks.get(cabinet.id)).toMatchObject({ source: 'schedule', themeId: dim.id, expiresAt: null });
  });
});

describe('SchedulerEngine per-controller fan-out', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs Dim White only to the idle cabinet while shelves keep a manual game theme', async () => {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    const shelfL = controllers.add({ name: 'Shelf L', host: '10.0.0.11', source: 'manual' });
    const shelfR = controllers.add({ name: 'Shelf R', host: '10.0.0.12', source: 'manual' });
    const cabinet = controllers.add({ name: 'Cabinet', host: '10.0.0.13', source: 'manual' });
    const dim = createThemeRepository(db).add({
      name: 'Dim White', effect: 0, palette: 0, colors: [[255, 255, 240]], brightness: 40
    });
    const lsu = createThemeRepository(db).add({
      name: 'LSU Wipe', effect: 55, palette: 6, colors: [[70, 29, 124]], brightness: 180
    });
    const looks = createActiveLookRepository(db);
    const appliedAt = new Date(2026, 9, 31, 8, 0, 0).toISOString();
    for (const shelf of [shelfL, shelfR]) {
      looks.set({
        controllerId: shelf.id, themeId: lsu.id, source: 'manual', sourceId: null,
        appliedAt, expiresAt: null
      });
    }
    createScheduleRepository(db).add(scheduleInput({
      actionPayload: { themeId: dim.id },
      controllers: [shelfL, shelfR, cabinet].map((c) => ({ controllerId: c.id, wledSegId: null }))
    }));

    const posts: { host: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const host = new URL(url).host;
      if (host !== '10.0.0.13') throw new Error(`unexpected device call to ${host}`);
      if (init?.body) posts.push({ host, body: JSON.parse(init.body as string) });
      return {
        ok: true, status: 200,
        json: async () => ({ on: true, bri: 128, ps: -1, seg: [{ id: 0 }] })
      } as Response;
    }));

    const engine = new SchedulerEngine(db, (members, action) =>
      applyActionV2(db, members, action as ControlAction));
    await engine.checkAndFireDueSchedules(new Date(2026, 9, 31, 10, 0, 0));

    expect(posts).toHaveLength(1);
    expect(posts[0].host).toBe('10.0.0.13');
    expect(posts[0].body).not.toHaveProperty('themeId');
    expect(posts[0].body.udpn).toEqual({ nn: true });
    expect(posts[0].body.bri).toBe(40);
    expect(posts[0].body.seg).toEqual([
      expect.objectContaining({ id: 0, fx: 0, pal: 0, col: [[255, 255, 240]] })
    ]);
    expect(looks.get(cabinet.id)).toMatchObject({ source: 'schedule', themeId: dim.id });
    expect(looks.get(shelfL.id)?.themeId).toBe(lsu.id);
    expect(looks.get(shelfR.id)?.themeId).toBe(lsu.id);
  });
});
