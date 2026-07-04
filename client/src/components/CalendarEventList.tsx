import type { CalendarEvent } from '../api/client';
import { TrashIcon } from './icons';

export function CalendarEventList({
  events,
  onToggleEnabled,
  onDelete
}: {
  events: CalendarEvent[];
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const holidays = events.filter((e) => e.category === 'holiday');
  const custom = events.filter((e) => e.category === 'custom');

  function renderEvent(e: CalendarEvent) {
    return (
      <li key={e.id} className="controller-row">
        <div className="controller-info">
          <label>
            <input type="checkbox" checked={e.enabled} onChange={(ev) => onToggleEnabled(e.id, ev.target.checked)} />
            <span className="controller-name">{e.name}</span>
          </label>
        </div>
        <button
          type="button"
          className="btn btn-destructive"
          onClick={() => onDelete(e.id)}
          aria-label={`Remove ${e.name}`}
        >
          <TrashIcon />
          Remove
        </button>
      </li>
    );
  }

  return (
    <section className="section">
      <h2>Calendar</h2>
      <div className="card">
        <h4>Holidays</h4>
        {holidays.length === 0 ? (
          <p className="empty-state">No holiday events yet.</p>
        ) : (
          <ul className="controller-list">{holidays.map(renderEvent)}</ul>
        )}
        <h4>Custom events</h4>
        {custom.length === 0 ? (
          <p className="empty-state">No custom events yet.</p>
        ) : (
          <ul className="controller-list">{custom.map(renderEvent)}</ul>
        )}
      </div>
    </section>
  );
}
