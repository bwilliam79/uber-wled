import { useCallback, useEffect, useState } from 'react';
import {
  listGroups, listControllers, listThemes, applyControl, getSegmentsSnapshot, getEffectsPalettes,
  type Group, type Controller, type CustomTheme, type ControlAction
} from '../api/client';
import { HomeTile } from './HomeTile';
import { aggregateTileStatus, type TileMember, type WledSegmentSnapshot } from '../lib/tileStatus';

const POLL_INTERVAL_MS = 5000;

interface Tile {
  id: string;
  title: string;
  members: TileMember[];
}

export function HomeSection() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [effects, setEffects] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<Map<string, WledSegmentSnapshot[]>>(new Map());

  useEffect(() => {
    listGroups().then(setGroups);
    listControllers().then(setControllers);
    listThemes().then(setThemes);
    getEffectsPalettes().then((r) => setEffects(r.effects ?? [])).catch(() => {});
  }, []);

  const refreshSnapshots = useCallback(async () => {
    const ids = new Set(controllers.map((c) => c.id));
    for (const g of groups) for (const m of g.members) ids.add(m.controllerId);

    const next = new Map<string, WledSegmentSnapshot[]>();
    await Promise.all(
      Array.from(ids).map(async (cid) => {
        try {
          next.set(cid, await getSegmentsSnapshot(cid));
        } catch {
          /* left absent from the map: aggregateTileStatus treats a missing entry as offline */
        }
      })
    );
    setSnapshots(next);
  }, [groups, controllers]);

  useEffect(() => {
    refreshSnapshots();
    const t = setInterval(refreshSnapshots, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refreshSnapshots]);

  async function handleApply(members: TileMember[], action: ControlAction) {
    await applyControl(members, action);
    refreshSnapshots();
  }

  if (controllers.length === 0) {
    return (
      <section className="section home-section">
        <h2>Home</h2>
        <p className="empty-state">Add a controller in Controllers to get started.</p>
      </section>
    );
  }

  const groupedControllerIds = new Set(groups.flatMap((g) => g.members.map((m) => m.controllerId)));

  const groupTiles: Tile[] = groups
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({ id: g.id, title: g.name, members: g.members }));

  const ungroupedTiles: Tile[] = controllers
    .filter((c) => !groupedControllerIds.has(c.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: `ungrouped:${c.id}`, title: c.name, members: [{ controllerId: c.id, wledSegId: 0 }] }));

  function renderTile(tile: Tile) {
    return (
      <HomeTile
        key={tile.id}
        id={tile.id}
        title={tile.title}
        members={tile.members}
        status={aggregateTileStatus(tile.members, snapshots)}
        themes={themes}
        effects={effects}
        onApply={(action) => handleApply(tile.members, action)}
      />
    );
  }

  return (
    <section className="section home-section">
      <h2>Home</h2>
      {groups.length === 0 && (
        <p className="home-banner">No groups yet — create one in Groups for room-based control.</p>
      )}
      <div className="home-grid">
        {groupTiles.map(renderTile)}
      </div>
      {ungroupedTiles.length > 0 && (
        <>
          <h3 className="home-ungrouped-heading">Ungrouped</h3>
          <div className="home-grid">
            {ungroupedTiles.map(renderTile)}
          </div>
        </>
      )}
    </section>
  );
}
