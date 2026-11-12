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

interface Bounds {
  id: number;
  start: number;
  stop: number;
}

interface PlannedSegment {
  start: number;
  stop: number;
  theme: 'lsu' | 'ark';
}

function liveSegments(segments: Bounds[]): Bounds[] {
  return segments.filter((segment) => segment.stop > segment.start).sort((a, b) => a.id - b.id);
}

/** Split one segment at floor((start + stop) / 2). A 1-LED segment stays LSU. */
function splitOne(segment: Bounds): PlannedSegment[] {
  const length = segment.stop - segment.start;
  if (length < 2) return [{ start: segment.start, stop: segment.stop, theme: 'lsu' }];
  const mid = Math.floor((segment.start + segment.stop) / 2);
  return [
    { start: segment.start, stop: mid, theme: 'lsu' },
    { start: mid, stop: segment.stop, theme: 'ark' }
  ];
}

/** Per-segment plan, or null when nothing on the strip can be split. */
function planPerSegment(segments: Bounds[]): PlannedSegment[] | null {
  const usable = liveSegments(segments);
  if (usable.length === 0) return null;
  return usable.flatMap(splitOne);
}

function planWholeStrip(count: number): PlannedSegment[] {
  const mid = Math.floor(count / 2);
  return [
    { start: 0, stop: mid, theme: 'lsu' },
    { start: mid, stop: count, theme: 'ark' }
  ];
}

function maxSegments(info: { leds?: { maxseg?: number } }): number | undefined {
  const maxseg = info.leds?.maxseg;
  if (typeof maxseg !== 'number' || !Number.isInteger(maxseg) || maxseg < 1) return undefined;
  return maxseg;
}

function choosePlan(segments: Bounds[], count: number, maxseg: number | undefined): PlannedSegment[] {
  const perSegment = planPerSegment(segments);
  if (!perSegment) return planWholeStrip(count);
  if (maxseg !== undefined && perSegment.length > maxseg) return planWholeStrip(count);
  return perSegment;
}

/**
 * True when these bounds are a layout applySplitLook writes: the whole-strip
 * halves, or each earlier segment split at its own midpoint (a 1-LED segment
 * left whole). Ids are 0..n-1, which is how the write numbers them.
 */
function isProducedSplitLayout(segments: Bounds[], count: number): boolean {
  const live = liveSegments(segments);
  if (live.length === 0) return false;
  if (live.some((segment, index) => segment.id !== index)) return false;
  if (live.length === 2 && count >= 2) {
    const mid = Math.floor(count / 2);
    const [first, second] = live;
    if (first.start === 0 && first.stop === mid && second.start === mid && second.stop === count) return true;
  }
  let sawPair = false;
  let index = 0;
  while (index < live.length) {
    const current = live[index];
    const next = live[index + 1];
    if (next && next.start === current.stop) {
      const mid = Math.floor((current.start + next.stop) / 2);
      if (current.stop === mid) {
        sawPair = true;
        index += 2;
        continue;
      }
    }
    if (current.stop - current.start >= 2) return false;
    index += 1;
  }
  return sawPair;
}

/** Re-apply team themes on a split that is already on the strip, without splitting it again. */
function planProducedSplit(segments: Bounds[]): PlannedSegment[] {
  const live = liveSegments(segments);
  const planned: PlannedSegment[] = [];
  let index = 0;
  while (index < live.length) {
    const current = live[index];
    const next = live[index + 1];
    if (next && next.start === current.stop) {
      const mid = Math.floor((current.start + next.stop) / 2);
      if (current.stop === mid) {
        planned.push({ start: current.start, stop: current.stop, theme: 'lsu' });
        planned.push({ start: next.start, stop: next.stop, theme: 'ark' });
        index += 2;
        continue;
      }
    }
    planned.push({ start: current.start, stop: current.stop, theme: 'lsu' });
    index += 1;
  }
  return planned;
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

function parseSnapshot(raw: string): SavedSegment[] | undefined {
  try {
    const value = JSON.parse(raw);
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
  return parseSnapshot(row.segments);
}

function loadAnySnapshot(db: Database.Database, controllerId: string): SavedSegment[] | undefined {
  const row = db.prepare('SELECT segments FROM game_segment_restore WHERE controller_id = ?').get(controllerId) as
    | { segments: string }
    | undefined;
  if (!row) return undefined;
  return parseSnapshot(row.segments);
}

function deleteSnapshot(db: Database.Database, controllerId: string): void {
  db.prepare('DELETE FROM game_segment_restore WHERE controller_id = ?').run(controllerId);
}

/**
 * Split each pre-game segment in half: the first half plays LSU and the
 * second plays Arkansas. A segment shorter than two LEDs keeps LSU across
 * its whole range. With no usable segments, or when the split would need
 * more segments than leds.maxseg, the whole strip is halved instead.
 * The previous bounds are saved so release can put them back. Retries the
 * device write once. The snapshot from the first attempt is kept so a retry
 * cannot record the already-split layout.
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
      const bounds = state.seg.map((segment) => ({ id: segment.id, start: segment.start, stop: segment.stop }));
      if (!saved) {
        const owner = loadSnapshotOwner(db, controllerId);
        const ownerActive =
          !!owner && createGameTriggerRepository(db).get(owner.espnEventId)?.status === 'active';
        // A later overlapping split must not replace the pre-game bounds with
        // the split this function just wrote. Keep that row and point it at
        // the new event. Never store a produced split layout.
        if (owner && ownerActive) {
          rekeySnapshot(db, controllerId, espnEventId);
        } else if (!isProducedSplitLayout(bounds, count)) {
          saveSnapshot(db, controllerId, espnEventId, bounds);
        }
        saved = true;
      }
      const stored = loadAnySnapshot(db, controllerId);
      const source = stored && !isProducedSplitLayout(stored, count) ? stored : undefined;
      const plan = source
        ? choosePlan(source, count, maxSegments(info))
        : isProducedSplitLayout(bounds, count)
          ? planProducedSplit(bounds)
          : choosePlan(bounds, count, maxSegments(info));
      const written = plan.map((piece, id) =>
        segmentForTheme(piece.theme === 'lsu' ? lsu : ark, controllerId, id, piece.start, piece.stop)
      );
      const writtenIds = new Set(written.map((segment) => segment.id));
      const extras = state.seg
        .filter((segment) => !writtenIds.has(segment.id))
        .map((segment) => ({ id: segment.id, stop: 0 }));
      await setState(controller.host, {
        on: true,
        bri: 255,
        udpn: { nn: true },
        seg: [...written, ...extras]
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
 * Put back the segment bounds captured at apply time, then drop the segments
 * the split added (WLED deletes a segment when it receives stop 0). No-op
 * when this controller has no snapshot for the event. Added segments are
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
  const planned = planPerSegment(saved);
  const producedCount = planned ? planned.length : 2;
  const seg: WledSegmentPatch[] = [
    ...Array.from({ length: producedCount }, (_, id) => id)
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
