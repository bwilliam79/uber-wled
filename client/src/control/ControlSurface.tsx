import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyControl,
  type ApplyResult, type ControlPatch, type CustomTheme, type DevicePreset, type Target
} from '../api/client';
import {
  useCapabilitiesMap, useControllers, useDevicePresets, useGroups, useThemes
} from '../api/queries';
import { useLiveStatus } from '../api/live';
import {
  aggregateControlState, applyOverrides, expandTargets, mergeEffects, mergePalettes,
  targetControllerIds, targetsEqual, type ControlOverrides
} from './controlState';
import { throttleTrailing, type Throttled } from '../lib/throttle';
import { Tabs } from '../components/ui/Tabs';
import { Slider } from '../components/ui/Slider';
import { Toggle } from '../components/ui/Toggle';
import { Chip } from '../components/ui/Chip';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Select } from '../components/ui/Select';
import { ColorWheel } from '../components/ui/ColorWheel';
import { LedPreview } from '../components/ui/LedPreview';
import { effectToPreview } from '../lib/effectPreview';
import { paletteGradientCss } from '../lib/paletteCss';
import { rgbToHex } from '../lib/color';
import { ColorTab } from './ColorTab';
import { EffectsTab, type EffectOptionKey, type EffectParamKey } from './EffectsTab';
import { PalettesTab } from './PalettesTab';
import { PresetsTab } from './PresetsTab';
import './control.css';

const TABS = [
  { id: 'colors', label: 'Colors' },
  { id: 'effects', label: 'Effects' },
  { id: 'palettes', label: 'Palettes' },
  // Primarily this app's Themes (device presets are a secondary subsection
  // inside). Labeled "Themes" to match the Themes section; the id stays
  // 'presets' to avoid churn. The Device Detail page's own "Presets" tab is
  // genuinely WLED device presets and keeps that name.
  { id: 'presets', label: 'Themes' }
];

const NL_MODES: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: 'Instant' },
  { value: 1, label: 'Fade' },
  { value: 2, label: 'Color fade' },
  { value: 3, label: 'Sunrise' }
];

const THROTTLE_MS = 250; // ≤ 4 writes/sec per control

export interface ControlSurfaceProps {
  targets: Target[];
  open: boolean;
  onClose: () => void;
}

