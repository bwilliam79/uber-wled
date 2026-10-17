import type Database from 'better-sqlite3';
import { createGroupRepository } from '../groups/repository.js';
import { createSettingsRepository, type Settings } from '../settings/repository.js';
import {
  createGameSyncLogRepository,
  createGameTriggerRepository,
  type GameTeam,
  type GameTrigger,
  type GameTriggerInput,
  type GameTriggerStatus
} from './repository.js';
import {
  ESPN_TEAM_IDS,
  fetchJson,
  parseScheduleEvents,
  releaseAtIso,
  scheduleUrl,
  summaryState,
  summaryUrl,
  type FetchLike,
  type ParsedEspnEvent
} from './espn.js';

export interface SyncGamesOptions {
  dryRun?: boolean;
  skipEventIds?: string[];
}

export interface SyncGamesResult {
  created: number;
  moved: number;
  cancelled: number;
  tba: number;
  unchanged: number;
  triggers: GameTrigger[];
}

const FROZEN: ReadonlySet<GameTriggerStatus> = new Set(['active', 'released']);

function windowsOverlap(a: { startAt: string; releaseAt: string }, b: { startAt: string; releaseAt: string }): boolean {
  return Date.parse(a.startAt) < Date.parse(b.releaseAt) && Date.parse(b.startAt) < Date.parse(a.releaseAt);
}

export function groupControllerIds(db: Database.Database, groupId: string | null): string[] {
  if (!groupId) return [];
  const group = createGroupRepository(db).list().find((g) => g.id === groupId);
  if (!group) return [];
  const ids: string[] = [];
  for (const member of group.members) {
    if (!ids.includes(member.controllerId)) ids.push(member.controllerId);
  }
  return ids;
}

export function computeAssignments(
  settings: Settings,
  groupIds: string[],
  teams: GameTeam[],
  split: boolean
): Record<string, string> {
  const ark = settings.gameArkansasThemeId;
  const lsu = settings.gameLsuThemeId;
  if (!ark || !lsu) return {};
  if (split || (teams.includes('arkansas') && teams.includes('lsu'))) {
    const out: Record<string, string> = {};
    if (settings.gameLeftControllerId) out[settings.gameLeftControllerId] = lsu;
    if (settings.gameRightControllerId) out[settings.gameRightControllerId] = ark;
    return out;
  }
  const themeId = teams[0] === 'lsu' ? lsu : ark;
  const out: Record<string, string> = {};
  for (const id of groupIds) out[id] = themeId;
  return out;
}

function needsSplit(
  event: ParsedEspnEvent,
  releaseAt: string,
  others: { id: string; teams: GameTeam[]; startAt: string; releaseAt: string }[]
): boolean {
  if (event.teams.includes('arkansas') && event.teams.includes('lsu')) return true;
  if (event.teams.length === 0) return false;
  const otherTeam: GameTeam = event.teams[0] === 'arkansas' ? 'lsu' : 'arkansas';
  const self = { startAt: event.startAt, releaseAt };
  return others.some((o) => o.id !== event.id && o.teams.includes(otherTeam) && windowsOverlap(self, o));
}

function mergeFetched(events: ParsedEspnEvent[]): ParsedEspnEvent[] {
  const byId = new Map<string, ParsedEspnEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (!existing) {
      byId.set(event.id, { ...event, teams: [...event.teams] });
      continue;
    }
    const teams = [...new Set([...existing.teams, ...event.teams])].sort() as GameTeam[];
    byId.set(event.id, { ...existing, teams, opponent: existing.opponent || event.opponent });
  }
  return [...byId.values()];
}

async function fetchAllEvents(fetchFn: FetchLike): Promise<ParsedEspnEvent[]> {
  const sports = ['football', 'basketball'] as const;
  const teams = Object.values(ESPN_TEAM_IDS);
  const results = await Promise.all(
    sports.flatMap((sport) =>
      teams.map(async (teamId) => {
        const body = await fetchJson(scheduleUrl(sport, teamId), fetchFn);
        return parseScheduleEvents(body, sport);
      })
    )
  );
  return mergeFetched(results.flat());
}

