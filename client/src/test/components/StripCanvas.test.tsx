import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  it('applies the provided live color as the inline stroke style (so it wins over the CSS class)', () => {
    render(
      <StripCanvas
        strips={strips}
        selected={new Set()}
        staleControllerIds={new Set()}
        onSelectionChange={vi.fn()}
        liveColors={new Map([['s1', 'rgb(200, 50, 25)']])}
      />
    );
    // Applied via inline style, not the presentation attribute — a presentation
    // attribute would lose to `.strip { stroke: ... }` in the real browser cascade.
    expect((screen.getByTestId('strip-s1') as unknown as SVGElement).style.stroke).toBe('rgb(200, 50, 25)');
    expect(screen.getByTestId('strip-s1').getAttribute('stroke')).toBeNull();
  });

  describe('marquee selection', () => {
    beforeEach(() => {
      // jsdom returns an all-zero rect; give the canvas a 100x100 box so
      // client coords map 1:1 onto the 0..100 canvas coordinate space.
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({})
      } as DOMRect);
    });
    afterEach(() => vi.restoreAllMocks());

    it('selects every strip whose point falls inside the dragged box', () => {
      const onSelectionChange = vi.fn();
      render(<StripCanvas strips={strips} selected={new Set()} staleControllerIds={new Set()} onSelectionChange={onSelectionChange} />);
      const bg = screen.getByTestId('canvas-bg');
      fireEvent.mouseDown(bg, { clientX: 5, clientY: 5 });
      fireEvent.mouseMove(bg, { clientX: 95, clientY: 95 });
      fireEvent.mouseUp(bg, { clientX: 95, clientY: 95 });
      expect(onSelectionChange).toHaveBeenCalledWith(new Set(['s1', 's2']));
    });

    it('clears the selection on a zero-area click of empty canvas', () => {
      const onSelectionChange = vi.fn();
      render(<StripCanvas strips={strips} selected={new Set(['s1'])} staleControllerIds={new Set()} onSelectionChange={onSelectionChange} />);
      const bg = screen.getByTestId('canvas-bg');
      fireEvent.mouseDown(bg, { clientX: 20, clientY: 20 });
      fireEvent.mouseUp(bg, { clientX: 20, clientY: 20 });
      expect(onSelectionChange).toHaveBeenCalledWith(new Set());
    });
  });
});
