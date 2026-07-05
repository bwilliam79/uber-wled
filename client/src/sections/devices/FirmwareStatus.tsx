import { useEffect, useState } from 'react';
import {
  getFirmwareStatus, pinFirmwareAsset, pushFirmwareUpdate, type FirmwareStatus as FirmwareStatusData
} from '../../api/client';
import { AssetPickerModal } from './AssetPickerModal';

/**
 * Strips the `WLED_<version>_` prefix and `.bin` suffix from an asset
 * filename to derive the pinned pattern token, e.g.
 * "WLED_0.15.0_ESP02.bin" -> "ESP02", per the firmware design spec.
 */
function assetNameToPattern(assetName: string): string {
  return assetName.replace(/^WLED_[^_]+_/, '').replace(/\.bin$/i, '');
}

export function FirmwareStatus({ controllerId }: { controllerId: string }) {
  const [status, setStatus] = useState<FirmwareStatusData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function refresh() {
    try {
      const data = await getFirmwareStatus(controllerId);
      setStatus(data);
      setLoadError(false);
    } catch {
      // Don't hang on "Checking firmware…" forever if the status call fails.
      setLoadError(true);
    }
  }

  useEffect(() => {
    refresh();
  }, [controllerId]);

  async function handlePick(assetName: string) {
    await pinFirmwareAsset(controllerId, assetNameToPattern(assetName));
    setPickerOpen(false);
    await refresh();
  }

  async function handleUpdate() {
    setUpdating(true);
    setUpdateError(null);
    try {
      const result = await pushFirmwareUpdate(controllerId);
      if (!result.ok) setUpdateError(result.error ?? 'Update failed');
      await refresh();
    } finally {
      setUpdating(false);
    }
  }

  if (loadError) return <p className="firmware-status controller-meta">Firmware status unavailable</p>;
  if (!status) return <p className="firmware-status controller-meta">Checking firmware…</p>;
  if (status.unreachable) return <p className="firmware-status controller-meta">Controller offline</p>;

  const hasCandidates = (status.candidateAssets ?? []).length > 0;
  const showUpdateButton = !hasCandidates && status.updateAvailable && !!status.pinnedAssetPattern;

  return (
    <div className="firmware-status">
      <span className="controller-meta">Installed: {status.installedVersion}</span>
      {status.updateAvailable && (
        <span className="badge badge-stale"> Update available ({status.latestTag})</span>
      )}
      {status.isPrerelease && <span className="badge">pre-release</span>}
      {hasCandidates && (
        <button type="button" className="btn btn-secondary" onClick={() => setPickerOpen(true)}>
          Pick firmware asset
        </button>
      )}
      {hasCandidates && pickerOpen && (
        <AssetPickerModal
          assets={status.candidateAssets}
          onPick={handlePick}
          onCancel={() => setPickerOpen(false)}
        />
      )}
      {showUpdateButton && (
        <button type="button" className="btn btn-primary" onClick={handleUpdate} disabled={updating}>
          {updating ? 'Updating…' : 'Update'}
        </button>
      )}
      {updateError && <p role="alert" className="error-banner">{updateError}</p>}
    </div>
  );
}
