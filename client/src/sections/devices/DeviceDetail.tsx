import type { Controller } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { cachedDeviceName } from '../../lib/deviceNames';
import { useEffect, useRef } from 'react';
import { Chip } from '../../components/ui/Chip';
import { Tabs } from '../../components/ui/Tabs';
import { ConfigTab } from './ConfigTab';
import { DevicePresetsTab } from './DevicePresetsTab';
import { InfoTab } from './InfoTab';
import { SegmentsTab } from './SegmentsTab';
import { UpdateTab } from './UpdateTab';
import type { DeviceTab } from './route';
import './devices.css';

export interface DeviceDetailProps {
  controller: Controller;
  live: LiveStatusEntry | undefined;
  tab: DeviceTab;
  onTabChange: (tab: DeviceTab) => void;
  onBack: () => void;
}

const TAB_ITEMS: { id: DeviceTab; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'segments', label: 'Segments' },
  { id: 'presets', label: 'Presets' },
  { id: 'config', label: 'Config' },
  { id: 'update', label: 'Update' }
];

export function DeviceDetail({ controller, live, tab, onTabChange, onBack }: DeviceDetailProps) {
  const ledCount = live?.info?.leds.count ?? 0;
  const maxSeg = live?.info?.leds.maxseg ?? 32;
  // Same reasoning as DeviceCard: controller.name is frozen at add/discovery
  // time (often a raw mDNS service name); prefer the live device-reported
  // name so this header stays consistent with the card the user just clicked.
  const displayName = live?.info?.name || cachedDeviceName(controller.id) || controller.name;
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selected = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selected?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [tab]);

  return (
    <div className="device-detail">
      <header className="device-detail-header">
        <nav className="device-breadcrumb" aria-label="Breadcrumb">
          <button type="button" className="device-back" onClick={onBack} aria-label="Back to devices">
            Devices
          </button>
          <span aria-hidden="true">/</span>
          <span>Controller</span>
        </nav>
        <div className="device-detail-titles">
          <h2>{displayName}</h2>
          <p className="device-card-host">
            <span className="ui-mono">{controller.host}</span>
            <button
              type="button"
              className="device-copy-host"
              aria-label={`Copy host ${controller.host}`}
              onClick={() => { void navigator.clipboard?.writeText(controller.host); }}
            >
              Copy
            </button>
          </p>
        </div>
        {live === undefined
          ? <Chip>Checking</Chip>
          : live.reachable
            ? <Chip variant="success">Online</Chip>
            : <Chip variant="danger">Offline</Chip>}
      </header>
      <div ref={tabsRef}>
        <Tabs label="Device tabs" tabs={TAB_ITEMS} active={tab}
          onChange={(id) => onTabChange(id as DeviceTab)} />
      </div>
      {tab === 'info' && <InfoTab controller={controller} live={live} onRemoved={onBack} />}
      {tab === 'segments' && (
        <SegmentsTab controllerId={controller.id} ledCount={ledCount} maxSeg={maxSeg} />
      )}
      {tab === 'presets' && <DevicePresetsTab controllerId={controller.id} />}
      {tab === 'config' && <ConfigTab controllerId={controller.id} />}
      {tab === 'update' && <UpdateTab controllerId={controller.id} />}
    </div>
  );
}
