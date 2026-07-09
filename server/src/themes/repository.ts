import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface CustomTheme {
  id: string;
  name: string;
  effect: number;
  palette: number;
  colors: number[][];
  brightness: number;
  /** WLED effect speed (0–255). Defaults to 128 for themes saved before this existed. */
  speed: number;
  /** WLED effect intensity (0–255). Defaults to 128 for themes saved before this existed. */
  intensity: number;
}

function fromRow(row: any): CustomTheme {
  return {
    id: row.id,
    name: row.name,
    effect: row.effect,
    palette: row.palette,
    colors: JSON.parse(row.colors),
    brightness: row.brightness,
    speed: row.speed ?? 128,
    intensity: row.intensity ?? 128
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
    add(
      input: Omit<CustomTheme, 'id' | 'speed' | 'intensity'> & { speed?: number; intensity?: number }
    ): CustomTheme {
      const id = randomUUID();
      const speed = input.speed ?? 128;
      const intensity = input.intensity ?? 128;
      db.prepare(
        `INSERT INTO themes (id, name, effect, palette, colors, brightness, speed, intensity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, input.name, input.effect, input.palette, JSON.stringify(input.colors),
        input.brightness, speed, intensity
      );
      return { id, ...input, speed, intensity };
    },
    update(id: string, patch: Partial<Omit<CustomTheme, 'id'>>): CustomTheme {
      const current = db.prepare('SELECT * FROM themes WHERE id = ?').get(id);
      if (!current) throw new Error(`theme ${id} not found`);
      const next = { ...fromRow(current), ...patch };
      db.prepare(
        `UPDATE themes SET name = ?, effect = ?, palette = ?, colors = ?, brightness = ?,
         speed = ?, intensity = ? WHERE id = ?`
      ).run(
        next.name, next.effect, next.palette, JSON.stringify(next.colors),
        next.brightness, next.speed, next.intensity, id
      );
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM themes WHERE id = ?').run(id);
    }
  };
}
