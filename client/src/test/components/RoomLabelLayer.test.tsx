import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomLabelLayer } from '../../components/RoomLabelLayer';
import type { RoomLabel } from '../../api/client';

const labels: RoomLabel[] = [{ id: 'r1', name: 'Kitchen', x: 20, y: 30 }];

describe('RoomLabelLayer', () => {
  afterEach(() => vi.restoreAllMocks());

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

  it('commits the dragged position via onMove on drag → move → release', () => {
    // jsdom returns an all-zero rect; give the svg a 100x100 box so client
    // coords map 1:1 onto the 0..100 canvas coordinate space.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect);
    const onMove = vi.fn();
    render(
      <svg viewBox="0 0 100 100">
        <RoomLabelLayer labels={labels} onMove={onMove} />
      </svg>
    );
    const label = screen.getByTestId('room-label-r1');
    const layer = label.parentElement!; // the <g> that owns move/up handlers
    fireEvent.mouseDown(label, { clientX: 20, clientY: 30 });
    fireEvent.mouseMove(layer, { clientX: 65, clientY: 45 });
    fireEvent.mouseUp(layer, { clientX: 65, clientY: 45 });
    expect(onMove).toHaveBeenCalledWith('r1', 65, 45);
  });
});
