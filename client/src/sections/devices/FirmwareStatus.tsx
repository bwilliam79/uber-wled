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

  const candidates = status.candidateAssets ?? [];
  const hasCandidates = candidates.length > 0;
  const isPinned = !!status.pinnedAssetPattern;
  // The server now always returns candidateAssets, whether or not a pattern
  // is already pinned, so the picker button stays reachable as an "override"
  // affordance after the first pin — it's no longer a one-time flow.
  const showUpdateButton = isPinned && status.updateAvailable;
  const pickerLabel = isPinned ? 'Override firmware asset' : 'Pick firmware asset';

  // The pin is a substring pattern (e.g. "ESP02"), not a full filename —
  // resolve it to the actual matching candidate so we can show the real
  // asset name that /update will push, not just the terse pattern fragment.
  const pinnedAsset = isPinned
    ? candidates.find((a) => a.name.toUpperCase().includes(status.pinnedAssetPattern!.toUpperCase()))
    : undefined;

  return (
    <div className="firmware-status">
      <span className="controller-meta">Installed: {status.installedVersion}</span>
      {status.updateAvailable && (
        <span className="badge badge-stale"> Update available ({status.latestTag})</span>
      )}
      {status.isPrerelease && <span className="badge">pre-release</span>}
      {status.detectedArch && (
        <span className="controller-meta firmware-board-type">Detected hardware: {status.detectedArch}</span>
      )}
      {isPinned && (
        <span className="controller-meta firmware-board-type">
          Asset: {pinnedAsset?.name ?? status.pinnedAssetPattern}
        </span>
      )}
      {!isPinned && candidates.length === 1 && (
        <span className="controller-meta firmware-board-type">Default asset: {candidates[0].name}</span>
      )}
      {!isPinned && candidates.length > 1 && (
        <span className="controller-meta firmware-board-type">
          {candidates.length} possible assets for this hardware — pick one below
        </span>
      )}
      {hasCandidates && (
        <button type="button" className="btn btn-secondary" onClick={() => setPickerOpen(true)}>
          {pickerLabel}
        </button>
      )}
      {hasCandidates && pickerOpen && (
        <AssetPickerModal
          assets={candidates}
          currentPattern={status.pinnedAssetPattern}
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
