import { describe, it, expect } from 'vitest';
import { groupControllersByRoom } from '../../sections/devices/deviceGrouping';
import type { Controller, Group } from '../../api/client';

const ctrl = (id: string): Controller =>
  ({ id, name: id, host: `${id}.local`, source: 'manual', stale: false, pinnedAssetPattern: null } as Controller);

const room = (id: string, name: string, sortOrder: number, controllerIds: string[]): Group => ({
  id, name, icon: null, sortOrder,
  members: controllerIds.map((cid) => ({ controllerId: cid, wledSegId: 0 }))
});

describe('groupControllersByRoom', () => {
  it('buckets controllers under their room, in sort order, with an ungrouped remainder', () => {
    const controllers = [ctrl('a'), ctrl('b'), ctrl('c'), ctrl('d')];
    const groups = [room('r2', 'Kitchen', 1, ['c']), room('r1', 'Living', 0, ['a', 'b'])];
    const { rooms, ungrouped } = groupControllersByRoom(groups, controllers);
    expect(rooms.map((r) => r.group.name)).toEqual(['Living', 'Kitchen']); // sortOrder
    expect(rooms[0].controllers.map((c) => c.id)).toEqual(['a', 'b']);
    expect(rooms[1].controllers.map((c) => c.id)).toEqual(['c']);
    expect(ungrouped.map((c) => c.id)).toEqual(['d']);
  });

  it('assigns a controller to only its first room (no duplicates)', () => {
    const controllers = [ctrl('a')];
    const groups = [room('r1', 'Living', 0, ['a']), room('r2', 'Kitchen', 1, ['a'])];
    const { rooms } = groupControllersByRoom(groups, controllers);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].group.name).toBe('Living');
  });

  it('omits rooms with no present controllers', () => {
    const { rooms, ungrouped } = groupControllersByRoom([room('r1', 'Empty', 0, ['gone'])], [ctrl('a')]);
    expect(rooms).toHaveLength(0);
    expect(ungrouped.map((c) => c.id)).toEqual(['a']);
  });
});
