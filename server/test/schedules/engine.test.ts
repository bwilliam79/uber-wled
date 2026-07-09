import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import SunCalc from 'suncalc';
import { SchedulerEngine, nextTriggerDate } from '../../src/schedules/engine.js';
import { createCalendarRepository } from '../../src/calendar/repository.js';
import { createSettingsRepository } from '../../src/settings/repository.js';

describe('nextTriggerDate', () => {
  it('computes the next cron-triggered date', () => {
    const now = new Date('2026-07-04T10:00:00');
    const next = nextTriggerDate(
      { triggerType: 'cron', cronExpr: '0 22 * * *' } as any,
      now
    );
    expect(next.getHours()).toBe(22);
    expect(next.getMinutes()).toBe(0);
  });

  it('computes a sunset-relative date with an offset', () => {
    const now = new Date('2026-07-04T10:00:00Z');
    const next = nextTriggerDate(
      { triggerType: 'sunset', offsetMinutes: -15, latitude: 39.1, longitude: -94.6 } as any,
      now
    );
    expect(next instanceof Date).toBe(true);
    expect(Number.isNaN(next.getTime())).toBe(false);
  });

  it('computes the next weekly-triggered date for a day later this week', () => {
    // 2026-07-04 is a Saturday (day 6); ask for the next Monday (day 1) at 18:30
    const now = new Date('2026-07-04T10:00:00');
    const next = nextTriggerDate(
      { triggerType: 'weekly', daysOfWeek: [1], timeOfDay: '18:30' } as any,
      now
    );
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(18);
    expect(next.getMinutes()).toBe(30);
    expect(next.getDate()).toBe(6); // the following Monday, July 6 2026
  });

  it('computes today as the next weekly-triggered date when today matches and the time is still ahead', () => {
    // 2026-07-04 is a Saturday (day 6); ask for Saturday at a later time today
    const now = new Date('2026-07-04T10:00:00');
    const next = nextTriggerDate(
      { triggerType: 'weekly', daysOfWeek: [6], timeOfDay: '18:30' } as any,
      now
    );
    expect(next.getDay()).toBe(6);
    expect(next.getDate()).toBe(4);
    expect(next.getHours()).toBe(18);
    expect(next.getMinutes()).toBe(30);
  });
});

