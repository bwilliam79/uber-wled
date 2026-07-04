import { useEffect, useState } from 'react';
import { listThemes, deleteTheme, type CustomTheme } from '../api/client';
import { TrashIcon } from './icons';

export function ThemeManager() {
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listThemes().then(setThemes).catch((e: Error) => setError(e.message));
  }, []);

  async function handleDelete(id: string) {
    await deleteTheme(id);
    setThemes((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <section className="section">
      <h2>Themes</h2>
      <div className="card">
        {error && <div className="error-banner">{error}</div>}
        {themes.length === 0 ? (
          <p className="empty-state">No custom themes yet.</p>
        ) : (
          <ul className="controller-list">
            {themes.map((t) => (
              <li key={t.id} className="controller-row">
                <div className="controller-info">
                  <span className="controller-name">{t.name}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-destructive"
                  onClick={() => handleDelete(t.id)}
                  aria-label={`Remove ${t.name}`}
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
