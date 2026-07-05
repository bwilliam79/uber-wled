import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteCalendarEvent, updateCalendarEvent, type CalendarEvent
} from '../../api/client';
import { useCalendarEvents, useGroups, useThemes } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { Toggle } from '../../components/ui/Toggle';
import { CalendarEventForm } from './CalendarEventForm';
import { CalendarGrid, eventsForDay } from './CalendarGrid';
import { ScheduleManager } from './ScheduleManager';
import './schedule.css';

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
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const events = useCalendarEvents();
  const groups = useGroups();
  const themes = useThemes();
  const queryClient = useQueryClient();

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
    queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prevData) =>
      (prevData ?? []).map((e) => (e.id === id ? updated : e))
    );
  }
  async function remove(id: string) {
    await deleteCalendarEvent(id);
    queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prevData) =>
      (prevData ?? []).filter((e) => e.id !== id)
    );
  }

  const eventList = events.data ?? [];
  const dayEvents = selectedDay === null ? [] : eventsForDay(eventList, year, month, selectedDay);
  const groupName = (id: string | null) =>
    (groups.data ?? []).find((g) => g.id === id)?.name ?? '—';
  const themeName = (payload: unknown) => {
    const themeId = (payload as { themeId?: string })?.themeId;
    return (themes.data ?? []).find((t) => t.id === themeId)?.name ?? themeId ?? '—';
  };
  function triggerLabel(e: CalendarEvent): string {
    return e.triggerTime.type === 'fixed'
      ? `at ${e.triggerTime.time}`
      : `${e.triggerTime.type} ${e.triggerTime.offsetMinutes >= 0 ? '+' : ''}${e.triggerTime.offsetMinutes} min`;
  }

  return (
    <section className="section schedule-section">
      <div className="schedule-body">
        <Card className="schedule-calendar">
          <CalendarGrid
            events={eventList} year={year} month={month} selectedDay={selectedDay}
            onSelectDay={setSelectedDay} onPrev={prev} onNext={next} onToday={today}
          />
          <Button variant="primary" onClick={() => setEventFormOpen(true)}>+ Event</Button>
        </Card>
        <Card className="schedule-detail">
          <h3>{selectedDay === null ? 'Select a day' : `Day ${selectedDay}`}</h3>
          {selectedDay === null && (
            <p className="empty-state">Click a date on the calendar to view or add events for that day.</p>
          )}
          {selectedDay !== null && dayEvents.length === 0 && (
            <p className="empty-state">No events on this day.</p>
          )}
          {dayEvents.map((e) => (
            <div key={e.id} className="schedule-detail-event">
              <div className="schedule-detail-event-head">
                <Toggle
                  checked={e.enabled}
                  onChange={(checked) => toggleEnabled(e.id, checked)}
                  label={`${e.name} enabled`}
                />
                <span className="schedule-detail-event-name">{e.name}</span>
                <Chip variant={e.category === 'holiday' ? 'accent' : 'default'}>{e.category}</Chip>
              </div>
              <span className="schedule-detail-meta">
                {e.actionType ?? 'action'} · {themeName(e.actionPayload)}
              </span>
              <span className="schedule-detail-meta">
                Trigger {triggerLabel(e)} · Group {groupName(e.groupId)}
              </span>
              {e.enabled && <Chip variant="warning">Overrides the weekly schedule this day</Chip>}
              <Button variant="danger" onClick={() => remove(e.id)}>Remove</Button>
            </div>
          ))}
        </Card>
      </div>
      <Modal open={eventFormOpen} title="New calendar event" onClose={() => setEventFormOpen(false)}>
        <CalendarEventForm
          groups={groups.data ?? []}
          themes={themes.data ?? []}
          onCreated={(e) => {
            queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prevData) => [
              ...(prevData ?? []),
              e
            ]);
            setEventFormOpen(false);
          }}
        />
      </Modal>
      <ScheduleManager />
    </section>
  );
}
