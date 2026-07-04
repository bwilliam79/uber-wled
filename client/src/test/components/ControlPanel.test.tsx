import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ControlPanel } from '../../components/ControlPanel';

describe('ControlPanel', () => {
  it('calls onApply with a brightness action when the slider is committed', () => {
    const onApply = vi.fn();
    render(
      <ControlPanel
        selectedMembers={[{ controllerId: 'c1', wledSegId: 0 }]}
        themes={[]}
        onApply={onApply}
      />
    );
    const slider = screen.getByLabelText(/brightness/i);
    fireEvent.change(slider, { target: { value: '150' } });
    expect(onApply).toHaveBeenCalledWith({ type: 'brightness', value: 150 });
  });

  it('calls onApply with a theme action when a theme is chosen', () => {
    const onApply = vi.fn();
    render(
      <ControlPanel
        selectedMembers={[{ controllerId: 'c1', wledSegId: 0 }]}
        themes={[{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }]}
        onApply={onApply}
      />
    );
    fireEvent.click(screen.getByText('Sunset'));
    expect(onApply).toHaveBeenCalledWith({ type: 'theme', themeId: 't1' });
  });

  it('shows a neutral empty state and disables controls when nothing is selected', () => {
    render(<ControlPanel selectedMembers={[]} themes={[]} onApply={vi.fn()} />);
    expect(screen.getByText(/Select a strip to control it/)).toBeTruthy();
    expect((screen.getByLabelText(/brightness/i) as HTMLInputElement).disabled).toBe(true);
  });
});
