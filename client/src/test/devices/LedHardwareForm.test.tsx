import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LedHardwareForm } from '../../sections/devices/config/LedHardwareForm';
import { probedCfg } from './fixtures';

function renderForm(onSave = vi.fn()) {
  render(<LedHardwareForm cfg={probedCfg()} busy={false} onSave={onSave} />);
  return onSave;
}

describe('LedHardwareForm', () => {
  it('seeds both probed outputs: GPIO 16/3, type SK6812, color order BRG', () => {
    renderForm();
    const pins = screen.getAllByLabelText('GPIO pin') as HTMLInputElement[];
    expect(pins.map((p) => p.value)).toEqual(['16', '3']);
    expect((screen.getByLabelText('Output 1 LED type') as HTMLSelectElement).value).toBe('30');
    expect((screen.getByLabelText('Output 1 color order') as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText('Output 1 auto-white mode') as HTMLSelectElement).value).toBe('2');
  });

  it('editing output 1 length emits a merged-row patch that keeps unknown keys', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getAllByLabelText('Length')[0], { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED & hardware' }));
    const patch = onSave.mock.calls[0][0];
    expect(patch.hw.led.ins[0]).toMatchObject({ len: 40, ledma: 55, freq: 0, ref: false });
    expect(patch.hw.led.ins[1].len).toBe(9);
  });

  it('changing the color order preserves the white-swap high nibble (0x22 → 0x21)', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('Output 1 color order'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED & hardware' }));
    expect(onSave.mock.calls[0][0].hw.led.ins[0].order).toBe(33);
  });

  it('total is derived from the sum of output lengths, not independently editable', () => {
    renderForm();
    const totalInput = screen.getByLabelText('Total LED count (derived)') as HTMLInputElement;
    expect(totalInput.value).toBe('48'); // 39 + 9
    expect(totalInput.readOnly).toBe(true);
    fireEvent.change(screen.getAllByLabelText('Length')[0], { target: { value: '40' } });
    expect((screen.getByLabelText('Total LED count (derived)') as HTMLInputElement).value).toBe('49');
  });

  it('max power, global auto-white mode, and FPS map to the hw.led globals', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getAllByLabelText(/Max current/)[0], { target: { value: '850' } });
    fireEvent.change(screen.getByLabelText('Global auto-white mode'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Target FPS'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED & hardware' }));
    const patch = onSave.mock.calls[0][0];
    expect(patch.hw.led.total).toBe(48);
    expect(patch.hw.led.maxpwr).toBe(850);
    expect(patch.hw.led.rgbwm).toBe(2);
    expect(patch.hw.led.fps).toBe(60);
  });

  it('seeds per-output ledma/maxpwr/freq and white-swap, and round-trips edits', () => {
    const onSave = renderForm();
    expect((screen.getAllByLabelText('mA per LED')[0] as HTMLInputElement).value).toBe('55');
    expect((screen.getAllByLabelText(/Max current/)[1] as HTMLInputElement).value).toBe('0');
    expect((screen.getAllByLabelText('PWM frequency (Hz)')[0] as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Output 1 white channel swap') as HTMLSelectElement).value).toBe('2');
    fireEvent.change(screen.getAllByLabelText('mA per LED')[0], { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save LED & hardware' }));
    expect(onSave.mock.calls[0][0].hw.led.ins[0].ledma).toBe(12);
  });
});
