import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { LayoutCanvas, type LayoutCanvasProps } from '../../../sections/layout/LayoutCanvas';
import { OFFLINE_STROKE, type LiveControllerStatus } from '../../../sections/layout/stripColors';
import type { Strip } from '../../../api/client';

const strips: Strip[] = [
  { id: 's1', controllerId: 'c1', wledSegId: 0, points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], label: 'Porch' },
  { id: 's2', controllerId: 'c2', wledSegId: 3, points: [{ x: 60, y: 60 }, { x: 90, y: 60 }], label: null }
];

// Real segment data captured 2026-07-04 from 192.168.1.86 /json/state.
const live = new Map<string, LiveControllerStatus>([
  ['c1', {
    reachable: true,
    state: { on: true, bri: 9, seg: [{ id: 0, on: true, bri: 255, col: [[255, 255, 255, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }] }
  }]
]);

function makeProps(overrides: Partial<LayoutCanvasProps> = {}): LayoutCanvasProps {
  return {
    strips,
    labels: [],
    live,
    selection: [],
    viewport: { scale: 1, tx: 0, ty: 0 },
    gridSnap: false,
    drawVertices: null,
    drawCursor: null,
    marqueeRect: null,
    svgRef: createRef<SVGSVGElement>(),
    toWorld: (x, y) => ({ x, y }),
    onStripPointerDown: vi.fn(),
    onVertexPointerDown: vi.fn(),
    onBackgroundPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onCanvasClick: vi.fn(),
    onCanvasDoubleClick: vi.fn(),
    onMoveLabel: vi.fn(),
    onRenameLabel: vi.fn(),
    ...overrides
  };
}

describe('LayoutCanvas', () => {
  it('applies the viewport as the world-group transform', () => {
    render(<LayoutCanvas {...makeProps({ viewport: { scale: 2, tx: 15, ty: -3 } })} />);
    expect(screen.getByTestId('world-group').getAttribute('transform')).toBe('translate(15 -3) scale(2)');
  });

  it('strokes strips with the live color via INLINE style (cascade winner), grey when offline', () => {
    render(<LayoutCanvas {...makeProps()} />);
    const s1 = screen.getByTestId('strip-s1') as unknown as SVGElement;
    const s2 = screen.getByTestId('strip-s2') as unknown as SVGElement;
    expect(s1.style.stroke).toBe('rgb(255, 255, 255)');   // live white from real fixture
    expect(s2.style.stroke).toBe(OFFLINE_STROKE);          // c2 absent from live map
    expect(s1.getAttribute('stroke')).toBeNull();          // never the presentation attribute
  });

  it('marks a selected strip with the glow filter and renders its vertex handles', () => {
    render(<LayoutCanvas {...makeProps({ selection: ['s1'] })} />);
    const s1 = screen.getByTestId('strip-s1');
    expect(s1.getAttribute('data-selected')).toBe('true');
    expect(s1.getAttribute('filter')).toBe('url(#strip-glow)');
    expect(screen.getByTestId('vertex-s1-0')).toBeDefined();
    expect(screen.getByTestId('vertex-s1-1')).toBeDefined();
    expect(screen.queryByTestId('vertex-s2-0')).toBeNull();
  });

  it('forwards pointerdown on a strip hit-line with the strip id', () => {
    const onStripPointerDown = vi.fn();
    render(<LayoutCanvas {...makeProps({ onStripPointerDown })} />);
    fireEvent.pointerDown(screen.getByTestId('strip-hit-s1'), { clientX: 20, clientY: 10 });
    expect(onStripPointerDown).toHaveBeenCalledTimes(1);
    expect(onStripPointerDown.mock.calls[0][0]).toBe('s1');
  });

  it('disables strip hit-lines while drawing so clicks fall through to the canvas', () => {
    render(<LayoutCanvas {...makeProps({ drawVertices: [] })} />);
    expect(screen.getByTestId('strip-hit-s1').getAttribute('pointer-events')).toBe('none');
  });

  it('renders the draw preview polyline and the rubber-band line to the cursor', () => {
    render(<LayoutCanvas {...makeProps({
      drawVertices: [{ x: 10, y: 10 }, { x: 50, y: 10 }],
      drawCursor: { x: 50, y: 50 }
    })} />);
    expect(screen.getByTestId('draw-line').getAttribute('points')).toBe('10,10 50,10');
    const rubber = screen.getByTestId('draw-rubber');
    expect(rubber.getAttribute('x1')).toBe('50');
    expect(rubber.getAttribute('y1')).toBe('10');
    expect(rubber.getAttribute('x2')).toBe('50');
    expect(rubber.getAttribute('y2')).toBe('50');
  });

  it('renders the marquee rect in world coordinates', () => {
    render(<LayoutCanvas {...makeProps({ marqueeRect: { x: 5, y: 6, w: 30, h: 20 } })} />);
    const m = screen.getByTestId('marquee');
    expect(m.getAttribute('x')).toBe('5');
    expect(m.getAttribute('width')).toBe('30');
  });

  it('renders the grid only when gridSnap is on', () => {
    const { rerender } = render(<LayoutCanvas {...makeProps()} />);
    expect(screen.queryByTestId('layout-grid')).toBeNull();
    rerender(<LayoutCanvas {...makeProps({ gridSnap: true })} />);
    expect(screen.getByTestId('layout-grid')).toBeDefined();
  });
});
