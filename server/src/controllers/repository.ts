import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Controller {
  id: string;
  name: string;
  host: string;
  source: 'discovered' | 'manual';
  stale: boolean;
  pinnedAssetPattern: string | null;
}

function fromRow(row: any): Controller {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    source: row.source,
    stale: !!row.stale,
    pinnedAssetPattern: row.pinned_asset_pattern ?? null
  };
}

export function createControllerRepository(db: Database.Database) {
  return {
    list(): Controller[] {
      return db.prepare('SELECT * FROM controllers ORDER BY name').all().map(fromRow);
    },
    add(input: { name: string; host: string; source: 'discovered' | 'manual' }): Controller {
      const id = randomUUID();
      db.prepare('INSERT INTO controllers (id, name, host, source, stale) VALUES (?, ?, ?, ?, 0)')
        .run(id, input.name, input.host, input.source);
      return { id, name: input.name, host: input.host, source: input.source, stale: false, pinnedAssetPattern: null };
    },
    remove(id: string): void {
      db.prepare('DELETE FROM controllers WHERE id = ?').run(id);
    },
    findByHost(host: string): Controller | undefined {
      const row = db.prepare('SELECT * FROM controllers WHERE host = ?').get(host);
      return row ? fromRow(row) : undefined;
    },
    markStale(id: string, stale: boolean): void {
      db.prepare('UPDATE controllers SET stale = ? WHERE id = ?').run(stale ? 1 : 0, id);
    },
    setPinnedAssetPattern(id: string, pattern: string | null): void {
      db.prepare('UPDATE controllers SET pinned_asset_pattern = ? WHERE id = ?').run(pattern, id);
    }
  };
}
