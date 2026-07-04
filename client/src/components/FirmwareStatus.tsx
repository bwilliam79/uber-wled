import { useEffect, useState } from 'react';
import {
  getFirmwareStatus, pinFirmwareAsset, pushFirmwareUpdate, type FirmwareStatus as FirmwareStatusData
} from '../api/client';
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
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  async function refresh() {
    const data = await getFirmwareStatus(controllerId);
    setStatus(data);
  }

  useEffect(() => {
    refresh();
  }, [controllerId]);

  async function handlePick(assetName: string) {
    await pinFirmwareAsset(controllerId, assetNameToPattern(assetName));
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

  if (!status) return <p className="firmware-status controller-meta">Checking firmware…</p>;

  const showPicker = (status.candidateAssets ?? []).length > 0;
  const showUpdateButton = !showPicker && status.updateAvailable && !!status.pinnedAssetPattern;

  return (
    <div className="firmware-status">
      <span className="controller-meta">Installed: {status.installedVersion}</span>
      {status.updateAvailable && (
        <span className="badge badge-stale"> Update available ({status.latestTag})</span>
      )}
      {showPicker && (
        <AssetPickerModal
          assets={status.candidateAssets}
          onPick={handlePick}
          onCancel={() => {}}
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
