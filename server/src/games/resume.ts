import type Database from 'better-sqlite3';
import SunCalc from 'suncalc';
import { createCalendarRepository, type CalendarEvent } from '../calendar/repository.js';
import { resolveDate } from '../calendar/dateRules.js';
import { payloadThemeId } from '../looks/applyTracking.js';
import { createScheduleRepository, type Schedule } from '../schedules/repository.js';
import { resolveEntityMembers } from '../schedules/targets.js';
import { createSettingsRepository } from '../settings/repository.js';

export type ResumeDecision =
  | { type: 'calendar'; eventId: string; themeId: string }
  | { type: 'schedule'; scheduleId: string; themeId: string }
  | { type: 'powerOff' };

function previousLocalDay(now: Date): Date {
  const day = new Date(now.getTime());
  day.setDate(day.getDate() - 1);
  return day;
}

function localDayMatches(dateRule: CalendarEvent['dateRule'], now: Date): boolean {
  const resolved = resolveDate(dateRule, now.getFullYear());
  return !!resolved && resolved.month === now.getMonth() + 1 && resolved.day === now.getDate();
}

function sunTimes(now: Date, lat: number, lon: number): { sunrise: Date; sunset: Date } {
  const times = SunCalc.getTimes(now, lat, lon);
  return { sunrise: times.sunrise, sunset: times.sunset };
}

function inSunsetSunriseWindow(event: CalendarEvent, now: Date, sunrise: Date, sunset: Date): boolean {
  if (localDayMatches(event.dateRule, now) && now.getTime() >= sunset.getTime()) return true;
  if (localDayMatches(event.dateRule, previousLocalDay(now)) && now.getTime() < sunrise.getTime()) return true;
  return false;
}

function isNight(now: Date, sunrise: Date, sunset: Date): boolean {
  return now.getTime() >= sunset.getTime() || now.getTime() < sunrise.getTime();
}

function targetsController(db: Database.Database, entity: CalendarEvent | Schedule, controllerId: string): boolean {
  return resolveEntityMembers(db, entity).some((m) => m.controllerId === controllerId);
}

/**
 * What to put on a controller after its game hold is cleared: an in-window
 * holiday theme, else the ambient night schedule, else power off.
 */
export function resolveResume(db: Database.Database, controllerId: string, now: Date): ResumeDecision {
  const settings = createSettingsRepository(db).get();
  const lat = settings.homeLatitude ?? 0;
  const lon = settings.homeLongitude ?? 0;
  const { sunrise, sunset } = sunTimes(now, lat, lon);

  for (const event of createCalendarRepository(db).list()) {
    if (!event.enabled || event.actionType !== 'theme') continue;
    const themeId = payloadThemeId(event.actionPayload);
    if (!themeId) continue;
    if (!inSunsetSunriseWindow(event, now, sunrise, sunset)) continue;
    if (!targetsController(db, event, controllerId)) continue;
    return { type: 'calendar', eventId: event.id, themeId };
  }

  if (isNight(now, sunrise, sunset)) {
    for (const schedule of createScheduleRepository(db).list()) {
      if (!schedule.enabled || schedule.actionType !== 'theme') continue;
      const themeId = payloadThemeId(schedule.actionPayload);
      if (!themeId) continue;
      if (!targetsController(db, schedule, controllerId)) continue;
      return { type: 'schedule', scheduleId: schedule.id, themeId };
    }
  }

  return { type: 'powerOff' };
}
