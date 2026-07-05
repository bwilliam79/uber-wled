import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ColorWheel } from '../../components/ui/ColorWheel';

type Rgb = { r: number; g: number; b: number };
const instances: FakePicker[] = [];

class FakeColor {
  rgb: Rgb = { r: 0, g: 0, b: 0 };
  setCalls: Rgb[] = [];
  set(c: Rgb) { this.rgb = { ...c }; this.setCalls.push({ ...c }); }
}

class FakePicker {
  color = new FakeColor();
  handlers: Record<string, ((c: { rgb: Rgb }) => void)[]> = {};
  constructor(_el: HTMLElement, opts: { color: Rgb }) {
    this.color.rgb = { ...opts.color };
    instances.push(this);
  }
  on(evt: string, fn: (c: { rgb: Rgb }) => void) { (this.handlers[evt] ??= []).push(fn); }
  emitChange() { for (const fn of this.handlers['color:change'] ?? []) fn({ rgb: { ...this.color.rgb } }); }
}

vi.mock('@jaames/iro', () => ({
  default: {
    ColorPicker: (el: HTMLElement, opts: { color: Rgb }) => new FakePicker(el, opts),
    ui: { Wheel: 'wheel' }
  }
}));

describe('ColorWheel', () => {
  beforeEach(() => { instances.length = 0; });

  it('mounts one picker seeded with the color prop', () => {
    render(<ColorWheel color={{ r: 255, g: 0, b: 0 }} onChange={vi.fn()} />);
    expect(instances).toHaveLength(1);
    expect(instances[0].color.rgb).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('forwards user color changes to onChange', () => {
    const onChange = vi.fn();
    render(<ColorWheel color={{ r: 255, g: 0, b: 0 }} onChange={onChange} />);
    instances[0].color.rgb = { r: 10, g: 20, b: 30 };
    instances[0].emitChange();
    expect(onChange).toHaveBeenCalledWith({ r: 10, g: 20, b: 30 });
  });

  it('pushes external color prop changes into the picker without re-emitting onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColorWheel color={{ r: 255, g: 0, b: 0 }} onChange={onChange} />);
    rerender(<ColorWheel color={{ r: 0, g: 255, b: 0 }} onChange={onChange} />);
    expect(instances[0].color.setCalls).toContainEqual({ r: 0, g: 255, b: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('skips picker updates when the prop already matches', () => {
    const { rerender } = render(<ColorWheel color={{ r: 1, g: 2, b: 3 }} onChange={vi.fn()} />);
    rerender(<ColorWheel color={{ r: 1, g: 2, b: 3 }} onChange={vi.fn()} />);
    expect(instances[0].color.setCalls).toHaveLength(0);
  });
});
