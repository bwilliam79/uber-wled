import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PalettesTab } from '../../control/PalettesTab';
import { CAPS_A, CAPS_B } from '../fixtures/capabilities';
import { mergePalettes, type AggregatedControlState } from '../../control/controlState';
import type { ControllerCapabilities } from '../../api/client';

const caps = new Map<string, ControllerCapabilities>([['cA', CAPS_A], ['cB', CAPS_B]]);
const PALETTES = mergePalettes(['cA', 'cB'], caps);

function makeAgg(overrides: Partial<AggregatedControlState> = {}): AggregatedControlState {
  return {
    hasData: true, anyUnreachable: false, power: 'on', bri: 128,
    transition: 7, fxName: 'Blink', palName: 'Default',
    colors: [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0]],
    sx: 100, ix: 50, c1: 0, c2: 0, c3: 0,
    o1: false, o2: false, o3: false, cct: 127, nl: null,
    ...overrides
  };
}

describe('PalettesTab', () => {
  it('renders gradient previews from real palx stops (Fire ends white-hot)', () => {
    render(<PalettesTab palettes={PALETTES} agg={makeAgg()} onSelectPalette={vi.fn()} />);
    const fireRow = screen.getByRole('button', { name: /Fire/ });
    const preview = fireRow.querySelector('.palette-preview')!;
    const gradient = preview.getAttribute('data-gradient')!;
    expect(gradient).toContain('linear-gradient(90deg');
    expect(gradient).toContain('rgb(255, 255, 255) 100%');
  });

  it('badges random palettes', () => {
    render(<PalettesTab palettes={PALETTES} agg={makeAgg()} onSelectPalette={vi.fn()} />);
    expect(screen.getByRole('button', { name: /\* Random Cycle/ }).textContent).toContain('Random');
  });

  it('renders slot palettes from the current slot colors', () => {
    render(<PalettesTab palettes={PALETTES} agg={makeAgg()} onSelectPalette={vi.fn()} />);
    const row = screen.getByRole('button', { name: /\* Color Gradient/ });
    const gradient = row.querySelector('.palette-preview')!.getAttribute('data-gradient')!;
    // slots ['c3','c2','c1'] → blue band, green band, red band
    expect(gradient).toBe(
      'linear-gradient(90deg, rgb(0, 0, 255) 0% 33%, rgb(0, 255, 0) 33% 67%, rgb(255, 0, 0) 67% 100%)'
    );
    expect(row.textContent).toContain('Not on all'); // CAPS_B lacks this palette
  });

  it('filters by search and applies by name', () => {
    const onSelectPalette = vi.fn();
    render(<PalettesTab palettes={PALETTES} agg={makeAgg()} onSelectPalette={onSelectPalette} />);
    fireEvent.change(screen.getByLabelText('Search palettes'), { target: { value: 'fire' } });
    expect(screen.queryByRole('button', { name: /Default/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Fire/ }));
    expect(onSelectPalette).toHaveBeenCalledWith('Fire');
  });

  it('notes mixed palettes', () => {
    render(<PalettesTab palettes={PALETTES} agg={makeAgg({ palName: 'mixed' })} onSelectPalette={vi.fn()} />);
    expect(screen.getByText(/different palettes/)).toBeTruthy();
  });
});
