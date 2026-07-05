import { describe, it, expect } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import {
  expandTargets,
  resolveNameToId,
  buildSegPatch,
  GroupNotFoundError,
  type Target
} from '../../src/control/applyV2.js';

// First 16 effect names and first 12 palette names probed live from the real
// controller at 192.168.1.86 (WLED 16.0.0 "Niji", vid 2605030).
export const EFFECTS = [
  'Solid', 'Blink', 'Breathe', 'Wipe', 'Wipe Random', 'Random Colors', 'Sweep', 'Dynamic',
  'Colorloop', 'Rainbow', 'Scan', 'Scan Dual', 'Fade', 'Theater', 'Theater Rainbow', 'Running'
];
export const PALETTES = [
  'Default', '* Random Cycle', '* Color 1', '* Colors 1&2', '* Color Gradient', '* Colors Only',
  'Party', 'Cloud', 'Lava', 'Ocean', 'Forest', 'Rainbow'
];

export function seedCapabilities(db: ReturnType<typeof createDb>, controllerId: string): void {
  db.prepare(
    `INSERT INTO controller_capabilities (controller_id, vid, effects, palettes, fxdata, palette_previews, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(controllerId, 2605030, JSON.stringify(EFFECTS), JSON.stringify(PALETTES), '[]', '{}', new Date().toISOString());
}

describe('resolveNameToId', () => {
  it('matches case-insensitively and exactly', () => {
    expect(resolveNameToId(EFFECTS, 'theater')).toBe(13);
    expect(resolveNameToId(EFFECTS, 'THEATER RAINBOW')).toBe(14);
    expect(resolveNameToId(PALETTES, 'rainbow')).toBe(11);
  });

  it('does not partial-match', () => {
    expect(resolveNameToId(EFFECTS, 'Theat')).toBeUndefined();
  });

  it('returns undefined when the name list is missing (no cache row)', () => {
    expect(resolveNameToId(undefined, 'Solid')).toBeUndefined();
  });
});

describe('expandTargets', () => {
  function setup() {
    const db = createDb(':memory:');
    const controllers = createControllerRepository(db);
    const a = controllers.add({ name: 'A', host: '10.0.0.50', source: 'manual' }).id;
    const b = controllers.add({ name: 'B', host: '10.0.0.51', source: 'manual' }).id;
    return { db, a, b };
  }

  it('expands a group into its segment members, preserving order', () => {
    const { db, a, b } = setup();
    const group = createGroupRepository(db).add({
      name: 'Front',
      members: [
        { controllerId: a, wledSegId: 0 },
        { controllerId: b, wledSegId: 1 }
      ]
    });
    expect(expandTargets(db, [{ kind: 'group', groupId: group.id }])).toEqual([
      { controllerId: a, wledSegId: 0 },
      { controllerId: b, wledSegId: 1 }
    ]);
  });

  it('dedupes identical (controller, segment) pairs and identical controller targets', () => {
    const { db, a } = setup();
    const targets: Target[] = [
      { kind: 'segment', controllerId: a, wledSegId: 0 },
      { kind: 'segment', controllerId: a, wledSegId: 0 },
      { kind: 'segment', controllerId: a, wledSegId: 1 }
    ];
    expect(expandTargets(db, targets)).toEqual([
      { controllerId: a, wledSegId: 0 },
      { controllerId: a, wledSegId: 1 }
    ]);
  });

  it('a whole-controller target subsumes segment targets for the same controller', () => {
    const { db, a, b } = setup();
    const targets: Target[] = [
      { kind: 'segment', controllerId: a, wledSegId: 0 },
      { kind: 'controller', controllerId: a },
      { kind: 'segment', controllerId: b, wledSegId: 2 }
    ];
    expect(expandTargets(db, targets)).toEqual([
      { controllerId: a, wledSegId: null },
      { controllerId: b, wledSegId: 2 }
    ]);
  });

  it('throws GroupNotFoundError for an unknown group id', () => {
    const { db } = setup();
    expect(() => expandTargets(db, [{ kind: 'group', groupId: 'nope' }])).toThrow(GroupNotFoundError);
    expect(() => expandTargets(db, [{ kind: 'group', groupId: 'nope' }])).toThrow('group not found: nope');
  });
});

describe('buildSegPatch', () => {
  function setup() {
    const db = createDb(':memory:');
    const id = createControllerRepository(db).add({ name: 'A', host: '10.0.0.50', source: 'manual' }).id;
    return { db, id };
  }

  it('resolves fxName and palName to per-device ids from the capability cache', () => {
    const { db, id } = setup();
    seedCapabilities(db, id);
    expect(buildSegPatch(db, id, { fxName: 'theater', palName: 'Rainbow' })).toEqual({
      seg: { fx: 13, pal: 11 }
    });
  });

  it('name wins over id when both are provided', () => {
    const { db, id } = setup();
    seedCapabilities(db, id);
    expect(buildSegPatch(db, id, { fxName: 'Colorloop', fxId: 3 })).toEqual({ seg: { fx: 8 } });
  });

  it('fails with "effect not found" for an unresolvable effect name', () => {
    const { db, id } = setup();
    seedCapabilities(db, id);
    expect(buildSegPatch(db, id, { fxName: 'Sparkle Fairy' })).toEqual({
      error: 'effect not found: Sparkle Fairy'
    });
  });

  it('fails with "palette not found" for an unresolvable palette name', () => {
    const { db, id } = setup();
    seedCapabilities(db, id);
    expect(buildSegPatch(db, id, { palName: 'Nonexistent' })).toEqual({
      error: 'palette not found: Nonexistent'
    });
  });

  it('fails the same way when the controller has no capability cache row', () => {
    const { db, id } = setup();
    expect(buildSegPatch(db, id, { fxName: 'Solid' })).toEqual({ error: 'effect not found: Solid' });
  });

  it('passes raw ids and all other segment fields through', () => {
    const { db, id } = setup();
    expect(
      buildSegPatch(db, id, {
        fxId: 9, palId: 6, col: [[255, 0, 0], [0, 0, 0], [0, 0, 255]],
        sx: 200, ix: 100, c1: 1, c2: 2, c3: 3,
        o1: true, o2: false, o3: true, cct: 127, on: true, bri: 64
      })
    ).toEqual({
      seg: {
        fx: 9, pal: 6, col: [[255, 0, 0], [0, 0, 0], [0, 0, 255]],
        sx: 200, ix: 100, c1: 1, c2: 2, c3: 3,
        o1: true, o2: false, o3: true, cct: 127, on: true, bri: 64
      }
    });
  });
});
