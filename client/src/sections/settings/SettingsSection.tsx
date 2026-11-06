import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  geocodeAddress, rescanNow, updateSettings, restoreBackupFile, BACKUP_URL,
  listAutoBackups, autoBackupUrl, restoreAutoBackup,
  type GeocodeMatch, type Settings
} from '../../api/client';
import { useSettings } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Toggle } from '../../components/ui/Toggle';
import { Modal } from '../../components/ui/Modal';
import { ImportButton } from '../../components/ImportButton';
import { useToast } from '../../components/ui/Toast';
import { triggerDownload, readJsonFile } from '../../lib/fileTransfer';
import { registerUnsavedGuard } from '../../lib/unsavedGuard';
import { AddControllerCard } from './AddControllerCard';
import './settings.css';

function clampLivePoll(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(30, Math.max(1, Math.round(value)));
}

/** One key at a time, so a union of Settings fields does not collapse to never. */
function assignKey<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function copySettings(target: Settings, source: Settings, keys: readonly (keyof Settings)[]): void {
  for (const key of keys) assignKey(target, key, source[key]);
}

function assignPartialSetting<K extends keyof Settings>(
  target: Partial<Settings>,
  key: K,
  value: Settings[K]
): void {
  target[key] = value;
}

function coordDisplayPrecision(value: number): number {
  // 6 decimal places is ~11cm precision — plenty for sunrise/sunset math,
  // and matches what Nominatim returns.
  return Number(value.toFixed(6));
}

type CategoryId = 'controllers' | 'location' | 'polling' | 'firmware' | 'schedule' | 'backup';

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'controllers', label: 'Controllers' },
  { id: 'location', label: 'Home location' },
  { id: 'polling', label: 'Polling & discovery' },
  { id: 'firmware', label: 'Firmware defaults' },
  { id: 'schedule', label: 'Schedule defaults' },
  { id: 'backup', label: 'Backup & restore' }
];

const CATEGORY_KEYS: Record<CategoryId, (keyof Settings)[]> = {
  controllers: [],
  location: ['homeLatitude', 'homeLongitude'],
  polling: ['discoveryRescanIntervalMinutes', 'controllerStatusPollIntervalMinutes', 'livePollIntervalSeconds'],
  firmware: ['includePrereleaseFirmware'],
  schedule: ['scheduleImportDisableOnDeviceDefault'],
  backup: []
};

function categoryDirty(id: CategoryId, draft: Settings, saved: Settings): boolean {
  return CATEGORY_KEYS[id].some((key) => draft[key] !== saved[key]);
}

function anyDirty(draft: Settings, saved: Settings): boolean {
  return (Object.keys(CATEGORY_KEYS) as CategoryId[]).some((id) => categoryDirty(id, draft, saved));
}

