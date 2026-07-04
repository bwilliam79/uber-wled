import { useEffect, useState } from 'react';
import { listSchedules, deleteSchedule, type Schedule } from '../api/client';
import { TrashIcon } from './icons';

export function ScheduleManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSchedules().then(setSchedules).catch((e: Error) => setError(e.message));
  }, []);

  async function handleDelete(id: string) {
    await deleteSchedule(id);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <section className="section">
      <h2>Schedules</h2>
      <div className="card">
        {error && <div className="error-banner">{error}</div>}
        {schedules.length === 0 ? (
          <p className="empty-state">No schedules yet.</p>
        ) : (
          <ul className="controller-list">
            {schedules.map((s) => (
              <li key={s.id} className="controller-row">
                <div className="controller-info">
                  <span className="controller-name">{s.name}</span>
                  <span className="controller-meta">{s.triggerType}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-destructive"
                  onClick={() => handleDelete(s.id)}
                  aria-label={`Remove ${s.name}`}
                >
                  <TrashIcon />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
