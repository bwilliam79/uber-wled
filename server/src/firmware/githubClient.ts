import type Database from 'better-sqlite3';

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface WledRelease {
  tag: string;
  publishedAt: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
  fetchedAt: string;
}

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/Aircoookie/WLED/releases';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function fromRow(row: any): WledRelease {
  return {
    tag: row.tag,
    publishedAt: row.published_at,
    prerelease: !!row.prerelease,
    assets: JSON.parse(row.assets),
    fetchedAt: row.fetched_at
  };
}

export function createReleaseCache(db: Database.Database) {
  return {
    list(): WledRelease[] {
      return db.prepare('SELECT * FROM wled_releases ORDER BY published_at DESC').all().map(fromRow);
    },
    saveAll(releases: WledRelease[]): void {
      const stmt = db.prepare(
        `INSERT INTO wled_releases (tag, published_at, prerelease, assets, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tag) DO UPDATE SET published_at = excluded.published_at, prerelease = excluded.prerelease, assets = excluded.assets, fetched_at = excluded.fetched_at`
      );
      const tx = db.transaction((rows: WledRelease[]) => {
        for (const r of rows) stmt.run(r.tag, r.publishedAt, r.prerelease ? 1 : 0, JSON.stringify(r.assets), r.fetchedAt);
      });
      tx(releases);
    }
  };
}

async function fetchFromGithub(): Promise<WledRelease[]> {
  const res = await fetch(GITHUB_RELEASES_URL);
  if (!res.ok) throw new Error(`GitHub releases request failed: ${res.status}`);
  const releases = (await res.json()) as any[];
  const fetchedAt = new Date().toISOString();
  return releases.map((r) => ({
    tag: r.tag_name,
    publishedAt: r.published_at,
    prerelease: !!r.prerelease,
    assets: (r.assets ?? []).map((a: any) => ({ name: a.name, downloadUrl: a.browser_download_url })),
    fetchedAt
  }));
}

function selectLatest(releases: WledRelease[], includePrerelease: boolean): WledRelease {
  const eligible = includePrerelease ? releases : releases.filter((r) => !r.prerelease);
  const pool = eligible.length > 0 ? eligible : releases;
  return pool[0];
}

export async function fetchLatestRelease(
  db: Database.Database,
  opts: { forceRefresh?: boolean; includePrerelease?: boolean } = {}
): Promise<WledRelease> {
  const cache = createReleaseCache(db);
  const cached = cache.list();
  const newestFetchedAt = cached[0]?.fetchedAt;
  const cacheIsFresh = !!newestFetchedAt && Date.now() - new Date(newestFetchedAt).getTime() < CACHE_MAX_AGE_MS;

  if (cacheIsFresh && !opts.forceRefresh) {
    return selectLatest(cached, !!opts.includePrerelease);
  }

  try {
    const fresh = await fetchFromGithub();
    cache.saveAll(fresh);
    return selectLatest(cache.list(), !!opts.includePrerelease);
  } catch (err) {
    if (cached.length > 0) return selectLatest(cached, !!opts.includePrerelease);
    throw err;
  }
}
