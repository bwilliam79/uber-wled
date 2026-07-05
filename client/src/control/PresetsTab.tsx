import type { CustomTheme, DevicePreset } from '../api/client';
import { Chip } from '../components/ui/Chip';
import { Button } from '../components/ui/Button';

export interface PresetsTabProps {
  themes: CustomTheme[];
  devicePresets: DevicePreset[] | null;
  onApplyTheme: (theme: CustomTheme) => void;
  onApplyDevicePreset: (preset: DevicePreset) => void;
}

export function PresetsTab({ themes, devicePresets, onApplyTheme, onApplyDevicePreset }: PresetsTabProps) {
  return (
    <div className="presets-tab">
      <h4 className="cs-subhead">Themes</h4>
      {themes.length === 0 && (
        <p className="empty-state">No themes yet — create one in the Themes section.</p>
      )}
      <ul className="preset-list">
        {themes.map((theme) => (
          <li key={theme.id} className="preset-row">
            <span className="preset-swatches">
              {theme.colors.slice(0, 3).map((c, i) => (
                <span key={i} className="swatch"
                  style={{ background: `rgb(${c[0] ?? 0}, ${c[1] ?? 0}, ${c[2] ?? 0})` }} />
              ))}
            </span>
            <span className="preset-name">{theme.name}</span>
            <Button variant="secondary" onClick={() => onApplyTheme(theme)}
              aria-label={`Apply theme ${theme.name}`}>Apply</Button>
          </li>
        ))}
      </ul>

      <h4 className="cs-subhead">Device presets</h4>
      {devicePresets === null && (
        <p className="empty-state">Device presets are available when a single device is selected.</p>
      )}
      {devicePresets !== null && devicePresets.length === 0 && (
        <p className="empty-state">No presets saved on this device.</p>
      )}
      {devicePresets !== null && devicePresets.length > 0 && (
        <ul className="preset-list">
          {devicePresets.map((preset) => (
            <li key={preset.id} className="preset-row">
              <span className="preset-name">{preset.name}</span>
              {preset.isPlaylist && <Chip>Playlist</Chip>}
              <Button variant="secondary" onClick={() => onApplyDevicePreset(preset)}
                aria-label={`Apply preset ${preset.name}`}>Apply</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
