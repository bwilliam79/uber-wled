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
  const [pinError, setPinError] = useState<string | null>(null);

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
    setPinError(null);
    try {
      await pinFirmwareAsset(controllerId, assetNameToPattern(assetName));
      setPickerOpen(false);
      await refresh();
    } catch {
      // Leave the picker open on failure — closing it here would silently
      // discard the user's choice with nothing pinned and no visible sign
      // anything went wrong (the exact bug this error state fixes).
      setPinError('Failed to save the pinned firmware asset. Try again.');
    }
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

  const candidates = status.candidateAssets ?? [];
  const hasCandidates = candidates.length > 0;
  const isPinned = !!status.pinnedAssetPattern;
  const showUpdateButton = isPinned && status.updateAvailable;

  return (
    <div className="firmware-status">
      <div className="firmware-status-row">
        <span className="controller-meta">Installed: {status.installedVersion}</span>
        {status.updateAvailable && <span className="controller-meta">Available: {status.latestTag}</span>}
        {status.isPrerelease && <span className="badge">pre-release</span>}
      </div>
      {status.detectedArch && (
        <div className="firmware-status-row">
          <span className="controller-meta">Hardware: {status.detectedArch}</span>
        </div>
      )}
      {!isPinned && hasCandidates && (
        <p className="firmware-setup-hint">One-time setup: pick the firmware asset for this device.</p>
      )}
      <div className="firmware-status-row">
        {hasCandidates && (
          <button type="button" className="btn btn-secondary" onClick={() => setPickerOpen(true)}>
            Pick Firmware Asset
          </button>
        )}
        {showUpdateButton && (
          <button type="button" className="btn btn-primary" onClick={handleUpdate} disabled={updating}>
            {updating ? 'Updating…' : 'Update Firmware'}
          </button>
        )}
      </div>
      {hasCandidates && pickerOpen && (
        <AssetPickerModal
          assets={candidates}
          currentPattern={status.pinnedAssetPattern}
          recommendedAssetName={status.recommendedAssetName}
          onPick={handlePick}
          onCancel={() => setPickerOpen(false)}
        />
      )}
      {pinError && <p role="alert" className="error-banner">{pinError}</p>}
      {updateError && <p role="alert" className="error-banner">{updateError}</p>}
    </div>
  );
}
