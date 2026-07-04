import { useEffect, useState } from 'react';
import {
  listCalendarEvents, listGroups, listThemes, updateCalendarEvent, deleteCalendarEvent,
  type CalendarEvent, type Group, type CustomTheme
} from '../api/client';
import { CalendarGrid, eventsForDay } from './CalendarGrid';
import { CalendarEventForm } from './CalendarEventForm';
import { ScheduleManager } from './ScheduleManager';

export function ScheduleSection({
  initialYear,
  initialMonth
}: {
  initialYear?: number;
  initialMonth?: number;
}) {
  const now = new Date();
  const [year, setYear] = useState(initialYear ?? now.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    listCalendarEvents().then(setEvents);
    listGroups().then(setGroups);
    listThemes().then(setThemes);
  }, []);

  function prev() {
    setSelectedDay(null);
    if (month === 1) { setMonth(12); setYear((y) => y - 1); } else { setMonth((m) => m - 1); }
  }
  function next() {
    setSelectedDay(null);
    if (month === 12) { setMonth(1); setYear((y) => y + 1); } else { setMonth((m) => m + 1); }
  }
  function today() {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setSelectedDay(now.getDate());
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    const updated = await updateCalendarEvent(id, { enabled });
    setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)));
  }
  async function remove(id: string) {
    await deleteCalendarEvent(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  const dayEvents = selectedDay === null ? [] : eventsForDay(events, year, month, selectedDay);
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? '—';
  const themeName = (payload: unknown) => {
    const themeId = (payload as { themeId?: string })?.themeId;
    return themes.find((t) => t.id === themeId)?.name ?? themeId ?? '—';
  };
  function triggerLabel(e: CalendarEvent): string {
    return e.triggerTime.type === 'fixed'
      ? `at ${e.triggerTime.time}`
      : `${e.triggerTime.type} ${e.triggerTime.offsetMinutes >= 0 ? '+' : ''}${e.triggerTime.offsetMinutes} min`;
  }

  return (
    <section className="section schedule-section">
      <div className="schedule-body">
        <div className="schedule-calendar card">
          <CalendarGrid
            events={events}
            year={year}
            month={month}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onPrev={prev}
            onNext={next}
            onToday={today}
          />
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Close' : '+ Event'}
          </button>
          {showForm && (
            <CalendarEventForm
              groups={groups}
              themes={themes}
              onCreated={(e) => { setEvents((prev) => [...prev, e]); setShowForm(false); }}
            />
          )}
        </div>

        <aside className="schedule-detail card">
          <h3>{selectedDay === null ? 'Select a day' : `Day ${selectedDay}`}</h3>
          {selectedDay !== null && dayEvents.length === 0 && <p className="empty-state">No events on this day.</p>}
          {dayEvents.map((e) => (
            <div key={e.id} className="schedule-detail-event">
              <label className="checkbox-field">
                <input type="checkbox" checked={e.enabled} onChange={(ev) => toggleEnabled(e.id, ev.target.checked)} />
                <span className="controller-name">{e.name}</span>
              </label>
              <span className="controller-meta">{e.actionType ?? 'action'} · {themeName(e.actionPayload)}</span>
              <span className="controller-meta">Trigger {triggerLabel(e)} · Group {groupName(e.groupId)}</span>
              {e.enabled && <span className="badge badge-stale">Overrides the weekly schedule this day</span>}
              <button type="button" className="btn btn-destructive" onClick={() => remove(e.id)}>Remove</button>
            </div>
          ))}
        </aside>
      </div>

      <ScheduleManager />
    </section>
  );
}
