import type Database from 'better-sqlite3';
import type { ApplyResult, ControlPatch } from '../control/applyV2.js';
import { createScheduleRepository } from '../schedules/repository.js';
import { calendarLookExpiresAt } from './expiry.js';
import { createActiveLookRepository, type LookSource } from './repository.js';

/**
 * Controllers whose apply succeeded. The engine's applyFn returns
 * ApplyResult[] in production; a non-array result (tests, or a caller that
 * doesn't report per target) is treated as every member succeeding.
 */
export function successfulControllerIds(
  members: { controllerId: string }[],
  result: unknown
): string[] {
  if (!Array.isArray(result)) {
    return [...new Set(members.map((m) => m.controllerId))];
  }
  const ids: string[] = [];
  for (const row of result as ApplyResult[]) {
    if (!row || row.ok !== true || typeof row.controllerId !== 'string') continue;
    if (!ids.includes(row.controllerId)) ids.push(row.controllerId);
  }
  return ids;
}

export function payloadThemeId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const id = (payload as { themeId?: unknown }).themeId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Dim White / the default look: the themeId of any theme-action schedule. */
export function isAmbientScheduleTheme(db: Database.Database, themeId: string): boolean {
  return createScheduleRepository(db).list().some(
    (s) => s.actionType === 'theme' && payloadThemeId(s.actionPayload) === themeId
  );
}

function writeLook(
  db: Database.Database,
  controllerIds: string[],
  look: { themeId: string; source: LookSource; sourceId: string | null; appliedAt: string; expiresAt: string | null }
): void {
  if (controllerIds.length === 0) return;
  const repo = createActiveLookRepository(db);
  for (const controllerId of controllerIds) repo.set({ controllerId, ...look });
}

export function trackCalendarThemeOn(
  db: Database.Database,
  members: { controllerId: string }[],
  result: unknown,
  eventId: string,
  themeId: string,
  now: Date
): void {
  writeLook(db, successfulControllerIds(members, result), {
    themeId,
    source: 'calendar',
    sourceId: eventId,
    appliedAt: now.toISOString(),
    expiresAt: calendarLookExpiresAt(now)
  });
}

export function trackScheduleThemeOn(
  db: Database.Database,
  members: { controllerId: string }[],
  result: unknown,
  scheduleId: string,
  themeId: string,
  now: Date
): void {
  writeLook(db, successfulControllerIds(members, result), {
    themeId,
    source: 'schedule',
    sourceId: scheduleId,
    appliedAt: now.toISOString(),
    expiresAt: null
  });
}

export function trackGameThemeOn(
  db: Database.Database,
  members: { controllerId: string }[],
  result: unknown,
  espnEventId: string,
  themeId: string,
  now: Date
): void {
  writeLook(db, successfulControllerIds(members, result), {
    themeId,
    source: 'game',
    sourceId: espnEventId,
    appliedAt: now.toISOString(),
    expiresAt: null
  });
}

export function trackClear(
  db: Database.Database,
  members: { controllerId: string }[],
  result: unknown
): void {
  const ids = successfulControllerIds(members, result);
  if (ids.length === 0) return;
  const repo = createActiveLookRepository(db);
  for (const id of ids) repo.clear(id);
}

/**
 * Manual /api/control/apply tracking. Power-off clears. Applying the ambient
 * schedule's own theme (Dim White) also clears, so the default look is not a
 * hold. Any other themeId is a manual hold. Anything else leaves the row alone.
 * Only controllers with ok === true are touched.
 */
export function trackManualApply(db: Database.Database, patch: ControlPatch, results: ApplyResult[]): void {
  const ids = successfulControllerIds(results, results);
  if (ids.length === 0) return;
  const repo = createActiveLookRepository(db);
  if (patch.on === false) {
    for (const id of ids) repo.clear(id);
    return;
  }
  if (!patch.themeId) return;
  if (isAmbientScheduleTheme(db, patch.themeId)) {
    for (const id of ids) repo.clear(id);
    return;
  }
  const appliedAt = new Date().toISOString();
  for (const id of ids) {
    repo.set({
      controllerId: id,
      themeId: patch.themeId,
      source: 'manual',
      sourceId: null,
      appliedAt,
      expiresAt: null
    });
  }
}
