import type { Controller } from '../api/client';
import { LightbulbIcon, TrashIcon } from './icons';

export function ControllerList({
  controllers,
  onDelete
}: {
  controllers: Controller[];
  onDelete: (id: string) => void;
}) {
  if (controllers.length === 0) {
    return <p className="empty-state">No controllers yet — add one below, by name and IP address.</p>;
  }
  return (
    <ul className="controller-list">
      {controllers.map((c) => (
        <li key={c.id} className="controller-row">
          <LightbulbIcon className="controller-icon" />
          <div className="controller-info">
            <span className="controller-name">{c.name}</span>
            <span className="controller-meta">{c.host}</span>
          </div>
          <span className="badge">{c.source}</span>
          {c.stale && <span className="badge badge-stale">stale</span>}
          <button
            type="button"
            className="btn btn-destructive"
            onClick={() => onDelete(c.id)}
            aria-label={`Remove ${c.name}`}
          >
            <TrashIcon />
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
