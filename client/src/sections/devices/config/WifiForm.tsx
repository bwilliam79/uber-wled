import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Toggle } from '../../../components/ui/Toggle';
import { buildWifiPatch, formatIpv4, parseIpv4, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

const IP_ERROR = 'Use dotted-quad form, e.g. 192.168.1.50';

export function WifiForm({ cfg, busy, onSave }: ConfigFormProps) {
  const row0 = (cfg.nw?.ins?.[0] ?? {}) as Cfg;
  const ap = (cfg.ap ?? {}) as Cfg;
  const [ssid, setSsid] = useState(String(row0.ssid ?? ''));
  const [password, setPassword] = useState('');
  const [staticIp, setStaticIp] = useState(formatIpv4(row0.ip));
  const [gateway, setGateway] = useState(formatIpv4(row0.gw));
  const [subnet, setSubnet] = useState(formatIpv4(row0.sn));
  const [apSsid, setApSsid] = useState(String(ap.ssid ?? ''));
  const [apPassword, setApPassword] = useState('');
  const [apChannel, setApChannel] = useState(String(ap.chan ?? 1));
  const [apHide, setApHide] = useState(Boolean(ap.hide));

  const ipError = parseIpv4(staticIp) === null ? IP_ERROR : null;
  const gwError = parseIpv4(gateway) === null ? IP_ERROR : null;
  const snError = parseIpv4(subnet) === null ? IP_ERROR : null;
  const valid = !ipError && !gwError && !snError;

  return (
    <Card className="config-form">
      <h3>WiFi</h3>
      <p className="config-warning" role="note">
        A wrong SSID or password strands the device: it falls back to its own WLED-AP access
        point and disappears from this app until you rejoin it to the network.
      </p>
      <Field label="Network SSID" htmlFor="cfg-wifi-ssid">
        <input id="cfg-wifi-ssid" className="input" value={ssid}
          onChange={(e) => setSsid(e.target.value)} />
      </Field>
      <Field label="Network password" htmlFor="cfg-wifi-psk"
        hint={row0.pskl
          ? `A ${row0.pskl}-character password is saved — leave blank to keep it`
          : 'Leave blank to keep the saved password'}>
        <input id="cfg-wifi-psk" className="input" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      <div className="config-form-grid">
        <Field label="Static IP (0.0.0.0 = DHCP)" htmlFor="cfg-wifi-ip" error={ipError ?? undefined}>
          <input id="cfg-wifi-ip" className="input" value={staticIp}
            onChange={(e) => setStaticIp(e.target.value)} />
        </Field>
        <Field label="Gateway" htmlFor="cfg-wifi-gw" error={gwError ?? undefined}>
          <input id="cfg-wifi-gw" className="input" value={gateway}
            onChange={(e) => setGateway(e.target.value)} />
        </Field>
        <Field label="Subnet mask" htmlFor="cfg-wifi-sn" error={snError ?? undefined}>
          <input id="cfg-wifi-sn" className="input" value={subnet}
            onChange={(e) => setSubnet(e.target.value)} />
        </Field>
      </div>
      <h4>AP fallback</h4>
      <div className="config-form-grid">
        <Field label="AP SSID" htmlFor="cfg-ap-ssid">
          <input id="cfg-ap-ssid" className="input" value={apSsid}
            onChange={(e) => setApSsid(e.target.value)} />
        </Field>
        <Field label="AP password" htmlFor="cfg-ap-psk" hint="Leave blank to keep the saved password">
          <input id="cfg-ap-psk" className="input" type="password" value={apPassword}
            onChange={(e) => setApPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="AP channel" htmlFor="cfg-ap-chan">
          <input id="cfg-ap-chan" className="input" type="number" inputMode="numeric" min={1} max={13}
            value={apChannel} onChange={(e) => setApChannel(e.target.value)} />
        </Field>
      </div>
      <Toggle label="Hide AP SSID" checked={apHide} onChange={setApHide} />
      <Button variant="primary" disabled={busy || !valid}
        onClick={() =>
          onSave(buildWifiPatch(cfg, {
            ssid, password, staticIp, gateway, subnet,
            apSsid, apPassword, apChannel: Number(apChannel), apHide
          }))
        }>
        Save WiFi
      </Button>
    </Card>
  );
}
