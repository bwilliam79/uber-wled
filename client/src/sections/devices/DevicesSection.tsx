import { useEffect, useMemo, useState } from 'react';
import type { Controller, Target } from '../../api/client';
import { useLiveStatus } from '../../api/live';
import { useControllers, useSyncGroups } from '../../api/queries';
import { ControlSurface } from '../../control/ControlSurface';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { DeviceCard } from './DeviceCard';
import { DeviceDetail } from './DeviceDetail';
import { SyncGroupCard } from './SyncGroupCard';
import { deviceHash, parseDevicesHash, type DeviceTab } from './route';
import './devices.css';

export function DevicesSection() {
  const [route, setRoute] = useState(() => parseDevicesHash(window.location.hash));
  const controllers = useControllers();
  const syncGroups = useSyncGroups();
  const [tab, setTab] = useState<'controllers' | 'sync'>('controllers');
  // A single target-set drives the Control surface, so both a single device
  // card and a whole sync group (its members) can open it.
  const [controlTargets, setControlTargets] = useState<Target[] | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseDevicesHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const list = useMemo(() => controllers.data ?? [], [controllers.data]);
  const liveIds = useMemo(
    () => (route.controllerId ? [route.controllerId] : list.map((c) => c.id)),
    [route.controllerId, list]
  );
  const live = useLiveStatus(liveIds);

  // Active sync groups surface as their own aggregate-control cards, pinned
  // above the individual devices; members still appear as their own cards too.
  const activeSyncGroups = useMemo(() => {
    const byId = new Map(list.map((c) => [c.id, c]));
    return (syncGroups.data ?? [])
      .filter((sg) => sg.active)
      .map((sg) => ({
        id: sg.id,
        name: sg.name,
        members: sg.memberControllerIds.map((id) => byId.get(id)).filter((c): c is Controller => !!c)
      }))
      .filter((sg) => sg.members.length > 0);
  }, [syncGroups.data, list]);

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
      </header>
      {controllers.isLoading && (
        <div className="devices-grid">
          <Skeleton height="140px" />
          <Skeleton height="140px" />
        </div>
      )}
      {controllers.isError && <p role="alert">Could not load controllers.</p>}

      <Tabs
        label="Devices views"
        active={tab}
        onChange={(id) => setTab(id as 'controllers' | 'sync')}
        tabs={[
          { id: 'controllers', label: 'Controllers' },
          { id: 'sync', label: 'Sync Groups' }
        ]}
      />

      {tab === 'controllers' && (
        !controllers.isLoading && !controllers.isError && list.length === 0 ? (
          <p className="empty-state">
            No controllers yet — discovery adds them automatically, or add one in Settings.
          </p>
        ) : (
          <div className="devices-grid">
            {list.map((c) => (
              <DeviceCard
                key={c.id}
                controller={c}
                live={live.get(c.id)}
                onControl={(id) => setControlTargets([{ kind: 'controller', controllerId: id }])}
                onOpen={openDetail}
              />
            ))}
          </div>
        )
      )}

      {tab === 'sync' && (
        activeSyncGroups.length === 0 ? (
          <p className="empty-state">
            No active sync groups — create one and turn it on in the Sync section, and it
            will show up here for whole-group control.
          </p>
        ) : (
          <div className="devices-grid">
            {activeSyncGroups.map((sg) => (
              <SyncGroupCard
                key={sg.id}
                name={sg.name}
                members={sg.members}
                live={live}
                onControl={setControlTargets}
              />
            ))}
          </div>
        )
      )}

      <ControlSurface
        targets={controlTargets ?? []}
        open={controlTargets !== null}
        onClose={() => setControlTargets(null)}
      />
    </section>
  );
}
