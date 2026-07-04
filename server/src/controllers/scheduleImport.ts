import type Database from 'better-sqlite3';
import { createControllerRepository } from './repository.js';
import { createGroupRepository } from '../groups/repository.js';
import { createScheduleRepository, type Schedule } from '../schedules/repository.js';

export interface RawWledPresetSchedule {
  presetId: number;
  presetName: string;
  raw: unknown;
}

export interface ParsedWledSchedule {
  presetId: number;
  daysOfWeek: number[];
  timeOfDay: string;
}

function bitmaskToDaysOfWeek(dow: number): number[] {
  const days: number[] = [];
  for (let bit = 0; bit < 7; bit++) {
    if (dow & (1 << bit)) days.push(bit);
  }
  return days;
}

export function parsePresetSchedule(
  entry: RawWledPresetSchedule
): { ok: true; parsed: ParsedWledSchedule } | { ok: false; reason: string } {
  const raw = entry.raw;
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): no schedule data present` };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.en !== 'boolean' || typeof r.hour !== 'number' || typeof r.min !== 'number' || typeof r.dow !== 'number') {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): unrecognized schedule shape` };
  }
  if (!r.en) {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): schedule is disabled on the device` };
  }
  if (r.hour < 0 || r.hour > 23 || r.min < 0 || r.min > 59) {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): hour/min out of range` };
  }
  const daysOfWeek = bitmaskToDaysOfWeek(r.dow);
  if (daysOfWeek.length === 0) {
    return { ok: false, reason: `preset ${entry.presetId} (${entry.presetName}): no days of week set` };
  }

  const timeOfDay = `${String(r.hour).padStart(2, '0')}:${String(r.min).padStart(2, '0')}`;
  return { ok: true, parsed: { presetId: entry.presetId, daysOfWeek, timeOfDay } };
}

async function fetchRawPresetSchedules(host: string): Promise<RawWledPresetSchedule[]> {
  const res = await fetch(`http://${host}/presets.json`);
  if (!res.ok) throw new Error(`WLED request failed: GET /presets.json -> ${res.status}`);
  const raw = (await res.json()) as Record<string, any>;
  return Object.entries(raw).map(([id, v]) => ({
    presetId: Number(id),
    presetName: v.n ?? `Preset ${id}`,
    raw: v
  }));
}

async function clearScheduleOnDevice(host: string, presetId: number): Promise<void> {
  await fetch(`http://${host}/json/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ psave: presetId, en: false })
  });
}

export async function importSchedules(
  db: Database.Database,
  controllerId: string,
  opts: { disableOnDevice: boolean }
): Promise<{ imported: Schedule[]; skipped: { raw: unknown; reason: string }[] }> {
  const controllers = createControllerRepository(db);
  const groups = createGroupRepository(db);
  const schedules = createScheduleRepository(db);

  const controller = controllers.list().find((c) => c.id === controllerId);
  if (!controller) throw new Error(`controller ${controllerId} not found`);

  let entries: RawWledPresetSchedule[];
  try {
    entries = await fetchRawPresetSchedules(controller.host);
  } catch (err: any) {
    const unreachable = new Error(`controller ${controller.name} is unreachable: ${err.message}`);
    (unreachable as any).statusCode = 503;
    throw unreachable;
  }

  const imported: Schedule[] = [];
  const skipped: { raw: unknown; reason: string }[] = [];

  const groupName = `${controller.name} (imported)`;
  let group = groups.list().find((g) => g.name === groupName);

  for (const entry of entries) {
    const result = parsePresetSchedule(entry);
    if (!result.ok) {
      skipped.push({ raw: entry.raw, reason: result.reason });
      continue;
    }

    if (!group) {
      group = groups.add({ name: groupName, members: [{ controllerId, wledSegId: 0 }] });
    }

    const schedule = schedules.add({
      name: `${entry.presetName} (imported)`,
      triggerType: 'weekly',
      cronExpr: null,
      daysOfWeek: result.parsed.daysOfWeek,
      timeOfDay: result.parsed.timeOfDay,
      offsetMinutes: 0,
      latitude: null,
      longitude: null,
      groupId: group.id,
      actionType: 'preset',
      actionPayload: { presetId: result.parsed.presetId },
      enabled: true
    });
    imported.push(schedule);

    if (opts.disableOnDevice) {
      await clearScheduleOnDevice(controller.host, result.parsed.presetId);
    }
  }

  return { imported, skipped };
}
