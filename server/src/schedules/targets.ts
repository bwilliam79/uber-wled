import type Database from 'better-sqlite3';
import { expandTargets, GroupNotFoundError, type ResolvedTarget, type Target } from '../control/applyV2.js';
import type { ScheduleControllerTarget } from './repository.js';

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
export function resolveEntityMembers(db: Database.Database, entity: Parameters<typeof targetsOf>[0]): ResolvedTarget[] {
  const targets = targetsOf(entity);
  if (targets.length === 0) return [];
  try {
    return expandTargets(db, targets);
  } catch (err) {
    if (err instanceof GroupNotFoundError) return [];
    throw err;
  }
}
