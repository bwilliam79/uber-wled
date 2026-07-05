import type { CustomTheme, ControlAction } from '../api/client';
import type { TileMember, TileStatus } from '../lib/tileStatus';

const POWER_LABEL: Record<TileStatus['power'], string> = {
  on: 'On now',
  off: 'Off now',
  mixed: 'Mixed',
  unknown: '—'
};

export function HomeTile({
  id,
  title,
  members,
  status,
  themes,
  effects,
  onApply
}: {
  id: string;
  title: string;
  members: TileMember[];
  status: TileStatus;
  themes: CustomTheme[];
  effects: string[];
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
        <span className="controller-meta">{POWER_LABEL[status.power]}</span>
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
        aria-label={`apply effect or theme to ${title}`}
        className="input"
        value=""
        disabled={disabled}
        onChange={(e) => {
          const [kind, value] = e.target.value.split(':');
          if (kind === 'effect') onApply({ type: 'effect', effectId: Number(value) });
          if (kind === 'theme') onApply({ type: 'theme', themeId: value });
        }}
      >
        <option value="">Apply…</option>
        {effects.length > 0 && (
          <optgroup label="Effects">
            {effects.map((effectName, i) => (
              <option key={i} value={`effect:${i}`}>{effectName}</option>
            ))}
          </optgroup>
        )}
        {themes.length > 0 && (
          <optgroup label="My Themes">
            {themes.map((t) => (
              <option key={t.id} value={`theme:${t.id}`}>{t.name}</option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
