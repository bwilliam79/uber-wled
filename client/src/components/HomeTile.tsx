import type { CustomTheme, ControlAction } from '../api/client';
import type { TileMember, TileStatus } from '../lib/tileStatus';

const POWER_LABEL: Record<TileStatus['power'], string> = {
  on: 'On',
  off: 'Off',
  mixed: 'Mixed',
  unknown: '—'
};

export function HomeTile({
  id,
  title,
  members,
  status,
  themes,
  onApply
}: {
  id: string;
  title: string;
  members: TileMember[];
  status: TileStatus;
  themes: CustomTheme[];
  onApply: (action: ControlAction) => void;
}) {
  const disabled = members.length === 0;

  return (
    <div className="card home-tile">
      <div className="home-tile-header">
        <span className="home-tile-name">{title}</span>
        {status.anyOffline && <span className="badge badge-stale">offline</span>}
      </div>
      <div className="home-tile-status">
        {status.power !== 'on' && status.power !== 'off' && (
          <span className="controller-meta">{POWER_LABEL[status.power]}</span>
        )}
        {status.brightness !== null && (
          <span className="controller-meta">{status.brightness} / 255</span>
        )}
      </div>
      {disabled && <p className="empty-state">Add members in Groups to control this room.</p>}
      <div className="home-tile-buttons">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          onClick={() => onApply({ type: 'power', on: true })}
        >
          On
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          onClick={() => onApply({ type: 'power', on: false })}
        >
          Off
        </button>
      </div>
      <div className="field">
        <label htmlFor={`home-tile-brightness-${id}`}>Brightness</label>
        <input
          id={`home-tile-brightness-${id}`}
          type="range"
          aria-label={`brightness for ${title}`}
          min={0}
          max={255}
          disabled={disabled}
          onChange={(e) => onApply({ type: 'brightness', value: Number(e.target.value) })}
        />
      </div>
      <select
        aria-label={`apply theme to ${title}`}
        className="input"
        value=""
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value) onApply({ type: 'theme', themeId: e.target.value });
        }}
      >
        <option value="">Apply theme…</option>
        {themes.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}
