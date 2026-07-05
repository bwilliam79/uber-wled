import { useState } from 'react';
import type { CustomTheme, Group } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WeeklyScheduleDraft {
  name: string;
  daysOfWeek: number[];
  timeOfDay: string;
  groupId: string;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
}

export function WeeklyScheduleForm({
  groups,
  themes,
  onPreview,
  onApprove,
  onDiscard,
  previewing
}: {
  groups: Group[];
  themes: CustomTheme[];
  onPreview: (draft: WeeklyScheduleDraft) => void;
  onApprove: () => void;
  onDiscard: () => void;
  previewing: boolean;
}) {
  const [name, setName] = useState('');
  const [days, setDays] = useState<Set<number>>(new Set());
  const [timeOfDay, setTimeOfDay] = useState('18:00');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [themeId, setThemeId] = useState(themes[0]?.id ?? '');

  function toggleDay(day: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
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
      <Field label="Group" htmlFor="weekly-schedule-group">
        <Select
          id="weekly-schedule-group" label="group" value={groupId} onChange={setGroupId}
          options={groups.map((g) => ({ value: g.id, label: g.name }))}
        />
      </Field>
      <Field label="Theme" htmlFor="weekly-schedule-theme">
        <Select
          id="weekly-schedule-theme" label="theme" value={themeId} onChange={setThemeId}
          options={themes.map((t) => ({ value: t.id, label: t.name }))}
        />
      </Field>
      <div className="schedule-form-actions">
        {!previewing && (
          <Button
            variant="primary"
            onClick={() =>
              onPreview({
                name,
                daysOfWeek: Array.from(days).sort((a, b) => a - b),
                timeOfDay,
                groupId,
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
      </div>
    </div>
  );
}
