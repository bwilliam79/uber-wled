import type Database from 'better-sqlite3';
import { createGroupRepository } from '../groups/repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { getState, setState } from '../wled/client.js';
import type { WledSegment, WledStatePatch } from '../wled/types.js';

export type Target =
  | { kind: 'controller'; controllerId: string }
  | { kind: 'segment'; controllerId: string; wledSegId: number }
  | { kind: 'group'; groupId: string };

export interface SegPatch {
  fxName?: string; fxId?: number;      // name wins if both; resolved per device
  palName?: string; palId?: number;
  col?: number[][];                    // up to 3 slots, each [r,g,b] or [r,g,b,w]
  sx?: number; ix?: number; c1?: number; c2?: number; c3?: number;
  o1?: boolean; o2?: boolean; o3?: boolean;
  cct?: number;
  on?: boolean; bri?: number;
}

export interface ControlPatch {
  on?: boolean;
  bri?: number;                        // 1-255
  transition?: number;                 // WLED units (100ms)
  ps?: number;                         // apply device preset id (device-local ids —
                                       // client restricts to single-controller selections)
  nl?: { on?: boolean; dur?: number; mode?: 0 | 1 | 2 | 3; tbri?: number };
  seg?: SegPatch;
}

export interface ApplyResult {
  controllerId: string;
  wledSegId: number | null;            // null = whole-controller target
  ok: boolean;
  error?: string;
}

export class GroupNotFoundError extends Error {
  constructor(groupId: string) {
    super(`group not found: ${groupId}`);
    this.name = 'GroupNotFoundError';
  }
}

export interface ResolvedTarget {
  controllerId: string;
  wledSegId: number | null;
}

