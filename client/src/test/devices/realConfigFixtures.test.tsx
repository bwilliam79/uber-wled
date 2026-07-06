/**
 * Fixture-driven audit: renders every form against the THREE real captured
 * configs (client/src/test/devices/fixtures/*.json — see fixtures/index.ts
 * for provenance) and asserts the previously-broken/missing fields actually
 * appear, plus round-trips them through the patch builders.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LedHardwareForm } from '../../sections/devices/config/LedHardwareForm';
import { WifiForm } from '../../sections/devices/config/WifiForm';
import { AdvancedJsonForm } from '../../sections/devices/config/AdvancedJsonForm';
import { outputDraftFromRow, mergeOutputRow } from '../../sections/devices/configPatches';
import { REAL_CONFIGS, cabinetLightsCfg, deskLightsCfg, tvLightsCfg } from './fixtures/realConfigs';

describe('real config fixtures — hw.led.total is always exactly sum(len)', () => {
  for (const { name, cfg } of REAL_CONFIGS) {
    it(name, () => {
      const c = cfg();
      const sum = c.hw.led.ins.reduce((s: number, row: any) => s + row.len, 0);
      expect(sum).toBe(c.hw.led.total);
    });
  }
});

describe('real config fixtures — outputDraftFromRow/mergeOutputRow round-trip every output losslessly', () => {
  for (const { name, cfg } of REAL_CONFIGS) {
    it(name, () => {
      const c = cfg();
      for (const row of c.hw.led.ins) {
        const draft = outputDraftFromRow(row);
        const merged = mergeOutputRow(row, draft);
        expect(merged).toEqual(row); // unchanged draft must reproduce the exact original row
      }
    });
  }
});

describe('LedHardwareForm against real configs', () => {
  it('cabinet-lights: RGBW order 34 decodes to BRG + W&G swap on BOTH outputs, ledma/maxpwr seeded', () => {
    render(<LedHardwareForm cfg={cabinetLightsCfg()} busy={false} onSave={vi.fn()} />);
    const colorOrders = screen.getAllByLabelText(/color order/) as HTMLSelectElement[];
    const whiteSwaps = screen.getAllByLabelText(/white channel swap/) as HTMLSelectElement[];
    expect(colorOrders.map((s) => s.value)).toEqual(['2', '2']);
    expect(whiteSwaps.map((s) => s.value)).toEqual(['2', '2']);
    expect((screen.getAllByLabelText('mA per LED')[0] as HTMLInputElement).value).toBe('55');
    expect((screen.getByLabelText('Total LED count (derived)') as HTMLInputElement).value).toBe('48');
    expect((screen.getByLabelText('Global auto-white mode') as HTMLSelectElement).value).toBe('255');
  });

  it('desk-lights: analog TYPE_ANALOG_5CH (45) output with order 1 (RGB, no white swap) and nonzero freq', () => {
    render(<LedHardwareForm cfg={deskLightsCfg()} busy={false} onSave={vi.fn()} />);
    expect((screen.getByLabelText('Output 1 LED type') as HTMLSelectElement).value).toBe('45');
    expect((screen.getByLabelText('Output 1 color order') as HTMLSelectElement).value).toBe('1');
    expect((screen.getByLabelText('Output 1 white channel swap') as HTMLSelectElement).value).toBe('0');
    expect((screen.getByLabelText('PWM frequency (Hz)') as HTMLInputElement).value).toBe('880');
    expect((screen.getByLabelText('GPIO pin') as HTMLInputElement).value).toBe('5'); // first of 5 pins
    expect((screen.getByLabelText('Total LED count (derived)') as HTMLInputElement).value).toBe('1');
  });

  it('tv-lights: plain RGB (order 0), per-output rgbwm None, per-output AND global maxpwr both bound independently', () => {
    const onSave = vi.fn();
    render(<LedHardwareForm cfg={tvLightsCfg()} busy={false} onSave={onSave} />);
    expect((screen.getByLabelText('Output 1 color order') as HTMLSelectElement).value).toBe('0');
    expect((screen.getByLabelText('Output 1 auto-white mode') as HTMLSelectElement).value).toBe('0');
    const maxCurrents = screen.getAllByLabelText(/Max current/) as HTMLInputElement[];
    expect(maxCurrents[0].value).toBe('5000'); // global
    expect(maxCurrents[1].value).toBe('5000'); // per-output override
    // Editing only the per-output value must not disturb the global one in the patch.
    fireEvent.change(maxCurrents[1], { target: { value: '3000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED & hardware' }));
    const patch = onSave.mock.calls[0][0];
    expect(patch.hw.led.maxpwr).toBe(5000);
    expect(patch.hw.led.ins[0].maxpwr).toBe(3000);
  });
});

describe('WifiForm against real configs', () => {
  it('desk-lights: older firmware with no wifi.txpwr and ap.pskl 0 still renders without crashing', () => {
    render(<WifiForm cfg={deskLightsCfg()} busy={false} onSave={vi.fn()} />);
    expect((screen.getByLabelText('Network SSID') as HTMLInputElement).value).toBe('Williams');
    expect(screen.getByText('Leave blank to keep the saved password')).toBeTruthy();
  });

  it('cabinet-lights: seeds real wifi radio settings (sleep=false, txpwr=78)', () => {
    render(<WifiForm cfg={cabinetLightsCfg()} busy={false} onSave={vi.fn()} />);
    expect((screen.getByLabelText('TX power') as HTMLSelectElement).value).toBe('78');
    expect(screen.getByRole('switch', { name: /modem-sleep/ }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('AdvancedJsonForm against a real config shows the COMPLETE raw cfg', () => {
  it('includes um, timers, ol, ota, and wifi — sections a previous filter could have dropped', () => {
    render(<AdvancedJsonForm cfg={cabinetLightsCfg()} busy={false} onSave={vi.fn()} />);
    const text = (screen.getByLabelText('cfg.json') as HTMLTextAreaElement).value;
    for (const key of ['"um"', '"timers"', '"ol"', '"ota"', '"wifi"', '"AudioReactive"']) {
      expect(text).toContain(key);
    }
  });
});
