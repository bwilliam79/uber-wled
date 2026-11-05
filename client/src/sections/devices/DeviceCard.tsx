import { useMemo, useRef, useState } from 'react';
import { applyControl, type Controller, type Target } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { useLiveWsPixels } from '../../api/liveWsPixels';
import { useFirmwareStatus } from '../../api/queries';
import { Chip } from '../../components/ui/Chip';
import { Slider } from '../../components/ui/Slider';
import { LiveOutputStrip } from '../../components/ui/LiveOutputStrip';
import { swatchesForEntry } from '../../lib/liveOutputSwatches';
import { cachedDeviceName } from '../../lib/deviceNames';
import { throttle } from '../../lib/throttle';
import { ChevronRightIcon } from '../../components/icons';
import './devices.css';

export interface DeviceCardProps {
  controller: Controller;
  live: LiveStatusEntry | undefined;
  onControl: (controllerId: string) => void;
  onOpen: (controllerId: string) => void;
}

const BRIGHTNESS_THROTTLE_MS = 120;

export function DeviceCard({ controller, live, onControl, onOpen }: DeviceCardProps) {
  const firmware = useFirmwareStatus(controller.id);
  const info = live?.info;
  const state = live?.state;
  const offline = live !== undefined && !live.reachable;
  // Prefer the live device-reported name over the frozen add/discovery name;
  // the cache bridges the gap before the live stream connects (no flash).
  const displayName = info?.name || cachedDeviceName(controller.id) || controller.name;

  const litHosts = useMemo(
    () => (live?.reachable && live.state?.on ? [controller.host] : []),
    [live?.reachable, live?.state?.on, controller.host]
  );
  const livePixelsByHost = useLiveWsPixels(litHosts);
  const livePixels = livePixelsByHost.get(controller.host);

  const target: Target[] = useMemo(
    () => [{ kind: 'controller', controllerId: controller.id }],
    [controller.id]
  );

  // Optimistic power/brightness so the control feels instant; the live SSE
  // reconciles it on the next status frame.
  const [override, setOverride] = useState<{ on?: boolean; bri?: number }>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const on = override.on ?? state?.on ?? false;
  const bri = override.bri ?? state?.bri ?? 0;
  const briPct = Math.round((bri / 255) * 100);

  const pushBri = useRef(
    throttle((v: number) => {
      applyControl(target, { bri: v }).catch(() => {});
    }, BRIGHTNESS_THROTTLE_MS)
  ).current;

  function togglePower() {
    const next = !on;
    setOverride((o) => ({ ...o, on: next }));
    applyControl(target, { on: next }).catch(() => {});
  }

  function setBrightness(v: number) {
    setOverride((o) => ({ ...o, bri: v }));
    pushBri(v);
  }

  return (
    <div className={`device-card ui-card${offline ? ' device-card-offline' : ''}`}>
      <div className="device-card-top">
        <button
          type="button"
          className="device-card-title"
          onClick={() => onOpen(controller.id)}
          aria-label={`Open ${displayName}`}
        >
          <span className="device-card-name">{displayName}</span>
          <ChevronRightIcon className="device-card-chevron" />
        </button>
        <button
          type="button"
          className={`device-toggle${on ? ' on' : ''}`}
          role="switch"
          aria-checked={on}
          aria-label={`Power for ${displayName}`}
          disabled={offline}
          onClick={togglePower}
        >
          <span className="device-toggle-knob" />
        </button>
      </div>

      <button
        type="button"
        className="device-card-strip-well"
        onClick={() => onOpen(controller.id)}
        aria-label={`Open live view for ${displayName}`}
      >
        <LiveOutputStrip
          swatches={swatchesForEntry(live, livePixels)}
          size="sm"
          className="device-card-live-strip"
        />
      </button>

      <div className="device-card-controls">
        <Slider
          min={0}
          max={255}
          value={bri}
          onChange={setBrightness}
          label={`Brightness for ${displayName}`}
          disabled={offline || !on}
        />
        <span className="device-card-bri ui-mono">{briPct}%</span>
      </div>

      <div className="device-card-status">
        {offline ? (
          <Chip variant="danger">Offline</Chip>
        ) : live === undefined ? (
          <Chip>Checking</Chip>
        ) : (
          <Chip variant="success">Online</Chip>
        )}
        {!offline && controller.stale && <Chip variant="warning">Stale</Chip>}
        {!offline && info?.live && (
          <Chip
            variant="accent"
            title={`Driven by realtime data${info.lip ? ` from ${info.lip}` : ''}${info.lm ? ` (${info.lm})` : ''} — app changes are overwritten while this is active`}
          >
            Live
          </Chip>
        )}
        {firmware.data?.updateAvailable && <Chip variant="warning">Update</Chip>}
        <button
          type="button"
          className="device-card-open"
          onClick={() => onControl(controller.id)}
          aria-label={`Control ${displayName}`}
        >
          Control
        </button>
      </div>
      <button
        type="button"
        className="device-card-details"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        Details
      </button>
      {detailsOpen && (
        <div className="device-card-details-body">
          <p className="device-card-meta ui-mono">
            {controller.host}
            {info?.leds.count !== undefined && <> · {info.leds.count} px</>}
            {info?.ver && <> · {info.ver}</>}
          </p>
          {info?.leds.fps !== undefined && !offline && (
            <p className="device-card-fps ui-mono">{info.leds.fps} FPS</p>
          )}
        </div>
      )}
    </div>
  );
}
