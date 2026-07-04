import { useEffect, useState } from 'react';
import { listControllers, deleteController, addController, type Controller } from '../api/client';
import { ControllerList } from '../components/ControllerList';
import { GroupManager } from '../components/GroupManager';
import { ThemeManager } from '../components/ThemeManager';
import { ScheduleManager } from '../components/ScheduleManager';
import { LightbulbIcon, AlertIcon } from '../components/icons';

export function Dashboard() {
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listControllers().then(setControllers).catch((e) => setError(e.message));
  }, []);

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

      <GroupManager />
      <ThemeManager />
      <ScheduleManager />
    </div>
  );
}
