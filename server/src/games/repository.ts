import type Database from 'better-sqlite3';

export type GameSport = 'football' | 'basketball';
export type GameTeam = 'arkansas' | 'lsu';
export type GameTriggerStatus = 'scheduled' | 'active' | 'released' | 'skipped' | 'cancelled';

export interface GameTrigger {
  espnEventId: string;
  sport: GameSport;
  teams: GameTeam[];
  opponent: string;
  startAt: string;
  releaseAt: string;
  timeValid: boolean;
  assignments: Record<string, string>;
  status: GameTriggerStatus;
  earlyFinal: boolean;
  updatedAt: string;
}

export interface GameTriggerInput {
  espnEventId: string;
  sport: GameSport;
  teams: GameTeam[];
  opponent: string;
  startAt: string;
  releaseAt: string;
  timeValid: boolean;
  assignments: Record<string, string>;
  status: GameTriggerStatus;
  earlyFinal?: boolean;
  updatedAt: string;
}

export interface GameSyncLogRow {
  id: number;
  at: string;
  espnEventId: string | null;
  change: string;
  detail: string | null;
}

function parseTeams(raw: string): GameTeam[] {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((t): t is GameTeam => t === 'arkansas' || t === 'lsu');
  } catch {
    return [];
  }
}

function parseAssignments(raw: string): Record<string, string> {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function fromRow(row: {
  espn_event_id: string;
  sport: GameSport;
  teams: string;
  opponent: string;
  start_at: string;
  release_at: string;
  time_valid: number;
  assignments: string;
  status: GameTriggerStatus;
  early_final: number;
  updated_at: string;
}): GameTrigger {
  return {
    espnEventId: row.espn_event_id,
    sport: row.sport,
    teams: parseTeams(row.teams),
    opponent: row.opponent,
    startAt: row.start_at,
    releaseAt: row.release_at,
    timeValid: !!row.time_valid,
    assignments: parseAssignments(row.assignments),
    status: row.status,
    earlyFinal: !!row.early_final,
    updatedAt: row.updated_at
  };
}

function fromLogRow(row: {
  id: number;
  at: string;
  espn_event_id: string | null;
  change: string;
  detail: string | null;
}): GameSyncLogRow {
  return {
    id: row.id,
    at: row.at,
    espnEventId: row.espn_event_id,
    change: row.change,
    detail: row.detail
  };
}

export function createGameTriggerRepository(db: Database.Database) {
  return {
    list(): GameTrigger[] {
      return (
        db.prepare('SELECT * FROM game_triggers ORDER BY start_at, espn_event_id').all() as Parameters<
          typeof fromRow
        >[0][]
      ).map(fromRow);
    },
    get(espnEventId: string): GameTrigger | undefined {
      const row = db.prepare('SELECT * FROM game_triggers WHERE espn_event_id = ?').get(espnEventId) as
        | Parameters<typeof fromRow>[0]
        | undefined;
      return row ? fromRow(row) : undefined;
    },
    upsert(input: GameTriggerInput): GameTrigger {
      const earlyFinal = input.earlyFinal ? 1 : 0;
      db.prepare(
        `INSERT INTO game_triggers (
           espn_event_id, sport, teams, opponent, start_at, release_at, time_valid,
           assignments, status, early_final, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(espn_event_id) DO UPDATE SET
           sport = excluded.sport,
           teams = excluded.teams,
           opponent = excluded.opponent,
           start_at = excluded.start_at,
           release_at = excluded.release_at,
           time_valid = excluded.time_valid,
           assignments = excluded.assignments,
           status = excluded.status,
           early_final = excluded.early_final,
           updated_at = excluded.updated_at`
      ).run(
        input.espnEventId,
        input.sport,
        JSON.stringify(input.teams),
        input.opponent,
        input.startAt,
        input.releaseAt,
        input.timeValid ? 1 : 0,
        JSON.stringify(input.assignments),
        input.status,
        earlyFinal,
        input.updatedAt
      );
      return {
        espnEventId: input.espnEventId,
        sport: input.sport,
        teams: input.teams,
        opponent: input.opponent,
        startAt: input.startAt,
        releaseAt: input.releaseAt,
        timeValid: input.timeValid,
        assignments: input.assignments,
        status: input.status,
        earlyFinal: !!earlyFinal,
        updatedAt: input.updatedAt
      };
    },
    updateStatus(espnEventId: string, status: GameTriggerStatus, updatedAt: string): void {
      db.prepare('UPDATE game_triggers SET status = ?, updated_at = ? WHERE espn_event_id = ?').run(
        status,
        updatedAt,
        espnEventId
      );
    },
    setEarlyFinal(espnEventId: string, updatedAt: string): void {
      db.prepare('UPDATE game_triggers SET early_final = 1, updated_at = ? WHERE espn_event_id = ?').run(
        updatedAt,
        espnEventId
      );
    }
  };
}

export function createGameSyncLogRepository(db: Database.Database) {
  return {
    listRecent(limit = 200): GameSyncLogRow[] {
      return (
        db
          .prepare('SELECT * FROM game_sync_log ORDER BY id DESC LIMIT ?')
          .all(limit) as Parameters<typeof fromLogRow>[0][]
      ).map(fromLogRow);
    },
    add(input: { at: string; espnEventId: string | null; change: string; detail?: string | null }): void {
      db.prepare('INSERT INTO game_sync_log (at, espn_event_id, change, detail) VALUES (?, ?, ?, ?)').run(
        input.at,
        input.espnEventId,
        input.change,
        input.detail ?? null
      );
    },
    hasChange(espnEventId: string, change: string): boolean {
      const row = db
        .prepare('SELECT 1 AS ok FROM game_sync_log WHERE espn_event_id = ? AND change = ? LIMIT 1')
        .get(espnEventId, change) as { ok: number } | undefined;
      return !!row;
    }
  };
}
