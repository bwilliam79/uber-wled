import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { rescanNow, updateSettings, type Settings } from '../../api/client';
import { useSettings } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Toggle } from '../../components/ui/Toggle';
import './settings.css';

function clampLivePoll(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(30, Math.max(1, Math.round(value)));
}

export function SettingsSection() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [rescanMessage, setRescanMessage] = useState<string | null>(null);
  const [rescanError, setRescanError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && draft === null) setDraft(settings.data);
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: (next: Settings) => updateSettings(next),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings'], saved);
      setDraft(saved);
    }
  });

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleRescan() {
    setRescanMessage(null);
    setRescanError(null);
    try {
      const { controllers } = await rescanNow();
      setRescanMessage(`Re-scan complete — ${controllers.length} controller(s) known.`);
    } catch (e: unknown) {
      setRescanError(e instanceof Error ? e.message : 'Re-scan failed');
    }
  }

  if (settings.isError) {
    return (
      <section className="section settings-section">
        <h2>Settings</h2>
        <div className="error-banner" role="alert">Failed to load settings.</div>
      </section>
    );
  }
  if (!draft) {
    return (
      <section className="section settings-section">
        <h2>Settings</h2>
        <p className="empty-state">Loading…</p>
      </section>
    );
  }

  return (
    <section className="section settings-section">
      <h2>Settings</h2>
      <Card className="settings-form">
        {save.isError && (
          <div className="error-banner" role="alert">Failed to save settings.</div>
        )}

        <div className="settings-toggle-row">
          <Toggle
            checked={draft.includePrereleaseFirmware}
            onChange={(c) => patch('includePrereleaseFirmware', c)}
            label="Include pre-release firmware builds"
          />
          <span>Include pre-release firmware builds</span>
        </div>

        <Field label="Home latitude" htmlFor="settings-lat">
          <input
            id="settings-lat" className="input" type="number" step="any"
            value={draft.homeLatitude ?? ''}
            onChange={(e) =>
              patch('homeLatitude', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </Field>

        <Field label="Home longitude" htmlFor="settings-lon">
          <input
            id="settings-lon" className="input" type="number" step="any"
            value={draft.homeLongitude ?? ''}
            onChange={(e) =>
              patch('homeLongitude', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </Field>

        <Field label="Discovery re-scan interval (minutes)" htmlFor="settings-interval">
          <input
            id="settings-interval" aria-label="Discovery re-scan interval (minutes)"
            className="input" type="number" min={1}
            value={draft.discoveryRescanIntervalMinutes}
            onChange={(e) => patch('discoveryRescanIntervalMinutes', Number(e.target.value))}
          />
        </Field>

        <div className="settings-toggle-row">
          <Toggle
            checked={draft.scheduleImportDisableOnDeviceDefault}
            onChange={(c) => patch('scheduleImportDisableOnDeviceDefault', c)}
            label="Default disable on device for schedule import"
          />
          <span>Default "disable on device" when importing WLED schedules</span>
        </div>

        <Field
          label="Controller status poll interval (minutes)"
          htmlFor="settings-status-poll-interval"
          hint="How often each controller's current state (power, brightness, effect, segments) is read and cached"
        >
          <input
            id="settings-status-poll-interval"
            aria-label="Controller status poll interval (minutes)"
            className="input" type="number" min={1}
            value={draft.controllerStatusPollIntervalMinutes}
            onChange={(e) => patch('controllerStatusPollIntervalMinutes', Number(e.target.value))}
          />
        </Field>

        <Field
          label="Live poll interval (seconds)"
          htmlFor="settings-live-poll"
          hint="How often watched controllers are polled while Home, Layout, or a Control panel is open (1–30 s)"
        >
          <input
            id="settings-live-poll" aria-label="Live poll interval (seconds)"
            className="input" type="number" min={1} max={30}
            value={draft.livePollIntervalSeconds}
            onChange={(e) => patch('livePollIntervalSeconds', Number(e.target.value))}
          />
        </Field>

        <div className="settings-actions">
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                ...draft,
                livePollIntervalSeconds: clampLivePoll(draft.livePollIntervalSeconds)
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save settings'}
          </Button>
          <Button variant="secondary" onClick={handleRescan}>Re-scan now</Button>
        </div>
        {rescanMessage && <p className="settings-note">{rescanMessage}</p>}
        {rescanError && <div className="error-banner" role="alert">{rescanError}</div>}
      </Card>
    </section>
  );
}
