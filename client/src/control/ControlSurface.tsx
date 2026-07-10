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
import { ConicColorWheel } from '../components/ui/ConicColorWheel';
import { LedPreview } from '../components/ui/LedPreview';
import { LiveOutputStrip } from '../components/ui/LiveOutputStrip';
import { useLiveWsPixels } from '../api/liveWsPixels';
import { swatchesForEntry } from '../lib/liveOutputSwatches';
import { effectToPreview } from '../lib/effectPreview';
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

// Quick primary + white swatches for the main control (palettes live in
// Advanced). W maps to the dedicated white channel on RGBW strips.
const QUICK_COLORS: { label: string; name: string; rgb: number[]; swatch: string; text: string }[] = [
  { label: 'R', name: 'Red', rgb: [255, 0, 0], swatch: '#ff3b3b', text: '#2a0000' },
  { label: 'G', name: 'Green', rgb: [0, 255, 0], swatch: '#37d84a', text: '#002a06' },
  { label: 'B', name: 'Blue', rgb: [0, 0, 255], swatch: '#3b6bff', text: '#00082a' },
  { label: 'W', name: 'White', rgb: [255, 255, 255], swatch: '#ffffff', text: '#333333' },
  // Black = off for that color slot — the hue wheel can't reach pure black, so
  // this is the way to switch part of a look off when building a theme.
  { label: 'K', name: 'Black (off)', rgb: [0, 0, 0], swatch: '#000000', text: '#9a9ca4' }
];

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

  // "Has a real white channel" — drives whether White uses the dedicated W
  // channel ([0,0,0,255]) or RGB white ([255,255,255]). info.leds.rgbw can be
  // true even when no segment actually outputs white (e.g. an RGB strip on an
  // RGBW-capable build), which makes a [0,0,0,255] white render as black. The
  // per-segment light capability (seglc, bit 1 = white) is authoritative; fall
  // back to the rgbw flag only when the firmware doesn't report seglc.
  const anyRgbw = controllerIds.some((id) => {
    const leds = live.get(id)?.info?.leds;
    if (!leds) return false;
    if (Array.isArray(leds.seglc) && leds.seglc.length > 0) {
      return leds.seglc.some((lc) => (lc & 0x02) !== 0);
    }
    return leds.rgbw === true;
  });
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

  // For a single on+reachable controller, preview its REAL live output (the
  // per-pixel WS stream) instead of the archetype approximation — truthful,
  // and it shows the actual effect animation. Multi-target / off falls back to
  // the archetype renderer below.
  const singleEntry = singleControllerId ? live.get(singleControllerId) : undefined;
  const singleHost = singleControllerId ? controllers.find((c) => c.id === singleControllerId)?.host : undefined;
  const showLivePreview = !!singleEntry?.reachable && !!singleEntry.state?.on && !!singleHost;
  const livePreviewHosts = useMemo(
    () => (showLivePreview && singleHost ? [singleHost] : []),
    [showLivePreview, singleHost]
  );
  const livePreviewPixels = useLiveWsPixels(livePreviewHosts);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Targets currently driven by realtime data (e.g. HyperHDR ambilight) — any
  // change made here is overwritten frame-by-frame until that source stops.
  const liveControlledNames = Array.from(new Set(expanded.map((t) => t.controllerId)))
    .filter((id) => live.get(id)?.info?.live)
    .map((id) => live.get(id)?.info?.name || controllers.find((c) => c.id === id)?.name || id);

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
    if (!Array.isArray(c)) return '#000000';
    // Fold the white channel into the RGB approximation so a dedicated-white
    // color (e.g. [0,0,0,255] on a true RGBW strip) previews as white, not black.
    const w = c[3] ?? 0;
    return rgbToHex([
      Math.min(255, (c[0] ?? 0) + w),
      Math.min(255, (c[1] ?? 0) + w),
      Math.min(255, (c[2] ?? 0) + w)
    ]);
  };
  const color0 = eff.colors[0];
  const centerHex = Array.isArray(color0) ? slotHex(0) : '#ffffff';
  const briValue = typeof eff.bri === 'number' ? eff.bri : 128;
  const briPct = Math.round((briValue / 255) * 100);
  const slotHexes = [0, 1, 2].map(slotHex);
  const litHexes = slotHexes.filter((_, i) => {
    const c = eff.colors[i];
    // Include a slot with only a white channel set — otherwise a pure-white
    // color drops out and the preview falls back to the placeholder.
    return Array.isArray(c) && (c[0] || c[1] || c[2] || c[3]);
  });
  // Lit slots win; if colors are defined but all black (e.g. the "K"/off
  // quick-color), preview black rather than the teal placeholder; only fall
  // back to teal when there's no color info at all.
  const anyColorDefined = eff.colors.some((c) => Array.isArray(c) && c.length > 0);
  const previewColors =
    litHexes.length > 0 ? litHexes.join(',') : anyColorDefined ? '#000000' : '#2ee6c0';
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

        {liveControlledNames.length > 0 && (
          <div className="cs-live-note" role="status">
            <strong>Live-controlled:</strong> {liveControlledNames.join(', ')} {liveControlledNames.length > 1 ? 'are' : 'is'} being
            driven by realtime data (e.g. HyperHDR) — changes here are overwritten until that stops.
          </div>
        )}

        {/* Preview: the device's real per-pixel output when it's a single
            on controller (truthful, shows the actual effect), otherwise the
            archetype approximation of the selected look. */}
        <div className="cs-preview-well">
          {showLivePreview && singleEntry ? (
            <LiveOutputStrip
              swatches={swatchesForEntry(singleEntry, singleHost ? livePreviewPixels.get(singleHost) : undefined)}
              className="cs-preview-live-strip"
            />
          ) : (
            <LedPreview
              effect={previewEffect}
              colors={previewColors}
              count={singleCount ?? 48}
              speed={0.9}
              className="cs-preview-canvas"
              ariaLabel="Live preview"
            />
          )}
        </div>

        {/* Two-column control: color wheel + palettes | effect chips + brightness. */}
        <div className="cs-main">
          <div className="cs-main-left">
            <ConicColorWheel colorHex={centerHex} onPick={(rgb) => setSlotColor(0, rgb)} size={210} />
            <div className="cs-quick-colors" role="group" aria-label="Quick colors">
              {QUICK_COLORS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="cs-quick-color"
                  style={{ background: q.swatch, color: q.text }}
                  aria-label={`Set ${q.name}`}
                  title={q.name}
                  onClick={() => setSlotColor(0, q.label === 'W' && anyRgbw ? [0, 0, 0, 255] : q.rgb)}
                >
                  {q.label}
                </button>
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
                onColorChange={setSlotColor} onCctChange={setCct} showWheel={false} />
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
