import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StripCanvas } from '../../components/StripCanvas';
import type { Strip } from '../../api/client';

const strips: Strip[] = [
  { id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], label: 'Porch' },
  { id: 's2', controllerId: 'c2', wledSegId: 0, points: [{ x: 60, y: 60 }, { x: 90, y: 60 }], label: null }
];

describe('StripCanvas', () => {
  it('renders one polyline per strip and selects a strip on click', () => {
    const onSelectionChange = vi.fn();
    render(<StripCanvas strips={strips} selected={new Set()} staleControllerIds={new Set()} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByTestId('strip-s1'));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['s1']));
  });

  it('marks the selected strip and greys a strip whose controller is stale', () => {
    render(<StripCanvas strips={strips} selected={new Set(['s1'])} staleControllerIds={new Set(['c2'])} onSelectionChange={vi.fn()} />);
    expect(screen.getByTestId('strip-s1').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('strip-s2').getAttribute('data-stale')).toBe('true');
  });

  it('uses the provided live color for a strip stroke', () => {
    render(
      <StripCanvas
        strips={strips}
        selected={new Set()}
        staleControllerIds={new Set()}
        onSelectionChange={vi.fn()}
        liveColors={new Map([['s1', 'rgb(200, 50, 25)']])}
      />
    );
    expect(screen.getByTestId('strip-s1').getAttribute('stroke')).toBe('rgb(200, 50, 25)');
  });
});
