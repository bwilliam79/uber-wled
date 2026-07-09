import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteCalendarEvent, updateCalendarEvent, importSchedulesFile, SCHEDULES_EXPORT_URL,
  type CalendarEvent
} from '../../api/client';
import { useCalendarEvents, useControllers, useGroups, useThemes } from '../../api/queries';
import { useLiveStatus } from '../../api/live';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { Toggle } from '../../components/ui/Toggle';
import { ImportButton } from '../../components/ImportButton';
import { useToast } from '../../components/ui/Toast';
import { triggerDownload, readJsonFile } from '../../lib/fileTransfer';
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
  // The day whose events overlay is open (a day that has events), and the
  // date the create form is prefilled for (from clicking an empty day).
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [createDate, setCreateDate] = useState<{ month: number; day: number } | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const events = useCalendarEvents();
  const groups = useGroups();
  const controllers = useControllers();
  const live = useLiveStatus((controllers.data ?? []).map((c) => c.id));
  const themes = useThemes();
  const queryClient = useQueryClient();
  const toast = useToast();

  async function handleImport(file: File) {
    try {
      const data = await readJsonFile(file);
      const r = await importSchedulesFile(data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['calendarEvents'] })
      ]);
      const summary = `${r.schedules} schedule${r.schedules === 1 ? '' : 's'} + ${r.calendarEvents} event${r.calendarEvents === 1 ? '' : 's'}`;
      const skipNote = r.skipped > 0 ? ` (${r.skipped} skipped — referenced a room/controller not on this instance)` : '';
      toast.show({ title: `Imported ${summary}${skipNote}`, variant: r.skipped > 0 ? 'error' : 'success' });
    } catch (err) {
      toast.show({ title: 'Schedule import failed', description: (err as Error).message, variant: 'error' });
    }
  }

  function prev() {
    setOpenDay(null);
    if (month === 1) { setMonth(12); setYear((y) => y - 1); } else { setMonth((m) => m - 1); }
  }
  function next() {
    setOpenDay(null);
    if (month === 12) { setMonth(1); setYear((y) => y + 1); } else { setMonth((m) => m + 1); }
  }
  function today() {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  }

  // Clicking a day: if it has events, open the day overlay; if it's empty,
  // jump straight into creating a custom event prefilled with that date.
  function handleSelectDay(day: number) {
    if (eventsForDay(eventList, year, month, day).length > 0) setOpenDay(day);
    else setCreateDate({ month, day });
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
  const dayEvents = openDay === null ? [] : eventsForDay(eventList, year, month, openDay);
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  function targetLabel(e: CalendarEvent): string {
    if (e.controllers && e.controllers.length > 0) {
      const names = e.controllers.map((c) => {
        const name = live.get(c.controllerId)?.info?.name
          || (controllers.data ?? []).find((ctrl) => ctrl.id === c.controllerId)?.name
          || c.controllerId;
        return c.wledSegId === null ? name : `${name} (segment ${c.wledSegId})`;
      });
      return `Controller${names.length > 1 ? 's' : ''} ${names.join(', ')}`;
    }
    const group = (groups.data ?? []).find((g) => g.id === e.groupId);
    return `Group ${group?.name ?? '—'}`;
  }
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
      <div className="schedule-header">
        <h2>Schedule</h2>
        <div className="schedule-header-actions">
          <Button variant="secondary" size="sm" onClick={() => triggerDownload(SCHEDULES_EXPORT_URL)}>
            Export
          </Button>
          <ImportButton label="Import" size="sm" onFile={handleImport} />
        </div>
      </div>
      <div className="schedule-body">
        <Card className="schedule-calendar">
          <CalendarGrid
            events={eventList} year={year} month={month} selectedDay={openDay}
            onSelectDay={handleSelectDay} onPrev={prev} onNext={next} onToday={today}
          />
          <p className="schedule-hint">Click a day to edit its events, or an empty day (+) to add one.</p>
        </Card>
      </div>

      {/* Day overlay: the events on a clicked day, with add/edit/remove. */}
      <Modal
        open={openDay !== null}
        size="lg"
        title={openDay === null ? '' : `${MONTH_NAMES[month - 1]} ${openDay}, ${year}`}
        onClose={() => setOpenDay(null)}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              if (openDay !== null) setCreateDate({ month, day: openDay });
              setOpenDay(null);
            }}
          >
            + Add event this day
          </Button>
        }
      >
        {dayEvents.length === 0 && <p className="empty-state">No events on this day.</p>}
        {dayEvents.map((e) => (
          <div key={e.id} className="schedule-detail-event">
            <div className="schedule-detail-event-head">
              <Toggle
                checked={e.enabled}
                onChange={(checked) => toggleEnabled(e.id, checked)}
                label={`${e.name} enabled`}
                showLabel={false}
              />
              <span className="schedule-detail-event-name">{e.name}</span>
              <Chip variant={e.category === 'holiday' ? 'accent' : 'default'}>{e.category}</Chip>
            </div>
            <span className="schedule-detail-meta">
              {e.actionType ?? 'action'} · {themeName(e.actionPayload)}
            </span>
            <span className="schedule-detail-meta">
              Trigger {triggerLabel(e)} · {targetLabel(e)}
            </span>
            {e.enabled && <Chip variant="warning">Overrides the weekly schedule this day</Chip>}
            <div className="schedule-detail-event-actions">
              <Button variant="secondary" onClick={() => { setEditingEvent(e); setOpenDay(null); }}>Edit</Button>
              <Button variant="danger" onClick={() => remove(e.id)}>Remove</Button>
            </div>
          </div>
        ))}
      </Modal>

      <Modal open={createDate !== null} size="lg" title="New calendar event" onClose={() => setCreateDate(null)}>
        {createDate && (
          <CalendarEventForm
            groups={groups.data ?? []}
            controllers={controllers.data ?? []}
            live={live}
            themes={themes.data ?? []}
            defaultDate={createDate}
            onCreated={(e) => {
              queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prevData) => [
                ...(prevData ?? []),
                e
              ]);
              setCreateDate(null);
            }}
          />
        )}
      </Modal>
      <Modal
        open={editingEvent !== null}
        size="lg"
        title={editingEvent?.category === 'holiday' ? 'Edit holiday' : 'Edit calendar event'}
        onClose={() => setEditingEvent(null)}
      >
        {editingEvent && (
          <CalendarEventForm
            groups={groups.data ?? []}
            controllers={controllers.data ?? []}
            live={live}
            themes={themes.data ?? []}
            initialEvent={editingEvent}
            onSaved={(saved) => {
              queryClient.setQueryData<CalendarEvent[]>(['calendarEvents'], (prevData) =>
                (prevData ?? []).map((existing) => (existing.id === saved.id ? saved : existing))
              );
              setEditingEvent(null);
            }}
          />
        )}
      </Modal>
      <ScheduleManager />
    </section>
  );
}
