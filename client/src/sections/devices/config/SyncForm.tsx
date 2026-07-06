import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Toggle } from '../../../components/ui/Toggle';
import { buildSyncPatch, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function SyncForm({ cfg, busy, onSave }: ConfigFormProps) {
  const sync = (cfg.if?.sync ?? {}) as Cfg;
  const recv = (sync.recv ?? {}) as Cfg;
  const send = (sync.send ?? {}) as Cfg;
  const [port0, setPort0] = useState(String(sync.port0 ?? 21324));
  const [port1, setPort1] = useState(String(sync.port1 ?? 65506));
  const [recvBri, setRecvBri] = useState(Boolean(recv.bri));
  const [recvCol, setRecvCol] = useState(Boolean(recv.col));
  const [recvFx, setRecvFx] = useState(Boolean(recv.fx));
  const [recvPal, setRecvPal] = useState(Boolean(recv.pal));
  const [recvSeg, setRecvSeg] = useState(Boolean(recv.seg));
  const [recvSb, setRecvSb] = useState(Boolean(recv.sb));
  const [recvGroups, setRecvGroups] = useState(String(recv.grp ?? 1));
  const [sendEn, setSendEn] = useState(Boolean(send.en));
  const [sendDir, setSendDir] = useState(Boolean(send.dir));
  const [sendHue, setSendHue] = useState(Boolean(send.hue));
  const [sendGroups, setSendGroups] = useState(String(send.grp ?? 1));
  const [espnow, setEspnow] = useState(Boolean(sync.espnow));
  const [sendBtn, setSendBtn] = useState(Boolean(send.btn));
  const [sendVa, setSendVa] = useState(Boolean(send.va));

  return (
    <Card className="config-form">
      <h3>Sync interfaces</h3>
      <div className="config-form-grid">
        <Field label="UDP port" htmlFor="cfg-sync-port0">
          <input id="cfg-sync-port0" className="input" type="number" inputMode="numeric"
            value={port0} onChange={(e) => setPort0(e.target.value)} />
        </Field>
        <Field label="UDP port 2" htmlFor="cfg-sync-port1">
          <input id="cfg-sync-port1" className="input" type="number" inputMode="numeric"
            value={port1} onChange={(e) => setPort1(e.target.value)} />
        </Field>
        <Field label="Receive groups (bitmap)" htmlFor="cfg-sync-recv-grp">
          <input id="cfg-sync-recv-grp" className="input" type="number" inputMode="numeric"
            value={recvGroups} onChange={(e) => setRecvGroups(e.target.value)} />
        </Field>
        <Field label="Send groups (bitmap)" htmlFor="cfg-sync-send-grp">
          <input id="cfg-sync-send-grp" className="input" type="number" inputMode="numeric"
            value={sendGroups} onChange={(e) => setSendGroups(e.target.value)} />
        </Field>
      </div>
      <div className="segment-switches">
        <Toggle label="Receive brightness" checked={recvBri} onChange={setRecvBri} />
        <Toggle label="Receive color" checked={recvCol} onChange={setRecvCol} />
        <Toggle label="Receive effects" checked={recvFx} onChange={setRecvFx} />
        <Toggle label="Receive palette" checked={recvPal} onChange={setRecvPal} />
        <Toggle label="Receive segment options" checked={recvSeg} onChange={setRecvSeg} />
        <Toggle label="Receive segment bounds" checked={recvSb} onChange={setRecvSb} />
        <Toggle label="Send on change" checked={sendEn} onChange={setSendEn} />
        <Toggle label="Notify on direct change" checked={sendDir} onChange={setSendDir} />
        <Toggle label="Notify on button press" checked={sendBtn} onChange={setSendBtn} />
        <Toggle label="Notify on Alexa change" checked={sendVa} onChange={setSendVa} />
        <Toggle label="Sync with Hue" checked={sendHue} onChange={setSendHue} />
        <Toggle label="Sync also over ESP-NOW" checked={espnow} onChange={setEspnow} />
      </div>
      <Button variant="primary" disabled={busy}
        onClick={() =>
          onSave(buildSyncPatch({
            port0: Number(port0), port1: Number(port1),
            recvBri, recvCol, recvFx, recvPal, recvSeg, recvSb, recvGroups: Number(recvGroups),
            sendEn, sendDir, sendHue, sendGroups: Number(sendGroups),
            espnow, sendBtn, sendVa
          }))
        }>
        Save sync
      </Button>
    </Card>
  );
}
