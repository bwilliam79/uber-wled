import type Database from 'better-sqlite3';
import { createControllerStatusRepository } from '../controllers/statusRepository.js';
import { createActiveLookRepository } from './repository.js';

/**
 * The status poller saw the controller reachable and powered off at or after
 * the look was applied — turned off from WLED's own app or button, which
 * releases the hold so an ambient schedule may run again.
 */
export function polledOffSince(db: Database.Database, controllerId: string, appliedAt: string): boolean {
  const status = createControllerStatusRepository(db).get(controllerId);
  if (!status?.reachable || !status.state || status.state.on !== false) return false;
  const polled = Date.parse(status.polledAt);
  const applied = Date.parse(appliedAt);
  if (Number.isNaN(polled) || Number.isNaN(applied)) return false;
  return polled >= applied;
}

/**
 * A controller is idle for an ambient schedule when nothing is holding a
 * different look on it: no tracked look, the tracked theme is this schedule's
 * own theme, a previous schedule wrote it, the calendar expiry has passed,
 * or the poller has seen it switched off since the look was applied.
 * Otherwise the look is held (a manual game theme, or an unexpired holiday).
 */
export function isControllerIdle(
  db: Database.Database,
  controllerId: string,
  scheduleThemeId: string | null,
  now: Date
): boolean {
  const look = createActiveLookRepository(db).get(controllerId);
  if (!look) return true;
  if (scheduleThemeId !== null && look.themeId === scheduleThemeId) return true;
  if (look.source === 'schedule') return true;
  if (look.expiresAt) {
    const exp = Date.parse(look.expiresAt);
    if (!Number.isNaN(exp) && exp <= now.getTime()) return true;
  }
  if (polledOffSince(db, controllerId, look.appliedAt)) return true;
  return false;
}
