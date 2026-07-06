import { describe, it, expect } from 'vitest';
import type { Target, Group, ControllerCapabilities } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import {
  expandTargets, targetControllerIds, aggregateControlState,
  mergeEffects, mergePalettes, applyOverrides, targetsEqual
} from '../../control/controlState';
import { CAPS_A, CAPS_B, makeSeg, makeState, liveEntry } from '../fixtures/capabilities';

const GROUPS: Group[] = [
  {
    id: 'g1',
    name: 'Kitchen',
    icon: null,
    sortOrder: 0,
    members: [{ controllerId: 'cA', wledSegId: 0 }, { controllerId: 'cB', wledSegId: 0 }]
  }
];

const caps = new Map<string, ControllerCapabilities>([['cA', CAPS_A], ['cB', CAPS_B]]);

function liveMap(entries: Record<string, LiveStatusEntry>) {
  return new Map(Object.entries(entries));
}

describe('expandTargets', () => {
  it('passes segment targets through and expands groups to member pairs', () => {
    const live = liveMap({});
    expect(expandTargets(
      [{ kind: 'segment', controllerId: 'cA', wledSegId: 1 }, { kind: 'group', groupId: 'g1' }],
      GROUPS, live
    )).toEqual([
      { controllerId: 'cA', wledSegId: 1 },
      { controllerId: 'cA', wledSegId: 0 },
      { controllerId: 'cB', wledSegId: 0 }
    ]);
  });

  it('expands a controller target to its live segment ids', () => {
    const live = liveMap({ cA: liveEntry(makeState([makeSeg(0), makeSeg(1)])) });
    expect(expandTargets([{ kind: 'controller', controllerId: 'cA' }], [], live))
      .toEqual([{ controllerId: 'cA', wledSegId: 0 }, { controllerId: 'cA', wledSegId: 1 }]);
  });

  it('uses wledSegId null when the controller has no live state', () => {
    expect(expandTargets([{ kind: 'controller', controllerId: 'cA' }], [], liveMap({})))
      .toEqual([{ controllerId: 'cA', wledSegId: null }]);
  });

  it('dedupes identical (controller, seg) pairs from overlapping targets', () => {
    const live = liveMap({ cA: liveEntry(makeState([makeSeg(0)])) });
    const targets: Target[] = [
      { kind: 'controller', controllerId: 'cA' },
      { kind: 'segment', controllerId: 'cA', wledSegId: 0 },
      { kind: 'group', groupId: 'g1' }
    ];
    const pairs = expandTargets(targets, GROUPS, live);
    expect(pairs.filter((p) => p.controllerId === 'cA' && p.wledSegId === 0)).toHaveLength(1);
  });

  it('targetControllerIds returns unique sorted ids incl. group members', () => {
    expect(targetControllerIds(
      [{ kind: 'group', groupId: 'g1' }, { kind: 'controller', controllerId: 'cA' }], GROUPS
    )).toEqual(['cA', 'cB']);
  });
});

