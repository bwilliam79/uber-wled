import type Database from 'better-sqlite3';

export type LookSource = 'manual' | 'calendar' | 'schedule';

export interface ActiveLook {
  controllerId: string;
  themeId: string;
  source: LookSource;
  sourceId: string | null;
  appliedAt: string;
  expiresAt: string | null;
}

export interface ActiveLookInput {
  controllerId: string;
  themeId: string;
  source: LookSource;
  sourceId?: string | null;
  appliedAt: string;
  expiresAt?: string | null;
}

function fromRow(row: {
  controller_id: string;
  theme_id: string;
  source: LookSource;
  source_id: string | null;
  applied_at: string;
  expires_at: string | null;
}): ActiveLook {
  return {
    controllerId: row.controller_id,
    themeId: row.theme_id,
    source: row.source,
    sourceId: row.source_id,
    appliedAt: row.applied_at,
    expiresAt: row.expires_at
  };
}

export function createActiveLookRepository(db: Database.Database) {
  return {
    get(controllerId: string): ActiveLook | undefined {
      const row = db.prepare('SELECT * FROM controller_active_look WHERE controller_id = ?').get(controllerId) as
        | Parameters<typeof fromRow>[0]
        | undefined;
      return row ? fromRow(row) : undefined;
    },
    list(): ActiveLook[] {
      return (
        db.prepare('SELECT * FROM controller_active_look ORDER BY controller_id').all() as Parameters<typeof fromRow>[0][]
      ).map(fromRow);
    },
    /** Insert or replace the whole-controller look. */
    set(input: ActiveLookInput): ActiveLook {
      const look: ActiveLook = {
        controllerId: input.controllerId,
        themeId: input.themeId,
        source: input.source,
        sourceId: input.sourceId ?? null,
        appliedAt: input.appliedAt,
        expiresAt: input.expiresAt ?? null
      };
      db.prepare(
        `INSERT INTO controller_active_look
           (controller_id, theme_id, source, source_id, applied_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(controller_id) DO UPDATE SET
           theme_id = excluded.theme_id,
           source = excluded.source,
           source_id = excluded.source_id,
           applied_at = excluded.applied_at,
           expires_at = excluded.expires_at`
      ).run(look.controllerId, look.themeId, look.source, look.sourceId, look.appliedAt, look.expiresAt);
      return look;
    },
    clear(controllerId: string): void {
      db.prepare('DELETE FROM controller_active_look WHERE controller_id = ?').run(controllerId);
    }
  };
}
