import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createAppUpdateCache } from './repository.js';
import { fetchLatestAppVersion, REPO_URL } from './githubClient.js';
import { CURRENT_APP_VERSION } from '../appVersion.js';

const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Compares dotted numeric versions (e.g. "1.5.3"); no pre-release suffixes to handle here. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function createAppUpdateRouter(db: Database.Database): Router {
  const router = Router();
  const cache = createAppUpdateCache(db);

  router.get('/', async (_req, res) => {
    const cached = cache.get();
    const cacheIsFresh = !!cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_AGE_MS;

    let latestVersion = cached?.latestVersion ?? null;
    if (!cacheIsFresh) {
      try {
        latestVersion = await fetchLatestAppVersion();
        cache.set(latestVersion, new Date().toISOString());
      } catch {
        // Best-effort: keep serving the last known value (possibly null)
        // rather than fail the whole request over a transient GitHub hiccup.
      }
    }

    res.json({
      currentVersion: CURRENT_APP_VERSION,
      latestVersion,
      updateAvailable: !!latestVersion && isNewerVersion(latestVersion, CURRENT_APP_VERSION),
      repoUrl: REPO_URL
    });
  });

  return router;
}
