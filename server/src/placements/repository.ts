import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Point } from '../segments/recommend.js';

export interface Placement {
  id: string;
  floorplanId: string;
  controllerId: string;
  wledSegId: number;
  points: Point[];
  lengthMeters: number | null;
}

function fromRow(row: any): Placement {
  return {
    id: row.id,
    floorplanId: row.floorplan_id,
    controllerId: row.controller_id,
    wledSegId: row.wled_seg_id,
    points: JSON.parse(row.points),
    lengthMeters: row.length_meters
  };
}

export function createPlacementRepository(db: Database.Database) {
  return {
    listByFloorplan(floorplanId: string): Placement[] {
      return db.prepare('SELECT * FROM placements WHERE floorplan_id = ?').all(floorplanId).map(fromRow);
    },
    add(input: Omit<Placement, 'id'>): Placement {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO placements (id, floorplan_id, controller_id, wled_seg_id, points, length_meters) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, input.floorplanId, input.controllerId, input.wledSegId, JSON.stringify(input.points), input.lengthMeters);
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<Placement, 'id'>>): Placement {
      const current = db.prepare('SELECT * FROM placements WHERE id = ?').get(id);
      if (!current) throw new Error(`placement ${id} not found`);
      const existing = fromRow(current);
      const next = { ...existing, ...patch };
      db.prepare(
        'UPDATE placements SET floorplan_id = ?, controller_id = ?, wled_seg_id = ?, points = ?, length_meters = ? WHERE id = ?'
      ).run(next.floorplanId, next.controllerId, next.wledSegId, JSON.stringify(next.points), next.lengthMeters, id);
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM placements WHERE id = ?').run(id);
    }
  };
}
