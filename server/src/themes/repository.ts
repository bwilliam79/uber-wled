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
  /** Optional per-controller segment direction, keyed by controller id.
   *  Controllers without an entry keep whatever `rev` the device already has. */
  directions: ThemeDirections | null;
}

export type ThemeDirections = Record<string, { rev: boolean }>;

/** Parses the stored JSON; anything malformed degrades to "no directions". */
export function parseDirections(raw: unknown): ThemeDirections | null {
  if (raw == null || raw === '') return null;
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const result = validateDirections(value);
    return 'error' in result ? null : result.directions;
  } catch {
    return null;
  }
}

/** Validates an API/import value. null/undefined/{} mean "no directions". */
export function validateDirections(value: unknown): { directions: ThemeDirections | null } | { error: string } {
  if (value == null) return { directions: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { error: 'directions must be an object keyed by controller id' };
  const out: ThemeDirections = {};
  for (const [controllerId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (controllerId.trim() === '') return { error: 'directions keys must be controller ids' };
    const rev = (entry as { rev?: unknown } | null)?.rev;
    if (typeof rev !== 'boolean') return { error: `directions.${controllerId}.rev must be a boolean` };
    out[controllerId] = { rev };
  }
  return { directions: Object.keys(out).length > 0 ? out : null };
}

/** controllerId → rev map for ControlPatch.segRev, or undefined when none. */
export function directionsToSegRev(directions: ThemeDirections | null | undefined): Record<string, boolean> | undefined {
  if (!directions) return undefined;
  const entries = Object.entries(directions);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([id, d]) => [id, d.rev]));
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
    intensity: row.intensity ?? 128,
    directions: parseDirections(row.directions)
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
      input: Omit<CustomTheme, 'id' | 'speed' | 'intensity' | 'directions'> & {
        speed?: number; intensity?: number; directions?: ThemeDirections | null;
      }
    ): CustomTheme {
      const id = randomUUID();
      const speed = input.speed ?? 128;
      const intensity = input.intensity ?? 128;
      const directions = input.directions ?? null;
      db.prepare(
        `INSERT INTO themes (id, name, effect, palette, colors, brightness, speed, intensity, directions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, input.name, input.effect, input.palette, JSON.stringify(input.colors),
        input.brightness, speed, intensity, directions ? JSON.stringify(directions) : null
      );
      return { id, ...input, speed, intensity, directions };
    },
    update(id: string, patch: Partial<Omit<CustomTheme, 'id'>>): CustomTheme {
      const current = db.prepare('SELECT * FROM themes WHERE id = ?').get(id);
      if (!current) throw new Error(`theme ${id} not found`);
      // undefined fields in the patch mean "keep the stored value".
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const next: CustomTheme = { ...fromRow(current), ...defined };
      db.prepare(
        `UPDATE themes SET name = ?, effect = ?, palette = ?, colors = ?, brightness = ?,
         speed = ?, intensity = ?, directions = ? WHERE id = ?`
      ).run(
        next.name, next.effect, next.palette, JSON.stringify(next.colors),
        next.brightness, next.speed, next.intensity,
        next.directions ? JSON.stringify(next.directions) : null, id
      );
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM themes WHERE id = ?').run(id);
    }
  };
}
