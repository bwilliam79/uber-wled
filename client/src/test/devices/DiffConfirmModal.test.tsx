import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffConfirmModal } from '../../sections/devices/DiffConfirmModal';

const SAFE_DIFF = [
  { path: 'id.name', from: 'Cabinet Lights', to: 'Kitchen Cabinets' },
  { path: 'hw.led.total', from: 48, to: 49 }
];
const RISKY_DIFF = [
  { path: 'nw.ins.0.ssid', from: 'Williams', to: 'Williams-5G' },
  { path: 'hw.led.ins.0.pin.0', from: 16, to: 4 }
];

describe('DiffConfirmModal', () => {
  it('renders one row per diff entry with path, from, and to', () => {
    render(<DiffConfirmModal open diff={SAFE_DIFF} rebootRequired={false}
      onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('id.name')).toBeTruthy();
    expect(screen.getByText('"Cabinet Lights"')).toBeTruthy();
    expect(screen.getByText('"Kitchen Cabinets"')).toBeTruthy();
    expect(screen.getByText('hw.led.total')).toBeTruthy();
  });

  it('enables Apply immediately for a safe diff and confirms', () => {
    const onConfirm = vi.fn();
    render(<DiffConfirmModal open diff={SAFE_DIFF} rebootRequired={false}
      onConfirm={onConfirm} onCancel={vi.fn()} />);
    const apply = screen.getByRole('button', { name: 'Apply 2 changes' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows the reboot-required note when flagged', () => {
    render(<DiffConfirmModal open diff={SAFE_DIFF} rebootRequired
      onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Reboot required')).toBeTruthy();
  });

  it('blocks a risky (WiFi/GPIO) diff behind an explicit acknowledgement', () => {
    const onConfirm = vi.fn();
    render(<DiffConfirmModal open diff={RISKY_DIFF} rebootRequired
      onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/strand the device/i);
    expect((screen.getByRole('button', { name: 'Apply 2 changes' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I understand this device may become unreachable'));
    const apply = screen.getByRole('button', { name: 'Apply 2 changes' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('renders (unset) for values removed by the patch', () => {
    render(<DiffConfirmModal open diff={[{ path: 'nw.ins.1.ssid', from: 'Old', to: undefined }]}
      rebootRequired={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('(unset)')).toBeTruthy();
  });

  it('calls onCancel from the Cancel button', () => {
    const onCancel = vi.fn();
    render(<DiffConfirmModal open diff={SAFE_DIFF} rebootRequired={false}
      onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
