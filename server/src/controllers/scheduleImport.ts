import type Database from 'better-sqlite3';
import { createControllerRepository } from './repository.js';
import { createGroupRepository } from '../groups/repository.js';
import { createScheduleRepository, type Schedule } from '../schedules/repository.js';
import { createSettingsRepository } from '../settings/repository.js';
import { getConfig, getInfo, patchConfig, getPresets } from '../wled/client.js';

/**
 * Real WLED devices (verified against 16.0.0 firmware) do NOT store
 * scheduled/time-triggered presets on the preset objects themselves
 * (`/presets.json`). They store them in `cfg.json`'s `timers.ins[]` array,
 * keyed by array index, with a `macro` field pointing at the preset id to
 * apply when the timer fires. A captured sample entry looks like:
 *
 *   { en: 0, hour: 255, min: 0, macro: 0, dow: 127,
 *     start: { mon: 1, day: 1 }, end: { mon: 12, day: 31 } }
 *
 * `timers.cntdwn` is a separate, single one-shot countdown timer with a
 * different shape — it is not part of `ins[]` and is intentionally not
 * modeled here (see importSchedules below).
 */
export interface RawWledTimerEntry {
  index: number;
  raw: unknown;
}

export interface ParsedWledTimer {
  macro: number;
  triggerType: 'weekly' | 'sunrise' | 'sunset';
  daysOfWeek: number[] | null;
  timeOfDay: string | null;
  offsetMinutes: number;
  /** Extra text to append to the imported schedule's name, or '' if none. */
  nameNote: string;
}

// Bit 0 = Sunday .. bit 6 = Saturday. This matches this app's own day-index
// convention (see WeeklyScheduleForm.tsx's DAY_LABELS, index 0 = 'Sun'), so
// no remapping is needed between WLED's dow bitmask and Schedule.daysOfWeek.
function bitmaskToDaysOfWeek(dow: number): number[] {
  const days: number[] = [];
  for (let bit = 0; bit < 7; bit++) {
    if (dow & (1 << bit)) days.push(bit);
  }
  return days;
}

interface WledDateBound {
  mon?: number;
  day?: number;
}

function isFullYear(start: unknown, end: unknown): boolean {
  const s = start as WledDateBound | undefined;
  const e = end as WledDateBound | undefined;
  return s?.mon === 1 && s?.day === 1 && e?.mon === 12 && e?.day === 31;
}

/**
 * This app's schedule model has no equivalent of WLED's per-timer
 * start/end date-range restriction, so a date-limited timer is imported as
 * year-round. Note the loss of information in the schedule's name so the
 * user isn't silently misled about scope.
 */
function dateRangeNote(start: unknown, end: unknown): string {
  if (isFullYear(start, end)) return '';
  const s = start as WledDateBound | undefined;
  const e = end as WledDateBound | undefined;
  if (!s || !e || s.mon == null || s.day == null || e.mon == null || e.day == null) return '';
  return ` (date-limited on device: ${s.mon}/${s.day}–${e.mon}/${e.day} — imported as year-round)`;
}

export function parseTimerEntry(
  entry: RawWledTimerEntry,
  presetName: (macro: number) => string
): { ok: true; parsed: ParsedWledTimer } | { ok: false; reason: string } {
  const raw = entry.raw;
  const label = `timer ${entry.index}`;

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: `${label}: no schedule data present` };
  }
  const r = raw as Record<string, unknown>;

  if (
    typeof r.en !== 'number' ||
    typeof r.hour !== 'number' ||
    typeof r.min !== 'number' ||
    typeof r.dow !== 'number' ||
    typeof r.macro !== 'number'
  ) {
    return { ok: false, reason: `${label}: unrecognized schedule shape` };
  }

  const named = `${label} (${presetName(r.macro)})`;

  if (!r.en) {
    return { ok: false, reason: `${named}: schedule is disabled on the device` };
  }

  // hour is 0-23 for a real clock time, or the sentinels 255 (sunrise) /
  // 254 (sunset) for astronomical triggers — these are valid, not "out of
  // range".
  const isSunrise = r.hour === 255;
  const isSunset = r.hour === 254;
  if (!isSunrise && !isSunset && (r.hour < 0 || r.hour > 23)) {
    return { ok: false, reason: `${named}: hour out of range` };
  }
  if (r.min < 0 || r.min > 59) {
    return { ok: false, reason: `${named}: min out of range` };
  }

  const daysOfWeek = bitmaskToDaysOfWeek(r.dow);
  if (daysOfWeek.length === 0) {
    return { ok: false, reason: `${named}: no days of week set` };
  }

  const rangeNote = dateRangeNote(r.start, r.end);

  if (isSunrise || isSunset) {
    // dow=127 (all 7 bits) means "every day". This app's sunrise/sunset
    // schedule type has no day-of-week restriction (engine.ts's
    // nextTriggerDate fires astronomical triggers every day), so a
    // device-side restriction to specific days can't be represented — import
    // it anyway (best-effort) but note the loss in the name.
    const restrictedNote =
      r.dow !== 127 ? ' (device restricted this to specific days — imported as every day)' : '';
    return {
      ok: true,
      parsed: {
        macro: r.macro,
        triggerType: isSunrise ? 'sunrise' : 'sunset',
        daysOfWeek: null,
        timeOfDay: null,
        // ASSUMPTION: WLED's astronomical-timer `min` field is a plain
        // 0-59 offset in minutes *after* the sunrise/sunset event. Nothing
        // in the observed firmware behavior/settings UI indicates a signed
        // encoding for "minutes before" the event, so a negative offset
        // is not representable here; this takes the straightforward
        // non-negative interpretation.
        offsetMinutes: r.min,
        nameNote: `${rangeNote}${restrictedNote}`
      }
    };
  }

  const timeOfDay = `${String(r.hour).padStart(2, '0')}:${String(r.min).padStart(2, '0')}`;
  return {
    ok: true,
    parsed: {
      macro: r.macro,
      triggerType: 'weekly',
      daysOfWeek,
      timeOfDay,
      offsetMinutes: 0,
      nameNote: rangeNote
    }
  };
}

