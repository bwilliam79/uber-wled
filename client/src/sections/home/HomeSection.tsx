import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listControllers,
  listGroups,
  applyControl,
  addGroup,
  updateGroup,
  deleteGroup,
  reorderGroups,
  type Controller,
  type ControlPatch,
  type Group,
  type GroupMember,
  type Target
} from '../../api/client';
import { useLiveStatus } from '../../api/live';
import { ControlSurface } from '../../control/ControlSurface';
import { Modal } from '../../components/ui/Modal';
import { HomeTile, type HomeTileData } from './HomeTile';
import { RoomCreateModal } from './RoomCreateModal';
import { RoomEditTile } from './RoomEditTile';
import {
  aggregateTileStatusLive,
  type LiveTileSource,
  type TileStatusV2
} from '../../lib/tileStatus';
import { dominantColor, OFF_GLOW, OFFLINE_GLOW } from '../../lib/dominantColor';
import { throttle } from '../../lib/throttle';
import { moveId, dropIndexForPoint } from './reorder';
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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);

  const tiles = useMemo(() => buildTiles(groups, controllers), [groups, controllers]);
  const sortedGroups = useMemo(
    () => groups.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [groups]
  );

  function invalidateGroups() {
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  }

  async function createRoom(name: string, icon: string | null) {
    await addGroup(name, [], icon);
    invalidateGroups();
  }

  function renameRoom(id: string, name: string) {
    updateGroup(id, { name }).then(invalidateGroups);
  }

  function setRoomIcon(id: string, icon: string | null) {
    updateGroup(id, { icon }).then(invalidateGroups);
  }

  function changeMembers(id: string, members: GroupMember[]) {
    updateGroup(id, { members }).then(invalidateGroups);
  }

  const editGridRef = useRef<HTMLDivElement | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);

  const orderedGroups = useMemo(() => {
    if (!dragOrder) return sortedGroups;
    const byId = new Map(sortedGroups.map((g) => [g.id, g]));
    return dragOrder.map((id) => byId.get(id)).filter((g): g is Group => !!g);
  }, [sortedGroups, dragOrder]);

  function persistOrder(ids: string[]) {
    reorderGroups(ids).then(invalidateGroups);
  }

  function moveRoom(id: string, delta: number) {
    const ids = orderedGroups.map((g) => g.id);
    const from = ids.indexOf(id);
    if (from === -1) return;
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    persistOrder(moveId(ids, id, to));
  }

  function handleDragStart(id: string, e: React.PointerEvent) {
    dragIdRef.current = id;
    setDragOrder(orderedGroups.map((g) => g.id));
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function handleDragMove(e: React.PointerEvent) {
    const dragId = dragIdRef.current;
    if (!dragId || !editGridRef.current) return;
    const rects = Array.from(editGridRef.current.children).map((el) => el.getBoundingClientRect());
    const idx = dropIndexForPoint(rects, e.clientX, e.clientY);
    setDragOrder((prev) => (prev ? moveId(prev, dragId, idx) : prev));
  }

  function handleDragEnd() {
    const dragId = dragIdRef.current;
    dragIdRef.current = null;
    if (dragId && dragOrder) persistOrder(dragOrder);
    setDragOrder(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteGroup(deleteTarget.id).then(() => {
      setDeleteTarget(null);
      invalidateGroups();
    });
  }

  function toggleSelect(id: string) {
    setSelectMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function enterSelectMode(id: string) {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function selectAll() {
    setSelectedIds(new Set(tiles.map((t) => t.id)));
  }

  function controlSelected() {
    const targets = tiles.filter((t) => selectedIds.has(t.id)).flatMap(targetsFor);
    if (targets.length > 0) setControlTargets(targets);
  }

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
        <div className="home-header-actions">
          {editMode && (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              Add room
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            aria-pressed={editMode}
            onClick={() => {
              setEditMode((v) => !v);
              exitSelectMode();
            }}
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>
      {editMode ? (
        <div
          className="home-grid"
          ref={editGridRef}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
        >
          {orderedGroups.map((g, i) => (
            <RoomEditTile
              key={g.id}
              group={g}
              controllers={controllers}
              index={i}
              count={orderedGroups.length}
              onRename={renameRoom}
              onSetIcon={setRoomIcon}
              onDelete={(id) => setDeleteTarget(orderedGroups.find((x) => x.id === id) ?? null)}
              onMembersChange={changeMembers}
              onMove={moveRoom}
              onDragStart={handleDragStart}
            />
          ))}
        </div>
      ) : (
        <div className={`home-grid${selectMode ? ' home-select-mode' : ''}`}>
          {tiles.map((tile) => {
            const status = statusFor(tile);
            return (
              <HomeTile
                key={tile.id}
                tile={tile}
                status={status}
                glowColor={glowFor(tile, status)}
                selectMode={selectMode}
                selected={selectedIds.has(tile.id)}
                onToggleSelect={toggleSelect}
                onLongPress={enterSelectMode}
                onOpenControl={(t) => setControlTargets(targetsFor(t))}
                onPower={handlePower}
                onBrightness={handleBrightness}
              />
            );
          })}
        </div>
      )}
      {selectMode && (
        <div className="home-action-bar" role="toolbar" aria-label="selection actions">
          <span className="home-action-count">{selectedIds.size} selected</span>
          <button type="button" className="btn btn-secondary" onClick={selectAll}>Select all</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selectedIds.size === 0}
            onClick={controlSelected}
          >
            Control
          </button>
          <button type="button" className="btn btn-secondary" onClick={exitSelectMode}>Cancel</button>
        </div>
      )}
      <ControlSurface
        targets={controlTargets ?? []}
        open={controlTargets !== null}
        onClose={() => setControlTargets(null)}
      />
      <RoomCreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createRoom} />
      <Modal open={deleteTarget !== null} title="Delete room" onClose={() => setDeleteTarget(null)}>
        <p>
          Delete "{deleteTarget?.name}"? Schedules and calendar events that reference it will stop
          working.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-destructive" onClick={confirmDelete}>
            Delete
          </button>
        </div>
      </Modal>
    </section>
  );
}
