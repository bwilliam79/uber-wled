import { useEffect, useState } from 'react';
import { getSettings, updateSettings, rescanNow, type Settings } from '../api/client';

export function SettingsSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rescanMessage, setRescanMessage] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(setSettings).catch((e) => setError(e.message));
  }, []);

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateSettings(settings);
      setSettings(saved);
    } catch (e: unknown) {
      // Keep the current (edited) values on screen; surface the failure inline.
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleRescan() {
    setRescanMessage(null);
    try {
      const { controllers } = await rescanNow();
      setRescanMessage(`Re-scan complete — ${controllers.length} controller(s) known.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Re-scan failed');
    }
  }

  if (!settings) {
    return (
      <section className="section">
        <h2>Settings</h2>
        {error
          ? <div className="error-banner" role="alert">{error}</div>
          : <p className="empty-state">Loading…</p>}
      </section>
    );
  }

  return (
    <section className="section">
      <h2>Settings</h2>
      <div className="card settings-form">
        {error && <div className="error-banner" role="alert">{error}</div>}

        <label className="checkbox-field">
          <input
            type="checkbox"
            aria-label="Include pre-release firmware builds"
            checked={settings.includePrereleaseFirmware}
            onChange={(e) => patch('includePrereleaseFirmware', e.target.checked)}
          />
          Include pre-release firmware builds
        </label>

        <div className="field">
          <label htmlFor="settings-lat">Home latitude</label>
          <input
            id="settings-lat"
            className="input"
            type="number"
            step="any"
            value={settings.homeLatitude ?? ''}
            onChange={(e) => patch('homeLatitude', e.target.value === '' ? null : Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="settings-lon">Home longitude</label>
          <input
            id="settings-lon"
            className="input"
            type="number"
            step="any"
            value={settings.homeLongitude ?? ''}
            onChange={(e) => patch('homeLongitude', e.target.value === '' ? null : Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="settings-interval">Discovery re-scan interval (minutes)</label>
          <input
            id="settings-interval"
            aria-label="Discovery re-scan interval (minutes)"
            className="input"
            type="number"
            min={1}
            value={settings.discoveryRescanIntervalMinutes}
            onChange={(e) => patch('discoveryRescanIntervalMinutes', Number(e.target.value))}
          />
        </div>

        <label className="checkbox-field">
          <input
            type="checkbox"
            aria-label="Default disable on device for schedule import"
            checked={settings.scheduleImportDisableOnDeviceDefault}
            onChange={(e) => patch('scheduleImportDisableOnDeviceDefault', e.target.checked)}
          />
          Default "disable on device" when importing WLED schedules
        </label>

        <div className="field">
          <label htmlFor="settings-status-poll-interval">Controller status poll interval (minutes)</label>
          <input
            id="settings-status-poll-interval"
            aria-label="Controller status poll interval (minutes)"
            className="input"
            type="number"
            min={1}
            value={settings.controllerStatusPollIntervalMinutes}
            onChange={(e) => patch('controllerStatusPollIntervalMinutes', Number(e.target.value))}
          />
          <span className="field-hint">
            How often each controller's current state (power, brightness, effect, segments) is read and cached
          </span>
        </div>

        <div className="settings-actions">
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleRescan}>Re-scan now</button>
        </div>
        {rescanMessage && <p className="controller-meta">{rescanMessage}</p>}
      </div>
    </section>
  );
}