function cloneTrigger(t: GameTrigger): GameTrigger {
  return { ...t, teams: [...t.teams], assignments: { ...t.assignments } };
}

export async function syncGames(
  db: Database.Database,
  now: Date,
  fetchFn: FetchLike = fetch,
  options: SyncGamesOptions = {}
): Promise<SyncGamesResult> {
  const dryRun = !!options.dryRun;
  const skipIds = new Set(options.skipEventIds ?? []);
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const settings = createSettingsRepository(db).get();
  const groupIds = groupControllerIds(db, settings.gameGroupId);
  const repo = createGameTriggerRepository(db);
  const log = createGameSyncLogRepository(db);

  const existing = repo.list();
  const byId = new Map(existing.map((t) => [t.espnEventId, cloneTrigger(t)]));
  const fetched = await fetchAllEvents(fetchFn);

  const counts = { created: 0, moved: 0, cancelled: 0, tba: 0, unchanged: 0 };
  const writes: GameTriggerInput[] = [];
  const logs: { espnEventId: string | null; change: string; detail: string | null }[] = [];

  function write(input: GameTriggerInput): void {
    writes.push(input);
    byId.set(input.espnEventId, {
      espnEventId: input.espnEventId,
      sport: input.sport,
      teams: input.teams,
      opponent: input.opponent,
      startAt: input.startAt,
      releaseAt: input.releaseAt,
      timeValid: input.timeValid,
      assignments: input.assignments,
      status: input.status,
      earlyFinal: !!input.earlyFinal,
      updatedAt: input.updatedAt
    });
  }

  const overlapPool: { id: string; teams: GameTeam[]; startAt: string; releaseAt: string }[] = [];
  const overlapSeen = new Set<string>();
  function addOverlap(id: string, teams: GameTeam[], startAt: string, releaseAt: string): void {
    if (overlapSeen.has(id)) return;
    overlapSeen.add(id);
    overlapPool.push({ id, teams, startAt, releaseAt });
  }
  for (const t of byId.values()) {
    if (t.status === 'scheduled' || t.status === 'active') {
      addOverlap(t.espnEventId, t.teams, t.startAt, t.releaseAt);
    }
  }
  for (const event of fetched) {
    if (skipIds.has(event.id) || !event.timeValid || event.state === 'post') continue;
    const releaseAt = releaseAtIso(event.startAt, event.sport);
    if (Date.parse(releaseAt) <= nowMs) continue;
    addOverlap(event.id, event.teams, event.startAt, releaseAt);
  }

  for (const event of fetched) {
    const current = byId.get(event.id);
    if (current && FROZEN.has(current.status)) {
      counts.unchanged += 1;
      continue;
    }

    if (skipIds.has(event.id)) {
      if (current?.status === 'skipped') {
        counts.unchanged += 1;
        continue;
      }
      write({
        espnEventId: event.id,
        sport: event.sport,
        teams: event.teams,
        opponent: event.opponent,
        startAt: event.startAt,
        releaseAt: releaseAtIso(event.startAt, event.sport),
        timeValid: event.timeValid,
        assignments: current?.assignments ?? {},
        status: 'skipped',
        earlyFinal: false,
        updatedAt: nowIso
      });
      logs.push({ espnEventId: event.id, change: 'skipped', detail: null });
      counts.unchanged += 1;
      continue;
    }

    if (!event.timeValid) {
      const alreadyTba = log.hasChange(event.id, 'tba') || logs.some((l) => l.espnEventId === event.id && l.change === 'tba');
      if (!alreadyTba) {
        counts.tba += 1;
        logs.push({ espnEventId: event.id, change: 'tba', detail: event.opponent });
      } else {
        counts.unchanged += 1;
      }
      if (current?.status === 'scheduled') {
        write({ ...current, status: 'cancelled', timeValid: false, updatedAt: nowIso });
        logs.push({ espnEventId: event.id, change: 'cancelled', detail: 'tba' });
        counts.cancelled += 1;
      }
      continue;
    }

    if (event.teams.length === 0) {
      counts.unchanged += 1;
      continue;
    }

    const releaseAt = releaseAtIso(event.startAt, event.sport);
    if (event.state === 'post' || Date.parse(releaseAt) <= nowMs) {
      if (!current) {
        counts.unchanged += 1;
        continue;
      }
      if (current.status === 'scheduled') {
        write({ ...current, status: 'cancelled', updatedAt: nowIso });
        logs.push({ espnEventId: event.id, change: 'cancelled', detail: event.state === 'post' ? 'post' : 'past' });
        counts.cancelled += 1;
      } else {
        counts.unchanged += 1;
      }
      continue;
    }

    const split = needsSplit(event, releaseAt, overlapPool);
    // Include other copies of this same event in the pool; needsSplit should ignore self.
    const assignments = computeAssignments(settings, groupIds, event.teams, split);
    const next: GameTriggerInput = {
      espnEventId: event.id,
      sport: event.sport,
      teams: event.teams,
      opponent: event.opponent,
      startAt: event.startAt,
      releaseAt,
      timeValid: true,
      assignments,
      status: 'scheduled',
      earlyFinal: false,
      updatedAt: nowIso
    };

    if (!current || current.status === 'cancelled') {
      write(next);
      logs.push({ espnEventId: event.id, change: 'created', detail: event.opponent });
      counts.created += 1;
      continue;
    }
    if (current.status === 'skipped') {
      counts.unchanged += 1;
      continue;
    }
    if (current.status === 'scheduled') {
      if (current.startAt !== event.startAt) {
        write(next);
        logs.push({
          espnEventId: event.id,
          change: 'moved',
          detail: `${current.startAt} -> ${event.startAt}`
        });
        counts.moved += 1;
      } else {
        if (JSON.stringify(current.assignments) !== JSON.stringify(assignments) || current.releaseAt !== releaseAt) {
          write({ ...next, status: 'scheduled' });
        }
        counts.unchanged += 1;
      }
    }
  }

  if (!dryRun) {
    for (const row of writes) repo.upsert(row);
    for (const entry of logs) log.add({ at: nowIso, ...entry });
  }

  const triggers = [...byId.values()].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.espnEventId.localeCompare(b.espnEventId));
  return { ...counts, triggers };
}

