import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addController } from '../../api/client';
import { useLiveStatus } from '../../api/live';
import { useControllers } from '../../api/queries';
import { ControlSurface } from '../../control/ControlSurface';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { DeviceCard } from './DeviceCard';
import { DeviceDetail } from './DeviceDetail';
import { deviceHash, parseDevicesHash, type DeviceTab } from './route';
import './devices.css';

export function DevicesSection() {
  const [route, setRoute] = useState(() => parseDevicesHash(window.location.hash));
  const controllers = useControllers();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [controlId, setControlId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newHost, setNewHost] = useState('');
  const [adding, setAdding] = useState(false);

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

  async function handleAdd() {
    if (!newName.trim() || !newHost.trim()) return;
    setAdding(true);
    try {
      await addController(newName.trim(), newHost.trim());
      await queryClient.invalidateQueries({ queryKey: ['controllers'] });
      setAddOpen(false);
      setNewName('');
      setNewHost('');
    } catch (e) {
      toast.show({
        title: 'Could not add controller',
        description: e instanceof Error ? e.message : undefined,
        variant: 'error'
      });
    } finally {
      setAdding(false);
    }
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
        <Button variant="primary" onClick={() => setAddOpen(true)}>Add controller</Button>
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
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add controller"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={adding}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAdd}
              disabled={adding || !newName.trim() || !newHost.trim()}>
              {adding ? 'Adding…' : 'Add'}
            </Button>
          </>
        }>
        <Field label="Name" htmlFor="add-controller-name">
          <input id="add-controller-name" className="input" value={newName}
            onChange={(e) => setNewName(e.target.value)} placeholder="Front Porch" />
        </Field>
        <Field label="Host / IP" htmlFor="add-controller-host">
          <input id="add-controller-host" className="input" value={newHost}
            onChange={(e) => setNewHost(e.target.value)} placeholder="10.0.0.50" />
        </Field>
      </Modal>
    </section>
  );
}
