import type Database from 'better-sqlite3';
import SunCalc from 'suncalc';
import { createScheduleRepository, type Schedule, type ScheduleControllerTarget } from './repository.js';
import { createCalendarRepository, type CalendarEvent, type TriggerTime } from '../calendar/repository.js';
import { createSettingsRepository } from '../settings/repository.js';
import { resolveDate } from '../calendar/dateRules.js';
import { expandTargets, GroupNotFoundError, type ResolvedTarget, type Target } from '../control/applyV2.js';

/**
 * A schedule/calendar event targets exactly one of a Room group or a list
 * of specific controllers directly (whole-device per entry when its
 * wledSegId is null, one segment when it's set) — same Target union
 * /api/control/apply already uses, just possibly more than one. Empty only
 * if somehow neither is set (shouldn't happen; callers skip it).
 */
function targetsOf(entity: {
  groupId: string | null;
  controllers: ScheduleControllerTarget[] | null;
}): Target[] {
  if (entity.controllers && entity.controllers.length > 0) {
    return entity.controllers.map((c) =>
      c.wledSegId === null
        ? { kind: 'controller', controllerId: c.controllerId }
        : { kind: 'segment', controllerId: c.controllerId, wledSegId: c.wledSegId }
    );
  }
  if (entity.groupId) return [{ kind: 'group', groupId: entity.groupId }];
  return [];
}

/** expandTargets throws GroupNotFoundError for a deleted group; treat that
 *  the same as "target no longer resolves to anything", same as the old
 *  code's `if (!group) continue`. */
function resolveMembers(db: Database.Database, entity: Parameters<typeof targetsOf>[0]): ResolvedTarget[] {
  const targets = targetsOf(entity);
  if (targets.length === 0) return [];
  try {
    return expandTargets(db, targets);
  } catch (err) {
    if (err instanceof GroupNotFoundError) return [];
    throw err;
  }
}

export function nextTriggerDate(schedule: Schedule, now: Date): Date {
  if (schedule.triggerType === 'cron') {
    // Compute the next matching minute by scanning forward — node-cron has no
    // built-in "next date" API, so we roll our own minimal minute-matcher.
    const [minute, hour, dom, month, dow] = (schedule.cronExpr ?? '* * * * *').split(' ');
    const matches = (field: string, value: number) => field === '*' || field.split(',').map(Number).includes(value);
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    for (let i = 0; i < 24 * 60; i++) {
      if (
        matches(minute, candidate.getMinutes()) &&
        matches(hour, candidate.getHours()) &&
        matches(dom, candidate.getDate()) &&
        matches(month, candidate.getMonth() + 1) &&
        matches(dow, candidate.getDay())
      ) {
        return candidate;
      }
      candidate.setMinutes(candidate.getMinutes() + 1);
    }
    return candidate;
  }

  if (schedule.triggerType === 'weekly') {
    const days = schedule.daysOfWeek ?? [];
    const [hh, mm] = (schedule.timeOfDay ?? '00:00').split(':').map(Number);
    const candidate = new Date(now);
    candidate.setHours(hh, mm, 0, 0);
    for (let i = 0; i < 8; i++) {
      if (days.includes(candidate.getDay()) && candidate.getTime() >= now.getTime() - 59_000) {
        return candidate;
      }
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(hh, mm, 0, 0);
    }
    return candidate;
  }

  const times = SunCalc.getTimes(now, schedule.latitude ?? 0, schedule.longitude ?? 0);
  const base = schedule.triggerType === 'sunrise' ? times.sunrise : times.sunset;
  return new Date(base.getTime() + schedule.offsetMinutes * 60_000);
}

