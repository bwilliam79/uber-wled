import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// NOTE: shipped Phase C kit uses `label`, not `ariaLabel`, for Toggle/Slider
// (see components/ui/Toggle.tsx, components/ui/Slider.tsx). Mocks below match
// the real props so HomeTile.tsx is wired against the actual kit contract.
vi.mock('../../../components/ui/Toggle', () => ({
  Toggle: ({ checked, onChange, label, disabled }: any) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
    />
  )
}));
vi.mock('../../../components/ui/Slider', () => ({
  Slider: ({ value, onChange, label, min, max, disabled }: any) => (
    <input
      type="range"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => onChange(Number((e.target as HTMLInputElement).value))}
    />
  )
}));

import { HomeTile, type HomeTileData } from '../../../sections/home/HomeTile';
import type { TileStatusV2 } from '../../../lib/tileStatus';

const TILE: HomeTileData = {
  id: 'g1',
  kind: 'group',
  title: 'Kitchen',
  icon: '🍳',
  members: [{ controllerId: 'c1', wledSegId: 0 }]
};
const STATUS_ON: TileStatusV2 = { power: 'on', brightness: 204, anyOffline: false, allOffline: false };

function renderTile(overrides: Record<string, unknown> = {}) {
  const props = {
    tile: TILE,
    status: STATUS_ON,
    glowColor: 'rgb(128, 40, 0)',
    selectMode: false,
    selected: false,
    onToggleSelect: vi.fn(),
    onLongPress: vi.fn(),
    onOpenControl: vi.fn(),
    onPower: vi.fn(),
    onBrightness: vi.fn(),
    ...overrides
  };
  render(<HomeTile {...(props as any)} />);
  return props;
}

afterEach(() => vi.useRealTimers());

describe('HomeTile', () => {
  it('shows name, icon, power label and brightness percent', () => {
    renderTile();
    expect(screen.getByText('Kitchen')).toBeTruthy();
    expect(screen.getByText('🍳')).toBeTruthy();
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy(); // 204/255
  });

  it('applies the glow color as the --tile-glow inline custom property', () => {
    renderTile();
    const el = screen.getByTestId('home-tile-g1');
    expect(el.style.getPropertyValue('--tile-glow')).toBe('rgb(128, 40, 0)');
  });

  it('opens controls when the body is tapped outside select mode', () => {
    const p = renderTile();
    fireEvent.click(screen.getByRole('button', { name: 'open controls for Kitchen' }));
    expect(p.onOpenControl).toHaveBeenCalledWith(TILE);
  });

  it('toggles selection instead of opening controls in select mode', () => {
    const p = renderTile({ selectMode: true });
    fireEvent.click(screen.getByRole('button', { name: 'open controls for Kitchen' }));
    expect(p.onToggleSelect).toHaveBeenCalledWith('g1');
    expect(p.onOpenControl).not.toHaveBeenCalled();
  });

  it('fires onLongPress after 450ms of pointer hold', () => {
    vi.useFakeTimers();
    const p = renderTile();
    const body = screen.getByRole('button', { name: 'open controls for Kitchen' });
    fireEvent.pointerDown(body, { clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(450); });
    expect(p.onLongPress).toHaveBeenCalledWith('g1');
  });

  it('cancels the long press when the pointer moves more than 10px', () => {
    vi.useFakeTimers();
    const p = renderTile();
    const body = screen.getByRole('button', { name: 'open controls for Kitchen' });
    fireEvent.pointerDown(body, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(body, { clientX: 40, clientY: 10 });
    act(() => { vi.advanceTimersByTime(600); });
    expect(p.onLongPress).not.toHaveBeenCalled();
  });

  it('does not treat the click after a long press as a body tap', () => {
    vi.useFakeTimers();
    const p = renderTile();
    const body = screen.getByRole('button', { name: 'open controls for Kitchen' });
    fireEvent.pointerDown(body, { clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(450); });
    fireEvent.pointerUp(body);
    fireEvent.click(body);
    expect(p.onOpenControl).not.toHaveBeenCalled();
  });

  it('routes power toggle and brightness slider changes to callbacks', () => {
    const p = renderTile();
    fireEvent.click(screen.getByRole('switch', { name: 'power for Kitchen' }));
    expect(p.onPower).toHaveBeenCalledWith(TILE, false);
    fireEvent.change(screen.getByRole('slider', { name: 'brightness for Kitchen' }), {
      target: { value: '90' }
    });
    expect(p.onBrightness).toHaveBeenCalledWith(TILE, 90);
  });

  it('disables quick controls and greys the tile when all members are offline', () => {
    renderTile({
      status: { power: 'unknown', brightness: null, anyOffline: true, allOffline: true },
      glowColor: '#3A3F4B'
    });
    expect((screen.getByRole('switch', { name: 'power for Kitchen' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('home-tile-g1').className).toContain('home-tile-offline');
  });
});
