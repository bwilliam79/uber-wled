import type Database from 'better-sqlite3';

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface WledRelease {
  tag: string;
  publishedAt: string;
  assets: ReleaseAsset[];
  fetchedAt: string;
}

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/Aircoookie/WLED/releases';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function fromRow(row: any): WledRelease {
  return {
    tag: row.tag,
    publishedAt: row.published_at,
    assets: JSON.parse(row.assets),
    fetchedAt: row.fetched_at
  };
}

export function createReleaseCache(db: Database.Database) {
  return {
    getLatest(): WledRelease | undefined {
      const row = db.prepare('SELECT * FROM wled_releases ORDER BY fetched_at DESC LIMIT 1').get();
      return row ? fromRow(row) : undefined;
    },
    save(release: WledRelease): void {
      db.prepare(
        `INSERT INTO wled_releases (tag, published_at, assets, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tag) DO UPDATE SET published_at = excluded.published_at, assets = excluded.assets, fetched_at = excluded.fetched_at`
      ).run(release.tag, release.publishedAt, JSON.stringify(release.assets), release.fetchedAt);
    }
  };
}

async function fetchFromGithub(): Promise<WledRelease> {
  const res = await fetch(GITHUB_RELEASES_URL);
  if (!res.ok) throw new Error(`GitHub releases request failed: ${res.status}`);
  const releases = (await res.json()) as any[];
  const newest = releases[0];
  return {
    tag: newest.tag_name,
    publishedAt: newest.published_at,
    assets: (newest.assets ?? []).map((a: any) => ({ name: a.name, downloadUrl: a.browser_download_url })),
    fetchedAt: new Date().toISOString()
  };
}

export async function fetchLatestRelease(
  db: Database.Database,
  opts: { forceRefresh?: boolean } = {}
): Promise<WledRelease> {
  const cache = createReleaseCache(db);
  const cached = cache.getLatest();

  const cacheIsFresh =
    !!cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_AGE_MS;

  if (cacheIsFresh && !opts.forceRefresh) {
    return cached!;
  }

  try {
    const release = await fetchFromGithub();
    cache.save(release);
    return release;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}
