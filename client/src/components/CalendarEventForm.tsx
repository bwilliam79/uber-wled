import { useState } from 'react';
import { addCalendarEvent, ConflictError, type Group, type CustomTheme, type CalendarEvent } from '../api/client';

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
        setError(`Conflicts with "${err.conflict.name}" on ${err.conflict.month}/${err.conflict.day}. Disable it first to save this event.`);
      } else {
        setError('Failed to save calendar event.');
      }
    }
  }

  return (
    <div className="add-controller-form">
      <h4>New custom calendar event</h4>
      <div className="field">
        <label htmlFor="calendar-event-name">Event name</label>
        <input
          id="calendar-event-name"
          aria-label="event name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="calendar-event-month">Month</label>
        <input
          id="calendar-event-month"
          aria-label="month"
          className="input"
          type="number"
          min={1}
          max={12}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor="calendar-event-day">Day</label>
        <input
          id="calendar-event-day"
          aria-label="day"
          className="input"
          type="number"
          min={1}
          max={31}
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor="calendar-event-time">Time</label>
        <input
          id="calendar-event-time"
          aria-label="event time"
          className="input"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="calendar-event-group">Group</label>
        <select id="calendar-event-group" aria-label="event group" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="calendar-event-theme">Theme</label>
        <select id="calendar-event-theme" aria-label="event theme" className="input" value={themeId} onChange={(e) => setThemeId(e.target.value)}>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <button type="button" className="btn btn-primary" onClick={handleSave}>
        Save
      </button>
      {error && <div className="error-banner" role="alert">{error}</div>}
    </div>
  );
}
