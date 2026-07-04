import type Database from 'better-sqlite3';
import type { WledInfo, WledState } from '../wled/types.js';

export interface ControllerStatus {
  controllerId: string;
  reachable: boolean;
  info: WledInfo | null;
  state: WledState | null;
  polledAt: string;
}

function fromRow(row: any): ControllerStatus {
  return {
    controllerId: row.controller_id,
    reachable: !!row.reachable,
    info: row.info ? JSON.parse(row.info) : null,
    state: row.state ? JSON.parse(row.state) : null,
    polledAt: row.polled_at
  };
}

export function createControllerStatusRepository(db: Database.Database) {
  return {
    get(controllerId: string): ControllerStatus | undefined {
      const row = db.prepare('SELECT * FROM controller_status WHERE controller_id = ?').get(controllerId);
      return row ? fromRow(row) : undefined;
    },
    getAll(): ControllerStatus[] {
      return db.prepare('SELECT * FROM controller_status').all().map(fromRow);
    },
    upsert(status: {
      controllerId: string;
      reachable: boolean;
      info: WledInfo | null;
      state: WledState | null;
      polledAt: string;
    }): void {
      db.prepare(
        `INSERT INTO controller_status (controller_id, reachable, info, state, polled_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(controller_id) DO UPDATE SET
           reachable = excluded.reachable,
           info = excluded.info,
           state = excluded.state,
           polled_at = excluded.polled_at`
      ).run(
        status.controllerId,
        status.reachable ? 1 : 0,
        status.info ? JSON.stringify(status.info) : null,
        status.state ? JSON.stringify(status.state) : null,
        status.polledAt
      );
    }
  };
}
