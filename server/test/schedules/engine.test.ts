import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { SchedulerEngine, nextTriggerDate } from '../../src/schedules/engine.js';

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

  beforeEach(() => {
    db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Front porch', host: '10.0.0.50', source: 'manual' }).id;
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
