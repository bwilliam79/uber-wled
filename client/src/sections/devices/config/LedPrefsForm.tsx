import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { Select } from '../../../components/ui/Select';
import { Toggle } from '../../../components/ui/Toggle';
import { NIGHTLIGHT_MODES, buildLedPrefsPatch, type Cfg } from '../configPatches';
import type { ConfigFormProps } from './types';

export function LedPrefsForm({ cfg, busy, onSave }: ConfigFormProps) {
  const def = (cfg.def ?? {}) as Cfg;
  const light = (cfg.light ?? {}) as Cfg;
  const tr = (light.tr ?? {}) as Cfg;
  const gc = (light.gc ?? {}) as Cfg;
  const nl = (light.nl ?? {}) as Cfg;
  const [bootPreset, setBootPreset] = useState(String(def.ps ?? 0));
  const [bootOn, setBootOn] = useState(Boolean(def.on));
  const [bootBri, setBootBri] = useState(String(def.bri ?? 128));
  const [transitionMs, setTransitionMs] = useState(String(Number(tr.dur ?? 7) * 100));
  const [gammaColor, setGammaColor] = useState(String(gc.col ?? 2.8));
  const [brightnessFactor, setBrightnessFactor] = useState(String(light['scale-bri'] ?? 100));
  const [nlMode, setNlMode] = useState(String(nl.mode ?? 0));
  const [nlDurationMin, setNlDurationMin] = useState(String(nl.dur ?? 60));
  const [nlTargetBri, setNlTargetBri] = useState(String(nl.tbri ?? 0));
  const [nlMacro, setNlMacro] = useState(String(nl.macro ?? 0));

  return (
    <Card className="config-form">
      <h3>LED preferences</h3>
      <div className="config-form-grid">
        <Field label="Boot preset id (0 = none)" htmlFor="cfg-def-ps">
          <input id="cfg-def-ps" className="input" type="number" inputMode="numeric"
            value={bootPreset} onChange={(e) => setBootPreset(e.target.value)} />
        </Field>
        <Field label="Boot brightness" htmlFor="cfg-def-bri">
          <input id="cfg-def-bri" className="input" type="number" inputMode="numeric" min={1} max={255}
            value={bootBri} onChange={(e) => setBootBri(e.target.value)} />
        </Field>
        <Field label="Transition duration (ms)" htmlFor="cfg-light-tr">
          <input id="cfg-light-tr" className="input" type="number" inputMode="numeric" step={100}
            value={transitionMs} onChange={(e) => setTransitionMs(e.target.value)} />
        </Field>
        <Field label="Color gamma" htmlFor="cfg-light-gc">
          <input id="cfg-light-gc" className="input" type="number" step="0.1"
            value={gammaColor} onChange={(e) => setGammaColor(e.target.value)} />
        </Field>
        <Field label="Brightness factor (%)" htmlFor="cfg-light-scale">
          <input id="cfg-light-scale" className="input" type="number" inputMode="numeric"
            value={brightnessFactor} onChange={(e) => setBrightnessFactor(e.target.value)} />
        </Field>
      </div>
      <Toggle label="Turn on at boot" checked={bootOn} onChange={setBootOn} />
      <h4>Nightlight</h4>
      <div className="config-form-grid">
        <Select label="Nightlight mode" value={nlMode} onChange={setNlMode}
          options={NIGHTLIGHT_MODES.map((m) => ({ value: String(m.value), label: m.label }))} />
        <Field label="Nightlight duration (minutes)" htmlFor="cfg-nl-dur">
          <input id="cfg-nl-dur" className="input" type="number" inputMode="numeric" min={1} max={255}
            value={nlDurationMin} onChange={(e) => setNlDurationMin(e.target.value)} />
        </Field>
        <Field label="Nightlight target brightness" htmlFor="cfg-nl-tbri">
          <input id="cfg-nl-tbri" className="input" type="number" inputMode="numeric" min={0} max={255}
            value={nlTargetBri} onChange={(e) => setNlTargetBri(e.target.value)} />
        </Field>
        <Field label="Nightlight macro id (0 = none)" htmlFor="cfg-nl-macro">
          <input id="cfg-nl-macro" className="input" type="number" inputMode="numeric"
            value={nlMacro} onChange={(e) => setNlMacro(e.target.value)} />
        </Field>
      </div>
      <Button variant="primary" disabled={busy}
        onClick={() =>
          onSave(buildLedPrefsPatch({
            bootPreset: Number(bootPreset), bootOn, bootBri: Number(bootBri),
            transitionDurationMs: Number(transitionMs),
            gammaColor: Number(gammaColor), brightnessFactor: Number(brightnessFactor),
            nlMode: Number(nlMode), nlDurationMin: Number(nlDurationMin),
            nlTargetBri: Number(nlTargetBri), nlMacro: Number(nlMacro)
          }))
        }>
        Save LED preferences
      </Button>
    </Card>
  );
}
