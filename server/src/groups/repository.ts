import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface GroupMember {
  controllerId: string;
  wledSegId: number;
}

export interface Group {
  id: string;
  name: string;
  members: GroupMember[];
}

export function createGroupRepository(db: Database.Database) {
  function membersFor(groupId: string): GroupMember[] {
    return db
      .prepare('SELECT controller_id, wled_seg_id FROM group_members WHERE group_id = ?')
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

  return {
    list(): Group[] {
      return db
        .prepare('SELECT * FROM groups ORDER BY name')
        .all()
        .map((row: any) => ({ id: row.id, name: row.name, members: membersFor(row.id) }));
    },
    add(input: { name: string; members: GroupMember[] }): Group {
      const id = randomUUID();
      db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run(id, input.name);
      setMembers(id, input.members);
      return { id, name: input.name, members: input.members };
    },
    update(id: string, patch: { name?: string; members?: GroupMember[] }): Group {
      const row: any = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
      if (!row) throw new Error(`group ${id} not found`);
      const name = patch.name ?? row.name;
      db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id);
      if (patch.members) setMembers(id, patch.members);
      return { id, name, members: membersFor(id) };
    },
    remove(id: string): void {
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    }
  };
}
