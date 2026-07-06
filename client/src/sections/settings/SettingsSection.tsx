import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { geocodeAddress, rescanNow, updateSettings, type GeocodeMatch, type Settings } from '../../api/client';
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

const GEO_TIMEOUT_MS = 10_000;

function coordDisplayPrecision(value: number): number {
  // 6 decimal places is ~11cm precision — plenty for sunrise/sunset math,
  // and matches what browsers' Geolocation API and Nominatim both return.
  return Number(value.toFixed(6));
}

function geolocationErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      // Browsers also report PERMISSION_DENIED — with no prompt ever shown —
      // when the page isn't in a secure context (HTTPS or localhost). The
      // isSecureContext check in handleUseMyLocation catches that case before
      // this ever fires; this message only applies to a genuine user denial.
      return 'Location permission was denied. Allow location access for this site in your browser settings, then try again.';
    case err.POSITION_UNAVAILABLE:
      return "Your device couldn't determine its location right now.";
    case err.TIMEOUT:
      return 'Timed out waiting for your device to report its location.';
    default:
      return "Couldn't determine your location.";
  }
}

const GEO_INSECURE_CONTEXT_MESSAGE =
  "Browsers only allow this API on HTTPS or localhost. This app is served over plain HTTP on your " +
  'LAN, so Chrome silently refuses the request — no permission prompt ever appears. Type the ' +
  'coordinates directly, or use "Look up an address" below (that one goes through the server, not the browser).';

export function SettingsSection() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [rescanMessage, setRescanMessage] = useState<string | null>(null);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [addressQuery, setAddressQuery] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressCandidates, setAddressCandidates] = useState<GeocodeMatch[] | null>(null);

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

  function handleUseMyLocation() {
    setGeoError(null);
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      // Chrome (and most browsers) reject getCurrentPosition outright on an
      // insecure origin — no permission prompt is ever shown, and the error
      // it reports (PERMISSION_DENIED) is indistinguishable from a real user
      // denial unless we check this ourselves first.
      setGeoError(GEO_INSECURE_CONTEXT_MESSAGE);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError("This browser doesn't support on-device geolocation.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        applyCoords(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setLocating(false);
        setGeoError(geolocationErrorMessage(err));
      },
      { timeout: GEO_TIMEOUT_MS, enableHighAccuracy: false }
    );
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
      <Card className="settings-form">
        {save.isError && (
          <div className="error-banner" role="alert">Failed to save settings.</div>
        )}

        <div className="settings-toggle-row">
          <Toggle
            checked={draft.includePrereleaseFirmware}
            onChange={(c) => patch('includePrereleaseFirmware', c)}
            label="Include pre-release firmware builds"
            showLabel={false}
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

        <div className="settings-location-helpers">
          <div className="settings-location-helper">
            <div className="settings-location-helper-row">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={locating}
                onClick={handleUseMyLocation}
              >
                {locating ? 'Locating…' : 'Use my current location'}
              </Button>
              <span className="settings-note">
                Your device's own on-device location — never leaves your browser.
              </span>
            </div>
            {geoError && <div className="error-banner" role="alert">{geoError}</div>}
          </div>

          <div className="settings-location-helper">
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
          </div>
        </div>

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
            showLabel={false}
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
