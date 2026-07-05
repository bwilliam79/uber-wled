import { useState } from 'react';
import {
  addCalendarEvent, ConflictError,
  type CalendarEvent, type CustomTheme, type Group
} from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';

export function CalendarEventForm({
  groups,
  themes,
  onCreated
}: {
  groups: Group[];
  themes: CustomTheme[];
  onCreated: (event: CalendarEvent) => void;
}) {
  const [name, setName] = useState('');
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [time, setTime] = useState('18:00');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [themeId, setThemeId] = useState(themes[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      const created = await addCalendarEvent({
        name,
        category: 'custom',
        dateRule: { kind: 'fixed', month, day },
        recursYearly: true,
        enabled: true,
        groupId: groupId || null,
        triggerTime: { type: 'fixed', time },
        actionType: 'theme',
        actionPayload: { themeId }
      });
      onCreated(created);
    } catch (err) {
      if (err instanceof ConflictError) {
        setError(
          `Conflicts with "${err.conflict.name}" on ${err.conflict.month}/${err.conflict.day}. Disable it first to save this event.`
        );
      } else {
        setError('Failed to save calendar event.');
      }
    }
  }

  return (
    <div className="calendar-event-form">
      <Field label="Event name" htmlFor="calendar-event-name">
        <input
          id="calendar-event-name" aria-label="event name" className="input"
          value={name} onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="form-row">
        <Field label="Month" htmlFor="calendar-event-month">
          <input
            id="calendar-event-month" aria-label="month" className="input" type="number"
            min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))}
          />
        </Field>
        <Field label="Day" htmlFor="calendar-event-day">
          <input
            id="calendar-event-day" aria-label="day" className="input" type="number"
            min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))}
          />
        </Field>
        <Field label="Time" htmlFor="calendar-event-time">
          <input
            id="calendar-event-time" aria-label="event time" className="input" type="time"
            value={time} onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Group" htmlFor="calendar-event-group">
        <Select
          id="calendar-event-group" label="event group" value={groupId} onChange={setGroupId}
          options={groups.map((g) => ({ value: g.id, label: g.name }))}
        />
      </Field>
      <Field label="Theme" htmlFor="calendar-event-theme">
        <Select
          id="calendar-event-theme" label="event theme" value={themeId} onChange={setThemeId}
          options={themes.map((t) => ({ value: t.id, label: t.name }))}
        />
      </Field>
      <Button variant="primary" onClick={handleSave}>Save</Button>
      {error && <div className="error-banner" role="alert">{error}</div>}
    </div>
  );
}
