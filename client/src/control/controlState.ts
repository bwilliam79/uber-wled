import type { Target, Group, ControllerCapabilities, FxMeta, PalettePreview } from '../api/client';
import type { LiveStatusEntry, LiveSegment } from '../api/live';

export interface ExpandedTarget { controllerId: string; wledSegId: number | null }

/** Value equality for target lists (order-sensitive) — lets consumers keep a
 *  stable state identity when a caller rebuilds an equal array each render. */
export function targetsEqual(a: Target[], b: Target[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((t, i) => {
    const o = b[i];
    if (t.kind !== o.kind) return false;
    if (t.kind === 'group' && o.kind === 'group') return t.groupId === o.groupId;
    if (t.kind !== 'group' && o.kind !== 'group') {
      return t.controllerId === o.controllerId &&
        (t.kind === 'segment' && o.kind === 'segment' ? t.wledSegId === o.wledSegId : true);
    }
    return false;
  });
}

export function expandTargets(
  targets: Target[],
  groups: Group[],
  live: Map<string, LiveStatusEntry>
): ExpandedTarget[] {
  const out: ExpandedTarget[] = [];
  const seen = new Set<string>();
  const push = (controllerId: string, wledSegId: number | null) => {
    const key = `${controllerId}:${wledSegId ?? '*'}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ controllerId, wledSegId });
  };
  for (const target of targets) {
    if (target.kind === 'segment') {
      push(target.controllerId, target.wledSegId);
    } else if (target.kind === 'controller') {
      const segs = live.get(target.controllerId)?.state?.seg;
      if (segs && segs.length > 0) for (const seg of segs) push(target.controllerId, seg.id);
      else push(target.controllerId, null);
    } else {
      const group = groups.find((g) => g.id === target.groupId);
      for (const member of group?.members ?? []) push(member.controllerId, member.wledSegId);
    }
  }
  return out;
}

export function targetControllerIds(targets: Target[], groups: Group[]): string[] {
  const ids = new Set<string>();
  for (const target of targets) {
    if (target.kind === 'group') {
      const group = groups.find((g) => g.id === target.groupId);
      for (const member of group?.members ?? []) ids.add(member.controllerId);
    } else {
      ids.add(target.controllerId);
    }
  }
  return [...ids].sort();
}

export type Mixed<T> = T | 'mixed' | null;

export interface AggregatedControlState {
  hasData: boolean;
  anyUnreachable: boolean;
  power: 'on' | 'off' | 'mixed';
  bri: number | 'mixed';
  transition: Mixed<number>;
  fxName: Mixed<string>;
  palName: Mixed<string>;
  colors: Mixed<number[]>[]; // always length 3
  sx: Mixed<number>; ix: Mixed<number>;
  c1: Mixed<number>; c2: Mixed<number>; c3: Mixed<number>;
  o1: Mixed<boolean>; o2: Mixed<boolean>; o3: Mixed<boolean>;
  cct: Mixed<number>;
  nl: { on: boolean; dur: number; mode: 0 | 1 | 2 | 3; tbri: number } | null;
}

function reduceValues<T>(values: T[], eq: (a: T, b: T) => boolean): Mixed<T> {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => eq(v, first)) ? first : 'mixed';
}

const scalarEq = <T,>(a: T, b: T) => a === b;

function colorEq(a: number[], b: number[]): boolean {
  for (let i = 0; i < 4; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return false;
  }
  return true;
}

export function aggregateControlState(
  targets: Target[],
  groups: Group[],
  live: Map<string, LiveStatusEntry>,
  caps: Map<string, ControllerCapabilities>
): AggregatedControlState {
  const expanded = expandTargets(targets, groups, live);
  let anyUnreachable = false;
  const segs: { controllerId: string; seg: LiveSegment }[] = [];
  const statefulControllers: string[] = []; // expansion order, deduped

  for (const pair of expanded) {
    const entry = live.get(pair.controllerId);
    if (!entry || !entry.reachable) {
      anyUnreachable = true;
      continue;
    }
    if (!entry.state) continue;
    if (!statefulControllers.includes(pair.controllerId)) statefulControllers.push(pair.controllerId);
    if (pair.wledSegId === null) {
      for (const seg of entry.state.seg) segs.push({ controllerId: pair.controllerId, seg });
    } else {
      const seg = entry.state.seg.find((s) => s.id === pair.wledSegId);
      if (seg) segs.push({ controllerId: pair.controllerId, seg });
    }
  }

  const hasData = segs.length > 0;
  const onValues = segs.map((s) => s.seg.on);
  const powerReduced = reduceValues(onValues, scalarEq);
  const power: 'on' | 'off' | 'mixed' =
    powerReduced === null ? 'off' : powerReduced === 'mixed' ? 'mixed' : powerReduced ? 'on' : 'off';

  const states = statefulControllers.map((id) => live.get(id)!.state!);
  const briReduced = reduceValues(states.map((s) => s.bri), scalarEq);
  const bri: number | 'mixed' = briReduced === null ? 'mixed' : briReduced;

  const names = (resolve: (controllerId: string, seg: LiveSegment) => string | undefined): Mixed<string> => {
    const values: string[] = [];
    for (const { controllerId, seg } of segs) {
      const name = resolve(controllerId, seg);
      if (name !== undefined) values.push(name);
    }
    return reduceValues(values, scalarEq);
  };

  const colors: Mixed<number[]>[] = [0, 1, 2].map((slot) =>
    reduceValues(
      segs.map((s) => s.seg.col[slot]).filter((c): c is number[] => Array.isArray(c)),
      colorEq
    )
  );

  const num = (pick: (seg: LiveSegment) => number | undefined): Mixed<number> =>
    reduceValues(segs.map((s) => pick(s.seg)).filter((v): v is number => typeof v === 'number'), scalarEq);
  const bool = (pick: (seg: LiveSegment) => boolean | undefined): Mixed<boolean> =>
    reduceValues(segs.map((s) => pick(s.seg)).filter((v): v is boolean => typeof v === 'boolean'), scalarEq);

  const firstNl = states[0]?.nl ?? null;

  return {
    hasData,
    anyUnreachable,
    power,
    bri,
    transition: reduceValues(states.map((s) => s.transition), scalarEq),
    fxName: names((id, seg) => caps.get(id)?.effects[seg.fx]),
    palName: names((id, seg) => caps.get(id)?.palettes[seg.pal]),
    colors,
    sx: num((s) => s.sx), ix: num((s) => s.ix),
    c1: num((s) => s.c1), c2: num((s) => s.c2), c3: num((s) => s.c3),
    o1: bool((s) => s.o1), o2: bool((s) => s.o2), o3: bool((s) => s.o3),
    cct: num((s) => s.cct),
    nl: firstNl ? { on: firstNl.on, dur: firstNl.dur, mode: firstNl.mode, tbri: firstNl.tbri } : null
  };
}

export interface MergedEffectEntry {
  name: string;
  supportedEverywhere: boolean;
  ids: Record<string, number>;
  meta: FxMeta | null;
}

export interface MergedPaletteEntry {
  name: string;
  supportedEverywhere: boolean;
  ids: Record<string, number>;
  preview: PalettePreview | null;
}

function mergeNamed<E>(
  controllerIds: string[],
  caps: Map<string, ControllerCapabilities>,
  list: (cap: ControllerCapabilities) => string[],
  attach: (cap: ControllerCapabilities, id: number) => E | null,
  pinnedFirst: string
): { name: string; supportedEverywhere: boolean; ids: Record<string, number>; extra: E | null }[] {
  const byName = new Map<string, { name: string; supportedEverywhere: boolean; ids: Record<string, number>; extra: E | null }>();
  for (const controllerId of controllerIds) {
    const cap = caps.get(controllerId);
    if (!cap) continue;
    list(cap).forEach((name, id) => {
      if (!name || name === 'RSVD') return;
      let entry = byName.get(name);
      if (!entry) {
        entry = { name, supportedEverywhere: false, ids: {}, extra: null };
        byName.set(name, entry);
      }
      entry.ids[controllerId] = id;
      if (entry.extra === null) entry.extra = attach(cap, id);
    });
  }
  const entries = [...byName.values()];
  for (const entry of entries) {
    entry.supportedEverywhere = controllerIds.every((id) => entry.ids[id] !== undefined);
  }
  entries.sort((a, b) =>
    a.name === pinnedFirst ? -1 : b.name === pinnedFirst ? 1 : a.name.localeCompare(b.name)
  );
  return entries;
}

export function mergeEffects(
  controllerIds: string[],
  caps: Map<string, ControllerCapabilities>
): MergedEffectEntry[] {
  return mergeNamed(
    controllerIds, caps,
    (cap) => cap.effects,
    (cap, id) => cap.fxMeta.find((m) => m.id === id) ?? null,
    'Solid'
  ).map(({ name, supportedEverywhere, ids, extra }) => ({ name, supportedEverywhere, ids, meta: extra }));
}

export function mergePalettes(
  controllerIds: string[],
  caps: Map<string, ControllerCapabilities>
): MergedPaletteEntry[] {
  return mergeNamed(
    controllerIds, caps,
    (cap) => cap.palettes,
    (cap, id) => cap.palettePreviews[id] ?? null,
    'Default'
  ).map(({ name, supportedEverywhere, ids, extra }) => ({ name, supportedEverywhere, ids, preview: extra }));
}

export interface ControlOverrides {
  power?: boolean; bri?: number; transition?: number;
  fxName?: string; palName?: string;
  colors?: Record<number, number[]>;
  sx?: number; ix?: number; c1?: number; c2?: number; c3?: number;
  o1?: boolean; o2?: boolean; o3?: boolean;
  cct?: number;
}

export function applyOverrides(
  agg: AggregatedControlState,
  overrides: ControlOverrides
): AggregatedControlState {
  return {
    ...agg,
    power: overrides.power !== undefined ? (overrides.power ? 'on' : 'off') : agg.power,
    bri: overrides.bri ?? agg.bri,
    transition: overrides.transition ?? agg.transition,
    fxName: overrides.fxName ?? agg.fxName,
    palName: overrides.palName ?? agg.palName,
    colors: agg.colors.map((c, i) => overrides.colors?.[i] ?? c),
    sx: overrides.sx ?? agg.sx, ix: overrides.ix ?? agg.ix,
    c1: overrides.c1 ?? agg.c1, c2: overrides.c2 ?? agg.c2, c3: overrides.c3 ?? agg.c3,
    o1: overrides.o1 ?? agg.o1, o2: overrides.o2 ?? agg.o2, o3: overrides.o3 ?? agg.o3,
    cct: overrides.cct ?? agg.cct
  };
}
