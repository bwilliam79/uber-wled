import { useEffect, useMemo, useState } from 'react';
import { useLiveStatus } from '../../api/live';
import { useControllers } from '../../api/queries';
import { ControlSurface } from '../../control/ControlSurface';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { DeviceCard } from './DeviceCard';
import { DeviceDetail } from './DeviceDetail';
import { deviceHash, parseDevicesHash, type DeviceTab } from './route';
import './devices.css';

export function DevicesSection() {
  const [route, setRoute] = useState(() => parseDevicesHash(window.location.hash));
  const controllers = useControllers();
  const [controlId, setControlId] = useState<string | null>(null);

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
      {!controllers.isLoading && !controllers.isError && list.length === 0 && (
        <p className="empty-state">
          No controllers yet — discovery adds them automatically, or add one by IP.
        </p>
      )}
      <div className="devices-grid">
        {list.map((c) => (
          <DeviceCard key={c.id} controller={c} live={live.get(c.id)}
            onControl={setControlId} onOpen={openDetail} />
        ))}
      </div>
      <ControlSurface
        targets={controlId ? [{ kind: 'controller', controllerId: controlId }] : []}
        open={controlId !== null}
        onClose={() => setControlId(null)}
      />
    </section>
  );
}
