import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorTab } from '../../control/ColorTab';
import { FX_BLINK } from '../fixtures/capabilities';
import type { AggregatedControlState } from '../../control/controlState';

vi.mock('../../components/ui/ConicColorWheel', () => ({
  ConicColorWheel: ({ colorHex }: { colorHex: string }) => (
    <div data-testid="color-wheel-mock" data-color={colorHex} />
  )
}));

function makeAgg(overrides: Partial<AggregatedControlState> = {}): AggregatedControlState {
  return {
    hasData: true, anyUnreachable: false, power: 'on', bri: 128,
    transition: 7, fxName: 'Blink', palName: 'Default',
    colors: [[255, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    sx: 100, ix: 50, c1: 0, c2: 0, c3: 0,
    o1: false, o2: false, o3: false, cct: 127,
    nl: { on: false, dur: 60, mode: 1, tbri: 0 },
    ...overrides
  };
}

describe('ColorTab', () => {
  beforeEach(() => localStorage.clear());

  it('shows only the slots the selected effect defines (Blink: Fx + Bg, no Cs)', () => {
    render(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={false} cctSupported={false}
      onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Fx' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bg' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cs' })).toBeNull();
  });

  it('shows all three default slots when no effect meta is available', () => {
    render(<ColorTab agg={makeAgg()} fxMeta={null} anyRgbw={false} cctSupported={false}
      onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cs' })).toBeTruthy();
  });

  it('flags a mixed active slot and feeds the wheel a neutral color', () => {
    render(<ColorTab agg={makeAgg({ colors: ['mixed', null, null] })} fxMeta={FX_BLINK}
      anyRgbw={false} cctSupported={false} onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.getByText('Mixed')).toBeTruthy();
    expect(screen.getByTestId('color-wheel-mock').getAttribute('data-color')).toBe('#ffffff');
  });

  it('applies a committed hex value to the active slot, preserving the white channel, and records a recent color', () => {
    const onColorChange = vi.fn();
    render(<ColorTab agg={makeAgg({ colors: [[10, 20, 30, 99], [0, 0, 0, 0], [0, 0, 0, 0]] })}
      fxMeta={FX_BLINK} anyRgbw={true} cctSupported={false}
      onColorChange={onColorChange} onCctChange={vi.fn()} />);
    const hex = screen.getByLabelText('hex color');
    fireEvent.change(hex, { target: { value: '#ffa757' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onColorChange).toHaveBeenCalledWith(0, [255, 167, 87, 99]);
    expect(JSON.parse(localStorage.getItem('uber-wled.recent-colors')!)).toContain('#ffa757');
  });

  it('kelvin quick chips map through kelvinToRgb', () => {
    const onColorChange = vi.fn();
    render(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={false} cctSupported={false}
      onColorChange={onColorChange} onCctChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '2700K' }));
    expect(onColorChange).toHaveBeenCalledWith(0, [255, 167, 87]);
  });

  it('renders the RGB sliders and routes edits to the active slot', () => {
    const onColorChange = vi.fn();
    render(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={false} cctSupported={false}
      onColorChange={onColorChange} onCctChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Green'), { target: { value: '200' } });
    expect(onColorChange).toHaveBeenCalledWith(0, [255, 200, 0]);
  });

  it('shows the white slider only for RGBW targets and the CCT slider only when supported', () => {
    const { rerender } = render(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={false}
      cctSupported={false} onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.queryByLabelText('White')).toBeNull();
    expect(screen.queryByLabelText('CCT')).toBeNull();
    rerender(<ColorTab agg={makeAgg()} fxMeta={FX_BLINK} anyRgbw={true} cctSupported={true}
      onColorChange={vi.fn()} onCctChange={vi.fn()} />);
    expect(screen.getByLabelText('White')).toBeTruthy();
    expect(screen.getByLabelText('CCT')).toBeTruthy();
  });
});