export function expandTargets(db: Database.Database, targets: Target[]): ResolvedTarget[] {
  const groups = createGroupRepository(db);
  const flat: ResolvedTarget[] = [];
  for (const target of targets) {
    if (target.kind === 'controller') {
      flat.push({ controllerId: target.controllerId, wledSegId: null });
    } else if (target.kind === 'segment') {
      flat.push({ controllerId: target.controllerId, wledSegId: target.wledSegId });
    } else {
      const group = groups.list().find((g) => g.id === target.groupId);
      if (!group) throw new GroupNotFoundError(target.groupId);
      for (const member of group.members) {
        flat.push({ controllerId: member.controllerId, wledSegId: member.wledSegId });
      }
    }
  }

  const controllerLevel = new Set(
    flat.filter((t) => t.wledSegId === null).map((t) => t.controllerId)
  );
  const seen = new Set<string>();
  const result: ResolvedTarget[] = [];
  for (const t of flat) {
    // A whole-controller target already patches every segment of that
    // controller, so segment targets for it are subsumed.
    if (t.wledSegId !== null && controllerLevel.has(t.controllerId)) continue;
    const key = `${t.controllerId}:${t.wledSegId ?? '*'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
}

export function resolveNameToId(names: string[] | undefined, name: string): number | undefined {
  if (!names) return undefined;
  const wanted = name.trim().toLowerCase();
  const index = names.findIndex((n) => n.trim().toLowerCase() === wanted);
  return index === -1 ? undefined : index;
}

interface CachedNames {
  effects: string[];
  palettes: string[];
}

function getCachedNames(db: Database.Database, controllerId: string): CachedNames | undefined {
  const row = db
    .prepare('SELECT effects, palettes FROM controller_capabilities WHERE controller_id = ?')
    .get(controllerId) as { effects: string; palettes: string } | undefined;
  if (!row) return undefined;
  return { effects: JSON.parse(row.effects), palettes: JSON.parse(row.palettes) };
}

export type BuildSegPatchResult = { seg: Partial<WledSegment> } | { error: string };

export function buildSegPatch(
  db: Database.Database,
  controllerId: string,
  patch: SegPatch
): BuildSegPatchResult {
  const seg: Partial<WledSegment> = {};
  const needsNames = patch.fxName !== undefined || patch.palName !== undefined;
  const names = needsNames ? getCachedNames(db, controllerId) : undefined;

  if (patch.fxName !== undefined) {
    const fx = resolveNameToId(names?.effects, patch.fxName);
    if (fx === undefined) return { error: `effect not found: ${patch.fxName}` };
    seg.fx = fx;
  } else if (patch.fxId !== undefined) {
    seg.fx = patch.fxId;
  }

  if (patch.palName !== undefined) {
    const pal = resolveNameToId(names?.palettes, patch.palName);
    if (pal === undefined) return { error: `palette not found: ${patch.palName}` };
    seg.pal = pal;
  } else if (patch.palId !== undefined) {
    seg.pal = patch.palId;
  }

  if (patch.col !== undefined) seg.col = patch.col;
  if (patch.sx !== undefined) seg.sx = patch.sx;
  if (patch.ix !== undefined) seg.ix = patch.ix;
  if (patch.c1 !== undefined) seg.c1 = patch.c1;
  if (patch.c2 !== undefined) seg.c2 = patch.c2;
  if (patch.c3 !== undefined) seg.c3 = patch.c3;
  if (patch.o1 !== undefined) seg.o1 = patch.o1;
  if (patch.o2 !== undefined) seg.o2 = patch.o2;
  if (patch.o3 !== undefined) seg.o3 = patch.o3;
  if (patch.cct !== undefined) seg.cct = patch.cct;
  if (patch.on !== undefined) seg.on = patch.on;
  if (patch.bri !== undefined) seg.bri = patch.bri;
  return { seg };
}

// Per-host write queue: a whole-controller patch does a GET (enumerate
// segment ids) then a POST as two separate round trips. Without this, two
// overlapping applyControlPatch calls for the *same* controller (rapid
// successive UI actions, a retry racing a fresh call, multiple browser
// tabs/users) can interleave their GET/POST pairs — e.g. call A's POST can
// land between call B's GET and POST, and then B's write, built from its
// now-stale segment/whatever-else snapshot, can clobber part of what A just
// set. Chaining every write for a given host onto one promise makes the
// GET+POST pair atomic with respect to other writes to that same device;
// writes to different hosts are unaffected and still run fully in parallel.
const hostWriteQueues = new Map<string, Promise<unknown>>();

function withHostLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const previous = hostWriteQueues.get(host) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Swallow rejections in the queue chain itself (they still propagate to
  // this call's own caller via `next`) so one failed write never wedges
  // every subsequent write to that host.
  hostWriteQueues.set(host, next.catch(() => undefined));
  return next;
}

async function writeTarget(
  host: string,
  target: ResolvedTarget,
  patch: ControlPatch,
  segPatch: Partial<WledSegment> | undefined
): Promise<void> {
  const body: WledStatePatch = { udpn: { nn: true } };
  if (patch.on !== undefined) body.on = patch.on;
  if (patch.bri !== undefined) body.bri = patch.bri;
  if (patch.transition !== undefined) body.transition = patch.transition;
  if (patch.ps !== undefined) body.ps = patch.ps;
  if (patch.nl !== undefined) body.nl = patch.nl;

  await withHostLock(host, async () => {
    if (segPatch) {
      if (target.wledSegId === null) {
        // Whole-controller target: enumerate the device's current segment ids
        // (one GET per controller per apply, per the master contract).
        const state = await getState(host);
        body.seg = state.seg.map((s) => ({ id: s.id, ...segPatch }));
      } else {
        body.seg = [{ id: target.wledSegId, ...segPatch }];
      }
    }
    await setState(host, body);
  });
}

export async function applyControlPatch(
  db: Database.Database,
  targets: Target[],
  patch: ControlPatch
): Promise<ApplyResult[]> {
  const controllers = new Map(createControllerRepository(db).list().map((c) => [c.id, c]));
  const resolved = expandTargets(db, targets); // GroupNotFoundError propagates to the route

  return Promise.all(
    resolved.map(async (target): Promise<ApplyResult> => {
      const controller = controllers.get(target.controllerId);
      if (!controller) {
        return { controllerId: target.controllerId, wledSegId: target.wledSegId, ok: false, error: 'controller not found' };
      }

      let segPatch: Partial<WledSegment> | undefined;
      if (patch.seg) {
        const built = buildSegPatch(db, target.controllerId, patch.seg);
        if ('error' in built) {
          return { controllerId: target.controllerId, wledSegId: target.wledSegId, ok: false, error: built.error };
        }
        segPatch = built.seg;
      }

      try {
        await writeTarget(controller.host, target, patch, segPatch);
        return { controllerId: target.controllerId, wledSegId: target.wledSegId, ok: true };
      } catch {
        // Per-target isolation with exactly one retry (matches v1 behavior).
        try {
          await writeTarget(controller.host, target, patch, segPatch);
          return { controllerId: target.controllerId, wledSegId: target.wledSegId, ok: true };
        } catch (secondError: any) {
          return {
            controllerId: target.controllerId,
            wledSegId: target.wledSegId,
            ok: false,
            error: secondError?.message ?? 'unknown error'
          };
        }
      }
    })
  );
}