export function SettingsSection() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [category, setCategory] = useState<CategoryId>('controllers');
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [rescanMessage, setRescanMessage] = useState<string | null>(null);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const [addressQuery, setAddressQuery] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressCandidates, setAddressCandidates] = useState<GeocodeMatch[] | null>(null);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const autoBackups = useQuery({ queryKey: ['auto-backups'], queryFn: listAutoBackups });
  const [restoreAutoName, setRestoreAutoName] = useState<string | null>(null);

  const dirty = !!(draft && settings.data && anyDirty(draft, settings.data));

  useEffect(() => registerUnsavedGuard(() => dirty), [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  async function performRestore() {
    if (!restoreFile) return;
    setRestoring(true);
    try {
      const data = await readJsonFile(restoreFile);
      const result = await restoreBackupFile(data);
      await queryClient.invalidateQueries();
      setDraft(null);
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
    mutationFn: (body: Partial<Settings>) => updateSettings(body),
    onSuccess: (saved, body) => {
      queryClient.setQueryData(['settings'], saved);
      const savedKeys = Object.keys(body) as (keyof Settings)[];
      setDraft((prev) => {
        if (!prev) return saved;
        const next = { ...prev };
        copySettings(next, saved, savedKeys);
        return next;
      });
      setSavedNote('Saved');
    }
  });

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSavedNote(null);
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function applyCoords(latitude: number, longitude: number) {
    setDraft((prev) => prev ? {
      ...prev,
      homeLatitude: coordDisplayPrecision(latitude),
      homeLongitude: coordDisplayPrecision(longitude)
    } : prev);
    setSavedNote(null);
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

  function saveCategory() {
    if (!draft) return;
    const body: Partial<Settings> = {};
    for (const key of CATEGORY_KEYS[category]) assignPartialSetting(body, key, draft[key]);
    if (category === 'polling' && body.livePollIntervalSeconds !== undefined) {
      body.livePollIntervalSeconds = clampLivePoll(body.livePollIntervalSeconds);
    }
    save.mutate(body);
  }

  function discardCategory() {
    const saved = settings.data;
    if (!saved) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      copySettings(next, saved, CATEGORY_KEYS[category]);
      return next;
    });
    setSavedNote(null);
  }

  if (settings.isError) {
    return (
      <section className="section settings-section">
        <h2>Settings</h2>
        <div className="error-banner" role="alert">Failed to load settings.</div>
      </section>
    );
  }
  if (!draft || !settings.data) {
    return (
      <section className="section settings-section">
        <h2>Settings</h2>
        <p className="empty-state" role="status">Loading…</p>
      </section>
    );
  }

  const paneDirty = categoryDirty(category, draft, settings.data);
  const savable = CATEGORY_KEYS[category].length > 0;
  const activeLabel = CATEGORIES.find((item) => item.id === category)?.label ?? 'Settings';
  const backups = Array.isArray(autoBackups.data) ? autoBackups.data : [];
  const latestBackup = backups[0];
  const olderBackups = backups.slice(1);

  return (
    <section className="section settings-section">
      <header className="settings-header">
        <div>
          <h2>Settings</h2>
          <p className="settings-lede">One category at a time. Other unsaved drafts stay put until you save or discard them.</p>
        </div>
        {dirty && <p className="settings-dirty" role="status">Unsaved changes</p>}
      </header>
      {save.isError && (
        <div className="error-banner" role="alert">Failed to save settings.</div>
      )}

      <div className="settings-layout">
        <div className="settings-nav" role="tablist" aria-label="Settings categories">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`settings-tab-${item.id}`}
              className="settings-nav-btn"
              aria-selected={category === item.id}
              aria-controls={`settings-panel-${item.id}`}
              onClick={() => { setCategory(item.id); setSavedNote(null); }}
            >
              <span>{item.label}</span>
              {categoryDirty(item.id, draft, settings.data) && <span className="settings-nav-dirty">Unsaved</span>}
            </button>
          ))}
        </div>

        <label className="settings-category-select">
          Category
          <select
            aria-label="Settings category"
            value={category}
            onChange={(event) => { setCategory(event.target.value as CategoryId); setSavedNote(null); }}
          >
            {CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>

        <div
          className="settings-pane"
          role="tabpanel"
          id={`settings-panel-${category}`}
          aria-labelledby={`settings-tab-${category}`}
        >
          <h3 className="settings-pane-title">{activeLabel}</h3>

          {category === 'controllers' && (
            <>
              <p className="settings-group-hint">
                Discovery adds controllers on the network. Use the form when a controller needs a manual host.
              </p>
              <AddControllerCard />
            </>
          )}

          {category === 'location' && (
            <>
              <p className="settings-group-hint">Used for sunrise and sunset schedule triggers.</p>
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
                hint="Sends this query to OpenStreetMap's Nominatim geocoding service over the internet — the only outbound call this app makes besides checking for firmware updates. Nothing is sent until you choose Find."
              >
                <div className="settings-address-row">
                  <input
                    id="settings-address-lookup"
                    className="input"
                    type="text"
                    placeholder="Search address…"
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
            </>
          )}

          {category === 'polling' && (
            <>
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
                hint="How often watched controllers are polled while a Control panel is open (1–30 s)"
              >
                <input
                  id="settings-live-poll" aria-label="Live poll interval (seconds)"
                  className="input" type="number" min={1} max={30}
                  value={draft.livePollIntervalSeconds}
                  onChange={(e) => patch('livePollIntervalSeconds', Number(e.target.value))}
                />
              </Field>
              <hr className="settings-divider" />
              <div className="settings-rescan">
                <Button variant="secondary" onClick={handleRescan}>Re-scan now</Button>
                <p className="settings-group-hint">Re-scan runs immediately and is not part of Save changes.</p>
                {rescanMessage && <p className="settings-note" role="status">{rescanMessage}</p>}
                {rescanError && <div className="error-banner" role="alert">{rescanError}</div>}
              </div>
            </>
          )}

          {category === 'firmware' && (
            <div className="settings-toggle-row">
              <Toggle
                checked={draft.includePrereleaseFirmware}
                onChange={(c) => patch('includePrereleaseFirmware', c)}
                label="Include pre-release firmware builds"
                showLabel={false}
              />
              <span>Include pre-release firmware builds</span>
            </div>
          )}

          {category === 'schedule' && (
            <div className="settings-toggle-row">
              <Toggle
                checked={draft.scheduleImportDisableOnDeviceDefault}
                onChange={(c) => patch('scheduleImportDisableOnDeviceDefault', c)}
                label="Default disable on device for schedule import"
                showLabel={false}
              />
              <span>Default "disable on device" when importing WLED schedules</span>
            </div>
          )}

          {category === 'backup' && (
            <>
              <p className="settings-group-hint">
                Download a full snapshot of controllers, rooms, sync groups, themes, schedules, calendar events, layout, and settings.
              </p>
              <Button variant="primary" onClick={() => triggerDownload(BACKUP_URL)}>
                Download backup
              </Button>
              {latestBackup ? (
                <p className="settings-group-hint">
                  Latest automatic snapshot: <span className="ui-mono">{latestBackup.name.replace(/^uber-wled-backup-|\.json$/g, '')}</span>
                  {' '}({Math.max(1, Math.round(latestBackup.size / 1024))} KB). {backups.length} kept.
                </p>
              ) : (
                <p className="empty-state">No automatic backups yet — the first is written within the hour.</p>
              )}
              {olderBackups.length > 0 && (
                <details className="settings-backup-all">
                  <summary>Show all backups</summary>
                  <ul className="settings-autobackup-list">
                    {olderBackups.map((b) => (
                      <li key={b.name} className="settings-autobackup-row">
                        <span className="settings-autobackup-date ui-mono">{b.name.replace(/^uber-wled-backup-|\.json$/g, '')}</span>
                        <span className="settings-autobackup-size">{Math.max(1, Math.round(b.size / 1024))} KB</span>
                        <a className="settings-autobackup-dl" href={autoBackupUrl(b.name)} download>Download</a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {latestBackup && (
                <div className="settings-autobackup-row">
                  <a className="settings-autobackup-dl" href={autoBackupUrl(latestBackup.name)} download>Download latest</a>
                </div>
              )}
              <div className="settings-danger">
                <h4>Restore</h4>
                <p className="settings-group-hint">
                  Restoring replaces everything currently in this instance. There is no undo.
                </p>
                <ImportButton label="Restore from backup…" onFile={setRestoreFile} disabled={restoring} />
                {backups.length > 0 && (
                  <ul className="settings-autobackup-list">
                    {backups.map((b) => (
                      <li key={`restore-${b.name}`} className="settings-autobackup-row">
                        <span className="settings-autobackup-date ui-mono">{b.name.replace(/^uber-wled-backup-|\.json$/g, '')}</span>
                        <button
                          type="button" className="settings-autobackup-restore"
                          onClick={() => setRestoreAutoName(b.name)} disabled={restoring}
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {savable && (
            <div className="settings-savebar">
              <Button variant="primary" disabled={!paneDirty || save.isPending} onClick={saveCategory}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="secondary" disabled={!paneDirty || save.isPending} onClick={discardCategory}>
                Discard
              </Button>
              {savedNote && !paneDirty && <p className="settings-note" role="status">{savedNote}</p>}
            </div>
          )}
        </div>
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