export async function pollActiveGameSummaries(
  db: Database.Database,
  now: Date,
  fetchFn: FetchLike = fetch
): Promise<string[]> {
  const repo = createGameTriggerRepository(db);
  const log = createGameSyncLogRepository(db);
  const early: string[] = [];
  const nowIso = now.toISOString();
  for (const trigger of repo.list()) {
    if (trigger.status !== 'active') continue;
    try {
      const body = await fetchJson(summaryUrl(trigger.sport, trigger.espnEventId), fetchFn);
      if (summaryState(body) === 'post') {
        repo.setEarlyFinal(trigger.espnEventId, nowIso);
        log.add({
          at: nowIso,
          espnEventId: trigger.espnEventId,
          change: 'early_final',
          detail: 'post'
        });
        early.push(trigger.espnEventId);
      }
    } catch {
      // Per-event poll isolation: a failed summary must not block the rest.
    }
  }
  return early;
}

export function hasTriggerStartingWithin14Days(db: Database.Database, now: Date): boolean {
  const horizon = now.getTime() + 14 * 24 * 60 * 60 * 1000;
  return createGameTriggerRepository(db)
    .list()
    .some((t) => {
      if (t.status !== 'scheduled' && t.status !== 'active') return false;
      const start = Date.parse(t.startAt);
      if (Number.isNaN(start)) return false;
      return start <= horizon;
    });
}

export function hasActiveGameTrigger(db: Database.Database): boolean {
  return createGameTriggerRepository(db).list().some((t) => t.status === 'active');
}