describe('SchedulerEngine.checkAndFireDueSchedules', () => {
  let db: ReturnType<typeof createDb>;
  let groupId: string;
  let applyFn: ReturnType<typeof vi.fn>;

  let controllerId: string;
  let controllerId2: string;

  beforeEach(() => {
    db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Front porch', host: '10.0.0.50', source: 'manual' }).id;
    controllerId2 = createControllerRepository(db).add({ name: 'Kitchen', host: '10.0.0.51', source: 'manual' }).id;
    groupId = createGroupRepository(db).add({
      name: 'Front', members: [{ controllerId, wledSegId: 0 }]
    }).id;
    applyFn = vi.fn().mockResolvedValue([{ controllerId, wledSegId: 0, ok: true }]);
  });

  it('fires a cron schedule whose minute matches now, and only once per minute', async () => {
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Every 10am', triggerType: 'cron', cronExpr: '0 10 * * *',
      daysOfWeek: null, timeOfDay: null, offsetMinutes: 0,
      latitude: null, longitude: null, groupId, actionType: 'power',
      actionPayload: { on: true }, enabled: true
    });
    const engine = new SchedulerEngine(db, applyFn);
    const tenAM = new Date('2026-07-04T10:00:00');

    await engine.checkAndFireDueSchedules(tenAM);
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId, wledSegId: 0 }],
      { type: 'power', on: true }
    );

    await engine.checkAndFireDueSchedules(tenAM);
    expect(applyFn).toHaveBeenCalledTimes(1); // not double-fired for the same minute
  });

  it('does not double-fire when two ticks overlap because applyFn is slow (race condition regression)', async () => {
    // Regression test for a check-then-act race: start() invokes
    // checkAndFireDueSchedules() from setInterval without awaiting it, so if
    // applyFn takes longer than the tick interval (e.g. a controller is
    // offline and every HTTP call times out), a second invocation could
    // previously start reading `lastFired` before the first invocation had
    // finished awaiting applyFn and updating `lastFired` — causing the same
    // schedule to fire twice for the same minute.
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Every 10am', triggerType: 'cron', cronExpr: '0 10 * * *',
      daysOfWeek: null, timeOfDay: null, offsetMinutes: 0,
      latitude: null, longitude: null, groupId, actionType: 'power',
      actionPayload: { on: true }, enabled: true
    });

    const slowApplyFn = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          // Resolve after 100ms to simulate a slow/offline controller whose
          // HTTP call (with a retry) takes longer than a single tick.
          setTimeout(() => resolve([{ controllerId, wledSegId: 0, ok: true }]), 100);
        })
    );
    const engine = new SchedulerEngine(db, slowApplyFn);
    const tenAM = new Date('2026-07-04T10:00:00');

    // Fire two overlapping invocations without awaiting between them, just
    // like an un-awaited setInterval callback firing again before the prior
    // tick's applyFn call has resolved.
    const first = engine.checkAndFireDueSchedules(tenAM);
    const second = engine.checkAndFireDueSchedules(tenAM);

    await Promise.all([first, second]);

    expect(slowApplyFn).toHaveBeenCalledTimes(1);
  });

  it('does not fire a disabled schedule', async () => {
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Disabled', triggerType: 'cron', cronExpr: '0 10 * * *', offsetMinutes: 0,
      daysOfWeek: null, timeOfDay: null,
      latitude: null, longitude: null, groupId, actionType: 'power',
      actionPayload: { on: true }, enabled: false
    });
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T10:00:00'));
    expect(applyFn).not.toHaveBeenCalled();
  });

  it('fires a schedule targeting a whole controller directly (no group)', async () => {
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Direct whole-controller', triggerType: 'cron', cronExpr: '0 10 * * *',
      daysOfWeek: null, timeOfDay: null, offsetMinutes: 0,
      latitude: null, longitude: null, groupId: null, controllers: [{ controllerId, wledSegId: null }],
      actionType: 'power', actionPayload: { on: true }, enabled: true
    });
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T10:00:00'));
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId, wledSegId: null }],
      { type: 'power', on: true }
    );
  });

  it('fires a schedule targeting one specific segment directly (no group)', async () => {
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Direct segment', triggerType: 'cron', cronExpr: '0 10 * * *',
      daysOfWeek: null, timeOfDay: null, offsetMinutes: 0,
      latitude: null, longitude: null, groupId: null, controllers: [{ controllerId, wledSegId: 2 }],
      actionType: 'power', actionPayload: { on: true }, enabled: true
    });
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T10:00:00'));
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId, wledSegId: 2 }],
      { type: 'power', on: true }
    );
  });

  it('fires a schedule targeting several individual controllers at once (no group)', async () => {
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Direct multi-controller', triggerType: 'cron', cronExpr: '0 10 * * *',
      daysOfWeek: null, timeOfDay: null, offsetMinutes: 0,
      latitude: null, longitude: null, groupId: null,
      controllers: [{ controllerId, wledSegId: null }, { controllerId: controllerId2, wledSegId: null }],
      actionType: 'power', actionPayload: { on: true }, enabled: true
    });
    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T10:00:00'));
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId, wledSegId: null }, { controllerId: controllerId2, wledSegId: null }],
      { type: 'power', on: true }
    );
  });

  it('fires a weekly schedule on the correct day of week at the correct time, and does not fire on other days', async () => {
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Saturday evening', triggerType: 'weekly', cronExpr: null,
      daysOfWeek: [6], timeOfDay: '18:30', offsetMinutes: 0,
      latitude: null, longitude: null, groupId, actionType: 'power',
      actionPayload: { on: true }, enabled: true
    });
    const engine = new SchedulerEngine(db, applyFn);

    // 2026-07-04 is a Saturday - should fire at 18:30
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T18:30:00'));
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId, wledSegId: 0 }],
      { type: 'power', on: true }
    );

    // 2026-07-05 is a Sunday at the same time - must not fire
    await engine.checkAndFireDueSchedules(new Date('2026-07-05T18:30:00'));
    expect(applyFn).toHaveBeenCalledTimes(1);
  });
});