function sameMinute(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

function todayMatches(dateRule: CalendarEvent['dateRule'], now: Date): boolean {
  const resolved = resolveDate(dateRule, now.getFullYear());
  return !!resolved && resolved.month === now.getMonth() + 1 && resolved.day === now.getDate();
}

function triggerTimeDue(triggerTime: TriggerTime, now: Date, lat: number, lon: number): boolean {
  if (triggerTime.type === 'fixed') {
    const [hh, mm] = triggerTime.time.split(':').map(Number);
    return now.getHours() === hh && now.getMinutes() === mm;
  }
  // Sunrise/sunset is computed at the server-wide home location (Settings).
  // Without a configured location this falls back to 0,0 — the sun times
  // there are meaningless, so a sunrise/sunset calendar trigger only works
  // once the home lat/lon is set, same as the Schedule sunrise/sunset path.
  const times = SunCalc.getTimes(now, lat, lon);
  const base = triggerTime.type === 'sunrise' ? times.sunrise : times.sunset;
  const due = new Date(base.getTime() + triggerTime.offsetMinutes * 60_000);
  return sameMinute(due, now);
}

type ApplyFn = (
  members: ResolvedTarget[],
  action: { type: string; [key: string]: unknown }
) => Promise<unknown>;

export class SchedulerEngine {
  private lastFired = new Map<string, Date>();
  private timer: ReturnType<typeof setInterval> | undefined;
  // Tail of a serial queue of checkAndFireDueSchedules() calls. Each new
  // invocation chains onto whatever is currently in flight so that no two
  // invocations ever execute their read-await-write sequence concurrently.
  // This matters because start()'s setInterval callback does not await the
  // returned promise, so a slow applyFn (e.g. an offline WLED controller
  // that times out on every retry) could otherwise cause the next tick to
  // start before the previous one finishes updating lastFired.
  private queue: Promise<void> = Promise.resolve();

  constructor(private db: Database.Database, private applyFn: ApplyFn) {}

  checkAndFireDueSchedules(now: Date): Promise<void> {
    const run = this.queue.catch(() => {}).then(() => this.runCheckAndFireDueSchedules(now));
    this.queue = run.catch(() => {});
    return run;
  }

  private async runCheckAndFireDueSchedules(now: Date): Promise<void> {
    const schedules = createScheduleRepository(this.db);
    const calendar = createCalendarRepository(this.db);

    const settings = createSettingsRepository(this.db).get();
    const lat = settings.homeLatitude ?? 0;
    const lon = settings.homeLongitude ?? 0;

    const todaysEvents = calendar.list().filter((e) => e.enabled && todayMatches(e.dateRule, now));

    // Fire each matching calendar event's own action, once per minute. An
    // event with an offTrigger also fires a power-off at that time — the two
    // are deduped under separate keys so on and off never suppress each other.
    for (const event of todaysEvents) {
      const members = resolveMembers(this.db, event);
      if (members.length === 0) continue;

      // ON: the event's configured action (usually applying a theme).
      if (event.actionType && triggerTimeDue(event.triggerTime, now, lat, lon)) {
        const key = `calendar:${event.id}`;
        const alreadyFired = this.lastFired.get(key);
        if (!alreadyFired || !sameMinute(alreadyFired, now)) {
          // Claim the key BEFORE awaiting applyFn so a concurrent/overlapping
          // invocation sees the claim immediately and doesn't double-fire.
          this.lastFired.set(key, now);
          await this.applyFn(members, { type: event.actionType, ...(event.actionPayload as object) });
        }
      }

      // OFF: optional power-off at an independent trigger time.
      if (event.offTrigger && triggerTimeDue(event.offTrigger, now, lat, lon)) {
        const key = `calendar:${event.id}:off`;
        const alreadyFired = this.lastFired.get(key);
        if (!alreadyFired || !sameMinute(alreadyFired, now)) {
          this.lastFired.set(key, now);
          await this.applyFn(members, { type: 'power', on: false });
        }
      }
    }

    // Suppression map: for every enabled today-resolved calendar event's
    // target, every controller it touches -> the set of segments suppressed
    // for it, or 'ALL' for a whole-controller target. A whole-controller
    // entry (either side) overlaps every segment of that controller, so the
    // overlap check below treats 'ALL' as matching any concrete segment id
    // and vice versa — a plain exact-key match would miss that.
    const suppressedByController = new Map<string, Set<number | 'ALL'>>();
    for (const event of todaysEvents) {
      for (const m of resolveMembers(this.db, event)) {
        const segs = suppressedByController.get(m.controllerId) ?? new Set();
        segs.add(m.wledSegId === null ? 'ALL' : m.wledSegId);
        suppressedByController.set(m.controllerId, segs);
      }
    }

    for (const schedule of schedules.list()) {
      if (!schedule.enabled) continue;
      const due = nextTriggerDate(schedule, now);
      if (!sameMinute(due, now)) continue;

      const alreadyFired = this.lastFired.get(schedule.id);
      if (alreadyFired && sameMinute(alreadyFired, now)) continue;

      const members = resolveMembers(this.db, schedule);
      if (members.length === 0) continue;

      const overlapsSuppressed = members.some((m) => {
        const segs = suppressedByController.get(m.controllerId);
        if (!segs) return false;
        return m.wledSegId === null ? segs.size > 0 : segs.has('ALL') || segs.has(m.wledSegId);
      });
      if (overlapsSuppressed) {
        this.lastFired.set(schedule.id, now); // treat as handled for this minute, don't re-check every tick
        continue;
      }

      // Claim before awaiting (see comment above) so an overlapping
      // invocation cannot also fire this schedule for the same minute.
      this.lastFired.set(schedule.id, now);
      await this.applyFn(members, { type: schedule.actionType, ...(schedule.actionPayload as object) });
    }
  }

  start(): void {
    this.timer = setInterval(() => {
      this.checkAndFireDueSchedules(new Date()).catch((err) => {
        console.error('SchedulerEngine tick failed:', err);
      });
    }, 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
