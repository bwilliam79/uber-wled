import type { TriggerTime } from '../../api/client';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';

/** Picks a trigger time: a fixed clock time, or sunset/sunrise with a ±minute
 *  offset. With allowNone, adds a "Don't turn off" choice mapping to null.
 *  Shared by the schedule and calendar-event forms. */
export function TriggerTimePicker({
  idPrefix,
  label,
  value,
  onChange,
  allowNone
}: {
  idPrefix: string;
  label: string;
  value: TriggerTime | null;
  onChange: (v: TriggerTime | null) => void;
  allowNone?: boolean;
}) {
  const kind = value === null ? 'none' : value.type;

  function setKind(next: string) {
    if (next === 'none') onChange(null);
    else if (next === 'fixed') onChange({ type: 'fixed', time: value?.type === 'fixed' ? value.time : '18:00' });
    else {
      const offsetMinutes = value && value.type !== 'fixed' ? value.offsetMinutes : 0;
      onChange({ type: next as 'sunset' | 'sunrise', offsetMinutes });
    }
  }

  const typeOptions = [
    ...(allowNone ? [{ value: 'none', label: "Don't turn off" }] : []),
    { value: 'fixed', label: 'Fixed time' },
    { value: 'sunset', label: 'Sunset' },
    { value: 'sunrise', label: 'Sunrise' }
  ];

  return (
    <div className="trigger-picker">
      <Field label={label} htmlFor={`${idPrefix}-kind`}>
        <Select
          id={`${idPrefix}-kind`} label={label} showLabel={false}
          value={kind} onChange={setKind} options={typeOptions}
        />
      </Field>
      {value?.type === 'fixed' && (
        <Field label="Time" htmlFor={`${idPrefix}-time`}>
          <input
            id={`${idPrefix}-time`} aria-label={`${label} time`} className="input" type="time"
            value={value.time} onChange={(e) => onChange({ type: 'fixed', time: e.target.value })}
          />
        </Field>
      )}
      {value !== null && value.type !== 'fixed' && (
        <Field label="Offset (min)" htmlFor={`${idPrefix}-offset`}>
          <input
            id={`${idPrefix}-offset`} aria-label={`${label} offset minutes`} className="input" type="number"
            value={value.offsetMinutes}
            onChange={(e) => onChange({ type: value.type, offsetMinutes: Number(e.target.value) })}
          />
        </Field>
      )}
    </div>
  );
}