describe('aggregateControlState', () => {
  const T_BOTH: Target[] = [
    { kind: 'controller', controllerId: 'cA' },
    { kind: 'controller', controllerId: 'cB' }
  ];

  it('aggregates agreeing targets into concrete values (name-resolved across differing ids)', () => {
    // cA runs Blink at id 1; cB runs Blink at id 2 → same NAME → not mixed.
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { fx: 1, sx: 100, ix: 50, pal: 0, col: [[255, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] })], { bri: 100 })),
      cB: liveEntry(makeState([makeSeg(0, { fx: 2, sx: 100, ix: 50, pal: 0, col: [[255, 0, 0], [0, 0, 0], [0, 0, 0]] })], { bri: 100 }))
    });
    const agg = aggregateControlState(T_BOTH, [], live, caps);
    expect(agg.hasData).toBe(true);
    expect(agg.anyUnreachable).toBe(false);
    expect(agg.power).toBe('on');
    expect(agg.bri).toBe(100);
    expect(agg.transition).toBe(7);
    expect(agg.fxName).toBe('Blink');
    expect(agg.palName).toBe('Default');
    // [255,0,0,0] vs [255,0,0]: missing white treated as 0 → equal
    expect(agg.colors[0]).toEqual([255, 0, 0, 0]);
    expect(agg.sx).toBe(100);
    expect(agg.ix).toBe(50);
    expect(agg.o1).toBe(true);
    expect(agg.cct).toBe(127);
    expect(agg.nl).toEqual({ on: false, dur: 60, mode: 1, tbri: 0 });
  });

  it('reports mixed power, brightness, effect and palette when targets disagree', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { on: true, fx: 1, pal: 0 })], { bri: 10 })),
      cB: liveEntry(makeState([makeSeg(0, { on: false, fx: 1, pal: 2 })], { bri: 200 }))
    });
    const agg = aggregateControlState(T_BOTH, [], live, caps);
    expect(agg.power).toBe('mixed');
    expect(agg.bri).toBe('mixed');
    // cA pal 0 = 'Default', cB pal 2 = 'Fire'
    expect(agg.palName).toBe('mixed');
  });

  it('reports mixed effect params and colors', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { sx: 10, o1: true, col: [[255, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] })])),
      cB: liveEntry(makeState([makeSeg(0, { sx: 20, o1: false, col: [[0, 255, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] })]))
    });
    const agg = aggregateControlState(T_BOTH, [], live, caps);
    expect(agg.sx).toBe('mixed');
    expect(agg.o1).toBe('mixed');
    expect(agg.colors[0]).toBe('mixed');
    expect(agg.colors[1]).toEqual([0, 0, 0, 0]);
  });

  it('ignores caps-less controllers for name resolution but keeps numeric aggregation', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { fx: 1 })])),
      cX: liveEntry(makeState([makeSeg(0, { fx: 9 })]))
    });
    const agg = aggregateControlState(
      [{ kind: 'controller', controllerId: 'cA' }, { kind: 'controller', controllerId: 'cX' }],
      [], live, caps // caps has no entry for cX
    );
    expect(agg.fxName).toBe('Blink'); // only cA contributes a name
    expect(agg.power).toBe('on');
  });

  it('flags unreachable targets and still aggregates the reachable ones', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { fx: 1 })], { bri: 42 })),
      cB: { reachable: false }
    });
    const agg = aggregateControlState(T_BOTH, [], live, caps);
    expect(agg.anyUnreachable).toBe(true);
    expect(agg.bri).toBe(42);
    expect(agg.fxName).toBe('Blink');
  });

  it('returns the no-data shape when nothing is live', () => {
    const agg = aggregateControlState(T_BOTH, [], liveMap({}), caps);
    expect(agg).toMatchObject({
      hasData: false, anyUnreachable: true, power: 'off', bri: 'mixed',
      transition: null, fxName: null, palName: null,
      sx: null, ix: null, c1: null, c2: null, c3: null,
      o1: null, o2: null, o3: null, cct: null, nl: null
    });
    expect(agg.colors).toEqual([null, null, null]);
  });

  it('aggregates group targets through their member segments', () => {
    const live = liveMap({
      cA: liveEntry(makeState([makeSeg(0, { on: true }), makeSeg(1, { on: false })])),
      cB: liveEntry(makeState([makeSeg(0, { on: true })]))
    });
    // g1 members are (cA,0) and (cB,0) — seg 1 of cA is NOT included
    const agg = aggregateControlState([{ kind: 'group', groupId: 'g1' }], GROUPS, live, caps);
    expect(agg.power).toBe('on');
  });
});

