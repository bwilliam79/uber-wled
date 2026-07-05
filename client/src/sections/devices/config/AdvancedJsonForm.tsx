import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import type { Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function AdvancedJsonForm({ cfg, busy, onSave }: ConfigFormProps) {
  const [text, setText] = useState(() => JSON.stringify(cfg, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('The config must be a JSON object');
      return;
    }
    setParseError(null);
    onSave(parsed as Cfg);
  }

  return (
    <Card className="config-form">
      <h3>Advanced (raw JSON)</h3>
      <p className="config-warning" role="note">
        Full cfg.json parity — usermod settings and every exotic section live here. The same
        dry-run diff preview runs before anything is written; only paths you actually changed
        are shown and applied.
      </p>
      <Field label="cfg.json" htmlFor="cfg-raw-json" error={parseError ?? undefined}>
        <textarea id="cfg-raw-json" className="input config-json-editor" spellCheck={false}
          rows={24} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="config-form-actions">
        <Button variant="secondary"
          onClick={() => { setText(JSON.stringify(cfg, null, 2)); setParseError(null); }}>
          Reset to device config
        </Button>
        <Button variant="primary" disabled={busy} onClick={save}>Save raw config</Button>
      </div>
    </Card>
  );
}
