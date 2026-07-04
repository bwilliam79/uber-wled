import type { Controller } from '../api/client';

export function ControllerList({
  controllers,
  onDelete
}: {
  controllers: Controller[];
  onDelete: (id: string) => void;
}) {
  if (controllers.length === 0) {
    return <p>No controllers yet — add one below.</p>;
  }
  return (
    <ul>
      {controllers.map((c) => (
        <li key={c.id}>
          <strong>{c.name}</strong> ({c.host}) — {c.source}
          {c.stale && <span> — stale</span>}
          <button onClick={() => onDelete(c.id)}>Remove</button>
        </li>
      ))}
    </ul>
  );
}