describe('mergeEffects', () => {
  it('unions names, tracks per-controller ids, flags partial support, filters RSVD, pins Solid', () => {
    const merged = mergeEffects(['cA', 'cB'], caps);
    expect(merged.map((e) => e.name)).toEqual(
      ['Solid', 'Blink', 'Colortwinkles', 'Pixels', 'Spaceships'] // Solid pinned, rest alphabetical
    );
    const blink = merged.find((e) => e.name === 'Blink')!;
    expect(blink.ids).toEqual({ cA: 1, cB: 2 });
    expect(blink.supportedEverywhere).toBe(true);
    expect(blink.meta!.sliders.ix).toBe('Duty cycle');
    const spaceships = merged.find((e) => e.name === 'Spaceships')!;
    expect(spaceships.supportedEverywhere).toBe(false);
    expect(spaceships.ids).toEqual({ cA: 3 });
    expect(merged.some((e) => e.name === 'RSVD')).toBe(false);
  });

  it('marks nothing supportedEverywhere when a controller has no caps', () => {
    const merged = mergeEffects(['cA', 'cMissing'], caps);
    expect(merged.every((e) => e.supportedEverywhere === false)).toBe(true);
    expect(merged.some((e) => e.name === 'Solid')).toBe(true); // still listed from cA
  });
});

describe('mergePalettes', () => {
  it('unions palettes with Default pinned and previews attached', () => {
    const merged = mergePalettes(['cA', 'cB'], caps);
    expect(merged.map((p) => p.name)).toEqual(
      ['Default', '* Color Gradient', '* Colors 1&2', '* Random Cycle', 'Fire']
    );
    const fire = merged.find((p) => p.name === 'Fire')!;
    expect(fire.supportedEverywhere).toBe(true);
    expect(fire.ids).toEqual({ cA: 4, cB: 2 });
    expect(fire.preview).toEqual({ type: 'stops', stops: expect.any(Array) });
    const gradient = merged.find((p) => p.name === '* Color Gradient')!;
    expect(gradient.supportedEverywhere).toBe(false);
    expect(gradient.preview).toEqual({ type: 'slots', slots: ['c3', 'c2', 'c1'] });
  });
});

describe('applyOverrides', () => {
  it('overlays optimistic values without touching un-overridden fields', () => {
    const live = liveMap({ cA: liveEntry(makeState([makeSeg(0, { fx: 1 })], { bri: 10 })) });
    const agg = aggregateControlState([{ kind: 'controller', controllerId: 'cA' }], [], live, caps);
    const out = applyOverrides(agg, { bri: 200, fxName: 'Pixels', colors: { 1: [0, 0, 255, 0] } });
    expect(out.bri).toBe(200);
    expect(out.fxName).toBe('Pixels');
    expect(out.colors[1]).toEqual([0, 0, 255, 0]);
    expect(out.colors[0]).toEqual(agg.colors[0]);
    expect(out.power).toBe(agg.power);
  });

  it('maps a power override onto the on/off union', () => {
    const live = liveMap({ cA: liveEntry(makeState([makeSeg(0, { on: false })])) });
    const agg = aggregateControlState([{ kind: 'controller', controllerId: 'cA' }], [], live, caps);
    expect(applyOverrides(agg, { power: true }).power).toBe('on');
  });
});

describe('targetsEqual', () => {
  it('treats value-equal lists as equal regardless of identity', () => {
    expect(targetsEqual(
      [{ kind: 'controller', controllerId: 'c1' }, { kind: 'segment', controllerId: 'c2', wledSegId: 1 }],
      [{ kind: 'controller', controllerId: 'c1' }, { kind: 'segment', controllerId: 'c2', wledSegId: 1 }]
    )).toBe(true);
    expect(targetsEqual([], [])).toBe(true);
  });

  it('detects differences in kind, ids, length, and order', () => {
    expect(targetsEqual([{ kind: 'controller', controllerId: 'c1' }], [])).toBe(false);
    expect(targetsEqual(
      [{ kind: 'controller', controllerId: 'c1' }],
      [{ kind: 'group', groupId: 'c1' }]
    )).toBe(false);
    expect(targetsEqual(
      [{ kind: 'segment', controllerId: 'c1', wledSegId: 0 }],
      [{ kind: 'segment', controllerId: 'c1', wledSegId: 2 }]
    )).toBe(false);
    expect(targetsEqual(
      [{ kind: 'group', groupId: 'g1' }, { kind: 'group', groupId: 'g2' }],
      [{ kind: 'group', groupId: 'g2' }, { kind: 'group', groupId: 'g1' }]
    )).toBe(false);
  });
});
