import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl, SearchInput, Select } from '../../../components/ui';

describe('SegmentedControl', () => {
  const OPTS = [
    { value: 'controller', label: 'Whole controller' },
    { value: 'segment', label: 'Segment' }
  ];

  it('renders a radiogroup with aria-checked on the active option', () => {
    render(<SegmentedControl options={OPTS} value="segment" onChange={() => {}} label="Target kind" />);
    expect(screen.getByRole('radiogroup', { name: 'Target kind' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Segment' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Whole controller' }).getAttribute('aria-checked')).toBe('false');
  });

  it('emits the clicked value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTS} value="segment" onChange={onChange} label="Target kind" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Whole controller' }));
    expect(onChange).toHaveBeenCalledWith('controller');
  });
});

describe('SearchInput', () => {
  it('emits typed text and clears via the clear button', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchInput value="" onChange={onChange} label="Search effects" />);
    const box = screen.getByRole('searchbox', { name: 'Search effects' });
    fireEvent.change(box, { target: { value: 'rainbow' } });
    expect(onChange).toHaveBeenCalledWith('rainbow');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    rerender(<SearchInput value="rainbow" onChange={onChange} label="Search effects" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('Select', () => {
  it('renders options and emits the chosen value', () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Mode"
        value="a"
        onChange={onChange}
        options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]}
      />
    );
    const select = screen.getByRole('combobox', { name: 'Mode' }) as HTMLSelectElement;
    expect(select.value).toBe('a');
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
