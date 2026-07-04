import { useEffect, useState } from 'react';
import {
  listControllers, deleteController, addController, listFloorplans,
  listCalendarEvents, updateCalendarEvent, deleteCalendarEvent, listGroups, listThemes,
  type Controller, type Floorplan, type CalendarEvent, type Group, type CustomTheme
} from '../api/client';
import { ControllerList } from '../components/ControllerList';
import { GroupManager } from '../components/GroupManager';
import { ThemeManager } from '../components/ThemeManager';
import { ScheduleManager } from '../components/ScheduleManager';
import { CalendarEventList } from '../components/CalendarEventList';
import { CalendarEventForm } from '../components/CalendarEventForm';
import { LightbulbIcon, AlertIcon } from '../components/icons';
import { FloorplanEditor } from './FloorplanEditor';

export function Dashboard() {
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [floorplans, setFloorplans] = useState<Floorplan[]>([]);
  const [openFloorplanId, setOpenFloorplanId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarGroups, setCalendarGroups] = useState<Group[]>([]);
  const [calendarThemes, setCalendarThemes] = useState<CustomTheme[]>([]);

  useEffect(() => {
    listControllers().then(setControllers).catch((e) => setError(e.message));
    listFloorplans().then(setFloorplans);
  }, []);

  useEffect(() => {
    listCalendarEvents().then(setCalendarEvents);
    listGroups().then(setCalendarGroups);
    listThemes().then(setCalendarThemes);
  }, []);

  async function handleToggleEventEnabled(id: string, enabled: boolean) {
    const updated = await updateCalendarEvent(id, { enabled });
    setCalendarEvents((prev) => prev.map((e) => (e.id === id ? updated : e)));
  }

  async function handleDeleteEvent(id: string) {
    await deleteCalendarEvent(id);
    setCalendarEvents((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleAdd() {
    if (!name || !host) return;
    try {
      const created = await addController(name, host);
      setControllers((prev) => [...prev, created]);
      setName('');
      setHost('');
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(id: string) {
    await deleteController(id);
    setControllers((prev) => prev.filter((c) => c.id !== id));
  }

  if (openFloorplanId) {
    return (
      <div>
        <header className="page-header">
          <LightbulbIcon className="logo-mark" />
          <h1>uber-wled</h1>
        </header>
        <button type="button" className="btn btn-secondary" onClick={() => setOpenFloorplanId(null)}>
          Back to dashboard
        </button>
        <FloorplanEditor floorplanId={openFloorplanId} />
      </div>
    );
  }

  return (
    <div>
      <header className="page-header">
        <LightbulbIcon className="logo-mark" />
        <h1>uber-wled</h1>
      </header>

      <section className="section">
        <h2>Controllers</h2>
        <div className="card">
          {error && (
            <div className="error-banner">
              <AlertIcon /> {error}
            </div>
          )}
          <ControllerList controllers={controllers} onDelete={handleDelete} />
          <div className="add-controller-form">
            <div className="field">
              <label htmlFor="controller-name">Name</label>
              <input
                id="controller-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Front Porch"
              />
            </div>
            <div className="field">
              <label htmlFor="controller-host">Host / IP</label>
              <input
                id="controller-host"
                className="input"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="10.0.0.50"
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={handleAdd}>
              Add controller
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Floorplans</h2>
        <div className="card">
          {floorplans.length === 0 ? (
            <p className="empty-state">No floorplans yet.</p>
          ) : (
            <ul className="controller-list">
              {floorplans.map((f) => (
                <li key={f.id} className="controller-row">
                  <div className="controller-info">
                    <span className="controller-name">{f.name}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setOpenFloorplanId(f.id)}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <GroupManager />
      <ThemeManager />
      <ScheduleManager />
      <CalendarEventList events={calendarEvents} onToggleEnabled={handleToggleEventEnabled} onDelete={handleDeleteEvent} />
      <CalendarEventForm groups={calendarGroups} themes={calendarThemes} onCreated={(e) => setCalendarEvents((prev) => [...prev, e])} />
    </div>
  );
}
