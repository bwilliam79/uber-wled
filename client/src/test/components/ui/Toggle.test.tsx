import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from '../../../components/ui';

describe('Toggle', () => {
  it('is a switch with aria-checked reflecting state', () => {
    const { rerender } = render(<Toggle label="Power" checked={false} onChange={() => {}} />);
    const sw = screen.getByRole('switch', { name: 'Power' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    rerender(<Toggle label="Power" checked onChange={() => {}} />);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.className).toContain('on');
  });

  it('reports the inverted value on click', () => {
    const onChange = vi.fn();
    render(<Toggle label="Power" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Power' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing when disabled', () => {
    const onChange = vi.fn();
    render(<Toggle label="Power" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Power' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
