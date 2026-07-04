import { useEffect, useState } from 'react';
import { listGroups, addGroup, deleteGroup, type Group } from '../api/client';
import { TrashIcon } from './icons';

export function GroupManager() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGroups().then(setGroups).catch((e: Error) => setError(e.message));
  }, []);

  async function handleAdd() {
    if (!name) return;
    try {
      const created = await addGroup(name, []);
      setGroups((prev) => [...prev, created]);
      setName('');
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: string) {
    await deleteGroup(id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }

  return (
    <section className="section">
      <h2>Groups</h2>
      <div className="card">
        {error && <div className="error-banner">{error}</div>}
        {groups.length === 0 ? (
          <p className="empty-state">No groups yet — add one below.</p>
        ) : (
          <ul className="controller-list">
            {groups.map((g) => (
              <li key={g.id} className="controller-row">
                <div className="controller-info">
                  <span className="controller-name">{g.name}</span>
                  <span className="controller-meta">{g.members.length} members</span>
                </div>
                <button
                  type="button"
                  className="btn btn-destructive"
                  onClick={() => handleDelete(g.id)}
                  aria-label={`Remove ${g.name}`}
                >
                  <TrashIcon />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="add-controller-form">
          <div className="field">
            <label htmlFor="group-name">Name</label>
            <input
              id="group-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New group name"
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleAdd}>
            Add
          </button>
        </div>
      </div>
    </section>
  );
}
