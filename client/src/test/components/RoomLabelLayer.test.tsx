import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomLabelLayer } from '../../components/RoomLabelLayer';
import type { RoomLabel } from '../../api/client';

const labels: RoomLabel[] = [{ id: 'r1', name: 'Kitchen', x: 20, y: 30 }];

describe('RoomLabelLayer', () => {
  it('renders each label at its canvas coordinates', () => {
    render(
      <svg viewBox="0 0 100 100">
        <RoomLabelLayer labels={labels} onMove={() => {}} />
      </svg>
    );
    const el = screen.getByTestId('room-label-r1');
    expect(el.textContent).toBe('Kitchen');
    expect(el.getAttribute('x')).toBe('20');
    expect(el.getAttribute('y')).toBe('30');
  });
});
