import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Toggle } from '../../../components/ui/Toggle';
import { buildTimePatch, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function TimeForm({ cfg, busy, onSave }: ConfigFormProps) {
  const ntp = (cfg.if?.ntp ?? {}) as Cfg;
  const [enabled, setEnabled] = useState(Boolean(ntp.en));
  const [host, setHost] = useState(String(ntp.host ?? '0.wled.pool.ntp.org'));
  const [tz, setTz] = useState(String(ntp.tz ?? 0));
  const [offset, setOffset] = useState(String(ntp.offset ?? 0));
  const [ampm, setAmpm] = useState(Boolean(ntp.ampm));
  const [lat, setLat] = useState(String(ntp.lt ?? 0));
  const [lon, setLon] = useState(String(ntp.ln ?? 0));

  return (
    <Card className="config-form">
      <h3>Time</h3>
      <Toggle label="Use NTP" checked={enabled} onChange={setEnabled} />
      <Field label="NTP server" htmlFor="cfg-ntp-host">
        <input id="cfg-ntp-host" className="input" value={host}
          onChange={(e) => setHost(e.target.value)} />
      </Field>
      <div className="config-form-grid">
        <Field label="Timezone index (WLED table)" htmlFor="cfg-ntp-tz"
          hint="Index into WLED's timezone list (probed 5 = US Central)">
          <input id="cfg-ntp-tz" className="input" type="number" inputMode="numeric"
            value={tz} onChange={(e) => setTz(e.target.value)} />
        </Field>
        <Field label="UTC offset (seconds)" htmlFor="cfg-ntp-offset">
          <input id="cfg-ntp-offset" className="input" type="number" inputMode="numeric"
            value={offset} onChange={(e) => setOffset(e.target.value)} />
        </Field>
        <Field label="Latitude" htmlFor="cfg-ntp-lat">
          <input id="cfg-ntp-lat" className="input" type="number" step="0.01"
            value={lat} onChange={(e) => setLat(e.target.value)} />
        </Field>
        <Field label="Longitude" htmlFor="cfg-ntp-lon">
          <input id="cfg-ntp-lon" className="input" type="number" step="0.01"
            value={lon} onChange={(e) => setLon(e.target.value)} />
        </Field>
      </div>
      <Toggle label="12-hour clock (AM/PM)" checked={ampm} onChange={setAmpm} />
      <Button variant="primary" disabled={busy}
        onClick={() =>
          onSave(buildTimePatch({
            ntpEnabled: enabled, ntpHost: host, timezone: Number(tz),
            offsetSeconds: Number(offset), ampm, latitude: Number(lat), longitude: Number(lon)
          }))
        }>
        Save time
      </Button>
    </Card>
  );
}