async function fetchTimers(host: string): Promise<{ ins: unknown[]; cntdwn: unknown }> {
  const cfg = await getConfig(host);
  const timers = (cfg as Record<string, unknown>).timers as Record<string, unknown> | undefined;
  return {
    ins: Array.isArray(timers?.ins) ? (timers!.ins as unknown[]) : [],
    cntdwn: timers?.cntdwn
  };
}

/**
 * Disables a single already-imported timer on the device by index (NOT by
 * preset/macro id — a macro id could in principle appear on more than one
 * timer slot). Fetches the current cfg, flips just `timers.ins[timerIndex].en`
 * to 0, and PATCHes back only the `timers.ins` array so unrelated cfg
 * sections (wifi, hardware, etc.) are left untouched.
 */
async function clearScheduleOnDevice(host: string, timerIndex: number): Promise<void> {
  const cfg = await getConfig(host);
  const timers = (cfg as Record<string, unknown>).timers as Record<string, unknown> | undefined;
  const ins = Array.isArray(timers?.ins) ? [...(timers!.ins as unknown[])] : [];
  const current = ins[timerIndex];
  if (typeof current !== 'object' || current === null) return;

  ins[timerIndex] = { ...(current as Record<string, unknown>), en: 0 };
  await patchConfig(host, { timers: { ins } });
}

export async function importSchedules(
  db: Database.Database,
  controllerId: string,
  opts: { disableOnDevice: boolean }
): Promise<{ imported: Schedule[]; skipped: { raw: unknown; reason: string }[] }> {
  const controllers = createControllerRepository(db);
  const groups = createGroupRepository(db);
  const schedules = createScheduleRepository(db);
  const settings = createSettingsRepository(db);

  const controller = controllers.list().find((c) => c.id === controllerId);
  if (!controller) {
    const notFound = new Error(`controller ${controllerId} not found`);
    (notFound as any).statusCode = 404;
    throw notFound;
  }

  let timers: { ins: unknown[]; cntdwn: unknown };
  let presets: { id: number; name: string }[];
  let liveName: string;
  try {
    [timers, presets, liveName] = await Promise.all([
      fetchTimers(controller.host),
      getPresets(controller.host),
      // controller.name is frozen at add/mDNS-discovery time — the group
      // this creates should use the live "Server Description" the user
      // actually sees everywhere else in the app, not that stale name.
      getInfo(controller.host).then((info) => info.name)
    ]);
  } catch (err: any) {
    const unreachable = new Error(`controller ${controller.name} is unreachable: ${err.message}`);
    (unreachable as any).statusCode = 503;
    throw unreachable;
  }

  const presetNameById = new Map(presets.map((p) => [p.id, p.name]));
  const presetName = (macro: number) => presetNameById.get(macro) ?? `Preset ${macro}`;

  const imported: Schedule[] = [];
  const skipped: { raw: unknown; reason: string }[] = [];
  const importedTimerIndexes: number[] = [];

  // cntdwn is a single one-shot countdown timer, structurally different from
  // the repeating weekly/sunrise/sunset schedules this app models — always
  // skip it, explicitly, rather than silently ignoring it.
  if (timers.cntdwn !== undefined) {
    skipped.push({
      raw: timers.cntdwn,
      reason: "countdown timer: countdown timers aren't supported by this app's schedule model"
    });
  }

  // Distinct from the controller's own live name, on purpose — the Home
  // page shows Rooms and controllers as separate tiles, and giving this
  // group the exact same name as its one member reads as an unexplained
  // duplicate.
  const groupName = `${liveName} schedule`;
  let group = groups.list().find((g) => g.name === groupName);
  const homeSettings = settings.get();

  for (let index = 0; index < timers.ins.length; index++) {
    const entry: RawWledTimerEntry = { index, raw: timers.ins[index] };
    const result = parseTimerEntry(entry, presetName);
    if (!result.ok) {
      skipped.push({ raw: entry.raw, reason: result.reason });
      continue;
    }

    if (!group) {
      group = groups.add({ name: groupName, members: [{ controllerId, wledSegId: 0 }] });
    }

    const isAstronomical = result.parsed.triggerType !== 'weekly';
    const schedule = schedules.add({
      name: `${presetName(result.parsed.macro)}${result.parsed.nameNote}`,
      triggerType: result.parsed.triggerType,
      cronExpr: null,
      daysOfWeek: result.parsed.daysOfWeek,
      timeOfDay: result.parsed.timeOfDay,
      offsetMinutes: result.parsed.offsetMinutes,
      latitude: isAstronomical ? homeSettings.homeLatitude : null,
      longitude: isAstronomical ? homeSettings.homeLongitude : null,
      groupId: group.id,
      controllers: null,
      actionType: 'preset',
      actionPayload: { presetId: result.parsed.macro },
      enabled: true
    });
    imported.push(schedule);
    importedTimerIndexes.push(index);
  }

  if (opts.disableOnDevice) {
    for (const timerIndex of importedTimerIndexes) {
      await clearScheduleOnDevice(controller.host, timerIndex);
    }
  }

  return { imported, skipped };
}
