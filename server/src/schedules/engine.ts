import type Database from 'better-sqlite3';
import SunCalc from 'suncalc';
import { createScheduleRepository, type Schedule } from './repository.js';
import { resolveEntityMembers } from './targets.js';
import { createCalendarRepository, type CalendarEvent, type TriggerTime } from '../calendar/repository.js';
import { createSettingsRepository } from '../settings/repository.js';
import { resolveDate } from '../calendar/dateRules.js';
import type { ResolvedTarget } from '../control/applyV2.js';
import { processGameTriggers } from '../games/tick.js';
import { isControllerIdle, isLiveManualOrGameHold } from '../looks/idle.js';
import { payloadThemeId, trackCalendarThemeOn, trackClear, trackScheduleThemeOn } from '../looks/applyTracking.js';

export { resolveEntityMembers } from './targets.js';
export { resolveResume } from '../games/resume.js';

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

function previousLocalDay(now: Date): Date {
  const day = new Date(now.getTime());
  day.setDate(day.getDate() - 1);
  return day;
}

// Approximate minute-of-day for "does this OFF belong to the previous local
// day?". Real sunrise/sunset math (nextTriggerDate / triggerTimeDue) is
// unchanged — these constants only order an OFF against its ON.
const SUNRISE_MINUTE = 6 * 60;
const SUNSET_MINUTE = 18 * 60;

