import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Select } from '../../../components/ui/Select';
import { Toggle } from '../../../components/ui/Toggle';
import {
  AUTO_WHITE_MODES, COLOR_ORDERS, LED_TYPES,
  buildLedHardwarePatch, outputDraftFromRow, type Cfg, type OutputDraft
} from '../configPatches';
import type { ConfigFormProps } from './types';

export function LedHardwareForm({ cfg, busy, onSave }: ConfigFormProps) {
  const led = (cfg.hw?.led ?? {}) as Cfg;
  const rows: Cfg[] = Array.isArray(led.ins) ? led.ins : [];
  const [total, setTotal] = useState(String(led.total ?? 0));
  const [maxpwr, setMaxpwr] = useState(String(led.maxpwr ?? 0));
  const [drafts, setDrafts] = useState<OutputDraft[]>(rows.map(outputDraftFromRow));

  function patchDraft(i: number, change: Partial<OutputDraft>) {
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...change } : d)));
  }

  return (
    <Card className="config-form">
      <h3>LED &amp; Hardware</h3>
      <p className="config-warning" role="note">
        Changing pins or output types can stop LED output or strand the device — every save here
        previews the exact diff and asks again before writing.
      </p>
      <div className="config-form-grid">
        <Field label="Total LED count" htmlFor="cfg-led-total">
          <input id="cfg-led-total" className="input" type="number" inputMode="numeric"
            value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <Field label="Max power (mA, 0 = unlimited)" htmlFor="cfg-led-maxpwr">
          <input id="cfg-led-maxpwr" className="input" type="number" inputMode="numeric"
            value={maxpwr} onChange={(e) => setMaxpwr(e.target.value)} />
        </Field>
      </div>
      {drafts.map((draft, i) => (
        <fieldset className="output-editor" key={i}>
          <legend>Output {i + 1}</legend>
          <div className="config-form-grid">
            <Field label="GPIO pin" htmlFor={`cfg-out-${i}-pin`}>
              <input id={`cfg-out-${i}-pin`} className="input" type="number" inputMode="numeric"
                value={String(draft.pin)}
                onChange={(e) => patchDraft(i, { pin: Number(e.target.value) })} />
            </Field>
            <Select label={`Output ${i + 1} LED type`} value={String(draft.type)}
              onChange={(v) => patchDraft(i, { type: Number(v) })}
              options={LED_TYPES.map((t) => ({ value: String(t.value), label: t.label }))} />
            <Field label="Length" htmlFor={`cfg-out-${i}-len`}>
              <input id={`cfg-out-${i}-len`} className="input" type="number" inputMode="numeric"
                value={String(draft.len)}
                onChange={(e) => patchDraft(i, { len: Number(e.target.value) })} />
            </Field>
            <Field label="Start" htmlFor={`cfg-out-${i}-start`}>
              <input id={`cfg-out-${i}-start`} className="input" type="number" inputMode="numeric"
                value={String(draft.start)}
                onChange={(e) => patchDraft(i, { start: Number(e.target.value) })} />
            </Field>
            <Select label={`Output ${i + 1} color order`} value={String(draft.colorOrder)}
              onChange={(v) => patchDraft(i, { colorOrder: Number(v) })}
              options={COLOR_ORDERS.map((o) => ({ value: String(o.value), label: o.label }))} />
            <Field label="Skip first LEDs" htmlFor={`cfg-out-${i}-skip`}>
              <input id={`cfg-out-${i}-skip`} className="input" type="number" inputMode="numeric"
                value={String(draft.skip)}
                onChange={(e) => patchDraft(i, { skip: Number(e.target.value) })} />
            </Field>
            <Select label={`Output ${i + 1} auto-white mode`} value={String(draft.rgbwm)}
              onChange={(v) => patchDraft(i, { rgbwm: Number(v) })}
              options={AUTO_WHITE_MODES.map((m) => ({ value: String(m.value), label: m.label }))} />
          </div>
          <Toggle label={`Output ${i + 1} reversed`} checked={draft.rev}
            onChange={(rev) => patchDraft(i, { rev })} />
        </fieldset>
      ))}
      <Button variant="primary" disabled={busy}
        onClick={() =>
          onSave(buildLedHardwarePatch(cfg, drafts, { total: Number(total), maxpwr: Number(maxpwr) }))
        }>
        Save LED &amp; hardware
      </Button>
    </Card>
  );
}