export function ControlSurface({ targets, open, onClose }: ControlSurfaceProps) {
  const { data: controllers = [] } = useControllers();
  const { data: groups = [] } = useGroups();
  const { data: themes = [] } = useThemes();

  const [localTargets, setLocalTargets] = useState<Target[]>(targets);
  useEffect(() => {
    // Bail out on value-equal target lists: callers may pass a freshly built
    // array each render, and adopting its identity would churn every
    // downstream memo/effect keyed on localTargets.
    setLocalTargets((prev) => (targetsEqual(prev, targets) ? prev : targets));
  }, [targets, open]);
  const localTargetsRef = useRef(localTargets);
  localTargetsRef.current = localTargets;

  const controllerIds = useMemo(
    () => targetControllerIds(localTargets, groups),
    [localTargets, groups]
  );
  const live = useLiveStatus(open ? controllerIds : []);
  const caps = useCapabilitiesMap(controllerIds);

  const [overrides, setOverrides] = useState<ControlOverrides>({});
  useEffect(() => {
    setOverrides((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [open, localTargets]);

  const agg = useMemo(
    () => aggregateControlState(localTargets, groups, live, caps),
    [localTargets, groups, live, caps]
  );
  const eff = useMemo(() => applyOverrides(agg, overrides), [agg, overrides]);

  const effects = useMemo(() => mergeEffects(controllerIds, caps), [controllerIds, caps]);
  const palettes = useMemo(() => mergePalettes(controllerIds, caps), [controllerIds, caps]);
  const selectedFxMeta = typeof eff.fxName === 'string'
    ? (effects.find((e) => e.name === eff.fxName)?.meta ?? null)
    : null;

  const anyRgbw = controllerIds.some((id) => live.get(id)?.info?.leds.rgbw === true);
  const cctSupported = controllerIds.some((id) => {
    const cct = live.get(id)?.info?.leds.cct;
    return cct === true || (typeof cct === 'number' && cct > 0);
  });

  const expanded = useMemo(
    () => expandTargets(localTargets, groups, live),
    [localTargets, groups, live]
  );
  const singleControllerId =
    expanded.length > 0 && expanded.every((t) => t.controllerId === expanded[0].controllerId)
      ? expanded[0].controllerId
      : null;
  const { data: devicePresets } = useDevicePresets(singleControllerId);

  const [failures, setFailures] = useState<ApplyResult[] | null>(null);
  const [activeTab, setActiveTab] = useState('colors');
  const [nlOpen, setNlOpen] = useState(false);
  const [nlDraft, setNlDraft] = useState<{ on: boolean; dur: number; mode: 0 | 1 | 2 | 3; tbri: number }>(
    { on: false, dur: 60, mode: 1, tbri: 0 }
  );
  const aggNl = agg.nl;
  useEffect(() => {
    if (!aggNl) return;
    setNlDraft((prev) =>
      prev.on === aggNl.on && prev.dur === aggNl.dur && prev.mode === aggNl.mode && prev.tbri === aggNl.tbri
        ? prev
        : { on: aggNl.on, dur: aggNl.dur, mode: aggNl.mode, tbri: aggNl.tbri }
    );
    // Primitive deps: `agg` is rebuilt whenever live/caps identities move, so
    // depending on the object identity would refire this on every SSE tick.
  }, [aggNl?.on, aggNl?.dur, aggNl?.mode, aggNl?.tbri]);

  const doApply = useCallback((patch: ControlPatch, targetsOverride?: Target[]) => {
    applyControl(targetsOverride ?? localTargetsRef.current, patch)
      .then(({ results }) => {
        const failed = results.filter((r) => !r.ok);
        if (failed.length > 0) setFailures(failed);
      })
      .catch((err: Error) => {
        setFailures([{ controllerId: '(request)', wledSegId: null, ok: false, error: err.message }]);
      });
  }, []);

  const throttlersRef = useRef(new Map<string, Throttled<[ControlPatch]>>());
  useEffect(() => {
    const throttlers = throttlersRef.current;
    return () => {
      for (const throttler of throttlers.values()) throttler.cancel();
      throttlers.clear();
    };
  }, []);
  const applyThrottled = useCallback((key: string, patch: ControlPatch) => {
    let throttler = throttlersRef.current.get(key);
    if (!throttler) {
      throttler = throttleTrailing((p: ControlPatch) => doApply(p), THROTTLE_MS);
      throttlersRef.current.set(key, throttler);
    }
    throttler.call(patch);
  }, [doApply]);

  const override = (patch: ControlOverrides) => setOverrides((prev) => ({ ...prev, ...patch }));

  const setPower = (on: boolean) => { override({ power: on }); doApply({ on }); };
  const setBri = (bri: number) => { override({ bri }); applyThrottled('bri', { bri }); };
  const setTransition = (transition: number) => { override({ transition }); doApply({ transition }); };
  const selectEffect = (fxName: string) => { override({ fxName }); doApply({ seg: { fxName } }); };
  const selectPalette = (palName: string) => { override({ palName }); doApply({ seg: { palName } }); };
  const setParam = (key: EffectParamKey, value: number) => {
    override({ [key]: value });
    applyThrottled(key, { seg: { [key]: value } });
  };
  const setOption = (key: EffectOptionKey, value: boolean) => {
    override({ [key]: value });
    doApply({ seg: { [key]: value } });
  };
  const setCct = (cct: number) => { override({ cct }); applyThrottled('cct', { seg: { cct } }); };
  const setSlotColor = (slot: number, rgb: number[]) => {
    override({ colors: { ...overrides.colors, [slot]: rgb } });
    const col: number[][] = [[], [], []];
    col[slot] = rgb;
    applyThrottled(`col${slot}`, { seg: { col: col.slice(0, slot + 1) } });
  };
  const applyTheme = (theme: CustomTheme) => {
    override({ bri: theme.brightness });
    doApply({
      bri: theme.brightness,
      seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors, sx: theme.speed, ix: theme.intensity }
    });
  };
  const applyDevicePreset = (preset: DevicePreset) => {
    // Device preset ids are device-local, so the surface gates preset apply
    // to single-controller selections and sends the master's ControlPatch.ps
    // through the v2 route as a whole-controller target (no dedicated
    // preset-apply route exists — see master contract).
    if (singleControllerId === null) return;
    doApply({ ps: preset.id }, [{ kind: 'controller', controllerId: singleControllerId }]);
  };
  const applyNightlight = () => { doApply({ nl: nlDraft }); setNlOpen(false); };
  const removeTarget = (index: number) =>
    setLocalTargets((prev) => prev.filter((_, i) => i !== index));

  const targetLabel = (target: Target): string => {
    if (target.kind === 'group') return groups.find((g) => g.id === target.groupId)?.name ?? 'Room';
    const controller = controllers.find((c) => c.id === target.controllerId);
    // Prefer the live device-reported name over the frozen (often mDNS)
    // stored name — same reasoning as DeviceCard/DeviceDetail/Home.
    const name = live.get(target.controllerId)?.info?.name || controller?.name || target.controllerId;
    return target.kind === 'segment' ? `${name} · seg ${target.wledSegId}` : name;
  };

  const transitionUnits = typeof eff.transition === 'number' ? eff.transition : 7;
  const failureCount = failures?.length ?? 0;

  // Close on Escape (the Drawer used to provide this).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ---- Derived values for the design's compact control view ----
  const slotHex = (i: number): string => {
    const c = eff.colors[i];
    return Array.isArray(c) ? rgbToHex([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0]) : '#000000';
  };
  const color0 = eff.colors[0];
  const wheelColor = Array.isArray(color0)
    ? { r: color0[0] ?? 0, g: color0[1] ?? 0, b: color0[2] ?? 0 }
    : { r: 255, g: 255, b: 255 };
  const centerHex = Array.isArray(color0) ? slotHex(0) : '—';
  const briValue = typeof eff.bri === 'number' ? eff.bri : 128;
  const briPct = Math.round((briValue / 255) * 100);
  const slotHexes = [0, 1, 2].map(slotHex);
  const previewColors =
    slotHexes.filter((_, i) => {
      const c = eff.colors[i];
      return Array.isArray(c) && (c[0] || c[1] || c[2]);
    }).join(',') || '#2ee6c0';
  const previewEffect = effectToPreview(typeof eff.fxName === 'string' ? eff.fxName : undefined);

  const singleController = singleControllerId ? controllers.find((c) => c.id === singleControllerId) : null;
  const singleInfo = singleControllerId ? live.get(singleControllerId)?.info : undefined;
  const singleName = singleControllerId
    ? (singleInfo?.name || singleController?.name || 'Controller')
    : null;
  const singleCount = singleInfo?.leds.count;

  if (!open) return null;

  return (
    <div className="ui-overlay" onClick={onClose}>
      <div className="cs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Control">
      <div className="control-surface">
        {/* Header: single-controller identity (or target chips) + power + close */}
        <div className="cs-modal-head">
          {singleName ? (
            <div className="cs-identity">
              <span className={`cs-status-dot${eff.power === 'on' ? ' on' : ''}`} aria-hidden="true" />
              <div className="cs-identity-text">
                <div className="cs-identity-name">{singleName}</div>
                <div className="cs-identity-meta ui-mono">
                  {singleController?.host}{singleCount !== undefined ? ` · ${singleCount} px` : ''}
                </div>
              </div>
            </div>
          ) : (
            <div className="cs-chips">
              {localTargets.map((target, i) => (
                <Chip key={`${targetLabel(target)}-${i}`} onRemove={() => removeTarget(i)}>
                  {targetLabel(target)}
                </Chip>
              ))}
              {agg.anyUnreachable && <Chip variant="warning">Some offline</Chip>}
            </div>
          )}
          <div className="cs-modal-head-actions">
            <span className="cs-power-label">Power</span>
            <Toggle label="Power" showLabel={false} checked={eff.power === 'on'} onChange={setPower} />
            {eff.power === 'mixed' && <Chip variant="warning">Mixed</Chip>}
            <IconButton label="Close" onClick={onClose}>✕</IconButton>
          </div>
        </div>

        {/* Live preview of the current look. */}
        <div className="cs-preview-well">
          <LedPreview
            effect={previewEffect}
            colors={previewColors}
            count={singleCount ?? 48}
            speed={0.9}
            className="cs-preview-canvas"
            ariaLabel="Live preview"
          />
        </div>

        {/* Two-column control: color wheel + palettes | effect chips + brightness. */}
        <div className="cs-main">
          <div className="cs-main-left">
            <ColorWheel color={wheelColor} onChange={(c) => setSlotColor(0, [c.r, c.g, c.b])} />
            <div className="cs-center-hex ui-mono">{centerHex}</div>
            <div className="cs-palette-row" role="group" aria-label="Palettes">
              {palettes.slice(0, 24).map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className={`cs-palette-swatch${eff.palName === p.name ? ' active' : ''}`}
                  style={{ background: paletteGradientCss(p.preview ?? undefined, slotHexes) }}
                  aria-label={`palette ${p.name}`}
                  title={p.name}
                  onClick={() => selectPalette(p.name)}
                />
              ))}
            </div>
          </div>
          <div className="cs-main-right">
            <div className="cs-section-label">Effect</div>
            <div className="cs-effect-chips" role="group" aria-label="Effects">
              {effects.map((e) => (
                <button
                  key={e.name}
                  type="button"
                  className={`cs-effect-chip${eff.fxName === e.name ? ' active' : ''}`}
                  onClick={() => selectEffect(e.name)}
                >
                  {e.name}
                </button>
              ))}
            </div>
            <div className="cs-bri">
              <div className="cs-bri-head">
                <span className="cs-section-label">Brightness</span>
                <span className="ui-mono">{briPct}%</span>
              </div>
              <Slider label="Brightness" min={1} max={255} value={briValue} onChange={setBri} />
              {eff.bri === 'mixed' && <Chip variant="warning">Mixed</Chip>}
            </div>
          </div>
        </div>

        {/* Advanced: everything the compact view doesn't surface — white channel,
            CCT/kelvin, per-effect params, full palettes, themes/device presets,
            nightlight, transition. Kept so nothing is lost. */}
        <details className="cs-advanced">
          <summary>Advanced controls</summary>
          <div className="cs-row transition-stepper">
            <span className="control-label">Transition</span>
            <IconButton label="decrease transition"
              onClick={() => setTransition(Math.max(0, transitionUnits - 1))}>−</IconButton>
            <span className="transition-value">{(transitionUnits / 10).toFixed(1)}s</span>
            <IconButton label="increase transition"
              onClick={() => setTransition(Math.min(650, transitionUnits + 1))}>+</IconButton>
          </div>
          <div className="cs-row">
            <Button variant="secondary" onClick={() => setNlOpen((v) => !v)}>Nightlight</Button>
            {nlOpen && (
              <div className="nl-popover">
                <Toggle label="Nightlight on" checked={nlDraft.on}
                  onChange={(on) => setNlDraft({ ...nlDraft, on })} />
                <label className="control-label">
                  Duration (min)
                  <input type="number" min={1} max={255} value={nlDraft.dur} className="input"
                    onChange={(e) => setNlDraft({ ...nlDraft, dur: Number(e.target.value) })} />
                </label>
                <Select label="Mode" value={String(nlDraft.mode)}
                  options={NL_MODES.map((m) => ({ value: String(m.value), label: m.label }))}
                  onChange={(v) => setNlDraft({ ...nlDraft, mode: Number(v) as 0 | 1 | 2 | 3 })} />
                <Slider label="Target brightness" min={0} max={255} value={nlDraft.tbri}
                  onChange={(tbri) => setNlDraft({ ...nlDraft, tbri })} />
                <Button onClick={applyNightlight}>Apply nightlight</Button>
              </div>
            )}
          </div>
          <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
          <div className="cs-tab-body">
            {activeTab === 'colors' && (
              <ColorTab agg={eff} fxMeta={selectedFxMeta} anyRgbw={anyRgbw} cctSupported={cctSupported}
                onColorChange={setSlotColor} onCctChange={setCct} />
            )}
            {activeTab === 'effects' && (
              <EffectsTab effects={effects} agg={eff}
                onSelectEffect={selectEffect} onParamChange={setParam} onOptionChange={setOption} />
            )}
            {activeTab === 'palettes' && (
              <PalettesTab palettes={palettes} agg={eff} onSelectPalette={selectPalette} />
            )}
            {activeTab === 'presets' && (
              <PresetsTab themes={themes}
                devicePresets={singleControllerId !== null ? (devicePresets ?? []) : null}
                onApplyTheme={applyTheme} onApplyDevicePreset={applyDevicePreset} />
            )}
          </div>
        </details>

        {failures !== null && (
          <div className="cs-failure-notice" role="alert">
            <div className="cs-failure-head">
              <p className="cs-failure-msg">
                {`${failureCount} ${failureCount === 1 ? 'target' : 'targets'} failed`}
              </p>
              <IconButton label="Dismiss" onClick={() => setFailures(null)}>×</IconButton>
            </div>
            <details className="cs-failure-details">
              <summary>Details</summary>
              <ul>
                {failures.map((failure, i) => (
                  <li key={i}>
                    {failure.controllerId}
                    {failure.wledSegId != null ? ` seg ${failure.wledSegId}` : ''}
                    {': '}
                    {failure.error ?? 'unknown error'}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
