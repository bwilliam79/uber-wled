import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncForm } from '../../sections/devices/config/SyncForm';
import { TimeForm } from '../../sections/devices/config/TimeForm';
import { LedPrefsForm } from '../../sections/devices/config/LedPrefsForm';
import { probedCfg } from './fixtures';

describe('SyncForm', () => {
  it('seeds the probed ports and receive flags', () => {
    render(<SyncForm cfg={probedCfg()} busy={false} onSave={vi.fn()} />);
    expect((screen.getByLabelText('UDP port') as HTMLInputElement).value).toBe('21324');
    expect((screen.getByLabelText('UDP port 2') as HTMLInputElement).value).toBe('65506');
    expect(screen.getByRole('switch', { name: 'Receive brightness' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Receive segment options' }).getAttribute('aria-checked')).toBe('false');
  });

  it('saves only the edited sync keys (unknown keys stay server-side)', () => {
    const onSave = vi.fn();
    render(<SyncForm cfg={probedCfg()} busy={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Receive segment options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save sync' }));
    const patch = onSave.mock.calls[0][0];
    expect(patch.if.sync.recv).toEqual({
      bri: true, col: true, fx: true, pal: true, seg: true, sb: false, grp: 1
    });
    expect(patch.if.sync.port0).toBe(21324);
    expect('espnow' in patch.if.sync).toBe(false);
  });
});

describe('TimeForm', () => {
  it('seeds the probed NTP settings', () => {
    render(<TimeForm cfg={probedCfg()} busy={false} onSave={vi.fn()} />);
    expect((screen.getByLabelText('NTP server') as HTMLInputElement).value).toBe('0.wled.pool.ntp.org');
    expect((screen.getByLabelText('Timezone index (WLED table)') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('33.24');
  });

  it('saves the exact if.ntp shape', () => {
    const onSave = vi.fn();
    render(<TimeForm cfg={probedCfg()} busy={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Timezone index (WLED table)'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save time' }));
    expect(onSave.mock.calls[0][0]).toEqual({
      if: { ntp: { en: true, host: '0.wled.pool.ntp.org', tz: 6, offset: 0, ampm: false, lt: 33.24, ln: -96.78 } }
    });
  });
});

describe('LedPrefsForm', () => {
  it('seeds boot preset 1, boot brightness 128, transition 700 ms', () => {
    render(<LedPrefsForm cfg={probedCfg()} busy={false} onSave={vi.fn()} />);
    expect((screen.getByLabelText('Boot preset id (0 = none)') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Transition duration (ms)') as HTMLInputElement).value).toBe('700');
    expect((screen.getByLabelText('Boot brightness') as HTMLInputElement).value).toBe('128');
  });

  it('converts transition ms back to WLED 100ms units on save', () => {
    const onSave = vi.fn();
    render(<LedPrefsForm cfg={probedCfg()} busy={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Transition duration (ms)'), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED preferences' }));
    expect(onSave.mock.calls[0][0]).toEqual({
      def: { ps: 1, on: false, bri: 128 },
      light: { 'scale-bri': 100, gc: { col: 2.8 }, tr: { dur: 12 } }
    });
  });
});
