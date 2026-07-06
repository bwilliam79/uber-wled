import { useMemo } from 'react';
import type { Controller } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { useLiveWsPixels } from '../../api/liveWsPixels';
import { useFirmwareStatus } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { LiveOutputStrip } from '../../components/ui/LiveOutputStrip';
import { swatchesForEntry } from '../../lib/liveOutputSwatches';
import { humanizeUptime, signalBars } from './format';
import './devices.css';

export interface DeviceCardProps {
  controller: Controller;
  live: LiveStatusEntry | undefined;
  onControl: (controllerId: string) => void;
  onOpen: (controllerId: string) => void;
}

function SignalBars({ signal }: { signal: number }) {
  const bars = signalBars(signal);
  return (
    <span className="signal-bars" role="img" aria-label={`WiFi signal ${bars} of 4 bars`}>
      {[1, 2, 3, 4].map((level) => (
        <span key={level} className={level <= bars ? 'signal-bar signal-bar-on' : 'signal-bar'} />
      ))}
    </span>
  );
}

export function DeviceCard({ controller, live, onControl, onOpen }: DeviceCardProps) {
  const firmware = useFirmwareStatus(controller.id);
  const info = live?.info;
  const state = live?.state;
  const offline = live !== undefined && !live.reachable;

  const litHosts = useMemo(
    () => (live?.reachable && live.state?.on ? [controller.host] : []),
    [live?.reachable, live?.state?.on, controller.host]
  );
  const livePixelsByHost = useLiveWsPixels(litHosts);
  const livePixels = livePixelsByHost.get(controller.host);

  return (
    <Card className="device-card">
      <div className="device-card-header">
        <button type="button" className="device-card-title"
          onClick={() => onOpen(controller.id)} aria-label={`Open ${controller.name}`}>
          {controller.name}
        </button>
        {info?.ver && <Chip>v{info.ver}</Chip>}
        {offline && <Chip variant="danger">Offline</Chip>}
        {!offline && controller.stale && <Chip variant="warning">Stale</Chip>}
        {firmware.data?.updateAvailable && <Chip variant="warning">Update available</Chip>}
      </div>
      <p className="device-card-host">{controller.host}</p>
      <div className="device-card-live">
        {state && <Chip variant={state.on ? 'success' : 'default'}>{state.on ? 'On' : 'Off'}</Chip>}
        {info?.wifi && <SignalBars signal={info.wifi.signal} />}
        {info?.leds.fps !== undefined && (
          <span className="device-card-metric">{info.leds.fps} FPS</span>
        )}
        {info?.uptime !== undefined && (
          <span className="device-card-metric">Up {humanizeUptime(info.uptime)}</span>
        )}
      </div>
      <LiveOutputStrip swatches={swatchesForEntry(live, livePixels)} size="sm" className="device-card-live-strip" />
      <div className="device-card-actions">
        <Button variant="primary" size="sm" onClick={() => onControl(controller.id)}
          aria-label={`Control ${controller.name}`}>
          Control
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onOpen(controller.id)}
          aria-label={`Details for ${controller.name}`}>
          Details
        </Button>
      </div>
    </Card>
  );
}
