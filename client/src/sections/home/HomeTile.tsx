import { Toggle } from '../../components/ui/Toggle';
import { Slider } from '../../components/ui/Slider';
import { Chip } from '../../components/ui/Chip';
import { LiveOutputStrip } from '../../components/ui/LiveOutputStrip';
import type { TileStatusV2, TileTargetMember } from '../../lib/tileStatus';
import type { LiveOutputSwatch } from '../../lib/liveOutputSwatches';

export interface HomeTileData {
  id: string; // group id, controller id for ungrouped tiles, or `sync:<id>`
  kind: 'group' | 'controller' | 'sync';
  title: string;
  icon: string | null;
  members: TileTargetMember[];
}

const POWER_LABEL: Record<TileStatusV2['power'], string> = {
  on: 'On',
  off: 'Off',
  mixed: 'Mixed',
  unknown: '—'
};

function statusDotClass(status: TileStatusV2): string {
  // 'unknown' almost always implies allOffline (aggregateTileStatusLive only
  // reports it when every member was skipped as offline) — except a room
  // with zero members, which reports unknown with allOffline: false. Check
  // power first so that empty-room case also reads as neutral, not "off".
  if (status.power === 'unknown' || status.allOffline) return 'home-tile-status-dot-offline';
  if (status.power === 'mixed') return 'home-tile-status-dot-mixed';
  return status.power === 'on' ? 'home-tile-status-dot-on' : 'home-tile-status-dot-off';
}

export function HomeTile({
  tile,
  status,
  liveSwatches,
  onOpenControl,
  onPower,
  onBrightness
}: {
  tile: HomeTileData;
  status: TileStatusV2;
  liveSwatches: LiveOutputSwatch[];
  onOpenControl: (tile: HomeTileData) => void;
  onPower: (tile: HomeTileData, on: boolean) => void;
  onBrightness: (tile: HomeTileData, bri: number) => void;
}) {
  const classes = ['home-tile', status.allOffline ? 'home-tile-offline' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} data-testid={`home-tile-${tile.id}`}>
      <span
        className={`home-tile-status-dot ${statusDotClass(status)}`}
        aria-hidden="true"
        data-testid={`tile-status-dot-${tile.id}`}
      />
      <div
        role="button"
        tabIndex={0}
        className="home-tile-body"
        aria-label={`open controls for ${tile.title}`}
        onClick={() => onOpenControl(tile)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenControl(tile);
          }
        }}
      >
        <div className="home-tile-top">
          {tile.icon && (
            <span className="home-tile-icon" aria-hidden="true">{tile.icon}</span>
          )}
          <span className="home-tile-name">{tile.title}</span>
          {tile.kind === 'sync' && <Chip variant="accent">Sync</Chip>}
          {status.anyOffline && !status.allOffline && <Chip variant="warning">offline</Chip>}
        </div>
        <div className="home-tile-status">
          <span>{POWER_LABEL[status.power]}</span>
          {status.brightness !== null && (
            <span>{Math.round((status.brightness / 255) * 100)}%</span>
          )}
          {status.allOffline && <span>offline</span>}
        </div>
        <LiveOutputStrip swatches={liveSwatches} size="sm" className="home-tile-live" />
      </div>
      <div className="home-tile-controls">
        <Toggle
          checked={status.power === 'on'}
          disabled={status.allOffline}
          label={`power for ${tile.title}`}
          showLabel={false}
          onChange={(next: boolean) => onPower(tile, next)}
        />
        <Slider
          min={1}
          max={255}
          value={status.brightness ?? 128}
          disabled={status.allOffline}
          label={`brightness for ${tile.title}`}
          onChange={(v: number) => onBrightness(tile, v)}
        />
      </div>
    </div>
  );
}
