import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  geocodeAddress, rescanNow, updateSettings, restoreBackupFile, BACKUP_URL,
  listAutoBackups, autoBackupUrl, restoreAutoBackup,
  type GeocodeMatch, type Settings
} from '../../api/client';
import { useSettings } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Toggle } from '../../components/ui/Toggle';
import { Modal } from '../../components/ui/Modal';
import { ImportButton } from '../../components/ImportButton';
import { useToast } from '../../components/ui/Toast';
import { triggerDownload, readJsonFile } from '../../lib/fileTransfer';
import { AddControllerCard } from './AddControllerCard';
import './settings.css';

function clampLivePoll(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(30, Math.max(1, Math.round(value)));
}

function coordDisplayPrecision(value: number): number {
  // 6 decimal places is ~11cm precision — plenty for sunrise/sunset math,
  // and matches what Nominatim returns.
  return Number(value.toFixed(6));
}

export function SettingsSection() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [rescanMessage, setRescanMessage] = useState<string | null>(null);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const [addressQuery, setAddressQuery] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressCandidates, setAddressCandidates] = useState<GeocodeMatch[] | null>(null);

  // Restore replaces the entire config, so it's gated behind a confirm.
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const autoBackups = useQuery({ queryKey: ['auto-backups'], queryFn: listAutoBackups });
  const [restoreAutoName, setRestoreAutoName] = useState<string | null>(null);

  async function performRestore() {
    if (!restoreFile) return;
    setRestoring(true);
    try {
      const data = await readJsonFile(restoreFile);
      const result = await restoreBackupFile(data);
      // Everything changed underneath us — refetch all app data.
      await queryClient.invalidateQueries();
      setDraft(null); // re-seed the settings draft from the restored values
      const total = Object.values(result.restored).reduce((a, b) => a + b, 0);
      toast.show({ title: `Configuration restored (${total} records)`, variant: 'success' });
    } catch (err) {
      toast.show({ title: 'Restore failed', description: (err as Error).message, variant: 'error' });
    } finally {
      setRestoring(false);
      setRestoreFile(null);
    }
  }

  async function performAutoRestore() {
    if (!restoreAutoName) return;
    setRestoring(true);
    try {
      const result = await restoreAutoBackup(restoreAutoName);
      await queryClient.invalidateQueries();
      setDraft(null);
      const total = Object.values(result.restored).reduce((a, b) => a + b, 0);
      toast.show({ title: `Restored ${restoreAutoName} (${total} records)`, variant: 'success' });
    } catch (err) {
      toast.show({ title: 'Restore failed', description: (err as Error).message, variant: 'error' });
    } finally {
      setRestoring(false);
      setRestoreAutoName(null);
    }
  }

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

  function applyCoords(latitude: number, longitude: number) {
    patch('homeLatitude', coordDisplayPrecision(latitude));
    patch('homeLongitude', coordDisplayPrecision(longitude));
  }

  function applyAddressCandidate(match: GeocodeMatch) {
    applyCoords(match.latitude, match.longitude);
    setAddressCandidates(null);
    setAddressError(null);
  }

  async function handleFindAddress() {
    const q = addressQuery.trim();
    if (!q) return;
    setAddressError(null);
    setAddressCandidates(null);
    setAddressLoading(true);
    try {
      const results = await geocodeAddress(q);
      if (results.length === 0) {
        setAddressError('No matches found for that address.');
      } else if (results.length === 1) {
        applyAddressCandidate(results[0]);
      } else {
        setAddressCandidates(results);
      }
    } catch (e: unknown) {
      setAddressError(e instanceof Error ? e.message : 'Address lookup failed.');
    } finally {
      setAddressLoading(false);
    }
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
      {save.isError && (
        <div className="error-banner" role="alert">Failed to save settings.</div>
      )}

      <div className="settings-grid">
        <AddControllerCard />
        <Card className="settings-group">
          <h3 className="settings-group-title">Home location</h3>
          <p className="settings-group-hint">Used for sunrise/sunset schedule triggers.</p>

          <div className="settings-field-pair">
            <Field label="Latitude" htmlFor="settings-lat">
              <input
                id="settings-lat" className="input" type="number" step="any"
                value={draft.homeLatitude ?? ''}
                onChange={(e) =>
                  patch('homeLatitude', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field label="Longitude" htmlFor="settings-lon">
              <input
                id="settings-lon" className="input" type="number" step="any"
                value={draft.homeLongitude ?? ''}
                onChange={(e) =>
                  patch('homeLongitude', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
          </div>

          <Field
            label="Look up an address"
            htmlFor="settings-address-lookup"
            hint="Sends this query to OpenStreetMap's Nominatim geocoding service over the internet — the only outbound call this app makes besides checking for firmware updates."
          >
            <div className="settings-address-row">
              <input
                id="settings-address-lookup"
                className="input"
                type="text"
                placeholder="123 Main St, Anytown, USA"
                value={addressQuery}
                onChange={(e) => setAddressQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleFindAddress();
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={addressLoading || addressQuery.trim() === ''}
                onClick={handleFindAddress}
              >
                {addressLoading ? 'Finding…' : 'Find'}
              </Button>
            </div>
          </Field>
          {addressError && <div className="error-banner" role="alert">{addressError}</div>}
          {addressCandidates && addressCandidates.length > 1 && (
            <ul className="settings-address-candidates">
              {addressCandidates.map((match, i) => (
                <li key={`${match.latitude},${match.longitude},${i}`}>
                  <button
                    type="button"
                    className="settings-address-candidate"
                    onClick={() => applyAddressCandidate(match)}
                  >
                    {match.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="settings-group">
          <h3 className="settings-group-title">Polling &amp; discovery</h3>
          <p className="settings-group-hint">How often the server reads from your controllers.</p>

          <Field label="Discovery re-scan interval (minutes)" htmlFor="settings-interval">
            <input
              id="settings-interval" aria-label="Discovery re-scan interval (minutes)"
              className="input" type="number" min={1}
              value={draft.discoveryRescanIntervalMinutes}
              onChange={(e) => patch('discoveryRescanIntervalMinutes', Number(e.target.value))}
            />
          </Field>

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
        </Card>

        <Card className="settings-group">
          <h3 className="settings-group-title">Firmware &amp; schedules</h3>
          <p className="settings-group-hint">Defaults for firmware updates and WLED schedule import.</p>

          <div className="settings-toggle-row">
            <Toggle
              checked={draft.includePrereleaseFirmware}
              onChange={(c) => patch('includePrereleaseFirmware', c)}
              label="Include pre-release firmware builds"
              showLabel={false}
            />
            <span>Include pre-release firmware builds</span>
          </div>

          <div className="settings-toggle-row">
            <Toggle
              checked={draft.scheduleImportDisableOnDeviceDefault}
              onChange={(c) => patch('scheduleImportDisableOnDeviceDefault', c)}
              label="Default disable on device for schedule import"
              showLabel={false}
            />
            <span>Default "disable on device" when importing WLED schedules</span>
          </div>
        </Card>

        <Card className="settings-group">
          <h3 className="settings-group-title">Backup &amp; restore</h3>
          <p className="settings-group-hint">
            Download a full snapshot of your uber-wled configuration (controllers, rooms, sync groups,
            themes, schedules, calendar events, layout, and settings), or restore one after a rebuild.
          </p>
          <div className="settings-backup-actions">
            <Button variant="secondary" onClick={() => triggerDownload(BACKUP_URL)}>
              Back up configuration
            </Button>
            <ImportButton label="Restore from backup…" onFile={setRestoreFile} disabled={restoring} />
          </div>
          <p className="settings-group-hint">
            Restoring <strong>replaces everything</strong> currently in this instance with the backup's contents.
          </p>
          <div className="settings-autobackups">
            <h4 className="settings-autobackups-title">Automatic backups</h4>
            <p className="settings-group-hint">
              A snapshot is saved on the server once a day (last {(autoBackups.data?.length ?? 0)} kept).
            </p>
            {autoBackups.data && autoBackups.data.length > 0 ? (
              <ul className="settings-autobackup-list">
                {autoBackups.data.map((b) => (
                  <li key={b.name} className="settings-autobackup-row">
                    <span className="settings-autobackup-date ui-mono">{b.name.replace(/^uber-wled-backup-|\.json$/g, '')}</span>
                    <span className="settings-autobackup-size">{Math.max(1, Math.round(b.size / 1024))} KB</span>
                    <a className="settings-autobackup-dl" href={autoBackupUrl(b.name)} download>Download</a>
                    <button
                      type="button" className="settings-autobackup-restore"
                      onClick={() => setRestoreAutoName(b.name)} disabled={restoring}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No automatic backups yet — the first is written within the hour.</p>
            )}
          </div>
        </Card>
      </div>

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
        {rescanMessage && <p className="settings-note">{rescanMessage}</p>}
        {rescanError && <div className="error-banner" role="alert">{rescanError}</div>}
      </div>

      <Modal
        open={restoreFile !== null}
        onClose={() => setRestoreFile(null)}
        title="Restore configuration?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestoreFile(null)} disabled={restoring}>Cancel</Button>
            <Button variant="danger" onClick={performRestore} disabled={restoring}>
              {restoring ? 'Restoring…' : 'Replace everything'}
            </Button>
          </>
        }
      >
        <p>
          This will <strong>replace all</strong> controllers, rooms, sync groups, themes, schedules,
          calendar events, layout, and settings in this instance with the contents of
          “{restoreFile?.name}”. This can't be undone.
        </p>
      </Modal>

      <Modal
        open={restoreAutoName !== null}
        onClose={() => setRestoreAutoName(null)}
        title="Restore this automatic backup?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestoreAutoName(null)} disabled={restoring}>Cancel</Button>
            <Button variant="danger" onClick={performAutoRestore} disabled={restoring}>
              {restoring ? 'Restoring…' : 'Replace everything'}
            </Button>
          </>
        }
      >
        <p>
          This will <strong>replace everything</strong> in this instance with the snapshot
          “{restoreAutoName}”. This can't be undone.
        </p>
      </Modal>
    </section>
  );
}
