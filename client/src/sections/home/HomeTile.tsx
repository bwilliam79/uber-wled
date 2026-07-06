import { useRef } from 'react';
import { Toggle } from '../../components/ui/Toggle';
import { Slider } from '../../components/ui/Slider';
import { Chip } from '../../components/ui/Chip';
import { LiveOutputStrip } from '../../components/ui/LiveOutputStrip';
import type { TileStatusV2, TileTargetMember } from '../../lib/tileStatus';
import type { LiveOutputSwatch } from '../../lib/liveOutputSwatches';

export interface HomeTileData {
  id: string; // group id, or controller id for ungrouped tiles
  kind: 'group' | 'controller';
  title: string;
  icon: string | null;
  members: TileTargetMember[];
}

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;

const POWER_LABEL: Record<TileStatusV2['power'], string> = {
  on: 'On',
  off: 'Off',
  mixed: 'Mixed',
  unknown: '—'
};

export function HomeTile({
  tile,
  status,
  glowColor,
  liveSwatches,
  selectMode,
  selected,
  onToggleSelect,
  onLongPress,
  onOpenControl,
  onPower,
  onBrightness
}: {
  tile: HomeTileData;
  status: TileStatusV2;
  glowColor: string;
  liveSwatches: LiveOutputSwatch[];
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onLongPress: (id: string) => void;
  onOpenControl: (tile: HomeTileData) => void;
  onPower: (tile: HomeTileData, on: boolean) => void;
  onBrightness: (tile: HomeTileData, bri: number) => void;
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  function clearPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  }

  function handlePointerDown(e: React.PointerEvent) {
    longPressFired.current = false;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onLongPress(tile.id);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!pressOrigin.current) return;
    if (
      Math.abs(e.clientX - pressOrigin.current.x) > MOVE_CANCEL_PX ||
      Math.abs(e.clientY - pressOrigin.current.y) > MOVE_CANCEL_PX
    ) {
      clearPress();
    }
  }

  function handleBodyActivate() {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (selectMode) onToggleSelect(tile.id);
    else onOpenControl(tile);
  }

  const classes = [
    'home-tile',
    selected ? 'home-tile-selected' : '',
    status.allOffline ? 'home-tile-offline' : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{ '--tile-glow': glowColor } as React.CSSProperties}
      data-testid={`home-tile-${tile.id}`}
    >
      <input
        type="checkbox"
        className="home-tile-select"
        checked={selected}
        aria-label={`select ${tile.title}`}
        onChange={() => onToggleSelect(tile.id)}
      />
      <div
        role="button"
        tabIndex={0}
        className="home-tile-body"
        aria-label={`open controls for ${tile.title}`}
        onClick={handleBodyActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleBodyActivate();
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearPress}
        onPointerLeave={clearPress}
        onPointerCancel={clearPress}
      >
        <div className="home-tile-top">
          {tile.icon && (
            <span className="home-tile-icon" aria-hidden="true">{tile.icon}</span>
          )}
          <span className="home-tile-name">{tile.title}</span>
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
