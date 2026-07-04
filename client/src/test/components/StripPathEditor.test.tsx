import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StripPathEditor } from '../../components/StripPathEditor';
import type { Controller } from '../../api/client';

const controllers: Controller[] = [
  { id: 'c1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }
];

describe('StripPathEditor', () => {
  it('collects clicked points and completes with the chosen controller + segment binding', () => {
    const onComplete = vi.fn();
    render(<StripPathEditor controllers={controllers} onComplete={onComplete} onCancel={vi.fn()} />);
    const canvas = screen.getByTestId('draw-canvas');
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 30, clientY: 10 });
    fireEvent.change(screen.getByLabelText(/segment id/i), { target: { value: '2' } });
    fireEvent.click(screen.getByText(/Finish strip/));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const arg = onComplete.mock.calls[0][0];
    expect(arg.controllerId).toBe('c1');
    expect(arg.wledSegId).toBe(2);
    expect(arg.points).toHaveLength(2);
  });
});
