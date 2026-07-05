import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WifiForm } from '../../sections/devices/config/WifiForm';
import { probedCfg } from './fixtures';

function renderForm(onSave = vi.fn()) {
  render(<WifiForm cfg={probedCfg()} busy={false} onSave={onSave} />);
  return onSave;
}

describe('WifiForm', () => {
  it('seeds from the probe and shows the saved-password hint', () => {
    renderForm();
    expect((screen.getByLabelText('Network SSID') as HTMLInputElement).value).toBe('Williams');
    expect((screen.getByLabelText('Static IP (0.0.0.0 = DHCP)') as HTMLInputElement).value).toBe('0.0.0.0');
    expect((screen.getByLabelText('Subnet mask') as HTMLInputElement).value).toBe('255.255.255.0');
    expect(screen.getByText(/A 10-character password is saved/)).toBeTruthy();
  });

  it('a blank password never enters the patch (write-only)', () => {
    const onSave = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save WiFi' }));
    const patch = onSave.mock.calls[0][0];
    expect('psk' in patch.nw.ins[0]).toBe(false);
    expect('psk' in patch.ap).toBe(false);
  });

  it('a typed password is included once', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('Network password'), { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save WiFi' }));
    expect(onSave.mock.calls[0][0].nw.ins[0].psk).toBe('hunter22');
  });

  it('an invalid static IP shows an error and blocks the save', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('Static IP (0.0.0.0 = DHCP)'), { target: { value: 'lights.local' } });
    expect(screen.getByRole('alert').textContent).toMatch(/dotted-quad/i);
    expect((screen.getByRole('button', { name: 'Save WiFi' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
