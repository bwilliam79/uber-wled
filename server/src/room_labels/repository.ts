import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface RoomLabel {
  id: string;
  name: string;
  x: number;
  y: number;
}

function fromRow(row: any): RoomLabel {
  return { id: row.id, name: row.name, x: row.x, y: row.y };
}

export function createRoomLabelRepository(db: Database.Database) {
  return {
    list(): RoomLabel[] {
      return db.prepare('SELECT * FROM room_labels').all().map(fromRow);
    },
    add(input: Omit<RoomLabel, 'id'>): RoomLabel {
      const id = randomUUID();
      db.prepare('INSERT INTO room_labels (id, name, x, y) VALUES (?, ?, ?, ?)')
        .run(id, input.name, input.x, input.y);
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<RoomLabel, 'id'>>): RoomLabel {
      const current = db.prepare('SELECT * FROM room_labels WHERE id = ?').get(id);
      if (!current) throw new Error(`room label ${id} not found`);
      const next = { ...fromRow(current), ...patch };
      db.prepare('UPDATE room_labels SET name = ?, x = ?, y = ? WHERE id = ?')
        .run(next.name, next.x, next.y, id);
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM room_labels WHERE id = ?').run(id);
    }
  };
}
