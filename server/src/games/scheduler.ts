import type Database from 'better-sqlite3';
import { createSettingsRepository } from '../settings/repository.js';
import { hasActiveGameTrigger, hasTriggerStartingWithin14Days, pollActiveGameSummaries, syncGames } from './sync.js';

const SYNC_CHECK_MS = 15 * 60 * 1000;
const POLL_EVERY_MS = 10 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function todayFiveAm(now: Date): Date {
  const five = new Date(now.getTime());
  five.setHours(5, 0, 0, 0);
  return five;
}

export function createGameDayScheduler(db: Database.Database): { start(): void; stop(): void } {
  let lastSyncAt: Date | null = null;
  let lastPollAt: Date | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runSync(now: Date): Promise<void> {
    try {
      await syncGames(db, now);
      lastSyncAt = now;
    } catch (err) {
      console.error('game-day sync failed:', err);
    }
  }

  async function runPoll(now: Date): Promise<void> {
    try {
      await pollActiveGameSummaries(db, now);
      lastPollAt = now;
    } catch (err) {
      console.error('game-day summary poll failed:', err);
    }
  }

  function syncDue(now: Date): boolean {
    if (!lastSyncAt) return true;
    const five = todayFiveAm(now);
    if (now.getTime() >= five.getTime() && lastSyncAt.getTime() < five.getTime()) return true;
    if (now.getTime() - lastSyncAt.getTime() >= SIX_HOURS_MS && hasTriggerStartingWithin14Days(db, now)) {
      return true;
    }
    return false;
  }

  function pollDue(now: Date): boolean {
    if (!hasActiveGameTrigger(db)) return false;
    if (!lastPollAt) return true;
    return now.getTime() - lastPollAt.getTime() >= POLL_EVERY_MS;
  }

  async function tick(): Promise<void> {
    const settings = createSettingsRepository(db).get();
    if (!settings.gameDayEnabled) return;
    const now = new Date();
    if (syncDue(now)) await runSync(now);
    if (pollDue(now)) await runPoll(now);
  }

  return {
    start(): void {
      tick().catch((err) => console.error('game-day scheduler tick failed:', err));
      timer = setInterval(() => {
        tick().catch((err) => console.error('game-day scheduler tick failed:', err));
      }, SYNC_CHECK_MS);
    },
    stop(): void {
      if (timer) clearInterval(timer);
    }
  };
}
