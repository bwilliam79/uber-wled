import { useEffect } from 'react';

export function AssetPickerModal({
  assets,
  currentPattern,
  recommendedAssetName,
  onPick,
  onCancel
}: {
  assets: { name: string; downloadUrl: string }[];
  currentPattern?: string | null;
  /** Filename of the plain/unspecialized build, when one is confidently
   *  known to be correct for ordinary boards — see FirmwareStatus's
   *  recommendedAssetName doc for why this isn't always present. */
  recommendedAssetName?: string | null;
  onPick: (assetName: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const isOverride = !!currentPattern;
  // Recommended option first, so it's the natural first thing a scanning
  // eye lands on — still just one button among several, never auto-picked.
  const orderedAssets = recommendedAssetName
    ? [
        ...assets.filter((a) => a.name === recommendedAssetName),
        ...assets.filter((a) => a.name !== recommendedAssetName)
      ]
    : assets;

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="asset-picker-heading" className="asset-picker-modal">
        <h4 id="asset-picker-heading">
          {isOverride ? 'Override the firmware asset for this controller' : 'Pick the correct firmware asset for this controller'}
        </h4>
        <p className="controller-meta">
          {isOverride
            ? `Currently pinned to "${currentPattern}". Choosing a different asset below replaces that pin for future updates.`
            : 'Ambiguous chip family — choose the exact asset for this device. This is remembered for future updates.'}
        </p>
        <ul className="asset-picker-list">
          {orderedAssets.map((a) => {
            const isRecommended = a.name === recommendedAssetName;
            return (
              <li key={a.name}>
                <button
                  type="button"
                  className={`btn ${isRecommended ? 'btn-primary' : 'btn-secondary'} asset-picker-option`}
                  onClick={() => onPick(a.name)}
                >
                  {a.name}
                  {isRecommended && <span className="asset-picker-recommended"> (recommended)</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
