import { useState } from 'react';
import type { Controller } from '../../api/client';
import { pushFirmwareUpdate } from '../../api/client';
import { useControllers, useFirmwareStatus } from '../../api/queries';
import { useLiveStatus, type LiveStatusEntry } from '../../api/live';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { GearIcon } from '../../components/icons';
import './firmware.css';

function FirmwareRow({
  controller,
  live,
  onOpenDeviceUpdate
}: {
  controller: Controller;
  live: LiveStatusEntry | undefined;
  onOpenDeviceUpdate: (controllerId: string) => void;
}) {
  const status = useFirmwareStatus(controller.id);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  // Prefer the live device-reported name over the frozen (often mDNS)
  // stored name — same reasoning as DeviceCard/DeviceDetail/Home/Control.
  const displayName = live?.info?.name || controller.name;

  // Pinning is required before the server will push an update at all, so an
  // update-available-but-unpinned controller has no direct action here —
  // the gear icon routes to the detail page's one-time picker instead.
  const canUpdateDirectly = !!status.data?.updateAvailable && !!status.data.pinnedAssetPattern;

  async function handleUpdate() {
    setUpdating(true);
    setUpdateError(null);
    try {
      const result = await pushFirmwareUpdate(controller.id);
      if (!result.ok) setUpdateError(result.error ?? 'Update failed');
      await status.refetch();
    } finally {
      setUpdating(false);
    }
  }

  return (
    <li className="firmware-row">
      <div className="firmware-row-info">
        <span className="firmware-row-name">{displayName}</span>
        {controller.stale && <Chip variant="warning">stale</Chip>}
        {status.isPending && <span className="firmware-row-meta">Checking firmware…</span>}
        {status.isError && <span className="firmware-row-meta">Firmware status unavailable</span>}
        {status.data?.unreachable && <span className="firmware-row-meta">Controller offline</span>}
        {status.data && !status.data.unreachable && (
          <span className="firmware-row-meta">
            Installed: {status.data.installedVersion ?? 'unknown'}
            {status.data.updateAvailable && ` — Available: ${status.data.latestTag}`}
            {status.data.isPrerelease && ' (pre-release)'}
          </span>
        )}
        {updateError && <span className="firmware-row-error" role="alert">{updateError}</span>}
      </div>
      <div className="firmware-row-actions">
        {canUpdateDirectly && (
          <Button variant="primary" size="sm" disabled={updating} onClick={handleUpdate}>
            {updating ? 'Updating…' : 'Update'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="firmware-row-settings"
          aria-label={`Firmware settings for ${displayName}`}
          onClick={() => onOpenDeviceUpdate(controller.id)}
        >
          <GearIcon />
        </Button>
      </div>
    </li>
  );
}

export function FirmwareSection({
  onOpenDeviceUpdate
}: {
  onOpenDeviceUpdate: (controllerId: string) => void;
}) {
  const controllers = useControllers();
  const controllerIds = controllers.data?.map((c) => c.id) ?? [];
  const live = useLiveStatus(controllerIds);
  return (
    <section className="section firmware-section">
      <h2>Firmware</h2>
      <Card>
        {controllers.isError && (
          <div className="error-banner" role="alert">Failed to load controllers.</div>
        )}
        {controllers.data && controllers.data.length === 0 && (
          <p className="empty-state">No controllers yet.</p>
        )}
        {controllers.data && controllers.data.length > 0 && (
          <ul className="firmware-list">
            {controllers.data.map((c) => (
              <FirmwareRow key={c.id} controller={c} live={live.get(c.id)} onOpenDeviceUpdate={onOpenDeviceUpdate} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
