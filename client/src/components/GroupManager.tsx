import { useEffect, useState } from 'react';
import {
  listGroups,
  addGroup,
  deleteGroup,
  updateGroup,
  listControllers,
  type Group,
  type GroupMember,
  type Controller
} from '../api/client';
import { TrashIcon } from './icons';

function GroupMembersEditor({
  group,
  controllers,
  onChange
}: {
  group: Group;
  controllers: Controller[];
  onChange: (updated: Group) => void;
}) {
  const [controllerId, setControllerId] = useState(controllers[0]?.id ?? '');
  const [wledSegId, setWledSegId] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleAddMember() {
    if (!controllerId) return;
    const newMember: GroupMember = { controllerId, wledSegId };
    try {
      const updated = await updateGroup(group.id, { members: [...group.members, newMember] });
      onChange(updated);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemoveMember(index: number) {
    const members = group.members.filter((_, i) => i !== index);
    try {
      const updated = await updateGroup(group.id, { members });
      onChange(updated);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function controllerName(id: string) {
    return controllers.find((c) => c.id === id)?.name ?? id;
  }

  return (
    <div className="group-members-editor">
      {error && <div className="error-banner">{error}</div>}
      {group.members.length === 0 ? (
        <p className="empty-state">No members yet — add one below.</p>
      ) : (
        <ul className="controller-list">
          {group.members.map((m, i) => (
            <li key={`${m.controllerId}-${m.wledSegId}-${i}`} className="controller-row">
              <div className="controller-info">
                <span className="controller-name">{controllerName(m.controllerId)}</span>
                <span className="controller-meta">segment {m.wledSegId}</span>
              </div>
              <button
                type="button"
                className="btn btn-destructive"
                onClick={() => handleRemoveMember(i)}
                aria-label={`Remove ${controllerName(m.controllerId)} segment ${m.wledSegId} from ${group.name}`}
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
          <label htmlFor={`group-${group.id}-controller`}>Controller</label>
          <select
            id={`group-${group.id}-controller`}
            aria-label={`controller for ${group.name}`}
            className="input"
            value={controllerId}
            onChange={(e) => setControllerId(e.target.value)}
          >
            {controllers.length === 0 && <option value="">No controllers</option>}
            {controllers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`group-${group.id}-seg`}>Segment ID</label>
          <input
            id={`group-${group.id}-seg`}
            aria-label={`segment id for ${group.name}`}
            className="input"
            type="number"
            min={0}
            value={wledSegId}
            onChange={(e) => setWledSegId(Number(e.target.value))}
          />
        </div>
        <button type="button" className="btn btn-primary" onClick={handleAddMember} disabled={!controllerId}>
          Add member
        </button>
      </div>
    </div>
  );
}

export function GroupManager() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGroups().then(setGroups).catch((e: Error) => setError(e.message));
    listControllers().then(setControllers).catch((e: Error) => setError(e.message));
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

  function handleGroupUpdated(updated: Group) {
    setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
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
              <li key={g.id} className="controller-row group-row">
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
      {groups.map((g) => (
        <div key={g.id} className="card group-members-card">
          <h3>{g.name} members</h3>
          <GroupMembersEditor group={g} controllers={controllers} onChange={handleGroupUpdated} />
        </div>
      ))}
    </section>
  );
}