function fixedMinute(time: string): number | null {
  const [hh, mm] = time.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function firstNumber(field: string | undefined): number | null {
  if (!field || field === '*') return null;
  const match = field.match(/\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function cronMinuteOfDay(expr: string | null): number | null {
  if (!expr) return null;
  const [minuteField, hourField] = expr.trim().split(/\s+/);
  const minute = firstNumber(minuteField);
  const hour = firstNumber(hourField);
  if (minute === null || hour === null) return null;
  return hour * 60 + minute;
}

function scheduleOnMinute(schedule: Schedule): number | null {
  switch (schedule.triggerType) {
    case 'sunrise':
      return SUNRISE_MINUTE + schedule.offsetMinutes;
    case 'sunset':
      return SUNSET_MINUTE + schedule.offsetMinutes;
    case 'weekly':
      return schedule.timeOfDay ? fixedMinute(schedule.timeOfDay) : null;
    case 'cron':
      return cronMinuteOfDay(schedule.cronExpr);
    default:
      return null;
  }
}

function triggerMinute(trigger: TriggerTime): number | null {
  if (trigger.type === 'fixed') return fixedMinute(trigger.time);
  const base = trigger.type === 'sunrise' ? SUNRISE_MINUTE : SUNSET_MINUTE;
  return base + trigger.offsetMinutes;
}

/** OFF earlier in the approximate day than ON belongs to the previous local day. */
function isOvernightOff(onMinute: number | null, offMinute: number | null): boolean {
  if (onMinute === null || offMinute === null) return false;
  return offMinute < onMinute;
}

function holdsFor(db: Database.Database, events: CalendarEvent[]): Map<string, Set<number | 'ALL'>> {
  const map = new Map<string, Set<number | 'ALL'>>();
  for (const event of events) {
    for (const member of resolveEntityMembers(db, event)) {
      const segs = map.get(member.controllerId) ?? new Set<number | 'ALL'>();
      segs.add(member.wledSegId === null ? 'ALL' : member.wledSegId);
      map.set(member.controllerId, segs);
    }
  }
  return map;
}

/** A whole-controller hold (or any held segment) blocks a whole-controller
 *  member; a segment member is blocked by 'ALL' or that same segment. */
function memberHeld(holds: Map<string, Set<number | 'ALL'>>, member: ResolvedTarget): boolean {
  const segs = holds.get(member.controllerId);
  if (!segs || segs.size === 0) return false;
  if (member.wledSegId === null) return true;
  return segs.has('ALL') || segs.has(member.wledSegId);
}

function actionableMembers(
  db: Database.Database,
  members: ResolvedTarget[],
  holds: Map<string, Set<number | 'ALL'>>,
  scheduleThemeId: string | null,
  now: Date
): ResolvedTarget[] {
  return members.filter(
    (member) => !memberHeld(holds, member) && isControllerIdle(db, member.controllerId, scheduleThemeId, now)
  );
}

/** Whether a schedule's day filter includes today (no filter = every day).
 *  Used to gate the paired OFF trigger to the same days the schedule runs. */
function scheduleActiveToday(schedule: Schedule, now: Date): boolean {
  const days = schedule.daysOfWeek;
  if (!days || days.length === 0) return true;
  return days.includes(now.getDay());
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

  private claimed(key: string, now: Date): boolean {
    const fired = this.lastFired.get(key);
    return !!fired && sameMinute(fired, now);
  }

  private async runCheckAndFireDueSchedules(now: Date): Promise<void> {
    const schedules = createScheduleRepository(this.db);
    const calendar = createCalendarRepository(this.db);

    const settings = createSettingsRepository(this.db).get();
    const lat = settings.homeLatitude ?? 0;
    const lon = settings.homeLongitude ?? 0;

    const enabledEvents = calendar.list().filter((e) => e.enabled);
    const yesterday = previousLocalDay(now);
    const todaysEvents = enabledEvents.filter((e) => todayMatches(e.dateRule, now));
    const yesterdaysEvents = enabledEvents.filter((e) => todayMatches(e.dateRule, yesterday));

    // Fire each matching calendar event's own action, once per minute. An
    // event with an offTrigger also fires a power-off at that time — the two
    // are deduped under separate keys so on and off never suppress each other.
    // An overnight OFF (sunrise after a sunset ON) belongs to the previous
    // local day: July 4's sunrise-off runs on the morning of July 5.
    for (const event of todaysEvents) {
      if (!event.actionType) continue;
      const members = resolveEntityMembers(this.db, event);
      if (members.length === 0) continue;
      if (!triggerTimeDue(event.triggerTime, now, lat, lon)) continue;
      const key = `calendar:${event.id}`;
      if (this.claimed(key, now)) continue;
      // Claim the key BEFORE awaiting applyFn so a concurrent/overlapping
      // invocation sees the claim immediately and doesn't double-fire.
      this.lastFired.set(key, now);
      // manual > game > calendar: skip members a live manual or game look holds.
      const actionable = members.filter((m) => !isLiveManualOrGameHold(this.db, m.controllerId));
      if (actionable.length > 0) {
        const result = await this.applyFn(actionable, { type: event.actionType, ...(event.actionPayload as object) });
        if (event.actionType === 'theme') {
          const themeId = payloadThemeId(event.actionPayload);
          if (themeId) trackCalendarThemeOn(this.db, actionable, result, event.id, themeId, now);
        }
      }
    }

    for (const event of enabledEvents) {
      if (!event.offTrigger) continue;
      const overnight = isOvernightOff(triggerMinute(event.triggerTime), triggerMinute(event.offTrigger));
      const matches = overnight ? todayMatches(event.dateRule, yesterday) : todayMatches(event.dateRule, now);
      if (!matches) continue;
      const members = resolveEntityMembers(this.db, event);
      if (members.length === 0) continue;
      if (!triggerTimeDue(event.offTrigger, now, lat, lon)) continue;
      const key = `calendar:${event.id}:off`;
      if (this.claimed(key, now)) continue;
      this.lastFired.set(key, now);
      // A holiday's own OFF never turns off a live manual or game hold.
      const offTargets = members.filter((m) => !isLiveManualOrGameHold(this.db, m.controllerId));
      if (offTargets.length === 0) continue;
      const result = await this.applyFn(offTargets, { type: 'power', on: false });
      trackClear(this.db, offTargets, result);
    }

    // Game-day holds sit between calendar and schedules: a live game keeps
    // Dim White off the controller; a holiday does not overwrite a game.
    if (settings.gameDayEnabled) {
      await processGameTriggers(this.db, now, this.applyFn);
    }

    // Date-based holds, per controller. Action-less events count: they exist
    // to keep ambient schedules off a controller for the day. A whole-controller
    // hold overlaps every segment of that controller and vice versa. ON looks
    // at today's events only; an overnight OFF also keeps yesterday's holds so
    // a holiday from the night before is not switched off at sunrise.
    const todayHolds = holdsFor(this.db, todaysEvents);
    const overnightHolds = holdsFor(this.db, [...todaysEvents, ...yesterdaysEvents]);

    for (const schedule of schedules.list()) {
      if (!schedule.enabled) continue;
      const members = resolveEntityMembers(this.db, schedule);
      if (members.length === 0) continue;
      const themeId = schedule.actionType === 'theme' ? payloadThemeId(schedule.actionPayload) : null;

      // ON: the schedule's own action at its trigger time. Idle, un-held
      // members still run when a sibling controller is holding a game or
      // holiday look — the schedule is not all-or-nothing.
      if (sameMinute(nextTriggerDate(schedule, now), now)) {
        if (!this.claimed(schedule.id, now)) {
          // Claim before awaiting so an overlapping tick can't double-fire.
          // Still claim when every member is skipped, so we don't re-apply
          // on the next tick of this same minute.
          this.lastFired.set(schedule.id, now);
          const actionable = actionableMembers(this.db, members, todayHolds, themeId, now);
          if (actionable.length > 0) {
            const result = await this.applyFn(actionable, {
              type: schedule.actionType,
              ...(schedule.actionPayload as object)
            });
            if (schedule.actionType === 'theme' && themeId) {
              trackScheduleThemeOn(this.db, actionable, result, schedule.id, themeId, now);
            }
          }
        }
      }

      // OFF: optional paired power-off. An overnight OFF (sunrise after sunset)
      // uses yesterday for the day-of-week filter and for calendar holds.
      if (schedule.offTrigger) {
        const overnight = isOvernightOff(scheduleOnMinute(schedule), triggerMinute(schedule.offTrigger));
        const activeDay = overnight ? yesterday : now;
        if (scheduleActiveToday(schedule, activeDay) && triggerTimeDue(schedule.offTrigger, now, lat, lon)) {
          const key = `${schedule.id}:off`;
          if (!this.claimed(key, now)) {
            this.lastFired.set(key, now);
            const holds = overnight ? overnightHolds : todayHolds;
            const actionable = actionableMembers(this.db, members, holds, themeId, now);
            if (actionable.length > 0) {
              const result = await this.applyFn(actionable, { type: 'power', on: false });
              trackClear(this.db, actionable, result);
            }
          }
        }
      }
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
