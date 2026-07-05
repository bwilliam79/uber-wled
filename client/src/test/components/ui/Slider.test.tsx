import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Slider } from '../../../components/ui';

describe('Slider', () => {
  it('renders an accessible range input with the fill percentage as an inline custom property', () => {
    render(<Slider label="Brightness" value={51} min={0} max={255} onChange={() => {}} />);
    const input = screen.getByRole('slider', { name: 'Brightness' }) as HTMLInputElement;
    expect(input.value).toBe('51');
    expect(input.min).toBe('0');
    expect(input.max).toBe('255');
    expect(input.style.getPropertyValue('--ui-slider-fill')).toBe('20%');
    expect(input.className).toContain('ui-slider');
  });

  it('passes a custom fill color through as --ui-slider-color', () => {
    render(<Slider label="Red" value={0} max={255} fillColor="#ff0000" onChange={() => {}} />);
    const input = screen.getByRole('slider', { name: 'Red' });
    expect(input.style.getPropertyValue('--ui-slider-color')).toBe('#ff0000');
  });

  it('emits numeric onChange for every input and onCommit on pointer release', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Slider label="Brightness" value={51} max={255} onChange={onChange} onCommit={onCommit} />);
    const input = screen.getByRole('slider', { name: 'Brightness' });
    fireEvent.change(input, { target: { value: '200' } });
    expect(onChange).toHaveBeenCalledWith(200);
    fireEvent.pointerUp(input);
    expect(onCommit).toHaveBeenCalledWith(51); // controlled value at release time
  });

  it('emits onCommit when an arrow key is released (keyboard operation)', () => {
    const onCommit = vi.fn();
    render(<Slider label="Brightness" value={51} max={255} onChange={() => {}} onCommit={onCommit} />);
    fireEvent.keyUp(screen.getByRole('slider', { name: 'Brightness' }), { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledWith(51);
    fireEvent.keyUp(screen.getByRole('slider', { name: 'Brightness' }), { key: 'a' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
