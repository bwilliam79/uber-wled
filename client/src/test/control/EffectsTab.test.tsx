import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EffectsTab } from '../../control/EffectsTab';
import { CAPS_A, CAPS_B } from '../fixtures/capabilities';
import { mergeEffects, type AggregatedControlState } from '../../control/controlState';
import type { ControllerCapabilities } from '../../api/client';

const caps = new Map<string, ControllerCapabilities>([['cA', CAPS_A], ['cB', CAPS_B]]);
const EFFECTS = mergeEffects(['cA', 'cB'], caps);

function makeAgg(overrides: Partial<AggregatedControlState> = {}): AggregatedControlState {
  return {
    hasData: true, anyUnreachable: false, power: 'on', bri: 128,
    transition: 7, fxName: 'Blink', palName: 'Default',
    colors: [[255, 0, 0, 0], null, null],
    sx: 100, ix: 50, c1: 0, c2: 0, c3: 0,
    o1: false, o2: false, o3: false, cct: 127,
    nl: null,
    ...overrides
  };
}

describe('EffectsTab', () => {
  it('lists union effects with 2D, Audio and Not-on-all badges from FxMeta flags', () => {
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: null })}
      onSelectEffect={vi.fn()} onParamChange={vi.fn()} onOptionChange={vi.fn()} />);
    const spaceships = screen.getByRole('button', { name: /Spaceships/ });
    expect(spaceships.textContent).toContain('2D');
    expect(spaceships.textContent).toContain('Not on all'); // only CAPS_A has it
    const pixels = screen.getByRole('button', { name: /Pixels/ });
    expect(pixels.textContent).toContain('Audio'); // flags include 'v'
    expect(screen.queryByText('RSVD')).toBeNull();
  });

  it('filters by search text', () => {
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: null })}
      onSelectEffect={vi.fn()} onParamChange={vi.fn()} onOptionChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search effects'), { target: { value: 'twink' } });
    expect(screen.getByRole('button', { name: /Colortwinkles/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Blink/ })).toBeNull();
  });

  it('applies an effect by NAME on click', () => {
    const onSelectEffect = vi.fn();
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: null })}
      onSelectEffect={onSelectEffect} onParamChange={vi.fn()} onOptionChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Colortwinkles/ }));
    expect(onSelectEffect).toHaveBeenCalledWith('Colortwinkles');
  });

  it('renders the selected effect\'s FxMeta sliders with real labels seeded from live state', () => {
    const onParamChange = vi.fn();
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: 'Blink', sx: 100, ix: 50 })}
      onSelectEffect={vi.fn()} onParamChange={onParamChange} onOptionChange={vi.fn()} />);
    const speed = screen.getByLabelText('Effect speed') as HTMLInputElement; // sx '!' → default label
    expect(speed.value).toBe('100');
    const duty = screen.getByLabelText('Duty cycle') as HTMLInputElement; // ix real label
    expect(duty.value).toBe('50');
    expect(screen.queryByLabelText('Custom 1')).toBeNull(); // Blink defines no c1
    fireEvent.change(duty, { target: { value: '80' } });
    expect(onParamChange).toHaveBeenCalledWith('ix', 80);
  });

  it('renders option toggles for effects that define them (Spaceships → Smear)', () => {
    const onOptionChange = vi.fn();
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: 'Spaceships' })}
      onSelectEffect={vi.fn()} onParamChange={vi.fn()} onOptionChange={onOptionChange} />);
    fireEvent.click(screen.getByLabelText('Smear'));
    expect(onOptionChange).toHaveBeenCalledWith('o1', true);
  });

  it('shows a mixed note and no dynamic controls when effects disagree', () => {
    render(<EffectsTab effects={EFFECTS} agg={makeAgg({ fxName: 'mixed' })}
      onSelectEffect={vi.fn()} onParamChange={vi.fn()} onOptionChange={vi.fn()} />);
    expect(screen.getByText(/different effects/)).toBeTruthy();
    expect(screen.queryByLabelText('Effect speed')).toBeNull();
  });
});
