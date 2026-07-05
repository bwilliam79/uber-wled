import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import {
  expandTargets,
  resolveNameToId,
  buildSegPatch,
  applyControlPatch,
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

// -- device write path -------------------------------------------------

function stubFetchByHost(
  handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    const handler = handlers[host];
    if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Real two-segment layout probed from 192.168.1.86 (segments 0-39 and 39-48).
const LIVE_STATE = {
  on: true, bri: 9, ps: -1,
  seg: [
    { id: 0, start: 0, stop: 39, len: 39, on: true, bri: 255, fx: 0, pal: 0, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    { id: 1, start: 39, stop: 48, len: 9, on: true, bri: 255, fx: 0, pal: 0, col: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }
  ]
};

describe('applyControlPatch', () => {
  const HOST = '10.0.0.50';
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const db = createDb(':memory:');
    const id = createControllerRepository(db).add({ name: 'Cab', host: HOST, source: 'manual' }).id;
    return { db, id };
  }

  it('segment target: single POST with udpn nn:true, no state enumeration', async () => {
    const { db, id } = setup();
    const posts: unknown[] = [];
    const fetchMock = stubFetchByHost({
      [HOST]: (_url, init) => {
        posts.push(JSON.parse(init?.body as string));
        return { status: 200, body: LIVE_STATE };
      }
    });
    const results = await applyControlPatch(
      db,
      [{ kind: 'segment', controllerId: id, wledSegId: 1 }],
      { bri: 120, seg: { fxId: 9 } }
    );
    expect(results).toEqual([{ controllerId: id, wledSegId: 1, ok: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(posts).toEqual([{ udpn: { nn: true }, bri: 120, seg: [{ id: 1, fx: 9 }] }]);
  });

  it('controller target with a seg patch: one GET to enumerate segments, then one POST patching all of them', async () => {
    const { db, id } = setup();
    seedCapabilities(db, id);
    const posts: unknown[] = [];
    stubFetchByHost({
      [HOST]: (_url, init) => {
        if (!init || init.method === undefined) return { status: 200, body: LIVE_STATE }; // GET /json/state
        posts.push(JSON.parse(init.body as string));
        return { status: 200, body: LIVE_STATE };
      }
    });
    const results = await applyControlPatch(
      db,
      [{ kind: 'controller', controllerId: id }],
      { seg: { fxName: 'Theater' } }
    );
    expect(results).toEqual([{ controllerId: id, wledSegId: null, ok: true }]);
    expect(posts).toEqual([{ udpn: { nn: true }, seg: [{ id: 0, fx: 13 }, { id: 1, fx: 13 }] }]);
  });

  it('controller target with only top-level fields: no GET, one POST', async () => {
    const { db, id } = setup();
    const posts: unknown[] = [];
    const fetchMock = stubFetchByHost({
      [HOST]: (_url, init) => {
        posts.push(JSON.parse(init?.body as string));
        return { status: 200, body: LIVE_STATE };
      }
    });
    const results = await applyControlPatch(db, [{ kind: 'controller', controllerId: id }], {
      on: true, bri: 200, transition: 7, nl: { on: true, dur: 30, mode: 1, tbri: 0 }
    });
    expect(results[0].ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(posts).toEqual([
      { udpn: { nn: true }, on: true, bri: 200, transition: 7, nl: { on: true, dur: 30, mode: 1, tbri: 0 } }
    ]);
  });

  it('applies a device preset via patch.ps at device level (preset apply has no dedicated route)', async () => {
    const { db, id } = setup();
    const posts: unknown[] = [];
    const fetchMock = stubFetchByHost({
      [HOST]: (_url, init) => {
        posts.push(JSON.parse(init?.body as string));
        return { status: 200, body: LIVE_STATE };
      }
    });
    const results = await applyControlPatch(db, [{ kind: 'controller', controllerId: id }], { ps: 3 });
    expect(results).toEqual([{ controllerId: id, wledSegId: null, ok: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no state enumeration for a device-level preset
    expect(posts).toEqual([{ udpn: { nn: true }, ps: 3 }]);
  });

  it('unresolved effect name fails that target without any device I/O, and other targets continue', async () => {
    const { db, id } = setup();
    const other = createControllerRepository(db).add({ name: 'B', host: '10.0.0.51', source: 'manual' }).id;
    seedCapabilities(db, other); // only controller B has a capability cache
    const fetchMock = stubFetchByHost({
      '10.0.0.51': (_url, init) => {
        expect(JSON.parse(init?.body as string)).toEqual({ udpn: { nn: true }, seg: [{ id: 0, fx: 13 }] });
        return { status: 200, body: LIVE_STATE };
      }
    });
    const results = await applyControlPatch(
      db,
      [
        { kind: 'segment', controllerId: id, wledSegId: 0 },
        { kind: 'segment', controllerId: other, wledSegId: 0 }
      ],
      { seg: { fxName: 'Theater' } }
    );
    expect(results[0]).toEqual({ controllerId: id, wledSegId: 0, ok: false, error: 'effect not found: Theater' });
    expect(results[1]).toEqual({ controllerId: other, wledSegId: 0, ok: true });
    expect(fetchMock.mock.calls.every(([url]) => new URL(url as string).host === '10.0.0.51')).toBe(true);
  });

  it('retries exactly once on write failure, then reports the error', async () => {
    const { db, id } = setup();
    const fetchMock = stubFetchByHost({ [HOST]: () => ({ status: 500, body: {} }) });
    const results = await applyControlPatch(db, [{ kind: 'segment', controllerId: id, wledSegId: 0 }], { on: false });
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain('500');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports controller not found without device I/O', async () => {
    const { db } = setup();
    const fetchMock = stubFetchByHost({});
    const results = await applyControlPatch(db, [{ kind: 'segment', controllerId: 'ghost', wledSegId: 0 }], { on: true });
    expect(results).toEqual([{ controllerId: 'ghost', wledSegId: 0, ok: false, error: 'controller not found' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
