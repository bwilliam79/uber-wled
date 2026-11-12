import type Database from 'better-sqlite3';
import { withHostLock, type ApplyResult } from '../control/applyV2.js';
import { createControllerRepository } from '../controllers/repository.js';
import { createThemeRepository, type CustomTheme } from '../themes/repository.js';
import { getInfo, getState, setState } from '../wled/client.js';
import type { WledSegmentPatch } from '../wled/types.js';
import type { SplitAssignment } from './assignment.js';
import { createGameTriggerRepository } from './repository.js';

interface SavedSegment {
  id: number;
  start: number;
  stop: number;
}

/**
 * Master brightness scales every segment. 255 lets each half use its theme
 * brightness as segment bri, which matches a whole-controller theme apply
 * (that sets master bri and leaves segment bri at 255).
 */
function segmentForTheme(
  theme: CustomTheme,
  controllerId: string,
  id: number,
  start: number,
  stop: number
): WledSegmentPatch {
  const seg: WledSegmentPatch = {
    id,
    start,
    stop,
    on: true,
    bri: theme.brightness,
    fx: theme.effect,
    pal: theme.palette,
    col: theme.colors,
    sx: theme.speed,
    ix: theme.intensity
  };
  const rev = theme.directions?.[controllerId]?.rev;
  if (typeof rev === 'boolean') seg.rev = rev;
  return seg;
}

function loadSnapshotOwner(
  db: Database.Database,
  controllerId: string
): { espnEventId: string } | undefined {
  const row = db
    .prepare('SELECT espn_event_id FROM game_segment_restore WHERE controller_id = ?')
    .get(controllerId) as { espn_event_id: string } | undefined;
  return row ? { espnEventId: row.espn_event_id } : undefined;
}

function rekeySnapshot(db: Database.Database, controllerId: string, espnEventId: string): void {
  db.prepare('UPDATE game_segment_restore SET espn_event_id = ? WHERE controller_id = ?').run(
    espnEventId,
    controllerId
  );
}

/** The two halves applySplitLook writes: [0, mid) and [mid, count). */
function isProducedSplitLayout(
  segments: { id: number; start: number; stop: number }[],
  count: number
): boolean {
  const live = segments.filter((segment) => segment.stop > segment.start);
  if (live.length !== 2) return false;
  const mid = Math.floor(count / 2);
  const first = live.find((segment) => segment.id === 0);
  const second = live.find((segment) => segment.id === 1);
  if (!first || !second) return false;
  return first.start === 0 && first.stop === mid && second.start === mid && second.stop === count;
}

function saveSnapshot(
  db: Database.Database,
  controllerId: string,
  espnEventId: string,
  segments: SavedSegment[]
): void {
  db.prepare(
    `INSERT INTO game_segment_restore (controller_id, espn_event_id, segments)
     VALUES (?, ?, ?)
     ON CONFLICT(controller_id) DO UPDATE SET
       espn_event_id = excluded.espn_event_id,
       segments = excluded.segments`
  ).run(controllerId, espnEventId, JSON.stringify(segments));
}

function loadSnapshot(
  db: Database.Database,
  controllerId: string,
  espnEventId: string
): SavedSegment[] | undefined {
  const row = db
    .prepare(
      'SELECT segments FROM game_segment_restore WHERE controller_id = ? AND espn_event_id = ?'
    )
    .get(controllerId, espnEventId) as { segments: string } | undefined;
  if (!row) return undefined;
  try {
    const value = JSON.parse(row.segments);
    if (!Array.isArray(value)) return undefined;
    const segments: SavedSegment[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const id = (entry as { id?: unknown }).id;
      const start = (entry as { start?: unknown }).start;
      const stop = (entry as { stop?: unknown }).stop;
      if (typeof id !== 'number' || typeof start !== 'number' || typeof stop !== 'number') continue;
      segments.push({ id, start, stop });
    }
    return segments;
  } catch {
    return undefined;
  }
}

function deleteSnapshot(db: Database.Database, controllerId: string): void {
  db.prepare('DELETE FROM game_segment_restore WHERE controller_id = ?').run(controllerId);
}

