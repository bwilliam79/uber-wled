import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PresetsTab } from '../../control/PresetsTab';
import type { CustomTheme, DevicePreset } from '../../api/client';

const THEMES: CustomTheme[] = [
  { id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0], [80, 0, 120]], brightness: 180 }
];
const PRESETS: DevicePreset[] = [
  { id: 1, name: 'Night mode', isPlaylist: false, quicklook: { on: true, bri: 40 } },
  { id: 2, name: 'Party loop', isPlaylist: true }
];

describe('PresetsTab', () => {
  it('always lists themes and applies them via onApplyTheme', () => {
    const onApplyTheme = vi.fn();
    render(<PresetsTab themes={THEMES} devicePresets={null}
      onApplyTheme={onApplyTheme} onApplyDevicePreset={vi.fn()} />);
    expect(screen.getByText('Sunset')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply theme Sunset' }));
    expect(onApplyTheme).toHaveBeenCalledWith(THEMES[0]);
  });

  it('hints that device presets need a single device when devicePresets is null', () => {
    render(<PresetsTab themes={[]} devicePresets={null}
      onApplyTheme={vi.fn()} onApplyDevicePreset={vi.fn()} />);
    expect(screen.getByText(/single device is selected/)).toBeTruthy();
  });

  it('lists device presets with a playlist badge and applies via onApplyDevicePreset', () => {
    const onApplyDevicePreset = vi.fn();
    render(<PresetsTab themes={[]} devicePresets={PRESETS}
      onApplyTheme={vi.fn()} onApplyDevicePreset={onApplyDevicePreset} />);
    expect(screen.getByText('Night mode')).toBeTruthy();
    const partyRow = screen.getByText('Party loop').closest('li')!;
    expect(partyRow.textContent).toContain('Playlist');
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset Night mode' }));
    expect(onApplyDevicePreset).toHaveBeenCalledWith(PRESETS[0]);
  });

  it('shows the empty message for a device with no presets', () => {
    render(<PresetsTab themes={[]} devicePresets={[]}
      onApplyTheme={vi.fn()} onApplyDevicePreset={vi.fn()} />);
    expect(screen.getByText(/No presets saved on this device/)).toBeTruthy();
  });
});
