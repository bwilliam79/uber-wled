import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface GroupMember {
  controllerId: string;
  wledSegId: number;
}

export interface Group {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  members: GroupMember[];
}

export function createGroupRepository(db: Database.Database) {
  function membersFor(groupId: string): GroupMember[] {
    // ORDER BY rowid: without an explicit order, sqlite may satisfy this
    // WHERE clause via the (group_id, controller_id, wled_seg_id) primary-key
    // index and return rows in key order rather than insertion order, which
    // breaks callers (e.g. expandTargets) that rely on member order.
    return db
      .prepare('SELECT rowid, controller_id, wled_seg_id FROM group_members WHERE group_id = ? ORDER BY rowid')
      .all(groupId)
      .map((r: any) => ({ controllerId: r.controller_id, wledSegId: r.wled_seg_id }));
  }

  function setMembers(groupId: string, members: GroupMember[]): void {
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId);
    const insert = db.prepare(
      'INSERT INTO group_members (group_id, controller_id, wled_seg_id) VALUES (?, ?, ?)'
    );
    for (const m of members) insert.run(groupId, m.controllerId, m.wledSegId);
  }

  function fromRow(row: any): Group {
    return {
      id: row.id,
      name: row.name,
      icon: row.icon ?? null,
      sortOrder: row.sort_order,
      members: membersFor(row.id)
    };
  }

  function list(): Group[] {
    return db.prepare('SELECT * FROM groups ORDER BY sort_order, name').all().map(fromRow);
  }

  return {
    list,
    add(input: { name: string; members: GroupMember[]; icon?: string | null; sortOrder?: number }): Group {
      const id = randomUUID();
      const sortOrder =
        input.sortOrder ??
        ((db.prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM groups').get() as any).next as number);
      db.prepare('INSERT INTO groups (id, name, icon, sort_order) VALUES (?, ?, ?, ?)').run(
        id,
        input.name,
        input.icon ?? null,
        sortOrder
      );
      setMembers(id, input.members);
      return { id, name: input.name, icon: input.icon ?? null, sortOrder, members: input.members };
    },
    update(
      id: string,
      patch: { name?: string; members?: GroupMember[]; icon?: string | null; sortOrder?: number }
    ): Group {
      const row: any = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
      if (!row) throw new Error(`group ${id} not found`);
      const name = patch.name ?? row.name;
      const icon = patch.icon !== undefined ? patch.icon : row.icon ?? null;
      const sortOrder = patch.sortOrder ?? row.sort_order;
      db.prepare('UPDATE groups SET name = ?, icon = ?, sort_order = ? WHERE id = ?').run(
        name,
        icon,
        sortOrder,
        id
      );
      if (patch.members) setMembers(id, patch.members);
      return { id, name, icon, sortOrder, members: membersFor(id) };
    },
    reorder(orderedIds: string[]): Group[] {
      const assign = db.prepare('UPDATE groups SET sort_order = ? WHERE id = ?');
      const tx = db.transaction((ids: string[]) => {
        ids.forEach((groupId, index) => assign.run(index, groupId));
      });
      tx(orderedIds);
      return list();
    },
    remove(id: string): void {
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    }
  };
}
