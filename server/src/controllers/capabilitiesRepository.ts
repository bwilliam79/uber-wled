import type Database from 'better-sqlite3';
import type { ControllerCapabilities } from '../wled/capabilities.js';

// The `fxdata` column stores the PARSED FxMeta[] JSON (parsed once at
// refresh time); the repository surfaces it as `fxMeta` per the
// ControllerCapabilities contract.
export function createCapabilitiesRepository(db: Database.Database) {
  return {
    get(controllerId: string): ControllerCapabilities | undefined {
      const row = db
        .prepare('SELECT * FROM controller_capabilities WHERE controller_id = ?')
        .get(controllerId) as any;
      if (!row) return undefined;
      return {
        vid: row.vid,
        effects: JSON.parse(row.effects),
        palettes: JSON.parse(row.palettes),
        fxMeta: JSON.parse(row.fxdata),
        palettePreviews: JSON.parse(row.palette_previews),
        fetchedAt: row.fetched_at
      };
    },
    upsert(controllerId: string, caps: ControllerCapabilities): void {
      db.prepare(
        `INSERT INTO controller_capabilities
           (controller_id, vid, effects, palettes, fxdata, palette_previews, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(controller_id) DO UPDATE SET
           vid = excluded.vid,
           effects = excluded.effects,
           palettes = excluded.palettes,
           fxdata = excluded.fxdata,
           palette_previews = excluded.palette_previews,
           fetched_at = excluded.fetched_at`
      ).run(
        controllerId,
        caps.vid,
        JSON.stringify(caps.effects),
        JSON.stringify(caps.palettes),
        JSON.stringify(caps.fxMeta),
        JSON.stringify(caps.palettePreviews),
        caps.fetchedAt
      );
    }
  };
}
