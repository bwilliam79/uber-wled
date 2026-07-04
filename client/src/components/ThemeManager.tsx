import { useEffect, useState } from 'react';
import { listThemes, addTheme, deleteTheme, type CustomTheme } from '../api/client';
import { TrashIcon } from './icons';

function hexToRgb(hex: string): number[] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

export function ThemeManager() {
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [effect, setEffect] = useState(0);
  const [palette, setPalette] = useState(0);
  const [brightness, setBrightness] = useState(128);
  const [color, setColor] = useState('#ffffff');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listThemes().then(setThemes).catch((e: Error) => setError(e.message));
  }, []);

  async function handleDelete(id: string) {
    await deleteTheme(id);
    setThemes((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleAdd() {
    if (!name) return;
    setSaving(true);
    try {
      const created = await addTheme({
        name,
        effect,
        palette,
        brightness,
        colors: [hexToRgb(color)]
      });
      setThemes((prev) => [...prev, created]);
      setName('');
      setEffect(0);
      setPalette(0);
      setBrightness(128);
      setColor('#ffffff');
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
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
        <div className="add-controller-form">
          <div className="field">
            <label htmlFor="theme-name">Name</label>
            <input
              id="theme-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New theme name"
            />
          </div>
          <div className="field">
            <label htmlFor="theme-effect">Effect</label>
            <input
              id="theme-effect"
              className="input"
              type="number"
              min={0}
              value={effect}
              onChange={(e) => setEffect(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="theme-palette">Palette</label>
            <input
              id="theme-palette"
              className="input"
              type="number"
              min={0}
              value={palette}
              onChange={(e) => setPalette(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="theme-brightness">Brightness</label>
            <input
              id="theme-brightness"
              className="input"
              type="number"
              min={0}
              max={255}
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="theme-color">Color</label>
            <input
              id="theme-color"
              className="input"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleAdd} disabled={!name || saving}>
            {saving ? 'Adding…' : 'Add theme'}
          </button>
        </div>
      </div>
    </section>
  );
}
