import type Database from 'better-sqlite3';

export interface AppUpdateCache {
  latestVersion: string | null;
  fetchedAt: string;
}

export function createAppUpdateCache(db: Database.Database) {
  return {
    get(): AppUpdateCache | null {
      const row = db.prepare('SELECT latest_version, fetched_at FROM app_update_cache WHERE id = 1').get() as
        | { latest_version: string | null; fetched_at: string }
        | undefined;
      return row ? { latestVersion: row.latest_version, fetchedAt: row.fetched_at } : null;
    },
    set(latestVersion: string, fetchedAt: string): void {
      db.prepare(
        `INSERT INTO app_update_cache (id, latest_version, fetched_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET latest_version = excluded.latest_version, fetched_at = excluded.fetched_at`
      ).run(latestVersion, fetchedAt);
    }
  };
}
