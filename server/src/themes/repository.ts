import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface CustomTheme {
  id: string;
  name: string;
  effect: number;
  palette: number;
  colors: number[][];
  brightness: number;
}

function fromRow(row: any): CustomTheme {
  return {
    id: row.id,
    name: row.name,
    effect: row.effect,
    palette: row.palette,
    colors: JSON.parse(row.colors),
    brightness: row.brightness
  };
}

export function createThemeRepository(db: Database.Database) {
  return {
    list(): CustomTheme[] {
      return db.prepare('SELECT * FROM themes ORDER BY name').all().map(fromRow);
    },
    get(id: string): CustomTheme | undefined {
      const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(id);
      return row ? fromRow(row) : undefined;
    },
    add(input: Omit<CustomTheme, 'id'>): CustomTheme {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO themes (id, name, effect, palette, colors, brightness) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, input.name, input.effect, input.palette, JSON.stringify(input.colors), input.brightness);
      return { id, ...input };
    },
    remove(id: string): void {
      db.prepare('DELETE FROM themes WHERE id = ?').run(id);
    }
  };
}
