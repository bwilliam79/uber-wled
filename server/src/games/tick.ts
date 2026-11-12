import type Database from 'better-sqlite3';
import { trackCalendarThemeOn, trackClear, trackGameThemeOn, trackScheduleThemeOn } from '../looks/applyTracking.js';
import { createActiveLookRepository } from '../looks/repository.js';
import { isLiveManualHold } from '../looks/idle.js';
import { isSplitAssignment } from './assignment.js';
import { createGameTriggerRepository, type GameTrigger } from './repository.js';
import { resolveResume } from './resume.js';
import { applySplitLook, restoreSplitLook } from './splitLook.js';

type ApplyFn = (
  members: { controllerId: string; wledSegId: number | null }[],
  action: { type: string; [key: string]: unknown }
) => Promise<unknown>;

function inWindow(trigger: GameTrigger, now: Date): boolean {
  const start = Date.parse(trigger.startAt);
  const release = Date.parse(trigger.releaseAt);
  if (Number.isNaN(start) || Number.isNaN(release)) return false;
  const t = now.getTime();
  return start <= t && t < release;
}

function dueForRelease(trigger: GameTrigger, now: Date): boolean {
  if (trigger.earlyFinal) return true;
  const release = Date.parse(trigger.releaseAt);
  return !Number.isNaN(release) && now.getTime() >= release;
}

async function applyResume(
  db: Database.Database,
  controllerId: string,
  now: Date,
  applyFn: ApplyFn
): Promise<void> {
  const members = [{ controllerId, wledSegId: null }];
  const decision = resolveResume(db, controllerId, now);
  if (decision.type === 'calendar') {
    const result = await applyFn(members, { type: 'theme', themeId: decision.themeId });
    trackCalendarThemeOn(db, members, result, decision.eventId, decision.themeId, now);
    return;
  }
  if (decision.type === 'schedule') {
    const result = await applyFn(members, { type: 'theme', themeId: decision.themeId });
    trackScheduleThemeOn(db, members, result, decision.scheduleId, decision.themeId, now);
    return;
  }
  const result = await applyFn(members, { type: 'power', on: false });
  trackClear(db, members, result);
}

export async function releaseGameTrigger(
  db: Database.Database,
  trigger: GameTrigger,
  now: Date,
  applyFn: ApplyFn
): Promise<void> {
  const looks = createActiveLookRepository(db);
  for (const controllerId of Object.keys(trigger.assignments)) {
    const look = looks.get(controllerId);
    if (!look || look.source !== 'game' || look.sourceId !== trigger.espnEventId) continue;
    // Split controllers saved their previous segment bounds at apply time.
    // Put that layout back before resume paints a holiday, a night theme, or power off.
    await restoreSplitLook(db, controllerId, trigger.espnEventId);
    looks.clear(controllerId);
    await applyResume(db, controllerId, now, applyFn);
  }
  createGameTriggerRepository(db).updateStatus(trigger.espnEventId, 'released', now.toISOString());
}

async function activateGameTrigger(
  db: Database.Database,
  trigger: GameTrigger,
  now: Date,
  applyFn: ApplyFn
): Promise<void> {
  for (const [controllerId, assignment] of Object.entries(trigger.assignments)) {
    if (isLiveManualHold(db, controllerId)) continue;
    if (isSplitAssignment(assignment)) {
      const result = await applySplitLook(db, controllerId, assignment, trigger.espnEventId);
      if (!result.ok) continue;
      // The active look stores the first-half theme. Hold and skip logic
      // keys off source "game", same as a single-theme game look.
      trackGameThemeOn(
        db,
        [{ controllerId }],
        [result],
        trigger.espnEventId,
        assignment.lsu,
        now
      );
      continue;
    }
    if (!assignment) continue;
    const members = [{ controllerId, wledSegId: null }];
    const result = await applyFn(members, { type: 'theme', themeId: assignment });
    trackGameThemeOn(db, members, result, trigger.espnEventId, assignment, now);
  }
  createGameTriggerRepository(db).updateStatus(trigger.espnEventId, 'active', now.toISOString());
}

/** Activate due games, then release expired/early-final ones. */
export async function processGameTriggers(db: Database.Database, now: Date, applyFn: ApplyFn): Promise<void> {
  const repo = createGameTriggerRepository(db);
  const triggers = repo.list();
  for (const trigger of triggers) {
    if (trigger.status === 'scheduled' && inWindow(trigger, now)) {
      await activateGameTrigger(db, trigger, now, applyFn);
    }
  }
  for (const trigger of repo.list()) {
    if (trigger.status === 'active' && dueForRelease(trigger, now)) {
      await releaseGameTrigger(db, trigger, now, applyFn);
    }
  }
}
