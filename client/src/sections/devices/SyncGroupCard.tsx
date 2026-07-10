import { useMemo, useRef, useState } from 'react';
import { applyControl, type Controller, type Target } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { Chip } from '../../components/ui/Chip';
import { Slider } from '../../components/ui/Slider';
import { throttle } from '../../lib/throttle';
import { SyncIcon } from '../../components/icons';
import './devices.css';

const BRIGHTNESS_THROTTLE_MS = 120;

export interface SyncGroupCardProps {
  name: string;
  members: Controller[];
  live: ReadonlyMap<string, LiveStatusEntry>;
  onControl: (targets: Target[]) => void;
}

/**
 * A card for an *active* sync group on the Devices page: aggregate power +
 * brightness and a Control button, all fanned out to the group's member
 * controllers (they move together anyway via WLED's native UDP sync).
 */
export function SyncGroupCard({ name, members, live, onControl }: SyncGroupCardProps) {
  const targets: Target[] = useMemo(
    () => members.map((c) => ({ kind: 'controller', controllerId: c.id })),
    [members]
  );

  const entries = members.map((c) => live.get(c.id));
  const anyOn = entries.some((e) => e?.state?.on);
  const briVals = entries
    .map((e) => e?.state?.bri)
    .filter((b): b is number => typeof b === 'number');
  const avgBri = briVals.length ? Math.round(briVals.reduce((a, b) => a + b, 0) / briVals.length) : 0;

  // Optimistic override so the control feels instant; live SSE reconciles it.
  const [override, setOverride] = useState<{ on?: boolean; bri?: number }>({});
  const on = override.on ?? anyOn;
  const bri = override.bri ?? avgBri;
  const briPct = Math.round((bri / 255) * 100);

  const pushBri = useRef(
    throttle((v: number) => {
      applyControl(targets, { bri: v }).catch(() => {});
    }, BRIGHTNESS_THROTTLE_MS)
  ).current;

  function togglePower() {
    const next = !on;
    setOverride((o) => ({ ...o, on: next }));
    applyControl(targets, { on: next }).catch(() => {});
  }
  function setBrightness(v: number) {
    setOverride((o) => ({ ...o, bri: v }));
    pushBri(v);
  }

  const memberNames = members.map((c) => live.get(c.id)?.info?.name || c.name).join(', ');

  return (
    <div className="device-card ui-card sync-card">
      <div className="device-card-top">
        <div className="device-card-title sync-card-title">
          <SyncIcon className="sync-card-icon" />
          <span className="device-card-name">{name}</span>
          <Chip variant="accent">Synced</Chip>
        </div>
        <button
          type="button"
          className={`device-toggle${on ? ' on' : ''}`}
          role="switch"
          aria-checked={on}
          aria-label={`Power for ${name}`}
          onClick={togglePower}
        >
          <span className="device-toggle-knob" />
        </button>
      </div>

      <p className="device-card-meta ui-mono">
        {members.length} controller{members.length === 1 ? '' : 's'} · {memberNames}
      </p>

      <div className="device-card-controls">
        <Slider
          min={0}
          max={255}
          value={bri}
          onChange={setBrightness}
          label={`Brightness for ${name}`}
          disabled={!on}
        />
        <span className="device-card-bri ui-mono">{briPct}%</span>
      </div>

      <div className="device-card-status">
        <Chip variant={on ? 'success' : 'default'}>{on ? 'On' : 'Off'}</Chip>
        <button
          type="button"
          className="device-card-open"
          onClick={() => onControl(targets)}
          aria-label={`Control ${name}`}
        >
          Control
        </button>
      </div>
    </div>
  );
}
