import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Controller } from '../../api/client';
import { pushFirmwareUpdate } from '../../api/client';
import { useControllers, useFirmwareStatus, useFirmwareStatusMap } from '../../api/queries';
import { useLiveStatus, type LiveStatusEntry } from '../../api/live';
import { cachedDeviceName } from '../../lib/deviceNames';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { useToast } from '../../components/ui/Toast';
import { GearIcon } from '../../components/icons';
import './firmware.css';

function FirmwareRow({
  controller,
  live,
  disableUpdate,
  onOpenDeviceUpdate
}: {
  controller: Controller;
  live: LiveStatusEntry | undefined;
  disableUpdate: boolean;
  onOpenDeviceUpdate: (controllerId: string) => void;
}) {
  const status = useFirmwareStatus(controller.id);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  // Prefer the live device-reported name over the frozen (often mDNS)
  // stored name — same reasoning as DeviceCard/DeviceDetail/Home/Control.
  const displayName = live?.info?.name || cachedDeviceName(controller.id) || controller.name;

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
        <div className="firmware-row-title">
          <span className="firmware-row-name">{displayName}</span>
          {controller.stale && <Chip variant="warning">stale</Chip>}
          {status.data && !status.data.unreachable && status.data.updateAvailable && (
            <Chip variant="warning">Update available ({status.data.latestTag})</Chip>
          )}
        </div>
        {status.isPending && <span className="firmware-row-meta">Checking firmware…</span>}
        {status.isError && <span className="firmware-row-meta">Firmware status unavailable</span>}
        {status.data?.unreachable && <span className="firmware-row-meta">Controller offline</span>}
        {status.data && !status.data.unreachable && (
          <span className="firmware-row-meta">
            Installed: {status.data.installedVersion ?? 'unknown'}
            {status.data.isPrerelease && ' (pre-release)'}
          </span>
        )}
        {updateError && <span className="firmware-row-error" role="alert">{updateError}</span>}
      </div>
      <div className="firmware-row-actions">
        {canUpdateDirectly && (
          <Button variant="primary" size="sm" disabled={updating || disableUpdate} onClick={handleUpdate}>
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
  const firmwareMap = useFirmwareStatusMap(controllerIds);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [updatingAll, setUpdatingAll] = useState(false);

  // Same requirement as a single row's direct Update button: only a pinned,
  // update-available controller can actually be pushed without visiting its
  // own detail page to pick an asset first.
  const updatableControllers = (controllers.data ?? []).filter((c) => {
    const status = firmwareMap.get(c.id);
    return !!status?.updateAvailable && !!status.pinnedAssetPattern;
  });

  async function handleUpdateAll() {
    setUpdatingAll(true);
    try {
      const results = await Promise.all(
        updatableControllers.map(async (c) => {
          const name = live.get(c.id)?.info?.name || cachedDeviceName(c.id) || c.name;
          try {
            const result = await pushFirmwareUpdate(c.id);
            return { name, ok: result.ok, error: result.error };
          } catch (err: any) {
            return { name, ok: false, error: err.message };
          } finally {
            queryClient.invalidateQueries({ queryKey: ['firmware', c.id] });
          }
        })
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.show({
          title: `Updated ${results.length} controller${results.length === 1 ? '' : 's'}`,
          variant: 'success'
        });
      } else {
        toast.show({
          title: `${results.length - failed.length} of ${results.length} controllers updated`,
          description: failed.map((f) => `${f.name}: ${f.error}`).join('; '),
          variant: 'error'
        });
      }
    } finally {
      setUpdatingAll(false);
    }
  }

  return (
    <section className="section firmware-section">
      <div className="firmware-section-header">
        <h2>Firmware</h2>
        {updatableControllers.length > 0 && (
          <Button variant="primary" disabled={updatingAll} onClick={handleUpdateAll}>
            {updatingAll ? 'Updating…' : `Update All (${updatableControllers.length})`}
          </Button>
        )}
      </div>
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
              <FirmwareRow
                key={c.id}
                controller={c}
                live={live.get(c.id)}
                disableUpdate={updatingAll}
                onOpenDeviceUpdate={onOpenDeviceUpdate}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