describe('SchedulerEngine calendar override-for-day', () => {
  let db: ReturnType<typeof createDb>;
  let sharedGroupId: string;
  let unrelatedGroupId: string;
  let porchControllerId: string;
  let kitchenControllerId: string;
  let applyFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    porchControllerId = controllers.add({ name: 'Porch', host: '10.0.0.51', source: 'manual' }).id;
    kitchenControllerId = controllers.add({ name: 'Kitchen', host: '10.0.0.52', source: 'manual' }).id;
    const groups = createGroupRepository(db);
    sharedGroupId = groups.add({
      name: 'Porch', members: [{ controllerId: porchControllerId, wledSegId: 0 }]
    }).id;
    unrelatedGroupId = groups.add({
      name: 'Kitchen', members: [{ controllerId: kitchenControllerId, wledSegId: 0 }]
    }).id;
    applyFn = vi.fn().mockResolvedValue([]);
  });

  it("fires an enabled calendar event's own action when today matches its resolved date and trigger time", async () => {
    const calendar = createCalendarRepository(db);
    calendar.add({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: sharedGroupId,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'theme', actionPayload: { themeId: 'patriotic' }
    });

    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T18:00:00'));

    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: porchControllerId, wledSegId: 0 }],
      { type: 'theme', themeId: 'patriotic' }
    );
  });

  it('applies the theme at the ON time and powers off at an independent OFF time', async () => {
    const calendar = createCalendarRepository(db);
    calendar.add({
      name: 'Christmas', category: 'holiday',
      dateRule: { kind: 'fixed', month: 12, day: 25 },
      recursYearly: true, enabled: true, groupId: sharedGroupId,
      triggerTime: { type: 'fixed', time: '17:00' },
      offTrigger: { type: 'fixed', time: '23:00' },
      actionType: 'theme', actionPayload: { themeId: 'xmas' }
    });
    const engine = new SchedulerEngine(db, applyFn);

    // At the ON time: only the theme applies, not a power-off.
    await engine.checkAndFireDueSchedules(new Date('2026-12-25T17:00:00'));
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: porchControllerId, wledSegId: 0 }],
      { type: 'theme', themeId: 'xmas' }
    );

    applyFn.mockClear();
    // At the OFF time: a power-off fires.
    await engine.checkAndFireDueSchedules(new Date('2026-12-25T23:00:00'));
    expect(applyFn).toHaveBeenCalledTimes(1);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: porchControllerId, wledSegId: 0 }],
      { type: 'power', on: false }
    );

    applyFn.mockClear();
    // Same OFF minute again: deduped, doesn't re-fire.
    await engine.checkAndFireDueSchedules(new Date('2026-12-25T23:00:00'));
    expect(applyFn).not.toHaveBeenCalled();
  });

  it('computes an OFF sunset trigger at the configured home location', async () => {
    const homeLat = 39.1;
    const homeLon = -94.6;
    createSettingsRepository(db).update({ homeLatitude: homeLat, homeLongitude: homeLon });

    // Compute the actual sunset for a date at that location; drive the event
    // date off the sunset instant's local calendar day so todayMatches is
    // timezone-robust, and fire exactly at that minute.
    const sunset = SunCalc.getTimes(new Date('2026-12-25T20:00:00'), homeLat, homeLon).sunset;
    const calendar = createCalendarRepository(db);
    calendar.add({
      name: 'Christmas', category: 'holiday',
      dateRule: { kind: 'fixed', month: sunset.getMonth() + 1, day: sunset.getDate() },
      recursYearly: true, enabled: true, groupId: sharedGroupId,
      triggerTime: { type: 'fixed', time: '17:00' },
      offTrigger: { type: 'sunset', offsetMinutes: 0 },
      actionType: 'theme', actionPayload: { themeId: 'xmas' }
    });

    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(sunset);
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: porchControllerId, wledSegId: 0 }],
      { type: 'power', on: false }
    );
  });

  it('suppresses an unrelated-group schedule\'s trigger the same day is unaffected, but a shared-group schedule is skipped', async () => {
    const calendar = createCalendarRepository(db);
    calendar.add({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: sharedGroupId,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Porch weekly (should be suppressed)', triggerType: 'weekly', cronExpr: null,
      daysOfWeek: [6], timeOfDay: '20:00', offsetMinutes: 0,
      latitude: null, longitude: null, groupId: sharedGroupId, actionType: 'power',
      actionPayload: { on: false }, enabled: true
    });
    schedules.add({
      name: 'Kitchen weekly (unaffected)', triggerType: 'weekly', cronExpr: null,
      daysOfWeek: [6], timeOfDay: '20:00', offsetMinutes: 0,
      latitude: null, longitude: null, groupId: unrelatedGroupId, actionType: 'power',
      actionPayload: { on: true }, enabled: true
    });

    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T20:00:00'));

    expect(applyFn).not.toHaveBeenCalledWith(
      [{ controllerId: porchControllerId, wledSegId: 0 }],
      { type: 'power', on: false }
    );
    expect(applyFn).toHaveBeenCalledWith(
      [{ controllerId: kitchenControllerId, wledSegId: 0 }],
      { type: 'power', on: true }
    );
  });

  it('a whole-controller calendar override suppresses a schedule targeting just one segment of that same controller', async () => {
    // The suppression check used to be a plain exact-string-key match
    // (controllerId:wledSegId), which would miss this: a whole-controller
    // target (wledSegId: null) doesn't share a literal key with a
    // segment-specific one, even though it covers that segment too.
    const calendar = createCalendarRepository(db);
    calendar.add({
      name: 'July 4th whole-controller', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null, controllers: [{ controllerId: porchControllerId, wledSegId: null }],
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'power', actionPayload: { on: true }
    });
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Porch segment 0 (should be suppressed)', triggerType: 'weekly', cronExpr: null,
      daysOfWeek: [6], timeOfDay: '20:00', offsetMinutes: 0,
      latitude: null, longitude: null, groupId: null, controllers: [{ controllerId: porchControllerId, wledSegId: 0 }],
      actionType: 'power', actionPayload: { on: false }, enabled: true
    });

    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T20:00:00'));

    expect(applyFn).not.toHaveBeenCalledWith(
      [{ controllerId: porchControllerId, wledSegId: 0 }],
      { type: 'power', on: false }
    );
  });

  it('a segment-specific calendar override suppresses a schedule targeting the whole controller', async () => {
    const calendar = createCalendarRepository(db);
    calendar.add({
      name: 'July 4th segment 0', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId: null, controllers: [{ controllerId: porchControllerId, wledSegId: 0 }],
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'power', actionPayload: { on: true }
    });
    const schedules = createScheduleRepository(db);
    schedules.add({
      name: 'Porch whole-controller (should be suppressed)', triggerType: 'weekly', cronExpr: null,
      daysOfWeek: [6], timeOfDay: '20:00', offsetMinutes: 0,
      latitude: null, longitude: null, groupId: null, controllers: [{ controllerId: porchControllerId, wledSegId: null }],
      actionType: 'power', actionPayload: { on: false }, enabled: true
    });

    const engine = new SchedulerEngine(db, applyFn);
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T20:00:00'));

    expect(applyFn).not.toHaveBeenCalledWith(
      [{ controllerId: porchControllerId, wledSegId: null }],
      { type: 'power', on: false }
    );
  });

  it('skips a calendar event whose dateRule cannot resolve for the current year instead of crashing', async () => {
    // Simulates a pre-existing bad record (e.g. inserted before creation-time
    // validation existed, or written directly to the DB) whose nthWeekday
    // rule requests an occurrence that doesn't exist this year. The engine
    // must not throw when resolveDate returns null — it should just treat
    // the event as not applicable today.
    const calendar = createCalendarRepository(db);
    calendar.add({
      name: 'Impossible 5th Monday of February', category: 'custom',
      dateRule: { kind: 'nthWeekday', month: 2, weekday: 1, n: 5 },
      recursYearly: true, enabled: true, groupId: sharedGroupId,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    const engine = new SchedulerEngine(db, applyFn);
    await expect(
      engine.checkAndFireDueSchedules(new Date('2026-02-23T18:00:00'))
    ).resolves.not.toThrow();

    expect(applyFn).not.toHaveBeenCalled();
  });
});
