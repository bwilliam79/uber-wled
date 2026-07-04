import { useState } from 'react';
import type { Group, CustomTheme } from '../api/client';

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
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  function handlePreview() {
    onPreview({
      name,
      daysOfWeek: Array.from(days).sort((a, b) => a - b),
      timeOfDay,
      groupId,
      actionType: 'theme',
      actionPayload: { themeId }
    });
  }

  return (
    <div className="add-controller-form">
      <h4>New weekly schedule</h4>
      <div className="field">
        <label htmlFor="weekly-schedule-name">Name</label>
        <input
          id="weekly-schedule-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Schedule name"
        />
      </div>
      <div className="field">
        {DAY_LABELS.map((label, day) => (
          <label key={day}>
            <input type="checkbox" aria-label={label} checked={days.has(day)} onChange={() => toggleDay(day)} />
            {label}
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="weekly-schedule-time">Time of day</label>
        <input
          id="weekly-schedule-time"
          aria-label="time of day"
          className="input"
          type="time"
          value={timeOfDay}
          onChange={(e) => setTimeOfDay(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="weekly-schedule-group">Group</label>
        <select id="weekly-schedule-group" aria-label="group" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="weekly-schedule-theme">Theme</label>
        <select id="weekly-schedule-theme" aria-label="theme" className="input" value={themeId} onChange={(e) => setThemeId(e.target.value)}>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      {!previewing && (
        <button type="button" className="btn btn-primary" onClick={handlePreview}>
          Preview
        </button>
      )}
      {previewing && (
        <>
          <button type="button" className="btn btn-primary" onClick={onApprove}>
            Approve
          </button>
          <button type="button" className="btn btn-secondary" onClick={onDiscard}>
            Discard
          </button>
        </>
      )}
    </div>
  );
}
