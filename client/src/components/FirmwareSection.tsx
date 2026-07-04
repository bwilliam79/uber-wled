import { useEffect, useState } from 'react';
import { listControllers, type Controller } from '../api/client';
import { FirmwareStatus } from './FirmwareStatus';
import { LightbulbIcon } from './icons';

export function FirmwareSection() {
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listControllers().then(setControllers).catch((e) => setError(e.message));
  }, []);

  return (
    <section className="section">
      <h2>Firmware</h2>
      <div className="card">
        {error && <div className="error-banner">{error}</div>}
        {controllers.length === 0 ? (
          <p className="empty-state">No controllers yet.</p>
        ) : (
          <ul className="controller-list">
            {controllers.map((c) => (
              <li key={c.id} className="controller-row">
                <LightbulbIcon className="controller-icon" />
                <div className="controller-info">
                  <span className="controller-name">{c.name}</span>
                  <span className="controller-meta">{c.host}</span>
                </div>
                {c.stale && <span className="badge badge-stale">stale</span>}
                <FirmwareStatus controllerId={c.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
