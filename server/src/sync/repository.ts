import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { patchConfig } from '../wled/client.js';
import { allocateBit } from './bitmask.js';

export interface SyncGroup {
  id: string;
  name: string;
  active: boolean;
  bitmask: number | null;
  memberControllerIds: string[];
}

export interface SyncMemberResult {
  controllerId: string;
  ok: boolean;
  error?: string;
}

export class SyncGroupNotFoundError extends Error {
  constructor(id: string) {
    super(`sync group not found: ${id}`);
    this.name = 'SyncGroupNotFoundError';
  }
}

export class SyncMemberConflictError extends Error {
  constructor(controllerId: string, otherGroupName: string) {
    super(`controller ${controllerId} is already an active member of sync group "${otherGroupName}"`);
    this.name = 'SyncMemberConflictError';
  }
}

/** A controller can only be an active member of one sync group's wire bit
 *  at a time — WLED's own grp bitmask *could* express multi-membership via
 *  combined bits, but that's real added complexity (a device's recv.grp
 *  would need the union of every group it's in, recomputed on every other
 *  group's activate/deactivate) with no clear use case yet. Enforced here,
 *  not in the schema, so the rule can evolve without a migration. */
export function createSyncGroupRepository(db: Database.Database, resolveHost: (controllerId: string) => string | undefined) {
  function membersFor(groupId: string): string[] {
    return db
      .prepare('SELECT controller_id FROM sync_group_members WHERE sync_group_id = ? ORDER BY rowid')
      .all(groupId)
      .map((r: any) => r.controller_id);
  }

  function setMembers(groupId: string, controllerIds: string[]): void {
    db.prepare('DELETE FROM sync_group_members WHERE sync_group_id = ?').run(groupId);
    const insert = db.prepare('INSERT INTO sync_group_members (sync_group_id, controller_id) VALUES (?, ?)');
    for (const id of controllerIds) insert.run(groupId, id);
  }

  function fromRow(row: any): SyncGroup {
    return {
      id: row.id,
      name: row.name,
      active: !!row.active,
      bitmask: row.bitmask ?? null,
      memberControllerIds: membersFor(row.id)
    };
  }

  function getOrThrow(id: string): SyncGroup {
    const row = db.prepare('SELECT * FROM sync_groups WHERE id = ?').get(id);
    if (!row) throw new SyncGroupNotFoundError(id);
    return fromRow(row);
  }

  function activeBitsExcept(excludeId: string): number[] {
    return (db.prepare('SELECT bitmask FROM sync_groups WHERE active = 1 AND id != ? AND bitmask IS NOT NULL').all(excludeId) as any[])
      .map((r) => r.bitmask as number);
  }

  /** Throws SyncMemberConflictError if any of `controllerIds` is an active
   *  member of a different sync group. */
  function assertNoConflicts(excludeGroupId: string, controllerIds: string[]): void {
    const others = db
      .prepare(
        `SELECT sg.name AS name, sgm.controller_id AS controller_id
         FROM sync_group_members sgm
         JOIN sync_groups sg ON sg.id = sgm.sync_group_id
         WHERE sg.active = 1 AND sg.id != ?`
      )
      .all(excludeGroupId) as { name: string; controller_id: string }[];
    const byController = new Map(others.map((r) => [r.controller_id, r.name]));
    for (const id of controllerIds) {
      const conflictGroup = byController.get(id);
      if (conflictGroup) throw new SyncMemberConflictError(id, conflictGroup);
    }
  }

  async function writeMemberSync(controllerId: string, patch: Record<string, unknown>): Promise<SyncMemberResult> {
    const host = resolveHost(controllerId);
    if (!host) return { controllerId, ok: false, error: 'controller not found' };
    try {
      await patchConfig(host, { if: { sync: patch } });
      return { controllerId, ok: true };
    } catch (err: any) {
      return { controllerId, ok: false, error: err.message };
    }
  }

  return {
    list(): SyncGroup[] {
      return db.prepare('SELECT * FROM sync_groups ORDER BY name').all().map(fromRow);
    },

    get: getOrThrow,

    add(input: { name: string; memberControllerIds: string[] }): SyncGroup {
      const id = randomUUID();
      db.prepare('INSERT INTO sync_groups (id, name, active, bitmask) VALUES (?, ?, 0, NULL)').run(id, input.name);
      setMembers(id, input.memberControllerIds);
      return { id, name: input.name, active: false, bitmask: null, memberControllerIds: input.memberControllerIds };
    },

    /** Renaming is always fine; changing membership is only allowed while
     *  inactive (deactivate first) — editing membership live would mean
     *  reconciling wire state for whichever controllers left/joined mid-sync,
     *  real complexity with no clear benefit over "stop, edit, restart". */
    rename(id: string, name: string): SyncGroup {
      const existing = getOrThrow(id);
      db.prepare('UPDATE sync_groups SET name = ? WHERE id = ?').run(name, id);
      return { ...existing, name };
    },

    setMembers(id: string, memberControllerIds: string[]): SyncGroup {
      const existing = getOrThrow(id);
      if (existing.active) {
        throw new Error('cannot change membership of an active sync group — deactivate it first');
      }
      setMembers(id, memberControllerIds);
      return { ...existing, memberControllerIds };
    },

    async remove(id: string): Promise<void> {
      const existing = getOrThrow(id);
      if (existing.active) {
        await Promise.allSettled(existing.memberControllerIds.map((cid) => writeMemberSync(cid, { send: { en: false } })));
      }
      db.prepare('DELETE FROM sync_group_members WHERE sync_group_id = ?').run(id);
      db.prepare('DELETE FROM sync_groups WHERE id = ?').run(id);
    },

    /** Assigns an unused sync bit, enables send + configures recv on every
     *  member with that bit, and marks the group active. Per-member writes
     *  are isolated (Promise.allSettled) — one unreachable controller
     *  doesn't block the others or the group's own active/bitmask state,
     *  matching this app's existing per-target-isolation convention in
     *  control/applyV2.ts. Throws before touching any device if another
     *  active group already claims one of these controllers, or if all 8
     *  wire bits are already in use. */
    async activate(id: string): Promise<{ group: SyncGroup; results: SyncMemberResult[] }> {
      const existing = getOrThrow(id);
      if (existing.active) return { group: existing, results: [] };
      assertNoConflicts(id, existing.memberControllerIds);
      const bit = allocateBit(activeBitsExcept(id));

      const results = await Promise.all(
        existing.memberControllerIds.map((cid) =>
          writeMemberSync(cid, {
            send: { en: true, grp: bit },
            recv: { grp: bit, bri: true, col: true, fx: true, pal: true }
          })
        )
      );

      db.prepare('UPDATE sync_groups SET active = 1, bitmask = ? WHERE id = ?').run(bit, id);
      return { group: { ...existing, active: true, bitmask: bit }, results };
    },

    /** Reverts every member's send.en to false (leaving grp values alone —
     *  harmless when nothing is broadcasting on them) and frees the bit for
     *  reallocation. Per-member writes are isolated the same way as
     *  activate(); the group is marked inactive regardless of individual
     *  write failures so it doesn't get stuck "active" forever because one
     *  controller was offline. */
    async deactivate(id: string): Promise<{ group: SyncGroup; results: SyncMemberResult[] }> {
      const existing = getOrThrow(id);
      if (!existing.active) return { group: existing, results: [] };

      const results = await Promise.all(
        existing.memberControllerIds.map((cid) => writeMemberSync(cid, { send: { en: false } }))
      );

      db.prepare('UPDATE sync_groups SET active = 0, bitmask = NULL WHERE id = ?').run(id);
      return { group: { ...existing, active: false, bitmask: null }, results };
    }
  };
}
