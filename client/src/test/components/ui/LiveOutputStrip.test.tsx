import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveOutputStrip } from '../../../components/ui/LiveOutputStrip';
import type { LiveOutputSwatch } from '../../../lib/liveOutputSwatches';

const SWATCHES: LiveOutputSwatch[] = [
  { key: 'c1:0', state: 'on', color: 'rgb(255, 0, 0)', len: 39 },
  { key: 'c1:1', state: 'off', color: '#334155', len: 9 },
  { key: 'c2:unreachable', state: 'unreachable', color: '#3A3F4B', len: 1 },
  { key: 'c3:pending', state: 'pending', color: '#232B3F', len: 1 }
];

describe('LiveOutputStrip', () => {
  it('renders one swatch per entry with an accessible group label', () => {
    render(<LiveOutputStrip swatches={SWATCHES} />);
    expect(screen.getByRole('img', { name: 'Live output' })).toBeTruthy();
    expect(screen.getAllByTestId(/^live-swatch-/)).toHaveLength(4);
  });

  it('applies the swatch color as background for on/off states', () => {
    render(<LiveOutputStrip swatches={SWATCHES} />);
    const on = screen.getByTestId('live-swatch-c1:0');
    const off = screen.getByTestId('live-swatch-c1:1');
    expect(on.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(off.style.backgroundColor).toBe('rgb(51, 65, 85)'); // #334155
  });

  it('mutes the off swatch and marks its title accordingly', () => {
    render(<LiveOutputStrip swatches={SWATCHES} />);
    const off = screen.getByTestId('live-swatch-c1:1');
    expect(off.className).toContain('ui-live-swatch-off');
    expect(off.title).toBe('off');
  });

  it('does not set an inline background color for unreachable or pending swatches', () => {
    render(<LiveOutputStrip swatches={SWATCHES} />);
    const unreachable = screen.getByTestId('live-swatch-c2:unreachable');
    const pending = screen.getByTestId('live-swatch-c3:pending');
    expect(unreachable.style.backgroundColor).toBe('');
    expect(unreachable.className).toContain('ui-live-swatch-unreachable');
    expect(unreachable.title).toBe('unreachable');
    expect(pending.style.backgroundColor).toBe('');
    expect(pending.className).toContain('ui-live-swatch-pending');
    expect(pending.title).toBe('waiting for data');
  });

  it('renders nothing but the empty group when there are no swatches', () => {
    render(<LiveOutputStrip swatches={[]} />);
    expect(screen.getByRole('img', { name: 'Live output' }).children).toHaveLength(0);
  });

  it('applies the sm size modifier class', () => {
    render(<LiveOutputStrip swatches={SWATCHES} size="sm" />);
    expect(screen.getByRole('img', { name: 'Live output' }).className).toContain('ui-live-strip-sm');
  });

  it('sizes each swatch proportionally to its segment length via flex-grow', () => {
    render(<LiveOutputStrip swatches={SWATCHES} />);
    const wide = screen.getByTestId('live-swatch-c1:0');
    const narrow = screen.getByTestId('live-swatch-c1:1');
    expect(wide.style.flexGrow).toBe('39');
    expect(narrow.style.flexGrow).toBe('9');
    expect(wide.style.flexBasis).toBe('0px');
  });

  it('renders a row of per-pixel dots instead of the flat color when live pixels are available', () => {
    const withPixels: LiveOutputSwatch[] = [
      { key: 'c1:0', state: 'on', color: 'rgb(255, 0, 0)', len: 39, pixels: ['rgb(1, 2, 3)', 'rgb(4, 5, 6)', 'rgb(7, 8, 9)'] }
    ];
    render(<LiveOutputStrip swatches={withPixels} />);
    const el = screen.getByTestId('live-swatch-c1:0');
    // The swatch becomes a transparent container of dots, not a solid fill.
    expect(el.className).toContain('ui-live-swatch-pixels');
    expect(el.style.backgroundColor).toBe('');
    const dots = el.querySelectorAll('.ui-live-dot');
    expect(dots).toHaveLength(3);
    expect((dots[0] as HTMLElement).style.backgroundColor).toBe('rgb(1, 2, 3)');
  });
});
