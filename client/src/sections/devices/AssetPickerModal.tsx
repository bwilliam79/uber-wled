import { useEffect } from 'react';

export function AssetPickerModal({
  assets,
  currentPattern,
  onPick,
  onCancel
}: {
  assets: { name: string; downloadUrl: string }[];
  currentPattern?: string | null;
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
          {assets.map((a) => (
            <li key={a.name}>
              <button type="button" className="btn btn-secondary asset-picker-option" onClick={() => onPick(a.name)}>
                {a.name}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
