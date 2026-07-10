import { useState } from 'react';
import {
  updateSchedule,
  type Controller, type CustomTheme, type Group, type Schedule, type TriggerTime
} from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TargetPicker, type TargetValue } from './TargetPicker';
import { TriggerTimePicker } from './TriggerTimePicker';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WeeklyScheduleDraft {
  name: string;
  daysOfWeek: number[];
  /** 'weekly' = fire at timeOfDay; 'sunrise'/'sunset' = fire at that solar
   *  event ± offsetMinutes. All three still repeat on the chosen daysOfWeek. */
  triggerType: 'weekly' | 'sunrise' | 'sunset';
  timeOfDay: string | null;
  offsetMinutes: number;
  target: TargetValue;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
  /** Optional paired power-off at an independent trigger time. */
  offTrigger: TriggerTime | null;
  /** 'weekly' → a recurring Schedule; 'date' → a specific-date CalendarEvent
   *  (fixed month/day) that overrides the weekly schedules that day. */
  repeat: 'weekly' | 'date';
  month: number;
  day: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function themeIdOf(schedule: Schedule): string {
  return (schedule.actionPayload as { themeId?: string } | null)?.themeId ?? '';
}

export function WeeklyScheduleForm({
  groups,
  controllers,
  live,
  themes,
  initialSchedule,
  onPreview,
  onApprove,
  onDiscard,
  onSaved,
  previewing
}: {
  groups: Group[];
  controllers: Controller[];
  live: Map<string, LiveStatusEntry>;
  themes: CustomTheme[];
  /** Present in edit mode — pre-fills the form and PATCHes this schedule
   *  directly on Save, skipping the live-preview/approve/discard dance
   *  (that exists to preview a brand-new theme against the real lights
   *  before committing; re-previewing every time someone renames an
   *  existing schedule or nudges its time would be disruptive, not
   *  helpful). Creating a new schedule still goes through onPreview. */
  initialSchedule?: Schedule;
  onPreview: (draft: WeeklyScheduleDraft) => void;
  onApprove: () => void;
  onDiscard: () => void;
  onSaved?: (schedule: Schedule) => void;
  previewing: boolean;
}) {
  // Existing schedules stored as 'cron' predate this form; treat them as fixed.
  const initialTrigger: 'weekly' | 'sunrise' | 'sunset' =
    initialSchedule?.triggerType === 'sunrise' || initialSchedule?.triggerType === 'sunset'
      ? initialSchedule.triggerType
      : 'weekly';
  const [name, setName] = useState(initialSchedule?.name ?? '');
  // Repeat/date apply only when creating; edit is always an existing recurring
  // schedule (specific-date entries are edited via the calendar-event form).
  const nowDate = new Date();
  const [repeat, setRepeat] = useState<'weekly' | 'date'>('weekly');
  const [month, setMonth] = useState(nowDate.getMonth() + 1);
  const [day, setDay] = useState(nowDate.getDate());
  const [days, setDays] = useState<Set<number>>(new Set(initialSchedule?.daysOfWeek ?? []));
  const [triggerType, setTriggerType] = useState<'weekly' | 'sunrise' | 'sunset'>(initialTrigger);
  const [timeOfDay, setTimeOfDay] = useState(initialSchedule?.timeOfDay ?? '18:00');
  const [offsetMinutes, setOffsetMinutes] = useState(initialSchedule?.offsetMinutes ?? 0);
  const [actionType, setActionType] = useState<'theme' | 'off'>(
    initialSchedule?.actionType === 'power' ? 'off' : 'theme'
  );
  const [offTrigger, setOffTrigger] = useState<TriggerTime | null>(initialSchedule?.offTrigger ?? null);
  const [target, setTarget] = useState<TargetValue>(
    initialSchedule
      ? { groupId: initialSchedule.groupId, controllers: initialSchedule.controllers }
      : { groupId: groups[0]?.id ?? null, controllers: null }
  );
  const [themeId, setThemeId] = useState(initialSchedule ? themeIdOf(initialSchedule) : (themes[0]?.id ?? ''));
  const [error, setError] = useState<string | null>(null);

  function toggleDay(day: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  // The action + trigger fields the draft/save payload share.
  const actionFields =
    actionType === 'off'
      ? { actionType: 'power' as const, actionPayload: { on: false } }
      : { actionType: 'theme' as const, actionPayload: { themeId } };
  const triggerFields = {
    triggerType,
    timeOfDay: triggerType === 'weekly' ? timeOfDay : null,
    offsetMinutes: triggerType === 'weekly' ? 0 : offsetMinutes,
    // A "turn off" action is itself the off — a paired off-trigger only makes
    // sense alongside a theme/on action.
    offTrigger: actionType === 'off' ? null : offTrigger
  };

  async function handleSaveEdit() {
    if (!initialSchedule) return;
    setError(null);
    try {
      const saved = await updateSchedule(initialSchedule.id, {
        name,
        daysOfWeek: Array.from(days).sort((a, b) => a - b),
        ...triggerFields,
        ...target,
        ...actionFields
      });
      onSaved?.(saved);
    } catch {
      setError('Failed to save schedule.');
    }
  }

  const draft = (): WeeklyScheduleDraft => ({
    name,
    daysOfWeek: Array.from(days).sort((a, b) => a - b),
    ...triggerFields,
    target,
    ...actionFields,
    repeat,
    month,
    day
  });

  return (
    <div className="schedule-form">
      <Field label="Name" htmlFor="weekly-schedule-name">
        <input
          id="weekly-schedule-name" className="input" value={name}
          onChange={(e) => setName(e.target.value)} placeholder="Schedule name"
        />
      </Field>
      {!initialSchedule && (
        <Field label="Repeat" htmlFor="weekly-schedule-repeat">
          <Select
            id="weekly-schedule-repeat" label="repeat" showLabel={false}
            value={repeat}
            onChange={(v) => setRepeat(v as 'weekly' | 'date')}
            options={[
              { value: 'weekly', label: 'Weekly (pick days)' },
              { value: 'date', label: 'Specific date' }
            ]}
          />
        </Field>
      )}
      {repeat === 'weekly' ? (
        <div className="field">
          <span id="weekly-schedule-days-label" className="field-label">Days</span>
          <div className="day-toggle-group" role="group" aria-labelledby="weekly-schedule-days-label">
            {DAY_LABELS.map((label, dayIdx) => (
              <label key={dayIdx} className={`day-toggle${days.has(dayIdx) ? ' active' : ''}`}>
                <input
                  type="checkbox" aria-label={label} checked={days.has(dayIdx)}
                  onChange={() => toggleDay(dayIdx)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="schedule-date-row">
            <Field label="Month" htmlFor="weekly-schedule-month">
              <Select
                id="weekly-schedule-month" label="month" showLabel={false}
                value={String(month)} onChange={(v) => setMonth(Number(v))}
                options={MONTH_NAMES.map((n, i) => ({ value: String(i + 1), label: n }))}
              />
            </Field>
            <Field label="Day" htmlFor="weekly-schedule-day">
              <input
                id="weekly-schedule-day" aria-label="day of month" className="input" type="number"
                min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))}
              />
            </Field>
          </div>
          <p className="control-label">Overrides the weekly schedules on this date.</p>
        </>
      )}
      <Field label="Trigger" htmlFor="weekly-schedule-trigger">
        <Select
          id="weekly-schedule-trigger" label="trigger" showLabel={false}
          value={triggerType}
          onChange={(v) => setTriggerType(v as 'weekly' | 'sunrise' | 'sunset')}
          options={[
            { value: 'weekly', label: 'Fixed time' },
            { value: 'sunrise', label: 'Sunrise' },
            { value: 'sunset', label: 'Sunset' }
          ]}
        />
      </Field>
      {triggerType === 'weekly' ? (
        <Field label="Time of day" htmlFor="weekly-schedule-time">
          <input
            id="weekly-schedule-time" aria-label="time of day" className="input" type="time"
            value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)}
          />
        </Field>
      ) : (
        <Field label="Offset (min)" htmlFor="weekly-schedule-offset">
          <input
            id="weekly-schedule-offset" aria-label="offset minutes" className="input" type="number"
            value={offsetMinutes} onChange={(e) => setOffsetMinutes(Number(e.target.value))}
          />
        </Field>
      )}
      <TargetPicker
        idPrefix="weekly-schedule"
        groups={groups}
        controllers={controllers}
        live={live}
        value={target}
        onChange={setTarget}
      />
      <Field label="Action" htmlFor="weekly-schedule-action">
        <Select
          id="weekly-schedule-action" label="action" showLabel={false}
          value={actionType}
          onChange={(v) => setActionType(v as 'theme' | 'off')}
          options={[
            { value: 'theme', label: 'Apply theme' },
            { value: 'off', label: 'Turn off' }
          ]}
        />
      </Field>
      {actionType === 'theme' && (
        <>
          <Field label="Theme" htmlFor="weekly-schedule-theme">
            <Select
              id="weekly-schedule-theme" label="theme" showLabel={false} value={themeId} onChange={setThemeId}
              options={themes.map((t) => ({ value: t.id, label: t.name }))}
            />
          </Field>
          <TriggerTimePicker
            idPrefix="weekly-schedule-off"
            label="Turn off at"
            value={offTrigger}
            onChange={setOffTrigger}
            allowNone
          />
        </>
      )}
      <div className="schedule-form-actions">
        {initialSchedule ? (
          <Button variant="primary" onClick={handleSaveEdit}>Save</Button>
        ) : (
          <>
            {!previewing && (
              <Button variant="primary" onClick={() => onPreview(draft())}>
                {actionType === 'off' ? 'Create' : 'Preview'}
              </Button>
            )}
            {previewing && (
              <>
                <Button variant="primary" onClick={onApprove}>Approve</Button>
                <Button variant="secondary" onClick={onDiscard}>Discard</Button>
              </>
            )}
          </>
        )}
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
    </div>
  );
}
