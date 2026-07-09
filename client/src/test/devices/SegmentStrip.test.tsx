import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentStrip } from '../../sections/devices/SegmentStrip';
import type { DeviceSegment } from '../../api/client';

function seg(id: number, start: number, stop: number, extra: Partial<DeviceSegment> = {}): DeviceSegment {
  return {
    id, start, stop, on: true, bri: 255, col: [[255, 255, 255, 0]],
    grp: 1, spc: 0, of: 0, rev: false, mi: false, ...extra
  } as DeviceSegment;
}

// Two contiguous segments over a 48-LED strip: [0,20) and [20,48).
const SEGMENTS = [seg(0, 0, 20), seg(1, 20, 48)];

function renderStrip(overrides: Partial<Parameters<typeof SegmentStrip>[0]> = {}) {
  const props = {
    segments: SEGMENTS, ledCount: 48, busy: false, selectedId: null as number | null,
    onSelect: vi.fn(), onSplit: vi.fn(), onMerge: vi.fn(), onBoundary: vi.fn(),
    effectFor: () => 'solid' as const,
    ...overrides
  };
  render(<SegmentStrip {...props} />);
  return props;
}

describe('SegmentStrip', () => {
  it('renders a zone per segment and a draggable handle on the shared boundary', () => {
    renderStrip();
    expect(screen.getByRole('button', { name: /Segment 0, LEDs 0 to 20/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Segment 1, LEDs 20 to 48/ })).toBeTruthy();
    // One shared, contiguous boundary → one handle (role slider).
    expect(screen.getAllByRole('slider')).toHaveLength(1);
  });

  it('does not render a handle when segments are not contiguous', () => {
    renderStrip({ segments: [seg(0, 0, 10), seg(1, 20, 48)] });
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('selecting a zone reveals Split (at its midpoint) and Merge with the next zone', () => {
    const onSplit = vi.fn();
    const onMerge = vi.fn();
    renderStrip({ selectedId: 0, onSplit, onMerge });
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect(onSplit).toHaveBeenCalledWith(0, 10); // midpoint of [0,20)

    fireEvent.click(screen.getByRole('button', { name: 'Merge →' }));
    expect(onMerge).toHaveBeenCalledWith(0, 1);
  });

  it('clicking a zone selects it', () => {
    const onSelect = vi.fn();
    renderStrip({ onSelect });
    fireEvent.click(screen.getByRole('button', { name: /Segment 1/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('disables Split for a 1-LED segment (cannot halve it)', () => {
    renderStrip({ segments: [seg(0, 0, 1), seg(1, 1, 48)], selectedId: 0 });
    expect((screen.getByRole('button', { name: 'Split' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('commits a dragged boundary on pointer up', () => {
    const onBoundary = vi.fn();
    renderStrip({ onBoundary });
    const handle = screen.getByRole('slider');
    // jsdom gives the track a 0-width rect, so boundaryFromEvent falls back to
    // leftStart+1 (=1); the drag still commits a changed boundary (20 -> 1).
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 120 });
    expect(onBoundary).toHaveBeenCalledWith(0, 1, 1);
  });
});