/**
 * Replace the controller's segments with two halves: [0, mid) LSU and
 * [mid, count) Arkansas. The previous bounds are saved so release can put
 * them back. Retries the device write once. The snapshot from the first
 * attempt is kept so a retry cannot record the already-split layout.
 */
export async function applySplitLook(
  db: Database.Database,
  controllerId: string,
  assignment: SplitAssignment,
  espnEventId: string
): Promise<ApplyResult> {
  const fail = (error: string): ApplyResult => ({ controllerId, wledSegId: null, ok: false, error });
  const controller = createControllerRepository(db).list().find((c) => c.id === controllerId);
  if (!controller) return fail('controller not found');
  const themes = createThemeRepository(db);
  const lsu = themes.get(assignment.lsu);
  const ark = themes.get(assignment.ark);
  if (!lsu) return fail(`theme ${assignment.lsu} not found`);
  if (!ark) return fail(`theme ${assignment.ark} not found`);

  let saved = false;
  const attempt = async (): Promise<void> => {
    await withHostLock(controller.host, async () => {
      const info = await getInfo(controller.host);
      const state = await getState(controller.host);
      const count = info.leds?.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 2) {
        throw new Error('led count too small to split');
      }
      const mid = Math.floor(count / 2);
      if (!saved) {
        const bounds = state.seg.map((segment) => ({ id: segment.id, start: segment.start, stop: segment.stop }));
        const owner = loadSnapshotOwner(db, controllerId);
        const ownerActive =
          !!owner && createGameTriggerRepository(db).get(owner.espnEventId)?.status === 'active';
        // A later overlapping split must not replace the pre-game bounds with
        // the halves this function just wrote. Keep that row and point it at
        // the new event. Never store the produced two-segment layout.
        if (owner && ownerActive) {
          rekeySnapshot(db, controllerId, espnEventId);
        } else if (!isProducedSplitLayout(bounds, count)) {
          saveSnapshot(db, controllerId, espnEventId, bounds);
        }
        saved = true;
      }
      const extras = state.seg
        .filter((segment) => segment.id !== 0 && segment.id !== 1)
        .map((segment) => ({ id: segment.id, stop: 0 }));
      await setState(controller.host, {
        on: true,
        bri: 255,
        udpn: { nn: true },
        seg: [
          segmentForTheme(lsu, controllerId, 0, 0, mid),
          segmentForTheme(ark, controllerId, 1, mid, count),
          ...extras
        ]
      });
    });
  };

  try {
    await attempt();
    return { controllerId, wledSegId: null, ok: true };
  } catch {
    try {
      await attempt();
      return { controllerId, wledSegId: null, ok: true };
    } catch (secondError: unknown) {
      const message = secondError instanceof Error ? secondError.message : 'unknown error';
      return fail(message);
    }
  }
}

/**
 * Put back the segment bounds captured at apply time, then drop the half
 * that was added (WLED deletes a segment when it receives stop 0). No-op
 * when this controller has no snapshot for the event. The extra segment is
 * removed before the original bounds are written so the ranges do not overlap.
 */
export async function restoreSplitLook(
  db: Database.Database,
  controllerId: string,
  espnEventId: string
): Promise<void> {
  const saved = loadSnapshot(db, controllerId, espnEventId);
  if (!saved) return;
  const controller = createControllerRepository(db).list().find((c) => c.id === controllerId);
  if (!controller) {
    deleteSnapshot(db, controllerId);
    return;
  }
  const savedIds = new Set(saved.map((segment) => segment.id));
  const seg: WledSegmentPatch[] = [
    ...[0, 1]
      .filter((id) => !savedIds.has(id))
      .map((id) => ({ id, stop: 0 })),
    ...saved.map((segment) => ({ id: segment.id, start: segment.start, stop: segment.stop }))
  ];
  const write = () => withHostLock(controller.host, () => setState(controller.host, { udpn: { nn: true }, seg }));
  try {
    await write();
  } catch {
    await write();
  }
  deleteSnapshot(db, controllerId);
}
