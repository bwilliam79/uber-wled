import type { GameSport, GameTeam } from './repository.js';

export const ESPN_TEAM_IDS: Record<GameTeam, string> = {
  arkansas: '8',
  lsu: '99'
};

export const ESPN_SPORT_PATH: Record<GameSport, string> = {
  football: 'football/college-football',
  basketball: 'basketball/mens-college-basketball'
};

const ESPN_ORIGIN = 'https://site.api.espn.com/apis/site/v2/sports';

export const FETCH_TIMEOUT_MS = 10_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function scheduleUrl(sport: GameSport, teamId: string): string {
  const base = `${ESPN_ORIGIN}/${ESPN_SPORT_PATH[sport]}/teams/${teamId}/schedule`;
  return sport === 'basketball' ? `${base}?seasontype=2` : base;
}

export function summaryUrl(sport: GameSport, eventId: string): string {
  return `${ESPN_ORIGIN}/${ESPN_SPORT_PATH[sport]}/summary?event=${encodeURIComponent(eventId)}`;
}

export function releaseAtIso(startAt: string, sport: GameSport): string {
  const hours = sport === 'football' ? 4 : 3;
  return new Date(Date.parse(startAt) + hours * 60 * 60 * 1000).toISOString();
}

export interface ParsedEspnEvent {
  id: string;
  sport: GameSport;
  startAt: string;
  timeValid: boolean;
  state: string;
  teams: GameTeam[];
  opponent: string;
}

function teamKeyForId(id: string): GameTeam | null {
  if (id === ESPN_TEAM_IDS.arkansas) return 'arkansas';
  if (id === ESPN_TEAM_IDS.lsu) return 'lsu';
  return null;
}

function competitorTeam(raw: unknown): { id: string; displayName: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const team = (raw as { team?: { id?: unknown; displayName?: unknown } }).team;
  if (!team || typeof team.id !== 'string') return null;
  const displayName = typeof team.displayName === 'string' ? team.displayName : team.id;
  return { id: team.id, displayName };
}

export function parseScheduleEvents(body: unknown, sport: GameSport): ParsedEspnEvent[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  const out: ParsedEspnEvent[] = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const id = (event as { id?: unknown }).id;
    const date = (event as { date?: unknown }).date;
    if (typeof id !== 'string' || typeof date !== 'string') continue;
    const competitions = (event as { competitions?: unknown[] }).competitions;
    const comp = Array.isArray(competitions) ? competitions[0] : undefined;
    const timeValid = (comp as { timeValid?: unknown } | undefined)?.timeValid !== false;
    const stateRaw = (comp as { status?: { type?: { state?: unknown } } } | undefined)?.status?.type?.state;
    const state = typeof stateRaw === 'string' ? stateRaw : 'pre';
    const competitors = Array.isArray((comp as { competitors?: unknown[] } | undefined)?.competitors)
      ? ((comp as { competitors: unknown[] }).competitors.map(competitorTeam).filter(Boolean) as {
          id: string;
          displayName: string;
        }[])
      : [];
    const teams = [...new Set(competitors.map((c) => teamKeyForId(c.id)).filter((t): t is GameTeam => t !== null))];
    teams.sort();
    const others = competitors.filter((c) => teamKeyForId(c.id) === null);
    const opponent =
      others.length > 0 ? others.map((c) => c.displayName).join(', ') : competitors.map((c) => c.displayName).join(' vs ');
    out.push({ id, sport, startAt: date, timeValid, state, teams, opponent });
  }
  return out;
}

export function summaryState(body: unknown): string | undefined {
  const headerState = (body as { header?: { competitions?: { status?: { type?: { state?: unknown } } }[] } } | null)
    ?.header?.competitions?.[0]?.status?.type?.state;
  if (typeof headerState === 'string') return headerState;
  const state = (body as { competitions?: { status?: { type?: { state?: unknown } } }[] } | null)?.competitions?.[0]
    ?.status?.type?.state;
  return typeof state === 'string' ? state : undefined;
}

export async function fetchJson(url: string, fetchFn: FetchLike): Promise<unknown> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}
