import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { buildIdentityPatch, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function IdentityForm({ cfg, busy, onSave }: ConfigFormProps) {
  const id = (cfg.id ?? {}) as Cfg;
  const [name, setName] = useState(String(id.name ?? ''));
  const [mdns, setMdns] = useState(String(id.mdns ?? ''));

  return (
    <Card className="config-form">
      <h3>Identity</h3>
      <Field label="Device name" htmlFor="cfg-id-name">
        <input id="cfg-id-name" className="input" value={name}
          onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="mDNS hostname" htmlFor="cfg-id-mdns"
        hint="Reachable as http://<hostname>.local">
        <input id="cfg-id-mdns" className="input" value={mdns}
          onChange={(e) => setMdns(e.target.value)} />
      </Field>
      <Button variant="primary" disabled={busy}
        onClick={() => onSave(buildIdentityPatch({ name, mdns }))}>
        Save identity
      </Button>
    </Card>
  );
}
