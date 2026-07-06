export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Set false when the label would duplicate text already visible right
   *  next to this toggle (e.g. a tile that already shows its own name). The
   *  label always stays the accessible name via aria-label either way. */
  showLabel?: boolean;
}

export function Toggle({ checked, onChange, label, disabled, showLabel = true }: ToggleProps) {
  return (
    <div className="ui-toggle-row">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`ui-toggle${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-toggle-thumb" />
      </button>
      {showLabel && <span className="ui-toggle-label">{label}</span>}
    </div>
  );
}
