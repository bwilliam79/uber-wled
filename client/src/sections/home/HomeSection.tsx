import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listControllers,
  listGroups,
  applyControl,
  type Controller,
  type ControlPatch,
  type Group,
  type Target
} from '../../api/client';
import { useLiveStatus } from '../../api/live';
import { ControlSurface } from '../../control/ControlSurface';
import { HomeTile, type HomeTileData } from './HomeTile';
import {
  aggregateTileStatusLive,
  type LiveTileSource,
  type TileStatusV2
} from '../../lib/tileStatus';
import { dominantColor, OFF_GLOW, OFFLINE_GLOW } from '../../lib/dominantColor';
import { throttle } from '../../lib/throttle';
import './home.css';

const OVERRIDE_TTL_MS = 4000; // two live-poll ticks at the 2s default
const BRIGHTNESS_THROTTLE_MS = 250;

interface QuickOverride {
  on?: boolean;
  bri?: number;
  at: number;
}

export function buildTiles(groups: Group[], controllers: Controller[]): HomeTileData[] {
  const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m.controllerId)));
  const groupTiles: HomeTileData[] = groups
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((g) => ({
      id: g.id,
      kind: 'group' as const,
      title: g.name,
      icon: g.icon,
      members: g.members.map((m) => ({ controllerId: m.controllerId, wledSegId: m.wledSegId }))
    }));
  const controllerTiles: HomeTileData[] = controllers
    .filter((c) => !grouped.has(c.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      kind: 'controller' as const,
      title: c.name,
      icon: null,
      members: [{ controllerId: c.id, wledSegId: null }]
    }));
  return [...groupTiles, ...controllerTiles];
}

function targetsFor(tile: HomeTileData): Target[] {
  return tile.kind === 'group'
    ? [{ kind: 'group', groupId: tile.id }]
    : [{ kind: 'controller', controllerId: tile.id }];
}

export function HomeSection() {
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: listGroups });
  const controllersQuery = useQuery({ queryKey: ['controllers'], queryFn: listControllers });
  const groups = groupsQuery.data ?? [];
  const controllers = controllersQuery.data ?? [];

  const controllerIds = useMemo(() => controllers.map((c) => c.id), [controllers]);
  const live = useLiveStatus(controllerIds) as ReadonlyMap<string, LiveTileSource>;

  const [controlTargets, setControlTargets] = useState<Target[] | null>(null);
  const [overrides, setOverrides] = useState<Map<string, QuickOverride>>(new Map());

  const tiles = useMemo(() => buildTiles(groups, controllers), [groups, controllers]);

  function statusFor(tile: HomeTileData): TileStatusV2 {
    const base = aggregateTileStatusLive(tile.members, live);
    const o = overrides.get(tile.id);
    if (!o || Date.now() - o.at > OVERRIDE_TTL_MS) return base;
    return {
      ...base,
      power: o.on === undefined ? base.power : o.on ? 'on' : 'off',
      brightness: o.bri ?? base.brightness
    };
  }

  function glowFor(tile: HomeTileData, status: TileStatusV2): string {
    if (status.allOffline) return OFFLINE_GLOW;
    for (const m of tile.members) {
      const src = live.get(m.controllerId);
      if (src?.reachable && src.state) {
        const color = dominantColor(src.state);
        if (color !== OFF_GLOW && color !== OFFLINE_GLOW) return color;
      }
    }
    return OFF_GLOW;
  }

  function setOverride(tileId: string, patch: { on?: boolean; bri?: number }) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(tileId, { ...next.get(tileId), ...patch, at: Date.now() });
      return next;
    });
  }

  function handlePower(tile: HomeTileData, on: boolean) {
    setOverride(tile.id, { on });
    const patch: ControlPatch = tile.kind === 'group' ? { seg: { on } } : { on };
    applyControl(targetsFor(tile), patch).catch(() => {});
  }

  const throttledBrightness = useRef(
    throttle((tile: HomeTileData, bri: number) => {
      const patch: ControlPatch = tile.kind === 'group' ? { seg: { bri } } : { bri };
      applyControl(targetsFor(tile), patch).catch(() => {});
    }, BRIGHTNESS_THROTTLE_MS)
  ).current;

  function handleBrightness(tile: HomeTileData, bri: number) {
    setOverride(tile.id, { bri });
    throttledBrightness(tile, bri);
  }

  if (!controllersQuery.isLoading && controllers.length === 0) {
    return (
      <section className="section home-section">
        <h2>Home</h2>
        <p className="empty-state">Add a controller in Devices to get started.</p>
      </section>
    );
  }

  return (
    <section className="section home-section">
      <div className="home-header">
        <h2>Home</h2>
        <div className="home-header-actions" />
      </div>
      <div className="home-grid">
        {tiles.map((tile) => {
          const status = statusFor(tile);
          return (
            <HomeTile
              key={tile.id}
              tile={tile}
              status={status}
              glowColor={glowFor(tile, status)}
              selectMode={false}
              selected={false}
              onToggleSelect={() => {}}
              onLongPress={() => {}}
              onOpenControl={(t) => setControlTargets(targetsFor(t))}
              onPower={handlePower}
              onBrightness={handleBrightness}
            />
          );
        })}
      </div>
      <ControlSurface
        targets={controlTargets ?? []}
        open={controlTargets !== null}
        onClose={() => setControlTargets(null)}
      />
    </section>
  );
}
