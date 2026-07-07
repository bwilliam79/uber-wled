import type Database from 'better-sqlite3';
import SunCalc from 'suncalc';
import { createScheduleRepository, type Schedule } from './repository.js';
import { createCalendarRepository, type CalendarEvent } from '../calendar/repository.js';
import { resolveDate } from '../calendar/dateRules.js';
import { expandTargets, GroupNotFoundError, type ResolvedTarget, type Target } from '../control/applyV2.js';

/**
 * A schedule/calendar event targets exactly one of a Room group or a
 * specific controller (whole-device when wledSegId is null, one segment
 * when it's set) — same Target union /api/control/apply already uses.
 * null only if somehow neither is set (shouldn't happen; callers skip it).
 */
function targetOf(entity: {
  groupId: string | null;
  controllerId: string | null;
  wledSegId: number | null;
}): Target | null {
  if (entity.controllerId) {
    return entity.wledSegId === null
      ? { kind: 'controller', controllerId: entity.controllerId }
      : { kind: 'segment', controllerId: entity.controllerId, wledSegId: entity.wledSegId };
  }
  if (entity.groupId) return { kind: 'group', groupId: entity.groupId };
  return null;
}

/** expandTargets throws GroupNotFoundError for a deleted group; treat that
 *  the same as "target no longer resolves to anything", same as the old
 *  code's `if (!group) continue`. */
function resolveMembers(db: Database.Database, entity: Parameters<typeof targetOf>[0]): ResolvedTarget[] {
  const target = targetOf(entity);
  if (!target) return [];
  try {
    return expandTargets(db, [target]);
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

function triggerTimeDue(triggerTime: CalendarEvent['triggerTime'], now: Date): boolean {
  if (triggerTime.type === 'fixed') {
    const [hh, mm] = triggerTime.time.split(':').map(Number);
    return now.getHours() === hh && now.getMinutes() === mm;
  }
  // NOTE: per the scheduling spec, CalendarEvent's sunset/sunrise triggerTime
  // carries only `offsetMinutes` — no lat/lon of its own (unlike `Schedule`,
  // which stores its own latitude/longitude per row). This mirrors the same
  // `?? 0` fallback `nextTriggerDate` already uses for a `Schedule` with no
  // configured location, and is a known pre-existing limitation of the
  // approved spec's data model rather than something introduced here — see
  // the Post-plan notes for the suggested follow-up (a single server-wide
  // home location setting shared by both `Schedule` and `CalendarEvent`).
  const times = SunCalc.getTimes(now, 0, 0);
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

    const todaysEvents = calendar.list().filter((e) => e.enabled && todayMatches(e.dateRule, now));

    // Fire each matching calendar event's own action, once per minute.
    for (const event of todaysEvents) {
      if (!event.actionType) continue;
      if (!triggerTimeDue(event.triggerTime, now)) continue;

      const key = `calendar:${event.id}`;
      const alreadyFired = this.lastFired.get(key);
      if (alreadyFired && sameMinute(alreadyFired, now)) continue;

      const members = resolveMembers(this.db, event);
      if (members.length === 0) continue;

      // Claim this key for the current minute BEFORE awaiting applyFn, so a
      // concurrent/overlapping invocation sees the up-to-date claim
      // immediately instead of the stale pre-await value and does not fire
      // the same event twice for the same minute.
      this.lastFired.set(key, now);
      await this.applyFn(members, { type: event.actionType, ...(event.actionPayload as object) });
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
