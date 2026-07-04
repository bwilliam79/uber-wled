import { useState } from 'react';
import { importSchedules, type Controller } from '../api/client';
import { LightbulbIcon, TrashIcon } from './icons';

function ImportSchedules({ controllerId }: { controllerId: string }) {
  const [disableOnDevice, setDisableOnDevice] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const res = await importSchedules(controllerId, disableOnDevice);
      setResult({ imported: res.imported.length, skipped: res.skipped.length });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="import-schedules">
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={disableOnDevice}
          onChange={(e) => setDisableOnDevice(e.target.checked)}
        />
        Disable on device
      </label>
      <button type="button" className="btn btn-secondary" onClick={handleImport} disabled={importing}>
        {importing ? 'Importing…' : 'Import schedules'}
      </button>
      {result && (
        <span className="controller-meta">
          Imported {result.imported}, skipped {result.skipped}
        </span>
      )}
      {error && <span className="error-banner">{error}</span>}
    </div>
  );
}

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
            <span className="controller-name" title={c.name}>{c.name}</span>
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
          <ImportSchedules controllerId={c.id} />
        </li>
      ))}
    </ul>
  );
}
