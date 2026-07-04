import { useEffect, useState } from 'react';
import { listControllers, deleteController, addController, type Controller } from '../api/client';
import { ControllerList } from '../components/ControllerList';

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
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(id: string) {
    await deleteController(id);
    setControllers((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 640, margin: '2rem auto' }}>
      <h1>uber-wled</h1>
      <h2>Controllers</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <ControllerList controllers={controllers} onDelete={handleDelete} />
      <div style={{ marginTop: '1rem' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host/IP" />
        <button onClick={handleAdd}>Add controller</button>
      </div>
    </div>
  );
}
