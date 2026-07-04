export function AssetPickerModal({
  assets,
  onPick,
  onCancel
}: {
  assets: { name: string; downloadUrl: string }[];
  onPick: (assetName: string) => void;
  onCancel: () => void;
}) {
  return (
    <div role="dialog" className="asset-picker-modal">
      <h4>Pick the correct firmware asset for this controller</h4>
      <ul className="asset-picker-list">
        {assets.map((a) => (
          <li key={a.name}>
            <button type="button" className="btn btn-secondary" onClick={() => onPick(a.name)}>
              {a.name}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
