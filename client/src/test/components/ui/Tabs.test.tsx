import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../../../components/ui';

const TABS = [
  { id: 'colors', label: 'Colors' },
  { id: 'effects', label: 'Effects' },
  { id: 'palettes', label: 'Palettes' }
];

describe('Tabs', () => {
  it('renders a tablist and marks the active tab selected with roving tabindex', () => {
    render(<Tabs tabs={TABS} active="effects" onChange={() => {}} label="Control tabs" />);
    expect(screen.getByRole('tablist', { name: 'Control tabs' })).toBeTruthy();
    const active = screen.getByRole('tab', { name: 'Effects' });
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.tabIndex).toBe(0);
    const inactive = screen.getByRole('tab', { name: 'Colors' });
    expect(inactive.getAttribute('aria-selected')).toBe('false');
    expect(inactive.tabIndex).toBe(-1);
  });

  it('changes tab on click', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="colors" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Palettes' }));
    expect(onChange).toHaveBeenCalledWith('palettes');
  });

  it('moves with ArrowRight/ArrowLeft and wraps at the ends', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="palettes" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Palettes' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('colors'); // wraps
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Palettes' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('effects');
  });
});
