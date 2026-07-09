import { useEffect, useMemo, useState } from 'react';
import type { Controller } from '../../api/client';
import { useLiveStatus } from '../../api/live';
import { useControllers, useGroups } from '../../api/queries';
import { ControlSurface } from '../../control/ControlSurface';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { DeviceCard } from './DeviceCard';
import { DeviceDetail } from './DeviceDetail';
import { RoomGroup } from './RoomGroup';
import { RoomsManagerModal } from './RoomsManagerModal';
import { groupControllersByRoom } from './deviceGrouping';
import { deviceHash, parseDevicesHash, type DeviceTab } from './route';
import { cachedDeviceName } from '../../lib/deviceNames';
import './devices.css';

export function DevicesSection() {
  const [route, setRoute] = useState(() => parseDevicesHash(window.location.hash));
  const controllers = useControllers();
  const groups = useGroups();
  const [controlId, setControlId] = useState<string | null>(null);
  const [roomsOpen, setRoomsOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseDevicesHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const list = controllers.data ?? [];
  const liveIds = useMemo(
    () => (route.controllerId ? [route.controllerId] : list.map((c) => c.id)),
    [route.controllerId, list]
  );
  const live = useLiveStatus(liveIds);

  const { rooms, ungrouped } = useMemo(
    () => groupControllersByRoom(groups.data ?? [], list),
    [groups.data, list]
  );
  const renderCard = (c: Controller) => (
    <DeviceCard key={c.id} controller={c} live={live.get(c.id)} onControl={setControlId} onOpen={openDetail} />
  );
  // Same resolution as DeviceCard so the room manager labels controllers with
  // their live/friendly name rather than the frozen add-time name.
  const nameFor = (id: string) =>
    live.get(id)?.info?.name || cachedDeviceName(id) || list.find((c) => c.id === id)?.name || id;

  function openDetail(controllerId: string, tab: DeviceTab = 'info') {
    window.location.hash = deviceHash(controllerId, tab);
    setRoute({ controllerId, tab });
  }

  function backToList() {
    window.location.hash = '#/devices';
    setRoute({ controllerId: null, tab: 'info' });
  }

  if (route.controllerId) {
    if (controllers.isLoading) {
      return (
        <section className="section devices-section">
          <Skeleton height="200px" />
        </section>
      );
    }
    const controller = list.find((c) => c.id === route.controllerId);
    if (!controller) {
      return (
        <section className="section devices-section">
          <p role="alert">Unknown device.</p>
          <Button variant="secondary" onClick={backToList}>Back to devices</Button>
        </section>
      );
    }
    return (
      <section className="section devices-section">
        <DeviceDetail controller={controller} live={live.get(controller.id)} tab={route.tab}
          onTabChange={(tab) => openDetail(controller.id, tab)} onBack={backToList} />
      </section>
    );
  }

  return (
    <section className="section devices-section">
      <header className="devices-header">
        <h2>Devices</h2>
        {list.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setRoomsOpen(true)}>Manage rooms</Button>
        )}
      </header>
      {controllers.isLoading && (
        <div className="devices-grid">
          <Skeleton height="140px" />
          <Skeleton height="140px" />
        </div>
      )}
      {controllers.isError && <p role="alert">Could not load controllers.</p>}
      {!controllers.isLoading && !controllers.isError && list.length === 0 && (
        <p className="empty-state">
          No controllers yet — discovery adds them automatically, or add one in Settings.
        </p>
      )}
      {rooms.length === 0 ? (
        <div className="devices-grid">{list.map(renderCard)}</div>
      ) : (
        <div className="devices-rooms">
          {rooms.map(({ group, controllers: members }) => (
            <RoomGroup key={group.id} title={group.name} icon={group.icon} count={members.length}>
              {members.map(renderCard)}
            </RoomGroup>
          ))}
          {ungrouped.length > 0 && (
            <RoomGroup title="Ungrouped" count={ungrouped.length}>
              {ungrouped.map(renderCard)}
            </RoomGroup>
          )}
        </div>
      )}
      <ControlSurface
        targets={controlId ? [{ kind: 'controller', controllerId: controlId }] : []}
        open={controlId !== null}
        onClose={() => setControlId(null)}
      />
      <RoomsManagerModal
        open={roomsOpen}
        onClose={() => setRoomsOpen(false)}
        groups={groups.data ?? []}
        controllers={list}
        nameFor={nameFor}
      />
    </section>
  );
}
