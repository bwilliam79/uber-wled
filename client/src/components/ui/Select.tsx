import { ChevronDownIcon } from '../icons';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  id?: string;
  disabled?: boolean;
  /** Set false when a wrapping <Field> (or similar) already renders this
   *  select's visible label, to avoid showing it twice. */
  showLabel?: boolean;
}

export function Select({ value, onChange, options, label, id, disabled, showLabel = true }: SelectProps) {
  const select = (
    <div className="ui-select-wrap">
      <select
        id={id}
        className="ui-select"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <ChevronDownIcon className="ui-select-chevron" />
    </div>
  );

  if (!label || !showLabel) return select;

  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={id}>{label}</label>
      {select}
    </div>
  );
}
