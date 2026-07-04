import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Point } from '../segments/recommend.js';

export interface Strip {
  id: string;
  controllerId: string;
  wledSegId: number;
  points: Point[];
  label: string | null;
}

function fromRow(row: any): Strip {
  return {
    id: row.id,
    controllerId: row.controller_id,
    wledSegId: row.wled_seg_id,
    points: JSON.parse(row.points),
    label: row.label ?? null
  };
}

export function createStripRepository(db: Database.Database) {
  return {
    list(): Strip[] {
      return db.prepare('SELECT * FROM strips').all().map(fromRow);
    },
    add(input: Omit<Strip, 'id'>): Strip {
      const id = randomUUID();
      db.prepare('INSERT INTO strips (id, controller_id, wled_seg_id, points, label) VALUES (?, ?, ?, ?, ?)')
        .run(id, input.controllerId, input.wledSegId, JSON.stringify(input.points), input.label);
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<Strip, 'id'>>): Strip {
      const current = db.prepare('SELECT * FROM strips WHERE id = ?').get(id);
      if (!current) throw new Error(`strip ${id} not found`);
      const existing = fromRow(current);
      const next = { ...existing, ...patch };
      db.prepare('UPDATE strips SET controller_id = ?, wled_seg_id = ?, points = ?, label = ? WHERE id = ?')
        .run(next.controllerId, next.wledSegId, JSON.stringify(next.points), next.label, id);
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM strips WHERE id = ?').run(id);
    }
  };
}
