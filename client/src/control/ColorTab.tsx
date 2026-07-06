import { useState } from 'react';
import type { FxMeta } from '../api/client';
import type { AggregatedControlState } from './controlState';
import { ColorWheel } from '../components/ui/ColorWheel';
import { Slider } from '../components/ui/Slider';
import { Chip } from '../components/ui/Chip';
import { kelvinToRgb, rgbToHex, hexToRgb } from '../lib/color';
import { getRecentColors, pushRecentColor } from '../lib/recentColors';

const KELVIN_PRESETS = [2700, 3500, 5000, 6500] as const;
const DEFAULT_SLOT_LABELS = ['Fx', 'Bg', 'Cs'] as const;
const CHANNELS = [
  { label: 'Red', index: 0 },
  { label: 'Green', index: 1 },
  { label: 'Blue', index: 2 }
] as const;

export interface ColorTabProps {
  agg: AggregatedControlState;
  fxMeta: FxMeta | null;
  anyRgbw: boolean;
  cctSupported: boolean;
  onColorChange: (slot: number, rgb: number[]) => void;
  onCctChange: (cct: number) => void;
}

export function ColorTab({ agg, fxMeta, anyRgbw, cctSupported, onColorChange, onCctChange }: ColorTabProps) {
  const labels: (string | null)[] = (fxMeta?.colorLabels ?? [...DEFAULT_SLOT_LABELS]).map(
    (label, i) => (label === '!' ? DEFAULT_SLOT_LABELS[i] : label)
  );
  const visibleSlots = [0, 1, 2].filter((i) => labels[i] != null);

  const [activeSlotRaw, setActiveSlot] = useState(0);
  const [hexDraft, setHexDraft] = useState('');
  const [recent, setRecent] = useState<string[]>(() => getRecentColors());

  const slot = visibleSlots.includes(activeSlotRaw) ? activeSlotRaw : (visibleSlots[0] ?? 0);
  const current = agg.colors[slot];
  const rgb = Array.isArray(current) ? current : null;
  const wheelColor = rgb
    ? { r: rgb[0] ?? 0, g: rgb[1] ?? 0, b: rgb[2] ?? 0 }
    : { r: 255, g: 255, b: 255 };

  const emit = (nextRgb: number[], remember = false) => {
    const value = anyRgbw ? [...nextRgb.slice(0, 3), rgb?.[3] ?? 0] : nextRgb.slice(0, 3);
    onColorChange(slot, value);
    if (remember) setRecent(pushRecentColor(rgbToHex(value)));
  };

  const commitHex = () => {
    const parsed = hexToRgb(hexDraft);
    if (!parsed) return;
    emit(parsed, true);
    setHexDraft('');
  };

  const setChannel = (index: number, value: number) => {
    const base = rgb ? [...rgb] : [0, 0, 0];
    base[index] = value;
    emit(base);
  };

  const setWhite = (value: number) => {
    const base = rgb ? [...rgb.slice(0, 3)] : [0, 0, 0];
    onColorChange(slot, [...base, value]);
  };

  return (
    <div className="color-tab">
      {/* Two columns side by side once the drawer is wide enough (see
          .color-tab in control.css) — wheel+slots on the left, everything
          else on the right, instead of one long vertical stack. */}
      <div className="color-tab-wheel-col">
        <div className="slot-row">
          {visibleSlots.map((i) => {
            const slotValue = agg.colors[i];
            const swatch = Array.isArray(slotValue)
              ? `rgb(${slotValue[0] ?? 0}, ${slotValue[1] ?? 0}, ${slotValue[2] ?? 0})`
              : 'transparent';
            return (
              <button key={i} type="button"
                className={i === slot ? 'slot-swatch active' : 'slot-swatch'}
                style={{ background: swatch }}
                onClick={() => setActiveSlot(i)}>
                {labels[i]}
              </button>
            );
          })}
          {current === 'mixed' && <Chip variant="warning">Mixed</Chip>}
        </div>

        <ColorWheel color={wheelColor} onChange={(c) => emit([c.r, c.g, c.b])} />
      </div>

      <div className="color-tab-controls-col">
        <div className="hex-row">
          <input aria-label="hex color" className="input" placeholder="#rrggbb"
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitHex(); }}
            onBlur={() => { if (hexDraft !== '') commitHex(); }} />
        </div>

        {/* Kit Slider takes a plain number — mixed/unknown slots fall back to
            128 (write-only until the user drags; the Mixed chip above
            signals the state). */}
        {CHANNELS.map(({ label, index }) => (
          <Slider key={label} label={label} min={0} max={255}
            value={rgb ? (rgb[index] ?? 0) : 128}
            onChange={(v) => setChannel(index, v)} />
        ))}
        {anyRgbw && (
          <Slider label="White" min={0} max={255}
            value={rgb ? (rgb[3] ?? 0) : 128}
            onChange={setWhite} />
        )}
        {cctSupported && (
          <Slider label="CCT" min={0} max={255}
            value={typeof agg.cct === 'number' ? agg.cct : 128}
            onChange={onCctChange} />
        )}

        <div className="kelvin-chips">
          {KELVIN_PRESETS.map((kelvin) => (
            <button key={kelvin} type="button" className="kelvin-chip"
              onClick={() => emit([...kelvinToRgb(kelvin)], true)}>
              {kelvin}K
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="recent-colors">
            {recent.map((hex) => (
              <button key={hex} type="button" className="swatch" aria-label={`recent color ${hex}`}
                style={{ background: hex }}
                onClick={() => { const parsed = hexToRgb(hex); if (parsed) emit(parsed); }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
