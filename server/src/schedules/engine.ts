import type Database from 'better-sqlite3';
import SunCalc from 'suncalc';
import { createScheduleRepository, type Schedule } from './repository.js';
import { createGroupRepository } from '../groups/repository.js';
import { createCalendarRepository, type CalendarEvent } from '../calendar/repository.js';
import { resolveDate } from '../calendar/dateRules.js';

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
  members: { controllerId: string; wledSegId: number }[],
  action: { type: string; [key: string]: unknown }
) => Promise<unknown>;

export class SchedulerEngine {
  private lastFired = new Map<string, Date>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private db: Database.Database, private applyFn: ApplyFn) {}

  async checkAndFireDueSchedules(now: Date): Promise<void> {
    const schedules = createScheduleRepository(this.db);
    const groups = createGroupRepository(this.db);
    const calendar = createCalendarRepository(this.db);

    const todaysEvents = calendar.list().filter((e) => e.enabled && todayMatches(e.dateRule, now));

    // Fire each matching calendar event's own action, once per minute.
    for (const event of todaysEvents) {
      if (!event.groupId || !event.actionType) continue;
      if (!triggerTimeDue(event.triggerTime, now)) continue;

      const alreadyFired = this.lastFired.get(`calendar:${event.id}`);
      if (alreadyFired && sameMinute(alreadyFired, now)) continue;

      const group = groups.list().find((g) => g.id === event.groupId);
      if (!group) continue;

      await this.applyFn(group.members, { type: event.actionType, ...(event.actionPayload as object) });
      this.lastFired.set(`calendar:${event.id}`, now);
    }

    // Suppressed member set: every member of every group targeted by an
    // enabled calendar event whose resolved date is today.
    const suppressedMemberKeys = new Set<string>();
    for (const event of todaysEvents) {
      if (!event.groupId) continue;
      const group = groups.list().find((g) => g.id === event.groupId);
      if (!group) continue;
      for (const m of group.members) {
        suppressedMemberKeys.add(`${m.controllerId}:${m.wledSegId}`);
      }
    }

    for (const schedule of schedules.list()) {
      if (!schedule.enabled) continue;
      const due = nextTriggerDate(schedule, now);
      if (!sameMinute(due, now)) continue;

      const alreadyFired = this.lastFired.get(schedule.id);
      if (alreadyFired && sameMinute(alreadyFired, now)) continue;

      const group = groups.list().find((g) => g.id === schedule.groupId);
      if (!group) continue;

      const overlapsSuppressed = group.members.some((m) =>
        suppressedMemberKeys.has(`${m.controllerId}:${m.wledSegId}`)
      );
      if (overlapsSuppressed) {
        this.lastFired.set(schedule.id, now); // treat as handled for this minute, don't re-check every tick
        continue;
      }

      await this.applyFn(group.members, { type: schedule.actionType, ...(schedule.actionPayload as object) });
      this.lastFired.set(schedule.id, now);
    }
  }

  start(): void {
    this.timer = setInterval(() => this.checkAndFireDueSchedules(new Date()), 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
