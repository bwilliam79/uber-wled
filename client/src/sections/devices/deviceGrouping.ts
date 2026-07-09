import type { Controller, Group } from '../../api/client';

export interface RoomSection {
  group: Group;
  controllers: Controller[];
}

/**
 * Buckets controllers under the rooms (groups) they belong to for the Devices
 * page. A controller is assigned to the first room (in sort order) that lists
 * it as a member, so it never appears twice; controllers in no room fall into
 * `ungrouped`. Rooms with no present controllers are omitted.
 */
export function groupControllersByRoom(
  groups: Group[],
  controllers: Controller[]
): { rooms: RoomSection[]; ungrouped: Controller[] } {
  const sorted = [...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const assigned = new Set<string>();
  const rooms: RoomSection[] = [];
  for (const group of sorted) {
    const members = controllers.filter(
      (c) => !assigned.has(c.id) && group.members.some((m) => m.controllerId === c.id)
    );
    members.forEach((c) => assigned.add(c.id));
    if (members.length > 0) rooms.push({ group, controllers: members });
  }
  const ungrouped = controllers.filter((c) => !assigned.has(c.id));
  return { rooms, ungrouped };
}
