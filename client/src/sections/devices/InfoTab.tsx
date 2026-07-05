import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteController, importSchedules, rebootController, type Controller
} from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { humanizeUptime, signalBars } from './format';
import './devices.css';

export interface InfoTabProps {
  controller: Controller;
  live: LiveStatusEntry | undefined;
  onRemoved: () => void;
}

export function InfoTab({ controller, live, onRemoved }: InfoTabProps) {
  const info = live?.info;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmReboot, setConfirmReboot] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const facts: [string, string][] = [
    ['IP address', info?.ip ?? controller.host],
    ['MAC', info?.mac ?? '—'],
    ['Version', info ? `${info.ver} (build ${info.vid ?? '—'})` : '—'],
    ['Architecture', info?.arch ?? '—'],
    ['Uptime', info?.uptime !== undefined ? humanizeUptime(info.uptime) : '—'],
    ['WiFi signal', info?.wifi
      ? `${info.wifi.signal}% (${signalBars(info.wifi.signal)}/4 bars), channel ${info.wifi.channel}`
      : '—'],
    ['BSSID', info?.wifi?.bssid ?? '—'],
    ['FPS', info?.leds.fps !== undefined ? String(info.leds.fps) : '—'],
    ['Free heap', info?.freeheap !== undefined ? `${Math.round(info.freeheap / 1024)} KiB` : '—'],
    ['Filesystem', info?.fs ? `${info.fs.u} / ${info.fs.t} KiB` : '—'],
    ['LEDs', info ? `${info.leds.count}${info.leds.rgbw ? ' RGBW' : ''}` : '—'],
    ['Usermods', info?.u && Object.keys(info.u).length > 0 ? Object.keys(info.u).join(', ') : 'none']
  ];

  async function handleReboot() {
    setBusy(true);
    try {
      await rebootController(controller.id);
      setConfirmReboot(false);
      toast.show({
        title: 'Rebooting',
        description: `${controller.name} is restarting — it drops offline for a few seconds.`,
        variant: 'info'
      });
    } catch {
      toast.show({ title: 'Reboot failed', variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await deleteController(controller.id);
      await queryClient.invalidateQueries({ queryKey: ['controllers'] });
      onRemoved();
    } finally {
      setBusy(false);
    }
  }

  async function handleImportSchedules() {
    setImporting(true);
    try {
      const res = await importSchedules(controller.id, false);
      toast.show({
        title: 'Schedules imported',
        description: `Imported ${res.imported.length}, skipped ${res.skipped.length}.`,
        variant: 'success'
      });
    } catch {
      toast.show({ title: 'Schedule import failed', variant: 'error' });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="info-tab">
      {live !== undefined && !live.reachable && <Chip variant="danger">Offline</Chip>}
      <Card>
        <h3>Live output</h3>
        <iframe
          className="info-liveview"
          src={`http://${controller.host}/liveview`}
          title={`Live output of ${controller.name}`}
        />
      </Card>
      <Card>
        <h3>Device facts</h3>
        <dl className="facts-grid">
          {facts.map(([label, value]) => (
            <div className="fact" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card>
        <h3>Actions</h3>
        <div className="info-actions-row">
          <a href={`http://${controller.host}`} target="_blank" rel="noreferrer">Open native UI</a>
          <Button variant="secondary" onClick={handleImportSchedules} disabled={importing}>
            {importing ? 'Importing…' : 'Import schedules'}
          </Button>
          <Button variant="danger" onClick={() => setConfirmReboot(true)}>Reboot</Button>
          <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove controller</Button>
        </div>
      </Card>
      <Modal open={confirmReboot} onClose={() => setConfirmReboot(false)} title="Reboot device"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReboot(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReboot} disabled={busy}>Confirm reboot</Button>
          </>
        }>
        <p>Reboot “{controller.name}”? Lights turn off until it restarts (a few seconds).</p>
      </Modal>
      <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove controller"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRemove} disabled={busy}>Remove</Button>
          </>
        }>
        <p>
          Remove “{controller.name}” from uber-wled? The device itself is not changed; groups,
          strips, and schedules that reference it will stop matching.
        </p>
      </Modal>
    </div>
  );
}
