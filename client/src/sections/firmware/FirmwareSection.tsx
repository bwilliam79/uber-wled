import type { Controller } from '../../api/client';
import { useControllers, useFirmwareStatus } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import './firmware.css';

function FirmwareRow({
  controller,
  onOpenDeviceUpdate
}: {
  controller: Controller;
  onOpenDeviceUpdate: (controllerId: string) => void;
}) {
  const status = useFirmwareStatus(controller.id);
  return (
    <li className="firmware-row">
      <div className="firmware-row-info">
        <span className="firmware-row-name">{controller.name}</span>
        <span className="firmware-row-host">{controller.host}</span>
      </div>
      <div className="firmware-row-status">
        {controller.stale && <Chip variant="warning">stale</Chip>}
        {status.isPending && <span className="firmware-row-meta">Checking firmware…</span>}
        {status.isError && <span className="firmware-row-meta">Firmware status unavailable</span>}
        {status.data?.unreachable && <span className="firmware-row-meta">Controller offline</span>}
        {status.data && !status.data.unreachable && (
          <>
            <span className="firmware-row-meta">
              Installed: {status.data.installedVersion ?? 'unknown'}
            </span>
            {status.data.detectedArch && (
              <span className="firmware-row-meta">Hardware: {status.data.detectedArch}</span>
            )}
            {status.data.isPrerelease && <Chip variant="accent">pre-release</Chip>}
            {status.data.updateAvailable && (
              <Chip variant="warning">Update available ({status.data.latestTag})</Chip>
            )}
            {status.data.pinnedAssetPattern && <Chip>Board type overridden</Chip>}
          </>
        )}
      </div>
      <Button
        variant={status.data?.updateAvailable ? 'primary' : 'secondary'}
        aria-label={`Open update for ${controller.name}`}
        onClick={() => onOpenDeviceUpdate(controller.id)}
      >
        {status.data?.updateAvailable ? 'Update…' : 'Manage…'}
      </Button>
    </li>
  );
}

export function FirmwareSection({
  onOpenDeviceUpdate
}: {
  onOpenDeviceUpdate: (controllerId: string) => void;
}) {
  const controllers = useControllers();
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
              <FirmwareRow key={c.id} controller={c} onOpenDeviceUpdate={onOpenDeviceUpdate} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
