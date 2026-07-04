import type Database from 'better-sqlite3';
import SunCalc from 'suncalc';
import { createScheduleRepository, type Schedule } from './repository.js';
import { createGroupRepository } from '../groups/repository.js';

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

    for (const schedule of schedules.list()) {
      if (!schedule.enabled) continue;
      const due = nextTriggerDate(schedule, now);
      if (!sameMinute(due, now)) continue;

      const alreadyFired = this.lastFired.get(schedule.id);
      if (alreadyFired && sameMinute(alreadyFired, now)) continue;

      const group = groups.list().find((g) => g.id === schedule.groupId);
      if (!group) continue;

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
