import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloorplanCanvas } from '../../components/FloorplanCanvas';

const floorplan = {
  id: 'f1', name: 'Main', imagePath: '/data/floorplans/x.png',
  cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, rotation: 0, zoom: 1
};

const placements = [
  { id: 'p1', floorplanId: 'f1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 90, y: 10 }], lengthMeters: 3 }
];

describe('FloorplanCanvas', () => {
  it('renders a polyline per placement and toggles selection on click', () => {
    const onToggleSelect = vi.fn();
    render(
      <FloorplanCanvas
        floorplan={floorplan}
        placements={placements}
        selected={new Set()}
        onToggleSelect={onToggleSelect}
      />
    );
    const line = screen.getByTestId('placement-p1');
    fireEvent.click(line);
    expect(onToggleSelect).toHaveBeenCalledWith('p1');
  });

  it('marks a selected placement with a distinct data attribute', () => {
    render(
      <FloorplanCanvas
        floorplan={floorplan}
        placements={placements}
        selected={new Set(['p1'])}
        onToggleSelect={vi.fn()}
      />
    );
    expect(screen.getByTestId('placement-p1').getAttribute('data-selected')).toBe('true');
  });
});
