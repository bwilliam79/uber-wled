import { useState } from 'react';
import { updateSchedule, type Controller, type CustomTheme, type Group, type Schedule } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TargetPicker, type TargetValue } from './TargetPicker';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WeeklyScheduleDraft {
  name: string;
  daysOfWeek: number[];
  timeOfDay: string;
  target: TargetValue;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
}

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
  const [name, setName] = useState(initialSchedule?.name ?? '');
  const [days, setDays] = useState<Set<number>>(new Set(initialSchedule?.daysOfWeek ?? []));
  const [timeOfDay, setTimeOfDay] = useState(initialSchedule?.timeOfDay ?? '18:00');
  const [target, setTarget] = useState<TargetValue>(
    initialSchedule
      ? { groupId: initialSchedule.groupId, controllerId: initialSchedule.controllerId, wledSegId: initialSchedule.wledSegId }
      : { groupId: groups[0]?.id ?? null, controllerId: null, wledSegId: null }
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

  async function handleSaveEdit() {
    if (!initialSchedule) return;
    setError(null);
    try {
      const saved = await updateSchedule(initialSchedule.id, {
        name,
        daysOfWeek: Array.from(days).sort((a, b) => a - b),
        timeOfDay,
        ...target,
        actionType: 'theme',
        actionPayload: { themeId }
      });
      onSaved?.(saved);
    } catch {
      setError('Failed to save schedule.');
    }
  }

  return (
    <div className="schedule-form">
      <Field label="Name" htmlFor="weekly-schedule-name">
        <input
          id="weekly-schedule-name" className="input" value={name}
          onChange={(e) => setName(e.target.value)} placeholder="Schedule name"
        />
      </Field>
      <div className="field">
        <span id="weekly-schedule-days-label" className="field-label">Days</span>
        <div className="day-toggle-group" role="group" aria-labelledby="weekly-schedule-days-label">
          {DAY_LABELS.map((label, day) => (
            <label key={day} className={`day-toggle${days.has(day) ? ' active' : ''}`}>
              <input
                type="checkbox" aria-label={label} checked={days.has(day)}
                onChange={() => toggleDay(day)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <Field label="Time of day" htmlFor="weekly-schedule-time">
        <input
          id="weekly-schedule-time" aria-label="time of day" className="input" type="time"
          value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)}
        />
      </Field>
      <TargetPicker
        idPrefix="weekly-schedule"
        groups={groups}
        controllers={controllers}
        live={live}
        value={target}
        onChange={setTarget}
      />
      <Field label="Theme" htmlFor="weekly-schedule-theme">
        <Select
          id="weekly-schedule-theme" label="theme" showLabel={false} value={themeId} onChange={setThemeId}
          options={themes.map((t) => ({ value: t.id, label: t.name }))}
        />
      </Field>
      <div className="schedule-form-actions">
        {initialSchedule ? (
          <Button variant="primary" onClick={handleSaveEdit}>Save</Button>
        ) : (
          <>
            {!previewing && (
              <Button
                variant="primary"
                onClick={() =>
                  onPreview({
                    name,
                    daysOfWeek: Array.from(days).sort((a, b) => a - b),
                    timeOfDay,
                    target,
                    actionType: 'theme',
                    actionPayload: { themeId }
                  })
                }
              >
                Preview
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
