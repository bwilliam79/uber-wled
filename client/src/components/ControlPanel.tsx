import type { CustomTheme, ControlAction } from '../api/client';

export function ControlPanel({
  selectedMembers,
  themes,
  onApply
}: {
  selectedMembers: { controllerId: string; wledSegId: number }[];
  themes: CustomTheme[];
  onApply: (action: ControlAction) => void;
}) {
  const disabled = selectedMembers.length === 0;

  return (
    <div className="card control-panel docked">
      <h3>Control ({selectedMembers.length} selected)</h3>
      {disabled && <p className="empty-state">Select a strip to control it.</p>}
      <div className="control-panel-buttons">
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
        <label htmlFor="brightness-slider">Brightness</label>
        <input
          id="brightness-slider"
          type="range"
          aria-label="brightness"
          min={0}
          max={255}
          disabled={disabled}
          onChange={(e) => onApply({ type: 'brightness', value: Number(e.target.value) })}
        />
      </div>
      <div className="control-panel-themes">
        {themes.map((t) => (
          <button
            key={t.id}
            type="button"
            className="btn btn-primary"
            disabled={disabled}
            onClick={() => onApply({ type: 'theme', themeId: t.id })}
          >
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}
