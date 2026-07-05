import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomLabels } from '../../../sections/layout/RoomLabels';
import type { RoomLabel } from '../../../api/client';

const labels: RoomLabel[] = [{ id: 'l1', name: 'Kitchen', x: 50, y: 20 }];
const toWorld = (clientX: number, clientY: number) => ({ x: clientX, y: clientY });

function renderLayer(overrides: { onMove?: ReturnType<typeof vi.fn>; onRename?: ReturnType<typeof vi.fn> } = {}) {
  const onMove = overrides.onMove ?? vi.fn();
  const onRename = overrides.onRename ?? vi.fn();
  render(
    <svg>
      <RoomLabels labels={labels} toWorld={toWorld} onMove={onMove} onRename={onRename} />
    </svg>
  );
  return { onMove, onRename };
}

describe('RoomLabels', () => {
  it('renders a chip with the label text', () => {
    renderLayer();
    expect(screen.getByTestId('room-label-l1').textContent).toBe('Kitchen');
  });

  it('drag: pointerdown then move then up commits the new world position once', () => {
    const { onMove } = renderLayer();
    const chip = screen.getByTestId('room-label-l1');
    fireEvent.pointerDown(chip, { clientX: 50, clientY: 20 });
    fireEvent.pointerMove(chip, { clientX: 30, clientY: 40 });
    fireEvent.pointerUp(chip);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('l1', 30, 40);
  });

  it('a pointerup without movement does not call onMove', () => {
    const { onMove } = renderLayer();
    const chip = screen.getByTestId('room-label-l1');
    fireEvent.pointerDown(chip, { clientX: 50, clientY: 20 });
    fireEvent.pointerUp(chip);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('double-click opens an inline input prefilled with the name; Enter commits the rename', () => {
    const { onRename } = renderLayer();
    fireEvent.doubleClick(screen.getByTestId('room-label-l1'));
    const input = screen.getByTestId('room-label-input-l1') as HTMLInputElement;
    expect(input.value).toBe('Kitchen');
    fireEvent.change(input, { target: { value: 'Pantry' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('l1', 'Pantry');
    expect(screen.queryByTestId('room-label-input-l1')).toBeNull();
  });

  it('Escape cancels the rename without calling onRename', () => {
    const { onRename } = renderLayer();
    fireEvent.doubleClick(screen.getByTestId('room-label-l1'));
    const input = screen.getByTestId('room-label-input-l1');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByTestId('room-label-l1').textContent).toBe('Kitchen');
  });

  it('an empty rename is discarded on Enter', () => {
    const { onRename } = renderLayer();
    fireEvent.doubleClick(screen.getByTestId('room-label-l1'));
    const input = screen.getByTestId('room-label-input-l1');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
  });
});
